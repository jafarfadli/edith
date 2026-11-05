import type { FontRef, LayoutLine, Run, Segment } from "@edith/ops";
import { textWidth, type FontMetrics } from "@/lib/fonts";

export interface LayoutInput { width: number; align: "left" | "center" | "right" | "justify"; lineHeight: number; paragraphs: Run[][] }
export interface LayoutResult { lines: LayoutLine[]; height: number; contentWidth: number }

interface Token { text: string; runIndex: number; width: number; space: boolean }

export function layoutText(input: LayoutInput, metricsFor: (f: FontRef) => FontMetrics): LayoutResult {
  const flat = input.paragraphs.flat();
  const ascentOf = (i: number) => { const r = flat[i]; const m = metricsFor(r.font); return (m.ascent / m.unitsPerEm) * r.size; };
  const descentOf = (i: number) => { const r = flat[i]; const m = metricsFor(r.font); return (m.descent / m.unitsPerEm) * r.size; };
  const measure = (text: string, i: number) => textWidth(text, metricsFor(flat[i].font), flat[i].size);

  const lines: LayoutLine[] = [];
  let baseline = 0;
  let lastDescent = 0;
  let contentWidth = 0;
  let runOffset = 0;

  const EPS = 1e-6;
  input.paragraphs.forEach((paragraph, pi) => {
    if (paragraph.length === 0) throw new Error(`layoutText: paragraph ${pi} has no runs`);
    // Split runs into word / whitespace pieces (a piece never crosses a run boundary).
    const pieces: Token[] = [];
    paragraph.forEach((r, k) => {
      const runIndex = runOffset + k;
      for (const m of r.text.matchAll(/\s+|[^\s]+/g)) {
        const text = m[0];
        pieces.push({ text, runIndex, width: measure(text, runIndex), space: /^\s+$/.test(text) });
      }
    });
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

    // A single word wider than the box is split by character into chunk units.
    const fitted: Token[][] = [];
    for (const unit of units) {
      const uw = unit.reduce((sum, t) => sum + t.width, 0);
      if (unit[0].space || uw <= input.width + EPS) { fitted.push(unit); continue; }
      let chunk: Token[] = [];
      let chunkWidth = 0;
      for (const t of unit) {
        for (const ch of t.text) {
          const cw = measure(ch, t.runIndex);
          if (chunk.length && chunkWidth + cw > input.width + EPS) {
            fitted.push(chunk);
            chunk = [];
            chunkWidth = 0;
          }
          const last = chunk[chunk.length - 1];
          if (last && last.runIndex === t.runIndex) { last.text += ch; last.width += cw; }
          else chunk.push({ text: ch, runIndex: t.runIndex, width: cw, space: false });
          chunkWidth += cw;
        }
      }
      if (chunk.length) fitted.push(chunk);
    }

    // Greedy line breaking over units.
    const rawLines: Token[][] = [];
    let current: Token[] = [];
    let currentWidth = 0;
    for (const unit of fitted) {
      const uw = unit.reduce((sum, t) => sum + t.width, 0);
      if (unit[0].space) {
        if (current.length === 0) continue; // drop spaces at line start
        current.push(...unit);
        currentWidth += uw;
        continue;
      }
      // Break when the line already holds a word and this whole word (plus the spaces before it) overflows.
      if (current.length > 0 && currentWidth - trailingSpaceWidth(current) > 0 && currentWidth + uw > input.width + EPS) {
        rawLines.push(trimEnd(current));
        current = [];
        currentWidth = 0;
      }
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
      const lineWidth = lineTokens.reduce((s, t) => s + t.width, 0);
      contentWidth = Math.max(contentWidth, lineWidth);
      lines.push({ baseline, segments: placeSegments(lineTokens, lineWidth, input, isLast) });
    });
  });

  return { lines, height: baseline + lastDescent, contentWidth };
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

function placeSegments(tokens: Token[], lineWidth: number, input: LayoutInput, isLastLine: boolean): Segment[] {
  const spaces = tokens.filter((t) => t.space).length;
  if (input.align === "justify" && !isLastLine && spaces > 0) {
    const extra = (input.width - lineWidth) / spaces;
    const segs: Segment[] = [];
    let x = 0;
    for (const t of tokens) {
      if (t.space) { x += t.width + extra; continue; }
      segs.push({ x, text: t.text, runIndex: t.runIndex });
      x += t.width;
    }
    return segs;
  }
  let x = 0;
  if (input.align === "right") x = input.width - lineWidth;
  else if (input.align === "center") x = (input.width - lineWidth) / 2;
  const segs: Segment[] = [];
  for (const t of tokens) {
    const last = segs[segs.length - 1];
    if (last && last.runIndex === t.runIndex) last.text += t.text;
    else segs.push({ x, text: t.text, runIndex: t.runIndex });
    x += t.width;
  }
  return segs;
}
