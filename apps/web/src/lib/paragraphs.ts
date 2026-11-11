import type { FontRef, Rect, Run, TextBox } from "@edith/ops";
import type { Paragraph, ParagraphLine } from "@/lib/api";
import { prefixCut } from "@/lib/editLine";
import { textWidth, type FontMetrics } from "@/lib/fonts";
import { normalizeRuns, runsText, sliceRuns } from "@/lib/runs";
import { relayout } from "@/lib/textbox";

// Font fallback lives in lib/fallback.ts (per character since M5); re-exported for its existing users.
export { hasUnsupportedChars, preloadFallback, prepareRuns, resolveLoadedRuns, substituteOf, type FontTable } from "@/lib/fallback";

export type MetricsFor = (f: FontRef) => FontMetrics;
/** Extra box width so a line measured at exactly the box width still fits. */
export const WIDTH_SLACK = 0.01;
/** On-screen cover of an edited paragraph's original line (× size around the baseline). */
export const MASK_ASCENT = 0.95;
export const MASK_DESCENT = 0.25;
/** Height (× size) of Latin ascenders and capitals above the baseline, for covers next to kept lines (maskRects). */
const MEET_ASCENT = 0.75;

/** Width of characters [start, end) of `runs`; trailing spaces are excluded unless `trimEnd` is false. */
export function measureRange(runs: Run[], start: number, end: number, metricsFor: MetricsFor, trimEnd = true): number {
  const pieces = sliceRuns(runs, start, end);
  while (trimEnd && pieces.length && /\s$/.test(pieces[pieces.length - 1].text)) {
    const last = pieces[pieces.length - 1];
    const text = last.text.replace(/\s+$/, "");
    if (text) pieces[pieces.length - 1] = { ...last, text };
    else pieces.pop();
  }
  const w = pieces.reduce((sum, r) => sum + textWidth(r.text, metricsFor(r.font), r.size, r), 0);
  // The range ends at its last glyph's ink: not the character spacing after it (as layoutText measures lines).
  const last = pieces[pieces.length - 1];
  return trimEnd && last && /\S$/.test(last.text) ? w - (last.charSpacing ?? 0) : w;
}

/** Box width that holds every original line on one line. */
export function paragraphWidth(p: Paragraph, metricsFor: MetricsFor): number {
  return Math.max(p.rect.w, ...p.lines.map((l) => measureRange(p.runs, l.start, l.end, metricsFor))) + WIDTH_SLACK;
}

/** Indexes of the lines followed by a hard break: the next line's first word would have fit on the
 *  line, so the original break was not a wrap (addresses, poems, short lines). */
export function hardBreaks(p: Paragraph, width: number, metricsFor: MetricsFor): number[] {
  const text = runsText(p.runs);
  const out: number[] = [];
  p.lines.forEach((line, i) => {
    const next = p.lines[i + 1];
    if (!next) return;
    const word = /^\S*/.exec(text.slice(next.start))![0];
    if (measureRange(p.runs, line.start, next.start + word.length, metricsFor) <= width) out.push(i);
  });
  return out;
}

/** The paragraph's runs as logical paragraphs: split at the hard breaks, whose joining characters are dropped. */
export function paragraphRuns(p: Paragraph, breaks: number[]): Run[][] {
  const out: Run[][] = [];
  let from = 0;
  for (const i of breaks) {
    out.push(normalizeRuns(sliceRuns(p.runs, from, p.lines[i].end)));
    from = p.lines[i + 1].start;
  }
  out.push(normalizeRuns(sliceRuns(p.runs, from, runsText(p.runs).length)));
  return out.map((runs) => (runs.length ? runs : [{ ...p.runs[0], text: "" }]));
}

/** Maps an offset in the paragraph's joined text to the box text of paragraphRuns(p, breaks) (paragraphs joined by "\n"). */
export function rawToBox(p: Paragraph, breaks: number[]): (offset: number) => number {
  return (o) => {
    let shift = 0;
    for (const i of breaks) {
      const gapStart = p.lines[i].end, gapEnd = p.lines[i + 1].start;
      if (o <= gapStart) break;
      if (o < gapEnd) return gapStart + shift;
      shift += 1 - (gapEnd - gapStart);
    }
    return o + shift;
  };
}

/** How far (pt) a single line measured wider than its room may still exceed it (paragraphFrame). */
const OVERSHOOT = 1;
/** A wrap width stays this far (pt) under the narrowest soft break's "line + space + next word" (wrapWidth). */
const BREAK_MARGIN = 0.05;
/** CJK ideographs, kana and full-width forms: lines wrap after any of them (paragraphs.py _wide). */
const WIDE = /^[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-｠￠-￦]/;

/** The first word of `text`: up to the first space; a CJK ideograph or kana alone. */
function firstWord(text: string): string {
  return WIDE.test(text) ? [...text][0] : /^\S*/.exec(text)![0];
}

