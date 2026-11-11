import type { LayoutLine, Run, TextBox } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { fontKey } from "@/lib/fonts";
import { anchorLine, BoxText, JUSTIFY_SQUEEZE } from "@/lib/editLine";
import { layoutText, type LineRange } from "@/lib/layout";
import { growWidth, paragraphFrame, rawToBox, WIDTH_SLACK, type MetricsFor } from "@/lib/paragraphs";

/** How much more than its tightest original line (share of a space) a justified paragraph's lines may compress, and the
 *  most they ever may (see justifyFrame). */
const JUSTIFY_MORE = 0.2;
const MAX_SQUEEZE = 0.6;

/** How far (pt) a text.edit box may be from where paragraphBox put it and still count as in place. */
const IN_PLACE = 0.01;
/** A kept line's baseline may be this far from the original line's: max(KEEP_Y_TOL pt, KEEP_Y_EM × its size). Shared
 *  contract with KEEP_Y_TOL / KEEP_Y_EM in apps/api/edith/bake/text.py (the bake redraws a line beyond it): change both. */
export const KEEP_Y_TOL = 1.0;
export const KEEP_Y_EM = 0.4;
/** The whitespace layoutText drops (`\s`: ECMAScript WhiteSpace and LineTerminator), listed: the bake compares a kept
 *  line without exactly these. Shared contract with SPACE_CHARS in apps/api/edith/bake/text.py. */
export const SPACE_CHARS = "\t\n\v\f\r                  　﻿";

/** TextEdit.decorV of the text.edit ops this client makes: their runs carry the original's drawn decorations (GET /text
 *  Run.underline / strike / bgColor and geometry), so the bake moves those marks with the text. An op without it (an old
 *  draft) leaves them where they are; editing such an op keeps it as it is. */
export const DECOR_V = 1 as const;

/** The box keeps its first baseline where `prev` had it: a fallback font with a taller ascent in the first line
 *  (CJK fallbacks are) would otherwise push the whole paragraph down. */
export function keepFirstBaseline(prev: TextBox, box: TextBox): TextBox {
  const before = prev.layout[0]?.baseline, after = box.layout[0]?.baseline;
  if (before === undefined || after === undefined) return box;
  return { ...box, rect: { ...box.rect, y: prev.rect.y + before - after } };
}

/** True when `paragraphs` hold no character but spaces: an edit of original (or OCR) text that leaves this deletes it. */
export function isBlank(paragraphs: Run[][]): boolean {
  return paragraphs.every((p) => !/\S/.test(p.map((r) => r.text).join("")));
}

/** True when text.edit / text.ocr_edit `box` deletes its text (blankBox, or a box typed empty). */
export function isBlankBox(box: TextBox): boolean {
  return isBlank(box.paragraphs);
}

/**
 * The box of an edit that deletes its paragraph's text (Delete on it, or every character removed): no text, one empty
 * line on `prev`'s first baseline (the style of its first run kept, for typing into it again), and the rect grown down
 * and up over `area` (the original paragraph, or what an OCR edit covers), so the place of the text stays a target that
 * selects the edit (to restore or retype it). The bake redacts every original line (no line is kept) and draws nothing;
 * on screen the covers hide every line.
 */
export function blankBox(prev: TextBox, area: { y: number; h: number }): TextBox {
  const run = prev.paragraphs.flat()[0];
  const baseline = prev.layout[0]?.baseline ?? prev.lineHeight;
  const y = Math.min(prev.rect.y, area.y);
  const bottom = Math.max(prev.rect.y + prev.rect.h, area.y + area.h);
  return {
    ...prev,
    rect: { ...prev.rect, y, h: bottom - y },
    paragraphs: [run ? [{ ...run, text: "" }] : []],
    layout: [{ baseline: prev.rect.y + baseline - y, segments: [] }],
  };
}

/** A character's style, as the bake's kept-line check (bake/text.py _same_char) compares it: with the original's
 *  measured scale and spacing (Run.hScale / charSpacing / wordSpacing). */
function styleKey(r: Run): string {
  return JSON.stringify([fontKey(r.font), r.size, r.color, r.bgColor ?? null, !!r.underline, !!r.strike,
    r.hScale ?? 1, r.charSpacing ?? 0, r.wordSpacing ?? 0,
    r.underlineTop ?? null, r.strikeTop ?? null, r.decorThickness ?? null, r.decorColor ?? null]);
}

/** The box text (paragraphs joined by "\n") and the style of each of its characters. */
function styledText(paragraphs: Run[][]): { text: string; styles: string[] } {
  let text = "";
  const styles: string[] = [];
  paragraphs.forEach((p, i) => {
    if (i) { text += "\n"; styles.push("\n"); }
    for (const r of p) {
      text += r.text;
      const key = styleKey(r);
      for (let k = 0; k < r.text.length; k++) styles.push(key);
    }
  });
  return { text, styles };
}

