import type { ContentOp, Rect } from "@edith/ops";
import type { ToolStyle } from "@/store/editor";

export type Pt = [number, number];
export const MIN_DRAG = 3;
export type DragTool = "rect" | "ellipse" | "line" | "arrow" | "whiteout" | "redact";
export const DRAG_TOOLS: ReadonlySet<string> = new Set(["rect", "ellipse", "line", "arrow", "whiteout", "redact"]);

/** Ink needs a positive width (the API rejects 0); the shared stroke slider allows 0 for shapes. */
export const MIN_INK_WIDTH = 0.5;
export const inkWidth = (w: number) => Math.max(MIN_INK_WIDTH, w);

/** A page-relative pointer position kept inside the page (drags may end outside it). */
export function clampToPage([x, y]: Pt, width: number, height: number): Pt {
  return [Math.min(Math.max(x, 0), width), Math.min(Math.max(y, 0), height)];
}

type Any = ContentOp & Record<string, unknown>;

export function normalizeRect([ax, ay]: Pt, [bx, by]: Pt): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

function boundsOfPoints(pts: number[][]): Rect {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function opBounds(op: ContentOp): Rect {
  const o = op as Any;
  switch (op.type) {
    case "text.add": return (o.box as { rect: Rect }).rect;
    case "ink.add": return boundsOfPoints((o.paths as number[][][]).flat());
    case "shape.add": return o.points ? boundsOfPoints(o.points as number[][]) : (o.rect as Rect);
    default: return o.rect as Rect;
  }
}

export function moveOp<T extends ContentOp>(op: T, dx: number, dy: number): T {
  const o = op as Any;
  const mv = (p: number[]) => [p[0] + dx, p[1] + dy];
  const mr = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
  switch (op.type) {
    case "text.add": { const box = o.box as { rect: Rect }; return { ...op, box: { ...box, rect: mr(box.rect) } }; }
    case "ink.add": return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(mv)) };
    case "shape.add": return o.points ? { ...op, points: (o.points as number[][]).map(mv) } : { ...op, rect: mr(o.rect as Rect) };
    default: return { ...op, rect: mr(o.rect as Rect) };
  }
}

export function resizeOp<T extends ContentOp>(op: T, to: Rect): T {
  const o = op as Any;
  const b = opBounds(op);
  const sx = b.w ? to.w / b.w : 1, sy = b.h ? to.h / b.h : 1;
  const sc = (p: number[]) => [to.x + (p[0] - b.x) * sx, to.y + (p[1] - b.y) * sy];
  switch (op.type) {
    case "text.add": { const box = o.box as { rect: Rect }; return { ...op, box: { ...box, rect: { ...box.rect, x: to.x, y: to.y, w: to.w } } }; }
    case "ink.add": return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(sc)) };
    case "shape.add": return o.points ? { ...op, points: (o.points as number[][]).map(sc) } : { ...op, rect: to };
    default: return { ...op, rect: to };
  }
}

export function createFromDrag(tool: DragTool, a: Pt, b: Pt, style: ToolStyle, pageKey: string, id: string): ContentOp | null {
  const r = normalizeRect(a, b);
  if (tool === "line" || tool === "arrow") {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_DRAG) return null;
    return { id, type: "shape.add", pageKey, kind: tool, points: [a, b], stroke: style.stroke, fill: null, width: style.width } as ContentOp;
  }
  if (r.w < MIN_DRAG || r.h < MIN_DRAG) return null;
  if (tool === "whiteout") return { id, type: "whiteout.add", pageKey, rect: r } as ContentOp;
  if (tool === "redact") return { id, type: "redact.add", pageKey, rect: r, fill: "black" } as ContentOp;
  return { id, type: "shape.add", pageKey, kind: tool, rect: r, stroke: style.stroke, fill: style.fill, width: style.width } as ContentOp;
}

export function arrowHead(width: number) {
  const length = Math.max(6, width * 4);
  return { length, width: 2 * length * Math.tan((25 * Math.PI) / 180) };
}