/**
 * Width a multi-line left-aligned paragraph wraps at (M5b F2). Any width from its widest line up to just under the
 * narrowest "line + space + next line's first word" (its soft breaks) reproduces the original breaks: it takes the
 * middle of that slack, no wider than the room the API measured beside its lines (`maxWidth`: up to the next rule,
 * other text or the right margin). Its widest line no longer fills the box, so a one-character edit does not push a
 * word to the next line (nor, shortening a line, pull one up). Without `maxWidth` (older API): the widest line.
 */
export function wrapWidth(p: Paragraph, natural: number, metricsFor: MetricsFor): number {
  if (!p.maxWidth) return natural;
  const soft = softBreak(p, natural, metricsFor);
  // Halfway into the slack: a line may grow by as much as the tightest soft break may shrink (an edit that shortens
  // that line would otherwise pull the next line's first word up).
  const middle = soft === Infinity ? Infinity : natural + (soft - natural) / 2;
  return Math.max(natural, Math.min(p.maxWidth + WIDTH_SLACK, middle));
}

/** Just under the narrowest "line + space + next line's first word" over `p`'s soft breaks (not its hard breaks at
 *  `natural`): the original was wrapped narrower than that, so no line of it may get that wide. Infinity: no soft
 *  break. */
export function softBreak(p: Paragraph, natural: number, metricsFor: MetricsFor): number {
  const text = runsText(p.runs);
  const hard = new Set(hardBreaks(p, natural, metricsFor));
  let soft = Infinity;
  p.lines.forEach((line, i) => {
    const next = p.lines[i + 1];
    if (!next || hard.has(i)) return;
    const word = firstWord(text.slice(next.start));
    soft = Math.min(soft, measureRange(p.runs, line.start, next.start + word.length, metricsFor) - BREAK_MARGIN);
  });
  return soft;
}

/** How wide (pt) an edited line of `p` may get before it wraps (M5d): into the room the API measured beside the
 *  paragraph (`maxWidth`: rightwards when left-aligned, around the centre when centred, leftwards when right-aligned),
 *  but never as wide as a soft break shows the original's measure was not (softBreak), and never less than the box
 *  `width`. Justified lines compress their spaces instead (lib/editLine.ts JUSTIFY_SQUEEZE); a single line's box
 *  already spans its room (paragraphFrame). */
export function growWidth(p: Paragraph, width: number, metricsFor: MetricsFor): number {
  if (p.lines.length < 2 || !p.maxWidth || p.align === "justify") return width;
  const soft = softBreak(p, paragraphWidth(p, metricsFor), metricsFor);
  return Math.max(width, Math.min(p.maxWidth + WIDTH_SLACK, soft));
}

/** What paragraphBox lays `p` out in: the box left edge and width, the lines followed by a hard break and the
 *  logical paragraphs. */
export function paragraphFrame(p: Paragraph, metricsFor: MetricsFor): { x: number; width: number; breaks: number[]; paragraphs: Run[][] } {
  // A single line (a form label, a table cell, a title) may grow into the room the API measured beside it:
  // rightwards when left-aligned, around its centre when centred, leftwards when right-aligned (M5b).
  const single = p.lines.length === 1 && p.align !== "justify";
  const natural = paragraphWidth(p, metricsFor);
  let width = natural;
  if (single && p.maxWidth) {
    // Clamped (M5b F2): a line measured wider than its room (a substitute font) exceeds it by OVERSHOOT at most, then
    // wraps rather than running off the page or into its neighbour.
    const room = p.maxWidth + WIDTH_SLACK;
    width = Math.max(room, Math.min(natural, room + OVERSHOOT));
  } else if (p.lines.length > 1 && p.align === "left") {
    width = wrapWidth(p, natural, metricsFor);
  }
  const x = !single ? p.rect.x
    : p.align === "center" ? p.rect.x + p.rect.w / 2 - width / 2
      : p.align === "right" ? p.rect.x + p.rect.w - width : p.rect.x;
  const breaks = hardBreaks(p, width, metricsFor);
  return { x, width, breaks, paragraphs: paragraphRuns(p, breaks) };
}

/** The TextBox that redraws `p` in place: same lines, first baseline on the original one. `edit`
 *  changes the logical paragraphs first (Replace); `toBox` maps offsets of the paragraph's joined text. */
export function paragraphBox(
  p: Paragraph, metricsFor: MetricsFor,
  edit?: (paragraphs: Run[][], toBox: (offset: number) => number) => Run[][],
): TextBox {
  const { x, width, breaks, paragraphs } = paragraphFrame(p, metricsFor);
  const box = relayout({
    rect: { x, y: 0, w: width, h: 0 }, align: p.align, lineHeight: p.lineHeight,
    paragraphs: edit ? edit(paragraphs, rawToBox(p, breaks)) : paragraphs, layout: [],
  }, metricsFor);
  const first = box.layout[0]?.baseline ?? 0;
  return { ...box, rect: { ...box.rect, y: p.lines[0].baseline - first } };
}

/** The original lines a text.edit box keeps (its layout lines' `source`): the bake neither redacts nor redraws them. */
export function keptLines(box: TextBox | undefined): Set<number> {
  const out = new Set<number>();
  for (const line of box?.layout ?? []) if (line.source !== undefined && line.source !== null) out.add(line.source);
  return out;
}

