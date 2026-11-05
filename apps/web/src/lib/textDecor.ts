import type { Run } from "@edith/ops";

/** Decoration geometry in multiples of the run's size, relative to the baseline (y grows down).
 *  Shared contract with apps/api/edith/bake/text.py (BG_ASCENT, …) — change both together. */
export const DECOR = { bgAscent: 0.9, bgDescent: 0.25, underlineTop: 0.075, strikeTop: -0.3, thickness: 0.06 } as const;

export interface Band { x: number; y: number; w: number; h: number }

/** Background, underline and strike bands of a segment drawn at (x, baseline) with advance `width`. */
export function decorBands(x: number, baseline: number, width: number, run: Run): { bg?: Band; underline?: Band; strike?: Band } {
  const s = run.size;
  const band = (top: number, h: number): Band => ({ x, y: baseline + top * s, w: width, h: h * s });
  return {
    ...(run.bgColor ? { bg: band(-DECOR.bgAscent, DECOR.bgAscent + DECOR.bgDescent) } : {}),
    ...(run.underline ? { underline: band(DECOR.underlineTop, DECOR.thickness) } : {}),
    ...(run.strike ? { strike: band(DECOR.strikeTop, DECOR.thickness) } : {}),
  };
}
