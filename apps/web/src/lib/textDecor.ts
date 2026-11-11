import type { Run } from "@edith/ops";

/** Decoration geometry in multiples of the run's size, relative to the baseline (y grows down).
 *  Shared contract with apps/api/edith/bake/text.py (BG_ASCENT, …) — change both together. */
export const DECOR = { bgAscent: 0.9, bgDescent: 0.25, underlineTop: 0.075, strikeTop: -0.3, thickness: 0.06 } as const;

export interface Band { x: number; y: number; w: number; h: number }

/** Background, underline and strike bands of a segment drawn at (x, baseline) with advance `width`: the original's
 *  geometry where the run carries it (Run.underlineTop / strikeTop / decorThickness), else DECOR (bake/text.py
 *  decor_bands). */
export function decorBands(x: number, baseline: number, width: number, run: Run): { bg?: Band; underline?: Band; strike?: Band } {
  const s = run.size;
  const band = (top: number, h: number): Band => ({ x, y: baseline + top * s, w: width, h: h * s });
  const thickness = run.decorThickness ?? DECOR.thickness;
  return {
    ...(run.bgColor ? { bg: band(-DECOR.bgAscent, DECOR.bgAscent + DECOR.bgDescent) } : {}),
    ...(run.underline ? { underline: band(run.underlineTop ?? DECOR.underlineTop, thickness) } : {}),
    ...(run.strike ? { strike: band(run.strikeTop ?? DECOR.strikeTop, thickness) } : {}),
  };
}

/** Bands of one colour and height this close along a line (pt) are drawn as one (bake/text.py JOIN_GAP): no seams
 *  between the segments of a run split per character or word. */
const JOIN_GAP = 0.5;

export function joinBands<B extends Band & { color: string }>(bands: B[]): B[] {
  const out: B[] = [];
  for (const b of bands) {
    const last = out[out.length - 1];
    if (last && last.color === b.color && Math.abs(last.y - b.y) < 1e-3 && Math.abs(last.h - b.h) < 1e-3
      && b.x >= last.x && b.x <= last.x + last.w + JOIN_GAP) { // touching, a small gap or overlapping (charSpacing < 0)
      out[out.length - 1] = { ...last, w: Math.max(last.x + last.w, b.x + b.w) - last.x };
    } else out.push(b);
  }
  return out;
}

/** The colour of a run's underline and strikethrough: the original's (Run.decorColor), else the text colour. */
export function decorColor(run: Run): string {
  return run.decorColor ?? run.color;
}