/** Original line index → x where the kept prefix of that line ends (LayoutLine.prefix, M5d): the original glyphs left
 *  of it stay, the rest of the line is redrawn. */
export function keptPrefixes(p: Paragraph, box: TextBox | undefined): Map<number, number> {
  const out = new Map<number, number>();
  const text = runsText(p.runs);
  for (const line of box?.layout ?? []) {
    const pre = line.prefix;
    const pl = pre ? p.lines[pre.source] : undefined;
    if (pre && pl && line.source == null) out.set(pre.source, prefixCut(text, pl, line.segments, pre.segments));
  }
  return out;
}

/** What is left of original line `l` right of `cut` (its kept prefix), or null when nothing is. */
function rightOf(l: ParagraphLine, cut: number | undefined): ParagraphLine | null {
  if (cut === undefined) return l;
  const end = l.rect.x + l.rect.w;
  return cut >= end ? null : { ...l, rect: { ...l.rect, x: cut, w: end - cut } };
}

/** The original lines of `p` that its text.edit `box` replaces (all of them without a box); a line with a kept prefix
 *  only from the prefix's end on. */
export function replacedLines(p: Paragraph, box?: TextBox): ParagraphLine[] {
  const kept = keptLines(box), cuts = keptPrefixes(p, box);
  return p.lines.flatMap((l, i) => (kept.has(i) ? [] : [rightOf(l, cuts.get(i))].filter((x): x is ParagraphLine => !!x)));
}

/** White covers hiding an edited paragraph's original lines on screen (the bake redacts them), except the lines its
 *  text.edit `box` keeps and the kept prefixes of the lines it edits. */
export function maskRects(p: Paragraph, box?: TextBox): Rect[] {
  const kept = keptLines(box), cuts = keptPrefixes(p, box);
  // Next to a kept line at tight leading the bands overlap: the cover stops where the upper line's descenders
  // (MASK_DESCENT) meet the lower line's ascenders (MEET_ASCENT, ink rather than the cover's margin), split by those
  // shares, so the kept line's descenders or ascenders stay visible and the replaced line's stay covered.
  const meet = (upper: ParagraphLine, lower: ParagraphLine) => {
    const d = MASK_DESCENT * upper.size, a = MEET_ASCENT * lower.size;
    return upper.baseline + (lower.baseline - upper.baseline) * (d / (d + a));
  };
  return p.lines.flatMap((l, i) => {
    if (kept.has(i)) return [];
    const above = p.lines[i - 1], below = p.lines[i + 1];
    let top = l.baseline - MASK_ASCENT * l.size, bottom = l.baseline + MASK_DESCENT * l.size;
    if (above && kept.has(i - 1)) top = Math.max(top, Math.min(meet(above, l), above.baseline + MASK_DESCENT * above.size));
    if (below && kept.has(i + 1)) bottom = Math.min(bottom, Math.max(meet(l, below), below.baseline - MASK_ASCENT * below.size));
    // Down to the next covered line when the leading leaves a gap: descenders reaching past the band (antialiased
    // edges, a deleted paragraph's 'g' and 'y') do not peek out between two covers.
    else if (below && !cuts.has(i + 1)) bottom = Math.max(bottom, Math.min(below.baseline - MASK_ASCENT * below.size, l.baseline + l.size));
    const rest = rightOf(l, cuts.get(i));
    if (!rest) return [];
    // A kept prefix shows up to its next word: the cover starts there (that word's glyph starts at its x).
    const x0 = cuts.has(i) ? rest.rect.x : l.rect.x - 0.5;
    // The line's drawn decorations go with it (the bake removes them): covered where they reach past the band (an
    // underlined trailing space, a highlight taller than the line); a kept prefix's stay in view.
    const decor = (l.decor ?? []).flatMap((d) => {
      const a = Math.max(d.x - 0.5, x0), b = d.x + d.w + 0.5;
      return b > a ? [{ x: a, y: d.y - 0.5, w: b - a, h: d.h + 1 }] : [];
    });
    // A table border or rule just above / below the text (the bake leaves it alone) is not wiped by the cover.
    if (l.coverBottom !== undefined) bottom = Math.max(top, Math.min(bottom, l.coverBottom));
    if (l.coverTop !== undefined) top = Math.min(bottom, Math.max(top, l.coverTop));
    return [{ x: x0, y: top, w: l.rect.x + l.rect.w + 0.5 - x0, h: bottom - top }, ...decor];
  });
}

/** Slack (pt) before an edited paragraph counts as taller than the original. */
const OVERFLOW_SLACK = 0.5;

/** True when the edited paragraph's laid-out height (first to last baseline) exceeds the original
 *  paragraph's: it may run into the text below, which is not moved (owner decision, M2 backlog). */
export function overflowsOriginal(box: TextBox, p: Paragraph): boolean {
  const lines = box.layout;
  if (lines.length < 2 || !p.lines.length) return false;
  const height = lines[lines.length - 1].baseline - lines[0].baseline;
  const original = p.lines[p.lines.length - 1].baseline - p.lines[0].baseline;
  return height > original + OVERFLOW_SLACK;
}
