import type { BundledFont, FontRef, Rect, Run, TextBox } from "@edith/ops";
import type { DocFont, Paragraph } from "@/lib/api";
import { covers, fontStore, isOriginal, textWidth, type FontMetrics } from "@/lib/fonts";
import { normalizeRuns, runsText, sliceRuns } from "@/lib/runs";
import { boxFonts, relayout } from "@/lib/textbox";

export type MetricsFor = (f: FontRef) => FontMetrics;
export type FontTable = Record<string, DocFont>;
type Loader = Pick<typeof fontStore, "load" | "peek">;

const ARIMO: BundledFont = { kind: "bundled", family: "Arimo", bold: false, italic: false };
const NOTO_SANS = "Noto Sans";
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

/** The TextBox that redraws `p` in place: same lines, first baseline on the original one. `edit`
 *  changes the logical paragraphs first (Replace); `toBox` maps offsets of the paragraph's joined text. */
export function paragraphBox(
  p: Paragraph, metricsFor: MetricsFor,
  edit?: (paragraphs: Run[][], toBox: (offset: number) => number) => Run[][],
): TextBox {
  const width = paragraphWidth(p, metricsFor);
  const breaks = hardBreaks(p, width, metricsFor);
  const paragraphs = paragraphRuns(p, breaks);
  const box = relayout({
    rect: { x: p.rect.x, y: 0, w: width, h: 0 }, align: p.align, lineHeight: p.lineHeight,
    paragraphs: edit ? edit(paragraphs, rawToBox(p, breaks)) : paragraphs, layout: [],
  }, metricsFor);
  const first = box.layout[0]?.baseline ?? 0;
  return { ...box, rect: { ...box.rect, y: p.lines[0].baseline - first } };
}

export function substituteOf(f: FontRef, fonts: FontTable): BundledFont {
  return isOriginal(f) ? fonts[f.ref]?.substitute ?? ARIMO : f;
}

/** One step of font fallback: a run whose original font is not loaded or lacks a glyph of its text
 *  switches to the substitute; a run whose loaded bundled family lacks a glyph switches to Arimo
 *  (Latin, Greek, Cyrillic), and Arimo to Noto Sans (wider Unicode coverage). Runs whose bundled font is not loaded yet stay as they are. */
export function resolveRunFonts(runs: Run[], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Run[] {
  return runs.map((r) => {
    const m = peek(r.font);
    if (m && covers(m, r.text)) return r;
    if (isOriginal(r.font)) return { ...r, font: substituteOf(r.font, fonts) };
    if (m && r.font.family === NOTO_SANS) return r;
    if (m) return { ...r, font: { ...r.font, family: r.font.family === ARIMO.family ? NOTO_SANS : ARIMO.family } };
    return r;
  });
}

const fontsOf = (paragraphs: Run[][]) => boxFonts({ paragraphs } as TextBox);

/** Fallback steps of the longest chain: original → substitute → Arimo → Noto Sans. */
const FALLBACK_STEPS = 3;

/** One fallback step over every paragraph; `null` when no run changed. */
function fallbackStep(paragraphs: Run[][], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Run[][] | null {
  let changed = false;
  const next = paragraphs.map((p) => {
    const q = resolveRunFonts(p, fonts, peek);
    if (q.some((r, i) => r !== p[i])) changed = true;
    return q;
  });
  return changed ? next : null;
}

/** The full font fallback using only fonts that are already loaded (same result as `prepareRuns`
 *  once its fonts are in); `null` when a font it needs is not loaded yet. */
export function resolveLoadedRuns(paragraphs: Run[][], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Run[][] | null {
  let out = paragraphs;
  for (let step = 0; step <= FALLBACK_STEPS; step++) {
    if (fontsOf(out).some((f) => !peek(f))) return null;
    const next = fallbackStep(out, fonts, peek);
    if (!next) return out;
    out = next;
  }
  return fontsOf(out).every((f) => peek(f)) ? out : null;
}

/** Loads every font the paragraphs need and applies font fallback (original → substitute → Arimo → Noto Sans).
 *  Rejects when a bundled font cannot be loaded. */
export async function prepareRuns(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore): Promise<Run[][]> {
  let out = paragraphs;
  for (let step = 0; step <= FALLBACK_STEPS; step++) {
    await Promise.allSettled(fontsOf(out).map((f) => store.load(f)));
    const next = fallbackStep(out, fonts, (f) => store.peek(f));
    if (!next) break;
    out = next;
  }
  await Promise.all(fontsOf(out).map((f) => store.load(f)));
  return out;
}

/** Loads the fonts of the whole fallback chain the paragraphs may need (original -> substitute -> Arimo
 *  -> Noto Sans, in the runs' bold/italic styles) so `resolveLoadedRuns` can answer synchronously.
 *  Never rejects: a font that fails to load just stays unresolved. */
export async function preloadFallback(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore): Promise<void> {
  let out = paragraphs;
  for (let step = 0; step <= FALLBACK_STEPS; step++) {
    await Promise.allSettled(fontsOf(out).map((f) => store.load(f)));
    const next = fallbackStep(out, fonts, (f) => store.peek(f));
    if (!next) return;
    out = next;
  }
  await Promise.allSettled(fontsOf(out).map((f) => store.load(f)));
}

/** White covers hiding an edited paragraph's original lines on screen (the bake redacts them). */
export function maskRects(p: Paragraph): Rect[] {
  return p.lines.map((l) => ({
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

/** True when some character has no glyph even after the whole font fallback (original -> substitute ->
 *  Arimo -> Noto Sans) with the loaded fonts: the bake draws it with a builtin font or as a box (CJK,
 *  emoji, check marks ...). False while a font of the chain is not loaded yet. */
export function hasUnsupportedChars(paragraphs: Run[][], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): boolean {
  const resolved = resolveLoadedRuns(paragraphs, fonts, peek);
  if (!resolved) return false;
  return resolved.flat().some((r) => {
    const m = peek(r.font);
    return !!m && !covers(m, r.text.replace(/[\n\r\t]/g, ""));
  });
}
