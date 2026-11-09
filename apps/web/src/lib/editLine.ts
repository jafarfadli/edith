import type { FontRef, LayoutLine, Run, Segment } from "@edith/ops";
import type { ParagraphLine } from "@/lib/api";
import { textWidth, type FontMetrics } from "@/lib/fonts";
import type { LineRange } from "@/lib/layout";

/** Spaces of a justified line may shrink by this share before it wraps (M5d): Word compresses justified lines (the
 *  reference documents set spaces at 78–83 % of the space glyph); a line that would need more wraps. */
export const JUSTIFY_SQUEEZE = 0.25;
/** A redrawn word may start this far (pt) left of the end of the word before it (rounding, kerning) before the edited
 *  line counts as overlapping and is laid out plainly instead. */
const OVERLAP_TOL = 0.3;
/** Right-to-left scripts (Hebrew, Arabic and their presentation forms): their lines are never re-placed word by word. */
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;

/** Text and runs of a box (its paragraphs joined by "\n"), measured as layoutText measures them. */
export class BoxText {
  readonly text: string;
  private readonly starts: number[] = [];
  private readonly flat: Run[];

  constructor(readonly paragraphs: Run[][], private readonly metricsFor: (f: FontRef) => FontMetrics) {
    let at = 0;
    for (const p of paragraphs) {
      this.starts.push(at);
      at += p.reduce((n, r) => n + r.text.length, 0) + 1;
    }
    this.text = paragraphs.map((p) => p.map((r) => r.text).join("")).join("\n");
    this.flat = paragraphs.flat();
  }

  run(index: number): Run {
    return this.flat[index];
  }

  /** The run pieces of characters [s, e) (one paragraph), with their flat run index (Segment.runIndex). */
  pieces(s: number, e: number): { runIndex: number; text: string; start: number }[] {
    const out: { runIndex: number; text: string; start: number }[] = [];
    let index = 0;
    this.paragraphs.forEach((p, i) => {
      let pos = this.starts[i];
      for (const r of p) {
        const a = Math.max(s, pos), b = Math.min(e, pos + r.text.length);
        if (a < b) out.push({ runIndex: index, text: r.text.slice(a - pos, b - pos), start: a });
        pos += r.text.length;
        index++;
      }
    });
    return out;
  }

  /** Pen advance of characters [s, e). */
  width(s: number, e: number): number {
    return this.pieces(s, e).reduce((sum, p) => sum + this.measure(p.text, p.runIndex), 0);
  }

  /** Pen advance of the whitespace among characters [s, e) (what a justified line compresses). */
  spaces(s: number, e: number): number {
    let w = 0;
    for (let i = s; i < e; i++) if (/\s/.test(this.text[i])) w += this.width(i, i + 1);
    return w;
  }

  /** Width of word [s, e) to the end of its last glyph (without the character spacing after it, as layoutText). */
  ink(s: number, e: number): number {
    const ps = this.pieces(s, e);
    const last = ps[ps.length - 1];
    return this.width(s, e) - (last ? this.flat[last.runIndex].charSpacing ?? 0 : 0);
  }

  measure(text: string, runIndex: number): number {
    const r = this.flat[runIndex];
    return textWidth(text, this.metricsFor(r.font), r.size, r);
  }
}

interface Word { s: number; e: number }

function words(text: string, from: number, to: number): Word[] {
  return [...text.slice(from, to).matchAll(/\S+/g)].map((m) => ({ s: from + m.index!, e: from + m.index! + m[0].length }));
}

/** An edit of a box text: characters [a, o.length − b) of the original became [a, tail) of the new text. */
export interface Edit { o: BoxText; n: BoxText; a: number; tail: number; delta: number }

/**
 * The edited original line `pl` (index `source`, at `orig` in the original box text), laid out as layout line `line`
 * (at `x` in the new box text), re-placed word by word where the original put its words (M5d), from `pl.wordX`:
 *
 * - The words before the edit stay where they were (`prefix`: the bake keeps their glyphs when the line is left-aligned
 *   or justified).
 * - The edited words follow from the original x of the first word they replace (or the word before them).
 * - The words after the edit keep their original x, moved by how much the edit grew the text before them (Edith's own
 *   widths on both sides, so measuring errors cancel).
 * - Then the alignment: a centred line moves by half the growth, a right-aligned one by all of it (nothing is kept);
 *   a stretched line (`stretched`: one the original justified out to its paragraph's right edge) keeps that edge by
 *   narrowing or widening the gaps after the kept words evenly, a gap at most `squeeze` narrower than a space.
 *
 * `boxX`: the box's left edge (segments are relative to it). Null when the line can't be re-placed so (no word
 * positions, right-to-left text, no word left, words that would overlap, a stretched line that can't keep its edge):
 * layoutText's placement stands.
 */
