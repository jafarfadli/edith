import type { FontRef, LayoutLine, Run, Segment } from "@edith/ops";
import { textWidth, type FontMetrics } from "@/lib/fonts";

/** `breaks`: offsets in the box text (the paragraphs joined by "\n") where a line must start, ascending: an original
 *  paragraph's own line breaks (lib/keepLines.ts). A break inside a word splits the word there.
 *  `fit` (M5d): how wide a line may get before it wraps, when that is more than `width` (the room an edited original
 *  line may grow into); lines are still aligned in `width`, so a wider one runs past the box on its free side(s).
 *  `squeeze` (M5d, justified text): the share by which the spaces of a line may shrink before it wraps, as Word lets
 *  justified lines compress; such a line (also the last of its paragraph) is set tighter to fit `width`. */
export interface LayoutInput {
  width: number; align: "left" | "center" | "right" | "justify"; lineHeight: number; paragraphs: Run[][];
  breaks?: number[]; fit?: number; squeeze?: number;
}
/** The box-text characters a line holds, without the spaces around it: [start, end); `last`: the last line of its
 *  paragraph. The line of an empty paragraph is empty at the paragraph's offset. */
export interface LineRange { start: number; end: number; last: boolean }
export interface LayoutResult { lines: LayoutLine[]; height: number; contentWidth: number; ranges: LineRange[] }

/** `start`: offset of the token's first character in the box text. */
interface Token { text: string; runIndex: number; width: number; space: boolean; start: number }

const tokenEnd = (t: Token) => t.start + t.text.length;

export function layoutText(input: LayoutInput, metricsFor: (f: FontRef) => FontMetrics): LayoutResult {
  const flat = input.paragraphs.flat();
  const ascentOf = (i: number) => { const r = flat[i]; const m = metricsFor(r.font); return (m.ascent / m.unitsPerEm) * r.size; };
  const descentOf = (i: number) => { const r = flat[i]; const m = metricsFor(r.font); return (m.descent / m.unitsPerEm) * r.size; };
  const measure = (text: string, i: number) => textWidth(text, metricsFor(flat[i].font), flat[i].size, flat[i]);
  // A line ends at its last glyph's ink: the character spacing after it (Run.charSpacing) is not part of its width.
  const trail = (t: Token | undefined) => (t && !t.space ? flat[t.runIndex].charSpacing ?? 0 : 0);

  const lines: LayoutLine[] = [];
  const ranges: LineRange[] = [];
  const forced = input.breaks ?? [];
  let fi = 0; // the next forced break not passed yet
  let paraStart = 0; // box-text offset of the paragraph
  let baseline = 0;
  let lastDescent = 0;
  let contentWidth = 0;
  let runOffset = 0;

  const EPS = 1e-6;
  input.paragraphs.forEach((paragraph, pi) => {
    if (paragraph.length === 0) throw new Error(`layoutText: paragraph ${pi} has no runs`);
    // Split runs into word / whitespace pieces (a piece never crosses a run boundary).
    const pieces: Token[] = [];
    let runStart = paraStart;
    paragraph.forEach((r, k) => {
      const runIndex = runOffset + k;
      for (const m of r.text.matchAll(/\s+|[^\s]+/g)) {
        const text = m[0];
        pieces.push({ text, runIndex, width: measure(text, runIndex), space: /^\s+$/.test(text), start: runStart + m.index });
      }
      runStart += r.text.length;
    });
    const paraEnd = runStart;
    const emptyRunIndex = runOffset;
    runOffset += paragraph.length;

    // Group consecutive non-space pieces (possibly from different runs) into word units.
    const units: Token[][] = [];
    let word: Token[] = [];
    const flushWord = () => { if (word.length) { units.push(word); word = []; } };
    for (const t of pieces) {
      if (t.space) { flushWord(); units.push([t]); } else word.push(t);
    }
    flushWord();

    // A forced break inside a word (CJK lines wrap between characters) splits it into two units.
    const split: Token[][] = [];
    for (const unit of units) {
      let rest = unit;
      for (;;) {
        const from = rest[0].start, to = tokenEnd(rest[rest.length - 1]);
        const f = rest[0].space ? undefined : forced.find((b) => b > from && b < to);
        if (f === undefined) { split.push(rest); break; }
        const head: Token[] = [], tail: Token[] = [];
        for (const t of rest) {
          if (tokenEnd(t) <= f) head.push(t);
          else if (t.start >= f) tail.push(t);
          else {
            const a = t.text.slice(0, f - t.start), b = t.text.slice(f - t.start);
            head.push({ ...t, text: a, width: measure(a, t.runIndex) });
            tail.push({ ...t, text: b, width: measure(b, t.runIndex), start: f });
          }
        }
        split.push(head);
        rest = tail;
      }
    }

    // A single word wider than the box is split by character into chunk units.
    const fitted: Token[][] = [];
    for (const unit of split) {
      const uw = unit.reduce((sum, t) => sum + t.width, 0);
      if (unit[0].space || uw - trail(unit[unit.length - 1]) <= input.width + EPS) { fitted.push(unit); continue; }
      let chunk: Token[] = [];
      let chunkWidth = 0;
      for (const t of unit) {
        let at = t.start;
        for (const ch of t.text) {
          const cw = measure(ch, t.runIndex);
          if (chunk.length && chunkWidth + cw - (flat[t.runIndex].charSpacing ?? 0) > input.width + EPS) {
            fitted.push(chunk);
            chunk = [];
            chunkWidth = 0;
          }
          const last = chunk[chunk.length - 1];
          if (last && last.runIndex === t.runIndex) { last.text += ch; last.width += cw; }
          else chunk.push({ text: ch, runIndex: t.runIndex, width: cw, space: false, start: at });
          chunkWidth += cw;
          at += ch.length;
        }
      }
      if (chunk.length) fitted.push(chunk);
    }

    // Greedy line breaking over units, plus the forced breaks.
    const rawLines: Token[][] = [];
    let current: Token[] = [];
    let currentWidth = 0;
    let currentSpaces = 0; // width of the spaces in `current`: between its words once another word follows
    const limit = Math.max(input.width, input.fit ?? 0);
    const squeeze = input.align === "justify" ? input.squeeze ?? 0 : 0;
    for (const unit of fitted) {
      const uw = unit.reduce((sum, t) => sum + t.width, 0);
      if (unit[0].space) {
        if (current.length === 0) continue; // drop spaces at line start
        current.push(...unit);
        currentWidth += uw;
        currentSpaces += uw;
        continue;
      }
      const at = unit[0].start;
      while (fi < forced.length && current.length > 0 && forced[fi] <= current[0].start) fi++;
      // A forced break between the line's first word and this one …
      const force = current.length > 0 && fi < forced.length && forced[fi] <= at;
      // … or the line already holds a word and this whole word (plus the spaces before it) overflows.
      if (force || (current.length > 0 && currentWidth - trailingSpaceWidth(current) > 0
        && currentWidth + uw - trail(unit[unit.length - 1]) > limit + squeeze * currentSpaces + EPS)) {
        rawLines.push(trimEnd(current));
        current = [];
        currentWidth = 0;
        currentSpaces = 0;
      }
      while (fi < forced.length && forced[fi] <= at) fi++;
      current.push(...unit);
      currentWidth += uw;
    }
    rawLines.push(trimEnd(current));

    rawLines.forEach((lineTokens, li) => {
      const isLast = li === rawLines.length - 1;
      const runIdxs = lineTokens.length ? lineTokens.map((t) => t.runIndex) : [emptyRunIndex];
      const ascent = Math.max(...runIdxs.map(ascentOf));
      baseline = lines.length === 0 ? ascent : baseline + input.lineHeight;
      lastDescent = Math.max(...runIdxs.map(descentOf));
      const lineWidth = lineTokens.reduce((s, t) => s + t.width, 0) - trail(lineTokens[lineTokens.length - 1]);
      contentWidth = Math.max(contentWidth, lineWidth);
      lines.push({ baseline, segments: placeSegments(lineTokens, lineWidth, input, isLast, flat, measure) });
      ranges.push(lineTokens.length
        ? { start: lineTokens[0].start, end: tokenEnd(lineTokens[lineTokens.length - 1]), last: isLast }
        : { start: paraStart, end: paraStart, last: isLast });
    });
    paraStart = paraEnd + 1; // past the "\n" between paragraphs
  });

  return { lines, height: baseline + lastDescent, contentWidth, ranges };
}

