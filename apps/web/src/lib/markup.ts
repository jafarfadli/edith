import type { Rect } from "@edith/ops";

/** Where MuPDF's appearance stream draws an underline/strike in quad `q`: a line q.h/16 thick whose
 *  centre is q.h/7 (underline) or 3·q.h/7 (strike) above the quad's bottom. */
export function markupLine(kind: "underline" | "strike", q: Rect): Rect {
  const t = q.h / 16;
  const centre = q.y + q.h - (kind === "underline" ? q.h / 7 : (3 * q.h) / 7);
  return { x: q.x, y: centre - t / 2, w: q.w, h: t };
}

/** A markup quad spans the text background band: baseline − 0.9·size … baseline + 0.25·size (DECOR in textDecor.ts). */
export const MARK_ASCENT = 0.9;
export const MARK_DESCENT = 0.25;
/** A press this close (pt) to the ends of a line still starts a selection on it. */
const SLOP = 2;

/** One horizontal line of original text (GET /documents/{id}/pages/{index}/chars): `boxes[i]` is
 *  `[x0, x1]` of the i-th code point of `text` (iterate with Array.from, not string indexes). */
export interface CharLine { text: string; boxes: [number, number][]; baseline: number; size: number }
/** A position between characters: before character `index` of line `line` (index = length: after the last). */
export interface Caret { line: number; index: number }
type Pt = [number, number];

function band(l: CharLine): { top: number; bottom: number } {
  return { top: l.baseline - MARK_ASCENT * l.size, bottom: l.baseline + MARK_DESCENT * l.size };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The lines that can be marked: original lines not hidden under `hidden` rects (edited paragraphs,
 *  whose original glyphs the bake removes). */
export function usableLines(lines: CharLine[], hidden: Rect[]): CharLine[] {
  return lines.filter((l) => {
    const { top, bottom } = band(l);
    const r = { x: l.boxes[0][0], y: top, w: l.boxes[l.boxes.length - 1][1] - l.boxes[0][0], h: bottom - top };
    return !hidden.some((h) => overlaps(r, h));
  });
}

function indexAt(l: CharLine, x: number): number {
  let i = 0;
  while (i < l.boxes.length && (l.boxes[i][0] + l.boxes[i][1]) / 2 < x) i++;
  return i;
}

/** The caret at `p`. `strict` (a press): only on a line, between its ends. Otherwise (a drag): the
 *  nearest line, vertically first. Null when there is no such line. */
export function caretAt(lines: CharLine[], [x, y]: Pt, strict: boolean): Caret | null {
  let best: { line: number; d: number } | null = null;
  lines.forEach((l, i) => {
    const { top, bottom } = band(l);
    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
    const x0 = l.boxes[0][0], x1 = l.boxes[l.boxes.length - 1][1];
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    if (strict && (dy > 0 || dx > SLOP)) return;
    const d = dy * 1e4 + dx;
    if (!best || d < best.d) best = { line: i, d };
  });
  const found = best as { line: number; d: number } | null;
  return found ? { line: found.line, index: indexAt(lines[found.line], x) } : null;
}

/** One quad per line between carets `a` and `b` (either order), without the spaces at its ends. */
export function markupQuads(lines: CharLine[], a: Caret, b: Caret): Rect[] {
  const [from, to] = a.line < b.line || (a.line === b.line && a.index <= b.index) ? [a, b] : [b, a];
  const out: Rect[] = [];
  for (let li = from.line; li <= to.line; li++) {
    const l = lines[li];
    const chars = Array.from(l.text);
    let start = li === from.line ? from.index : 0;
    let end = li === to.line ? to.index : chars.length;
    while (start < end && /\s/.test(chars[start])) start++;
    while (end > start && /\s/.test(chars[end - 1])) end--;
    if (start >= end) continue;
    const { top, bottom } = band(l);
    out.push({ x: l.boxes[start][0], y: top, w: l.boxes[end - 1][1] - l.boxes[start][0], h: bottom - top });
  }
  return out;
}
