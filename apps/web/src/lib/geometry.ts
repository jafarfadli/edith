/** Shape geometry shared with apps/api/edith/bake/geometry.py — change both together (both test suites
 *  pin the same numbers). Dash patterns are multiples of w' = max(width, 0.5): dashed [3w', 2w'] with butt
 *  caps, dotted [0, 2w'] with round caps; like the bake's `dashes_arg` (`:g`) they are rounded to 6
 *  significant digits. A cloud splits each edge of its closed polygon into n = floor(len / arc + 0.5)
 *  (at least 1) chords, arc = CLOUD_ARC + CLOUD_ARC_PER_WIDTH · width (floor(x + 0.5), not Python's
 *  banker's `round`), and draws a half circle bulging out of the polygon on each chord as two cubic
 *  Béziers. */
export type Pt = [number, number];
export type Bezier = [Pt, Pt, Pt, Pt];
export type Dash = "solid" | "dashed" | "dotted";

export const KAPPA = 0.5522847498;
export const CLOUD_ARC = 8;
export const CLOUD_ARC_PER_WIDTH = 2;

/** Python's `f"{v:g}"` as a number (6 significant digits). */
const g6 = (v: number) => Number(v.toPrecision(6));

export function dashPattern(dash: Dash | undefined, width: number): { dash: number[]; lineCap: "butt" | "round" } | null {
  const w = Math.max(width, 0.5);
  if (dash === "dashed") return { dash: [g6(3 * w), g6(2 * w)], lineCap: "butt" };
  if (dash === "dotted") return { dash: [0, g6(2 * w)], lineCap: "round" };
  return null;
}

/** Twice the signed area (shoelace); > 0 means clockwise on screen (y grows down). */
export function signedArea2(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

export function cloudBeziers(points: readonly Pt[], width: number): Bezier[] {
  const arc = CLOUD_ARC + CLOUD_ARC_PER_WIDTH * width;
  const clockwise = signedArea2(points) > 0;
  const out: Bezier[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = points[i], [qx, qy] = points[(i + 1) % n];
    const length = Math.hypot(qx - px, qy - py);
    if (length === 0) continue;
    const ux = (qx - px) / length, uy = (qy - py) / length;
    const [nx, ny] = clockwise ? [uy, -ux] : [-uy, ux]; // outward normal
    const count = Math.max(1, Math.floor(length / arc + 0.5));
    for (let k = 0; k < count; k++) {
      const ax = px + ((qx - px) * k) / count, ay = py + ((qy - py) * k) / count;
      const bx = px + ((qx - px) * (k + 1)) / count, by = py + ((qy - py) * (k + 1)) / count;
      const r = length / count / 2;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const top: Pt = [mx + r * nx, my + r * ny];
      const kr = KAPPA * r;
      out.push([[ax, ay], [ax + kr * nx, ay + kr * ny], [top[0] - kr * ux, top[1] - kr * uy], top]);
      out.push([top, [top[0] + kr * ux, top[1] + kr * uy], [bx + kr * nx, by + kr * ny], [bx, by]]);
    }
  }
  return out;
}