/** Where `p`'s original lines are in the box text of paragraphRuns(p, breaks), without the spaces around them. */
export function originalRanges(p: Paragraph, breaks: number[], boxText: string): LineRange[] {
  const toBox = rawToBox(p, breaks);
  return p.lines.map((l, i) => {
    let start = toBox(l.start), end = toBox(l.end);
    while (start < end && /\s/.test(boxText[start])) start++;
    while (end > start && /\s/.test(boxText[end - 1])) end--;
    return { start, end, last: i === p.lines.length - 1 || breaks.includes(i) };
  });
}

/** True when `box` is where paragraphBox(p) puts it (same left edge, width, alignment, line height, first baseline):
 *  only then can original lines stay. A moved or resized text.edit redraws everything. */
export function inPlace(box: TextBox, p: Paragraph, x: number, width: number): boolean {
  const first = box.layout[0];
  return !!first && p.lines.length > 0
    && Math.abs(box.rect.x - x) < IN_PLACE && Math.abs(box.rect.w - width) < IN_PLACE
    && (box.align ?? "left") === p.align && Math.abs(box.lineHeight - p.lineHeight) < 1e-6
    && Math.abs(box.rect.y + first.baseline - p.lines[0].baseline) < IN_PLACE;
}

/**
 * The text.edit box of original paragraph `p` (runs prepared as for paragraphBox) after its text became
 * `paragraphs`, from the box `prev` the edit started with. Unchanged lines stay the original's (LayoutLine.source):
 *
 * - The text is compared character by character with its style: the common prefix and suffix are unchanged.
 * - Every original line break the edit leaves stays where it was, as long as each edited line still fits: it may
 *   grow into the room beside the paragraph (growWidth), a justified one may compress its spaces (JUSTIFY_SQUEEZE).
 *   An edited line that got shorter keeps its break too, unless the next line's first word now fits on it where it
 *   did not before (at the box width): then the text reflows, as it does when a line no longer fits or the edit
 *   removed or added a break.
 * - Reflow: the lines before the edit keep their breaks (forced); from the first changed line on, the text wraps as
 *   usual. Once a wrapped line starts where the original line of the same index starts (mapped through the edit,
 *   inside the suffix), the reflow has settled: every later original break is forced again. Lines that moved to
 *   another index (an insertion that added a line, a deleted line) are redrawn.
 * - A line is kept when it holds exactly the characters of the original line of its index, unchanged, and is the
 *   last of its paragraph exactly when that one was (justification).
 * - An edited line that starts where the original line of its index started is re-placed word by word where the
 *   original had its words (anchorLine): the words before the edit keep their glyphs (LayoutLine.prefix).
 *
 * The box must be in place (inPlace), else every line is redrawn. The first baseline stays where `prev` had it.
 * Text left blank deletes the paragraph (blankBox).
 */
export function editedBox(prev: TextBox, paragraphs: Run[][], p: Paragraph, metricsFor: MetricsFor): TextBox {
  if (isBlank(paragraphs)) return blankBox(prev, p.rect);
  const frame = paragraphFrame(p, metricsFor);
  const align = prev.align ?? "left";
  const done = (r: ReturnType<typeof layoutText>, layout: LayoutLine[]) =>
    keepFirstBaseline(prev, { ...prev, paragraphs, layout, rect: { ...prev.rect, h: Math.max(r.height, prev.lineHeight) } });
  if (!inPlace(prev, p, frame.x, frame.width)) {
    const r = layoutText({ width: prev.rect.w, align, lineHeight: prev.lineHeight, paragraphs }, metricsFor);
    return done(r, r.lines);
  }
  const o = styledText(frame.paragraphs), n = styledText(paragraphs);
  const orig = originalRanges(p, frame.breaks, o.text);
  const most = Math.min(o.text.length, n.text.length);
  let a = 0;
  while (a < most && o.text[a] === n.text[a] && o.styles[a] === n.styles[a]) a++;
  let b = 0;
  const at = (s: { text: string; styles: string[] }, k: number) => s.text.length - 1 - k;
  while (b < most - a && o.text[at(o, b)] === n.text[at(n, b)] && o.styles[at(o, b)] === n.styles[at(n, b)]) b++;
  const delta = n.text.length - o.text.length, tail = n.text.length - b, oEnd = o.text.length - b;
  const ob = new BoxText(frame.paragraphs, metricsFor), nb = new BoxText(paragraphs, metricsFor);

  // Justified text is set in its real column (the ink width of its lines), not the box paragraphFrame widened to the
  // natural width of a line Word had compressed: its lines may compress their spaces by JUSTIFY_SQUEEZE, or by as much
  // as an original line was (Word did it, so it may again).
  const { width, squeeze } = align === "justify"
    ? justifyFrame(orig, ob, prev.rect.w, p.rect.w + WIDTH_SLACK) : { width: prev.rect.w, squeeze: 0 };
  const lay = (breaks: number[], fit?: number) => layoutText({
    width, align, lineHeight: prev.lineHeight, paragraphs, breaks, fit, squeeze,
  }, metricsFor);

  // Every original break the edit leaves, where it is now; none inside the changed text.
  const kept = orig.slice(1).flatMap((x) => (x.start <= a ? [x.start] : x.start >= oEnd ? [x.start + delta] : []));
  let r = kept.length === orig.length - 1 ? lay(kept, growWidth(p, width, metricsFor)) : null;
  if (r && !keepsBreaks(r.ranges, kept, orig, a, oEnd, ob, nb, width, squeeze)) r = null;
  if (!r) {
    const before = orig.slice(1).filter((x) => x.start <= a).map((x) => x.start);
    r = lay(before);
    const settled = r.ranges.findIndex((x, k) => k > 0 && k < orig.length && x.start >= tail && x.start - delta === orig[k].start);
    if (settled > 0) r = lay([...before, ...orig.slice(settled).map((x) => x.start + delta)]);
  }
  const ranges = r.ranges;
  const edit = { o: ob, n: nb, a, tail, delta };
  const layout = r.lines.map((line, k) => {
    const x = ranges[k], was = orig[k];
    const same = !!was && x.end > x.start && x.last === was.last && (
      (x.end <= a && x.start === was.start && x.end === was.end)
      || (x.start >= tail && x.start - delta === was.start && x.end - delta === was.end));
    if (same) return { ...line, source: k };
    // An edited original line (same index, same start): its words where the original had them.
    const starts = !!was && (x.start <= a ? x.start === was.start : x.start >= tail && x.start - delta === was.start);
    const pl = p.lines[k];
    // Justified out to the paragraph's right edge in the original (a line the layout ends a logical paragraph with, at a
    // break it guessed hard, may still be one).
    const stretched = align === "justify" && k < p.lines.length - 1 && Math.abs(pl.rect.x + pl.rect.w - (p.rect.x + p.rect.w)) <= 1;
    return (starts && anchorLine(edit, line, x, was, pl, k, { align, stretched, boxX: prev.rect.x, squeeze })) || line;
  });
  // A kept line (or prefix) must also sit on its original baseline, as the bake requires: where the original spaced its
  // lines unevenly, the grid line (lineHeight) is elsewhere, and keeping the glyphs there would disagree with the screen.
  const box = done(r, layout);
  const onBaseline = (line: LayoutLine, k: number) =>
    Math.abs(box.rect.y + line.baseline - p.lines[k].baseline) <= Math.max(KEEP_Y_TOL, KEEP_Y_EM * p.lines[k].size);
  return { ...box, layout: box.layout.map((line, k) => ((line.source != null || line.prefix) && !onBaseline(line, k) ? unkept(line) : line)) };
}

