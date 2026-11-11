import type { Rect } from "@edith/ops";

/** Smart guides (Figma-style): what a box being moved or resized snaps to, and what to draw. Pure geometry in page
 *  points (no DOM, no zoom: the caller converts its pixel threshold). A box has three stops per axis — its low edge,
 *  its middle and its high edge (left/centre/right, top/middle/bottom) — and snaps to the stops of the other
 *  objects and of the page, or to a spacing equal to another gap of the row/column.
 *
 *  Snapping only decides the offset; the guides are then derived from the box *after* it moved (what is exactly
 *  aligned or equally spaced now), so what is drawn is always true. */

export type Axis = "x" | "y";

/** A line at `pos` on `axis` (axis "x": the vertical line x = pos), from `from` to `to` along the other axis. */
export interface Guide { axis: Axis; pos: number; from: number; to: number }

/** A gap along `axis` from `from` to `to`, to be drawn at `at` on the other axis, labelled with its length. */
export interface Gap { axis: Axis; from: number; to: number; at: number }

export interface Snap { dx: number; dy: number; guides: Guide[]; gaps: Gap[] }

/** Two coordinates this close (pt) are the same: far below anything visible, above float noise of sums. */
const EPS = 0.01;
/** Gaps shorter than this (pt) are touching objects, not a spacing worth showing. */
const MIN_GAP = 0.5;
/** A resized box never gets smaller than this (pt) from snapping. */
const MIN_SIZE = 1;

/** The box around `rects`, or null for none. */
export function boundsUnion(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((q) => q.x)), y = Math.min(...rects.map((q) => q.y));
  return { x, y, w: Math.max(...rects.map((q) => q.x + q.w)) - x, h: Math.max(...rects.map((q) => q.y + q.h)) - y };
}

/** A length for a label: one decimal at most, no trailing ".0", never "-0". */
export function fmtPt(v: number): string {
  const n = Math.round(v * 10) / 10;
  return String(Object.is(n, -0) ? 0 : n);
}

/** A box seen along `axis`: its low/high edge, and its extent on the other (cross) axis. */
interface Span { lo: number; hi: number; clo: number; chi: number }
const span = (q: Rect, axis: Axis): Span =>
  axis === "x" ? { lo: q.x, hi: q.x + q.w, clo: q.y, chi: q.y + q.h } : { lo: q.y, hi: q.y + q.h, clo: q.x, chi: q.x + q.w };
const stops = (s: Span): [number, number, number] => [s.lo, (s.lo + s.hi) / 2, s.hi];
const crossOverlap = (a: Span, b: Span) => Math.min(a.chi, b.chi) - Math.max(a.clo, b.clo);

function gapMark(axis: Axis, from: number, to: number, a: Span, b: Span): Gap {
  const overlap = crossOverlap(a, b) > 0;
  const at = overlap ? (Math.max(a.clo, b.clo) + Math.min(a.chi, b.chi)) / 2 : (a.clo + a.chi) / 2;
  return { axis, from, to, at };
}

