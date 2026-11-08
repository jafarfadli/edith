import type { Rect, SymbolAdd } from "@edith/ops";

/** Check/cross geometry — shared contract with apps/api/edith/bake/symbols.py: points in the unit
 *  square of the rect, stroke width × the rect's shorter side, round caps and joins. */
export const SYMBOL_PATHS: Record<SymbolAdd["kind"], [number, number][][]> = {
  check: [[[0.12, 0.52], [0.4, 0.8], [0.88, 0.2]]],
  cross: [[[0.18, 0.18], [0.82, 0.82]], [[0.82, 0.18], [0.18, 0.82]]],
};
export const SYMBOL_WIDTH = 0.12;

export function symbolPaths(kind: SymbolAdd["kind"], r: Rect): { paths: [number, number][][]; width: number } {
  const paths = SYMBOL_PATHS[kind].map((path) => path.map(([u, v]) => [r.x + u * r.w, r.y + v * r.h] as [number, number]));
  return { paths, width: SYMBOL_WIDTH * Math.min(r.w, r.h) };
}
