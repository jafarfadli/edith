import type { FontRef, Rect, Run, TextBox } from "@edith/ops";
import type { Paragraph, ParagraphLine } from "@/lib/api";
import { textWidth, type FontMetrics } from "@/lib/fonts";
import { normalizeRuns, runsText, sliceRuns } from "@/lib/runs";
import { relayout } from "@/lib/textbox";

// Font fallback lives in lib/fallback.ts (per character since M5); re-exported for its existing users.
export { hasUnsupportedChars, preloadFallback, prepareRuns, resolveLoadedRuns, substituteOf, type FontTable } from "@/lib/fallback";

export type MetricsFor = (f: FontRef) => FontMetrics;
/** Extra box width so a line measured at exactly the box width still fits. */
const WIDTH_SLACK = 0.01;
/** On-screen cover of an edited paragraph's original line (× size around the baseline). */
export const MASK_ASCENT = 0.95;
export const MASK_DESCENT = 0.25;

/** Width of characters [start, end) of `runs`; trailing spaces are excluded unless `trimEnd` is false. */
export function measureRange(runs: Run[], start: number, end: number, metricsFor: MetricsFor, trimEnd = true): number {
  const pieces = sliceRuns(runs, start, end);
  while (trimEnd && pieces.length && /\s$/.test(pieces[pieces.length - 1].text)) {
    const last = pieces[pieces.length - 1];
    const text = last.text.replace(/\s+$/, "");
    if (text) pieces[pieces.length - 1] = { ...last, text };
    else pieces.pop();
  }
  return pieces.reduce((w, r) => w + textWidth(r.text, metricsFor(r.font), r.size), 0);
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

/** What paragraphBox lays `p` out in: the box width, the lines followed by a hard break and the logical paragraphs. */
export function paragraphFrame(p: Paragraph, metricsFor: MetricsFor): { width: number; breaks: number[]; paragraphs: Run[][] } {
  // A left-aligned single line (a form label, a table cell) may grow into the room the API measured beside it.
  const room = p.lines.length === 1 && p.align === "left" && p.maxWidth ? p.maxWidth + WIDTH_SLACK : 0;
  const width = Math.max(paragraphWidth(p, metricsFor), room);
  const breaks = hardBreaks(p, width, metricsFor);
  return { width, breaks, paragraphs: paragraphRuns(p, breaks) };
}

/** The TextBox that redraws `p` in place: same lines, first baseline on the original one. `edit`
 *  changes the logical paragraphs first (Replace); `toBox` maps offsets of the paragraph's joined text. */
export function paragraphBox(
  p: Paragraph, metricsFor: MetricsFor,
  edit?: (paragraphs: Run[][], toBox: (offset: number) => number) => Run[][],
): TextBox {
  const { width, breaks, paragraphs } = paragraphFrame(p, metricsFor);
  const box = relayout({
    rect: { x: p.rect.x, y: 0, w: width, h: 0 }, align: p.align, lineHeight: p.lineHeight,
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

/** The original lines of `p` that its text.edit `box` replaces (all of them without a box). */
export function replacedLines(p: Paragraph, box?: TextBox): ParagraphLine[] {
  const kept = keptLines(box);
  return p.lines.filter((_, i) => !kept.has(i));
}

/** White covers hiding an edited paragraph's original lines on screen (the bake redacts them), except the lines its
 *  text.edit `box` keeps. */
export function maskRects(p: Paragraph, box?: TextBox): Rect[] {
  return replacedLines(p, box).map((l) => ({
    x: l.rect.x - 0.5, y: l.baseline - MASK_ASCENT * l.size, w: l.rect.w + 1, h: (MASK_ASCENT + MASK_DESCENT) * l.size,
  }));
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