function trailingSpaceWidth(tokens: Token[]): number {
  let w = 0;
  for (let i = tokens.length - 1; i >= 0 && tokens[i].space; i--) w += tokens[i].width;
  return w;
}

function trimEnd(tokens: Token[]): Token[] {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1].space) end--;
  return tokens.slice(0, end);
}

/** Segments of a line. A run's tokens merge into one segment, except with the original's spacing: one segment per
 *  character for Run.charSpacing and one per word and per space for Run.wordSpacing, so that the bake (which only
 *  scales a segment's glyphs by hScale) puts every glyph where the layout measured it. */
function placeSegments(
  tokens: Token[], lineWidth: number, input: LayoutInput, isLastLine: boolean,
  runs: Run[], measure: (text: string, i: number) => number,
): Segment[] {
  const segs: Segment[] = [];
  /** Places token `t` at `x`; `join`: it may extend the previous segment of its run. */
  const place = (t: Token, x: number, join: boolean) => {
    const r = runs[t.runIndex];
    if (r.charSpacing) {
      for (const ch of t.text) { segs.push({ x, text: ch, runIndex: t.runIndex }); x += measure(ch, t.runIndex); }
      return;
    }
    const last = segs[segs.length - 1];
    if (join && last && last.runIndex === t.runIndex && !r.wordSpacing) last.text += t.text;
    else segs.push({ x, text: t.text, runIndex: t.runIndex });
  };
  const spaces = tokens.filter((t) => t.space).length;
  // A justified paragraph's last line is set ragged, unless it only fits by compressing its spaces (`squeeze`).
  if (input.align === "justify" && spaces > 0 && (!isLastLine || lineWidth > input.width + 1e-6)) {
    const extra = (input.width - lineWidth) / spaces;
    let x = 0;
    for (const t of tokens) {
      if (t.space) { x += t.width + extra; continue; }
      place(t, x, false);
      x += t.width;
    }
    return segs;
  }
  let x = 0;
  if (input.align === "right") x = input.width - lineWidth;
  else if (input.align === "center") x = (input.width - lineWidth) / 2;
  for (const t of tokens) {
    place(t, x, true);
    x += t.width;
  }
  return segs;
}