/**
 * Whether a layout with the original breaks `kept` (M5d) holds: it broke nowhere else (every edited line fit), and no
 * edited original line (one holding characters [a, oEnd) of the original, or the insertion point) that is not the last
 * of its paragraph got short enough for the next line's first word to fit on it at the box `width`, where it did not
 * fit on the original line (an edit that shortens a line by a letter leaves it alone, as Word would).
 */
function keepsBreaks(ranges: LineRange[], kept: number[], orig: LineRange[], a: number, oEnd: number, o: BoxText,
  n: BoxText, width: number, squeeze: number): boolean {
  if (ranges.length !== kept.length + 1 || ranges.some((x, k) => k > 0 && x.start !== kept[k - 1])) return false;
  // Holds characters [s, e) and the first word at `next` (paragraph text `t`) on one line at `width`?
  const fits = (t: BoxText, s: number, next: number) => {
    const word = /^\S*/.exec(t.text.slice(next))![0];
    return t.ink(s, next + word.length) <= width + squeeze * t.spaces(s, next) + 1e-6;
  };
  return orig.every((was, k) => {
    const end = k + 1 < orig.length ? orig[k + 1].start - 1 : o.text.length;
    if (was.last || oEnd < was.start || a > end) return true; // not edited, or nothing to pull up
    return !fits(n, ranges[k].start, ranges[k + 1].start) || fits(o, was.start, orig[k + 1].start);
  });
}

/** The width and squeeze (share by which spaces may compress) an edited justified paragraph is set with: its real column
 *  `column` (the ink width of its lines) and JUSTIFY_SQUEEZE. Where Word compressed an original line, its lines may
 *  compress JUSTIFY_MORE beyond the tightest one (Word set them so, a letter more is still a tight line, not a reflow),
 *  up to MAX_SQUEEZE. When an original line can't fit the column so (a line without spaces measured wider), the box
 *  width `box` as before. */
function justifyFrame(orig: LineRange[], o: BoxText, box: number, column: number): { width: number; squeeze: number } {
  let tightest = 0;
  for (const x of orig) {
    const over = o.ink(x.start, x.end) - column;
    if (over <= 0) continue;
    const spaces = o.spaces(x.start, x.end);
    if (!spaces || over / spaces > MAX_SQUEEZE) return { width: box, squeeze: JUSTIFY_SQUEEZE };
    tightest = Math.max(tightest, over / spaces);
  }
  const squeeze = tightest ? Math.min(MAX_SQUEEZE, Math.max(JUSTIFY_SQUEEZE, tightest + JUSTIFY_MORE)) : JUSTIFY_SQUEEZE;
  return { width: Math.min(box, column), squeeze };
}

function unkept(line: LayoutLine): LayoutLine {
  return { baseline: line.baseline, segments: line.segments };
}