export function anchorLine(edit: Edit, line: LayoutLine, x: LineRange, orig: LineRange, pl: ParagraphLine, source: number,
  opts: { align: "left" | "center" | "right" | "justify"; stretched: boolean; boxX: number; squeeze: number }): LayoutLine | null {
  const { o, n, a, tail, delta } = edit;
  const { align, boxX, squeeze } = opts;
  const xs = pl.wordX;
  const ow = words(o.text, orig.start, orig.end), nw = words(n.text, x.start, x.end);
  if (!xs || xs.length !== ow.length || !nw.length || !ow.length) return null;
  if (RTL.test(o.text.slice(orig.start, orig.end)) || RTL.test(n.text.slice(x.start, x.end))) return null;
  const origIndex = new Map(ow.map((w, i) => [w.s, i]));
  const space = (t: string, i: number) => i >= t.length || /\s/.test(t[i]);

  // Where each new word starts in the original (unchanged first character at a word start of this line), if anywhere.
  const anchors = nw.map((w) => {
    const at = w.s < a ? w.s : w.s >= tail ? w.s - delta : -1;
    const i = origIndex.get(at);
    return i === undefined ? null : { at, i };
  });
  // The kept prefix: leading words untouched by the edit, ending where the original word ends.
  let kept = 0;
  while (kept < nw.length && nw[kept].e <= a && anchors[kept]?.i === kept && space(o.text, nw[kept].e)) kept++;

  const fN = (w: Word) => n.width(x.start, w.s);
  const fO = (at: number) => o.width(orig.start, at);
  const X: number[] = [];
  nw.forEach((w, k) => {
    const an = anchors[k];
    if (k < kept) X.push(xs[k]);
    else if (an) X.push(xs[an.i] + fN(w) - fO(an.at));
    else if (k === kept && kept > 0 && kept < xs.length) X.push(xs[kept]); // the edit starts where the original's next word did
    else if (k === 0) X.push(xs[0]);
    else X.push(X[k - 1] + fN(w) - fN(nw[k - 1]));
  });
  const ink = nw.map((w) => n.ink(w.s, w.e));
  for (let k = 1; k < nw.length; k++) if (X[k] < X[k - 1] + ink[k - 1] - OVERLAP_TOL) return null;

  // Alignment: how much further the line now ends than the original did.
  const last = nw.length - 1, lastOrig = ow[ow.length - 1];
  const grow = X[last] + ink[last] - (xs[ow.length - 1] + o.ink(lastOrig.s, lastOrig.e));
  const justified = opts.stretched;
  if ((align === "center" || align === "right") && Math.abs(grow) > 0.005) {
    const shift = align === "center" ? grow / 2 : grow;
    for (let k = 0; k < X.length; k++) X[k] -= shift;
    kept = 0;
  } else if (justified && Math.abs(grow) > 0.005) {
    // The gaps between the redrawn words take the growth; the one after the kept prefix too when they can't (the first
    // redrawn word then moves, and the prefix is redrawn rather than kept: see the check below).
    const spread = (first: number): number[] | null => {
      const gaps = nw.length - first;
      if (first < 1 || gaps <= 0) return null;
      const at = X.map((v, k) => (k >= first ? v - (grow * (k - first + 1)) / gaps : v));
      for (let k = first; k < nw.length; k++) {
        const word = n.width(nw[k - 1].s, nw[k - 1].e), natural = fN(nw[k]) - fN(nw[k - 1]) - word;
        if (at[k] - at[k - 1] - word < (1 - squeeze) * natural - 0.01) return null;
      }
      return at;
    };
    const at = (kept >= 1 ? spread(kept + 1) : null) ?? spread(Math.max(kept, 1));
    if (!at) return null;
    X.splice(0, X.length, ...at);
  }

  // Segments, word by word (one per character with charSpacing); the spaces after a word ride on its last segment,
  // except in a justified line (layoutText drops them there too).
  const segs: Segment[] = [];
  let keptSegs = 0;
  nw.forEach((w, k) => {
    let pos = X[k];
    const place = (piece: { runIndex: number; text: string }, join: boolean) => {
      const r = n.run(piece.runIndex);
      if (r.charSpacing) {
        for (const ch of piece.text) { segs.push({ x: pos - boxX, text: ch, runIndex: piece.runIndex }); pos += n.measure(ch, piece.runIndex); }
        return;
      }
      const prev = segs[segs.length - 1];
      if (join && prev && prev.runIndex === piece.runIndex && !r.wordSpacing) prev.text += piece.text;
      else segs.push({ x: pos - boxX, text: piece.text, runIndex: piece.runIndex });
      pos += n.measure(piece.text, piece.runIndex);
    };
    for (const piece of n.pieces(w.s, w.e)) place(piece, false);
    if (!justified && k < last) for (const piece of n.pieces(w.e, nw[k + 1].s)) place(piece, true);
    if (k === kept - 1) keptSegs = segs.length;
  });
  // The bake keeps the prefix only when the rest starts at or right of the original word it replaces (bake/text.py
  // kept_prefixes): mirrored, so the screen shows what the export will.
  const cut = kept < ow.length ? xs[kept] : pl.rect.x + pl.rect.w;
  if (keptSegs && segs.slice(keptSegs).some((s) => s.text.trim() && boxX + s.x < cut - 0.5)) keptSegs = 0;
  return { baseline: line.baseline, segments: segs, ...(keptSegs ? { prefix: { source, segments: keptSegs } } : {}) };
}

/** Where the original glyphs of line `pl` of a paragraph with text `text` stop being kept when a layout line keeps its
 *  first `count` segments (LayoutLine.prefix): the x of the original's first word after as many non-space characters
 *  as those segments hold (as the bake counts), or the line's end when they hold all of it. */
export function prefixCut(text: string, pl: ParagraphLine, segments: Segment[], count: number): number {
  let chars = segments.slice(0, count).reduce((sum, s) => sum + s.text.replace(/\s/g, "").length, 0);
  let word = -1;
  for (let i = pl.start; i < pl.end; i++) {
    if (/\s/.test(text[i])) continue;
    if (i === pl.start || /\s/.test(text[i - 1])) word++;
    if (chars-- === 0) return pl.wordX?.[word] ?? pl.rect.x + pl.rect.w;
  }
  return pl.rect.x + pl.rect.w;
}
