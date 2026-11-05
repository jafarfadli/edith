import type { AnnotAdd, ContentOp, Rect, SymbolAdd, TextAdd, TextEdit } from "@edith/ops";
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

export function isTextOp(op: ContentOp | undefined): op is TextAdd | TextEdit {
  return op?.type === "text.add" || op?.type === "text.edit";
}

/** Size of a sticky note's icon (MuPDF draws the Note icon 16 x 16 pt from the point). */
export const NOTE_SIZE = 16;
/** Default size of a check/cross symbol placed with a click. */
export const SYMBOL_SIZE = 20;

/** Highlight/underline/strike: attached to the text under it (cannot be moved or resized). */
export function isMarkup(op: ContentOp | undefined): op is AnnotAdd {
  return op?.type === "annot.add" && op.kind !== "note";
}

/** Objects with resize handles: everything except text markup and sticky notes. */
export function isResizable(op: ContentOp | undefined): boolean {
  return !!op && op.type !== "annot.add";
}

export function opBounds(op: ContentOp): Rect {
  const o = op as Any;
  switch (op.type) {
    case "text.add": case "text.edit": return (o.box as { rect: Rect }).rect;
    case "annot.add": {
      const [px, py] = op.point ?? [0, 0];
      if (op.kind === "note") return { x: px, y: py, w: NOTE_SIZE, h: NOTE_SIZE };
      const qs = op.quads ?? [];
      if (!qs.length) return { x: px, y: py, w: 0, h: 0 }; // malformed markup: no NaN/Infinity bounds
      const x = Math.min(...qs.map((q) => q.x)), y = Math.min(...qs.map((q) => q.y));
      return { x, y, w: Math.max(...qs.map((q) => q.x + q.w)) - x, h: Math.max(...qs.map((q) => q.y + q.h)) - y };
    }
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
    case "text.add": case "text.edit": { const box = o.box as { rect: Rect }; return { ...op, box: { ...box, rect: mr(box.rect) } }; }
    case "ink.add": return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(mv)) };
    case "shape.add": return o.points ? { ...op, points: (o.points as number[][]).map(mv) } : { ...op, rect: mr(o.rect as Rect) };
    case "annot.add": return o.point ? { ...op, point: mv(o.point as number[]) } : op; // markup stays on its text
    default: return { ...op, rect: mr(o.rect as Rect) };
  }
}

export function resizeOp<T extends ContentOp>(op: T, to: Rect): T {
  const o = op as Any;
  const b = opBounds(op);
  const sx = b.w ? to.w / b.w : 1, sy = b.h ? to.h / b.h : 1;
  const sc = (p: number[]) => [to.x + (p[0] - b.x) * sx, to.y + (p[1] - b.y) * sy];
  switch (op.type) {
    case "text.add": case "text.edit": { const box = o.box as { rect: Rect }; return { ...op, box: { ...box, rect: { ...box.rect, x: to.x, y: to.y, w: to.w } } }; }
    case "ink.add": return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(sc)) };
    case "shape.add": return o.points ? { ...op, points: (o.points as number[][]).map(sc) } : { ...op, rect: to };
    case "annot.add": return op;
    default: return { ...op, rect: to };
  }
}

/** A check/cross centred on `at`, kept on the page. */
export function symbolAt(kind: SymbolAdd["kind"], [x, y]: Pt, style: ToolStyle, pageKey: string, id: string, page: { width: number; height: number }): SymbolAdd {
  const s = SYMBOL_SIZE;
  const rx = Math.min(Math.max(x - s / 2, 0), Math.max(page.width - s, 0));
  const ry = Math.min(Math.max(y - s / 2, 0), Math.max(page.height - s, 0));
  return { id, type: "symbol.add", pageKey, kind, rect: { x: rx, y: ry, w: s, h: s }, color: style.symbolColor };
}

/** An empty sticky note whose icon's top-left corner is `at` (kept on the page). */
export function noteAt([x, y]: Pt, style: ToolStyle, pageKey: string, id: string, page: { width: number; height: number }): AnnotAdd {
  const point: [number, number] = [Math.min(x, Math.max(page.width - NOTE_SIZE, 0)), Math.min(y, Math.max(page.height - NOTE_SIZE, 0))];
  return { id, type: "annot.add", pageKey, kind: "note", point, color: style.noteColor, content: "" };
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
