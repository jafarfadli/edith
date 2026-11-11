import type { Rect } from "@edith/ops";
import { alignDelta, type Align } from "@/lib/objects";

/** Group operations on boxes, pure: what a marquee selects, how a selection aligns and distributes, the order Tab
 *  walks. Boxes are in whatever space the caller works in (page points, or screen pixels for align/distribute so
 *  that "left" means the left of the screen on a rotated page). */

export interface Boxed { id: string; rect: Rect }

const touches = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const holds = (outer: Rect, inner: Rect) => outer.x <= inner.x && outer.y <= inner.y
  && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;

/** The ids a marquee selects: every object it touches (Figma's rule: partly inside is enough), except one that
 *  holds the whole marquee — a page-sized scan or a big rectangle under the drag is the background, not the target. */
export function marqueeHits(marquee: Rect, items: readonly Boxed[]): string[] {
  return items.filter((it) => touches(marquee, it.rect) && !holds(it.rect, marquee)).map((it) => it.id);
}

/** Per id, how far to move (dx, dy) so every box lines up with side `a` of `ref`. */
export function alignMoves(rects: Record<string, Rect>, a: Align, ref: Rect): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const [id, rect] of Object.entries(rects)) {
    const [dx, dy] = alignDelta(rect, ref, a);
    out[id] = [dx || 0, dy || 0]; // no -0
  }
  return out;
}

/** Per id, how far to move along `axis` so the gaps between three or more boxes are equal; the outermost two stay.
 *  Empty for fewer than three. */
export function distributeMoves(items: readonly Boxed[], axis: "x" | "y"): Record<string, number> {
  if (items.length < 3) return {};
  const lo = (q: Rect) => (axis === "x" ? q.x : q.y), size = (q: Rect) => (axis === "x" ? q.w : q.h);
  const sorted = [...items].sort((a, b) => lo(a.rect) - lo(b.rect));
  const first = sorted[0].rect, last = sorted[sorted.length - 1].rect;
  const free = lo(last) + size(last) - lo(first) - sorted.reduce((sum, it) => sum + size(it.rect), 0);
  const gap = free / (sorted.length - 1);
  const out: Record<string, number> = {};
  let at = lo(first);
  for (const it of sorted) {
    out[it.id] = at - lo(it.rect) || 0;
    at += size(it.rect) + gap;
  }
  return out;
}

/** Tab order: rows from the top (boxes whose tops are within one band share a row), each row left to right. */
const ROW = 10;
export function readingOrder(items: readonly Boxed[]): string[] {
  return [...items]
    .sort((a, b) => Math.round(a.rect.y / ROW) - Math.round(b.rect.y / ROW) || a.rect.x - b.rect.x || a.rect.y - b.rect.y)
    .map((it) => it.id);
}

/** The id after (`dir` 1) or before (-1) `current` in `order`, wrapping; the first/last when nothing (known) is current. */
export function cycleSelection(order: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (!order.length) return null;
  const i = current === null ? -1 : order.indexOf(current);
  if (i < 0) return dir === 1 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}