/** The offset moving `box`'s stops onto the nearest of `to` within `thr` (null when none is near). */
function nearest(from: readonly number[], to: readonly number[], thr: number): number | null {
  let best: number | null = null;
  for (const f of from) for (const t of to) {
    const d = t - f;
    if (Math.abs(d) <= thr && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/** Targets that share rows/columns with `box` along `axis` (they overlap it on the cross axis), left to right. */
function inLine(box: Rect, targets: readonly Rect[], axis: Axis): Span[] {
  const b = span(box, axis);
  return targets.map((q) => span(q, axis)).filter((s) => crossOverlap(s, b) > 0).sort((p, q) => p.lo - q.lo);
}

/** Gaps (≥ MIN_GAP) between neighbours of a row, left to right. */
function rowGaps(row: readonly Span[]): { a: Span; b: Span; g: number }[] {
  const out: { a: Span; b: Span; g: number }[] = [];
  for (let i = 1; i < row.length; i++) {
    const g = row[i].lo - row[i - 1].hi;
    if (g >= MIN_GAP) out.push({ a: row[i - 1], b: row[i], g });
  }
  return out;
}

/** The offsets along `axis` that give `box` a spacing equal to another: centred between its neighbours, or at the
 *  distance of a gap of the row from the neighbour on either side. The nearest within `thr`, or null. */
function spacingDelta(box: Rect, targets: readonly Rect[], axis: Axis, thr: number): number | null {
  const b = span(box, axis), w = b.hi - b.lo;
  const row = inLine(box, targets, axis);
  const before = row.filter((s) => s.hi <= b.lo + EPS).reduce<Span | null>((m, s) => (!m || s.hi > m.hi ? s : m), null);
  const after = row.filter((s) => s.lo >= b.hi - EPS).reduce<Span | null>((m, s) => (!m || s.lo < m.lo ? s : m), null);
  const free = (lo: number) => row.every((s) => lo + w <= s.lo + EPS || lo >= s.hi - EPS); // not over a neighbour
  const wanted: number[] = [];
  if (before && after) {
    const room = after.lo - before.hi - w;
    if (room >= 2 * MIN_GAP) wanted.push(before.hi + room / 2);
  }
  for (const { g } of rowGaps(row)) {
    if (before) wanted.push(before.hi + g);
    if (after) wanted.push(after.lo - g - w);
  }
  let best: number | null = null;
  for (const lo of wanted) {
    const d = lo - b.lo;
    if (Math.abs(d) <= thr && free(lo) && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

/** The equal spacings `box` has right now with the objects of its row and column: its gap to either neighbour equal
 *  to the other one, or to a gap between two other objects. The gaps to draw (each once). */
export function spacingFor(box: Rect, targets: readonly Rect[]): Gap[] {
  const out = new Map<string, Gap>();
  const add = (g: Gap) => out.set(`${g.axis}:${g.from}:${g.to}:${g.at}`, g);
  for (const axis of ["x", "y"] as const) {
    const b = span(box, axis);
    const row = inLine(box, targets, axis);
    const before = row.filter((s) => s.hi <= b.lo + EPS).reduce<Span | null>((m, s) => (!m || s.hi > m.hi ? s : m), null);
    const after = row.filter((s) => s.lo >= b.hi - EPS).reduce<Span | null>((m, s) => (!m || s.lo < m.lo ? s : m), null);
    const left = before ? gapMark(axis, before.hi, b.lo, before, b) : null;
    const right = after ? gapMark(axis, b.hi, after.lo, b, after) : null;
    const gl = left ? left.to - left.from : 0, gr = right ? right.to - right.from : 0;
    if (left && right && gl >= MIN_GAP && Math.abs(gl - gr) < EPS) { add(left); add(right); }
    for (const { a, b: next, g } of rowGaps(row)) {
      if (left && gl >= MIN_GAP && Math.abs(g - gl) < EPS) { add(left); add(gapMark(axis, a.hi, next.lo, a, next)); }
      if (right && gr >= MIN_GAP && Math.abs(g - gr) < EPS) { add(right); add(gapMark(axis, a.hi, next.lo, a, next)); }
    }
  }
  return [...out.values()];
}

/** Which stop of an axis: 0 low edge, 1 middle, 2 high edge. */
export type Slot = 0 | 1 | 2;

/** The lines `box` is exactly on right now: any of its stops equal to a stop of a target or of the page (`only`: just
 *  those stops, for a resize that moves one edge). A line through an object spans the box and that object; one through
 *  the page spans the page. Lines at the same position are one. */
export function guidesFor(box: Rect, targets: readonly Rect[], page: Rect | null = null, only?: { x?: readonly Slot[]; y?: readonly Slot[] }): Guide[] {
  const out = new Map<string, Guide>();
  const put = (axis: Axis, pos: number, from: number, to: number) => {
    const key = `${axis}:${Math.round(pos * 100)}`;
    const g = out.get(key);
    out.set(key, g ? { ...g, from: Math.min(g.from, from), to: Math.max(g.to, to) } : { axis, pos, from, to });
  };
  for (const axis of ["x", "y"] as const) {
    const b = span(box, axis), mine = stops(b);
    const slots = (only?.[axis] ?? [0, 1, 2]) as readonly Slot[];
    for (const q of targets) {
      const t = span(q, axis);
      stops(t).forEach((v) => {
        for (const k of slots) if (Math.abs(mine[k] - v) < EPS) put(axis, v, Math.min(b.clo, t.clo), Math.max(b.chi, t.chi));
      });
    }
    if (page) {
      const t = span(page, axis);
      stops(t).forEach((v) => {
        for (const k of slots) if (Math.abs(mine[k] - v) < EPS) put(axis, v, t.clo, t.chi);
      });
    }
  }
  return [...out.values()];
}

/** The stops a box can snap to along `axis`: those of the targets and of the page. */
function targetStops(targets: readonly Rect[], page: Rect | null, axis: Axis): number[] {
  return [...targets, ...(page ? [page] : [])].flatMap((q) => stops(span(q, axis)));
}

/** `moving` dragged: the offset (dx, dy) that snaps it, and the guides and gaps true at the snapped position.
 *  `thr`: snap distance in pt (5 screen px / zoom). A spacing snap competes with the alignments by distance. */
export function snapMove(moving: Rect, targets: readonly Rect[], page: Rect | null, thr: number): Snap {
  const d: Record<Axis, number> = { x: 0, y: 0 };
  for (const axis of ["x", "y"] as const) {
    const align = nearest(stops(span(moving, axis)), targetStops(targets, page, axis), thr);
    const space = spacingDelta(moving, targets, axis, thr);
    if (align !== null && (space === null || Math.abs(align) <= Math.abs(space))) d[axis] = align;
    else if (space !== null) d[axis] = space;
  }
  const at = { ...moving, x: moving.x + d.x, y: moving.y + d.y };
  return { dx: d.x, dy: d.y, guides: guidesFor(at, targets, page), gaps: spacingFor(at, targets) };
}

/** `old` resized to `next` (edges dragged): each edge that moved snaps to the nearest stop of the targets/page within
 *  `thr`; the others stay. The guides are those of the moved edges. */
export function snapResize(old: Rect, next: Rect, targets: readonly Rect[], page: Rect | null, thr: number): { rect: Rect; guides: Guide[] } {
  const rect = { ...next };
  const only: { x: Slot[]; y: Slot[] } = { x: [], y: [] };
  for (const axis of ["x", "y"] as const) {
    const o = span(old, axis), n = span(next, axis);
    const to = targetStops(targets, page, axis);
    let lo = n.lo, hi = n.hi;
    const slots: Slot[] = [];
    if (Math.abs(n.lo - o.lo) > EPS) { const d = nearest([n.lo], to, thr); if (d !== null && hi - (lo + d) >= MIN_SIZE) { lo += d; slots.push(0); } }
    if (Math.abs(n.hi - o.hi) > EPS) { const d = nearest([n.hi], to, thr); if (d !== null && hi + d - lo >= MIN_SIZE) { hi += d; slots.push(2); } }
    only[axis] = slots;
    if (axis === "x") { rect.x = lo; rect.w = hi - lo; } else { rect.y = lo; rect.h = hi - lo; }
  }
  return { rect, guides: guidesFor(rect, targets, page, only) };
}

/** Distances from `a` to `b` (Alt held over `b` with `a` selected): along an axis where they are apart, the gap
 *  between them; where they overlap on both axes (one over or in the other), how far their edges are from each
 *  other. Zero distances are left out. */
export function measure(a: Rect, b: Rect): Gap[] {
  const out: Gap[] = [];
  const sa = { x: span(a, "x"), y: span(a, "y") }, sb = { x: span(b, "x"), y: span(b, "y") };
  const apart = (axis: Axis) => sa[axis].hi <= sb[axis].lo || sb[axis].hi <= sa[axis].lo;
  const both = !apart("x") && !apart("y");
  for (const axis of ["x", "y"] as const) {
    const p = sa[axis], q = sb[axis];
    if (apart(axis)) {
      const [first, second] = p.hi <= q.lo ? [p, q] : [q, p];
      out.push(gapMark(axis, first.hi, second.lo, first, second));
    } else if (both) {
      for (const [from, to] of [[Math.min(p.lo, q.lo), Math.max(p.lo, q.lo)], [Math.min(p.hi, q.hi), Math.max(p.hi, q.hi)]]) {
        if (to - from >= EPS) out.push(gapMark(axis, from, to, p, q));
      }
    }
  }
  return out.filter((g) => g.to - g.from >= EPS);
}
