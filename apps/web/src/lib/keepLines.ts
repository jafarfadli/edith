import type { LayoutLine, Run, TextBox } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { fontKey } from "@/lib/fonts";
import { layoutText, type LineRange } from "@/lib/layout";
import { paragraphFrame, rawToBox, type MetricsFor } from "@/lib/paragraphs";

/** How far (pt) a text.edit box may be from where paragraphBox put it and still count as in place. */
const IN_PLACE = 0.01;

/** The box keeps its first baseline where `prev` had it: a fallback font with a taller ascent in the first line
 *  (CJK fallbacks are) would otherwise push the whole paragraph down. */
export function keepFirstBaseline(prev: TextBox, box: TextBox): TextBox {
  const before = prev.layout[0]?.baseline, after = box.layout[0]?.baseline;
  if (before === undefined || after === undefined) return box;
  return { ...box, rect: { ...box.rect, y: prev.rect.y + before - after } };
}

function styleKey(r: Run): string {
  return JSON.stringify([fontKey(r.font), r.size, r.color, r.bgColor ?? null, !!r.underline, !!r.strike]);
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
export function inPlace(box: TextBox, p: Paragraph, width: number): boolean {
  const first = box.layout[0];
  return !!first && p.lines.length > 0
    && Math.abs(box.rect.x - p.rect.x) < IN_PLACE && Math.abs(box.rect.w - width) < IN_PLACE
    && (box.align ?? "left") === p.align && Math.abs(box.lineHeight - p.lineHeight) < 1e-6
    && Math.abs(box.rect.y + first.baseline - p.lines[0].baseline) < IN_PLACE;
}

/**
 * The text.edit box of original paragraph `p` (runs prepared as for paragraphBox) after its text became
 * `paragraphs`, from the box `prev` the edit started with. Unchanged lines stay the original's (LayoutLine.source):
 *
 * - The text is compared character by character with its style: the common prefix and suffix are unchanged.
 * - Every original line that starts inside the prefix keeps its break (a forced break), so the lines before the edit
 *   are the original's.
 * - From the first changed line on, the text wraps as usual. Once a wrapped line starts where the original line of
 *   the same index starts (mapped through the edit, inside the suffix), the reflow has settled: every later original
 *   break is forced again, so those lines are the original's too. Lines that moved to another index (an insertion
 *   that added a line, a deleted line) are redrawn.
 * - A line is kept when it holds exactly the characters of the original line of its index, unchanged, and is the
 *   last of its paragraph exactly when that one was (justification).
 *
 * The box must be in place (inPlace), else every line is redrawn. The first baseline stays where `prev` had it.
 */
export function editedBox(prev: TextBox, paragraphs: Run[][], p: Paragraph, metricsFor: MetricsFor): TextBox {
  const frame = paragraphFrame(p, metricsFor);
  const lay = (breaks?: number[]) => layoutText({
    width: prev.rect.w, align: prev.align ?? "left", lineHeight: prev.lineHeight, paragraphs, breaks,
  }, metricsFor);
  const done = (r: ReturnType<typeof layoutText>, layout: LayoutLine[]) =>
    keepFirstBaseline(prev, { ...prev, paragraphs, layout, rect: { ...prev.rect, h: Math.max(r.height, prev.lineHeight) } });
  if (!inPlace(prev, p, frame.width)) {
    const r = lay();
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
  const delta = n.text.length - o.text.length, tail = n.text.length - b;

  const before = orig.slice(1).filter((r) => r.start <= a).map((r) => r.start);
  let r = lay(before);
  const settled = r.ranges.findIndex((x, k) => k > 0 && k < orig.length && x.start >= tail && x.start - delta === orig[k].start);
  if (settled > 0) r = lay([...before, ...orig.slice(settled).map((x) => x.start + delta)]);
  const layout = r.lines.map((line, k) => {
    const x = r.ranges[k], was = orig[k];
    const same = !!was && x.end > x.start && x.last === was.last && (
      (x.end <= a && x.start === was.start && x.end === was.end)
      || (x.start >= tail && x.start - delta === was.start && x.end - delta === was.end));
    return same ? { ...line, source: k } : line;
  });
  return done(r, layout);
}
