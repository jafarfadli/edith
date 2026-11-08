import type { AnnotAdd, ContentOp, Rect, ShapeAdd, SymbolAdd, TextAdd, TextEdit } from "@edith/ops";
import type { CropBox } from "@/lib/coords";
import type { ToolStyle } from "@/store/editor";

export type Pt = [number, number];
export const MIN_DRAG = 3;
export type DragTool = "rect" | "ellipse" | "line" | "arrow" | "whiteout" | "redact";
export const DRAG_TOOLS: ReadonlySet<string> = new Set(["rect", "ellipse", "line", "arrow", "whiteout", "redact"]);
/** Tools that select original text and add a text-markup annotation (they stay active). */
export const MARKUP_TOOLS: ReadonlySet<string> = new Set(["highlight", "underline", "strike"]);

/** Ink needs a positive width (the API rejects 0); the shared stroke slider allows 0 for shapes. */
export const MIN_INK_WIDTH = 0.5;
export const inkWidth = (w: number) => Math.max(MIN_INK_WIDTH, w);

/** A page-relative pointer position kept inside the page (drags may end outside it). */
export function clampToPage([x, y]: Pt, width: number, height: number): Pt {
  return [Math.min(Math.max(x, 0), width), Math.min(Math.max(y, 0), height)];
}

/** `clampToPage` for the visible part of a (cropped) page. */
export function clampToBounds([x, y]: Pt, b: CropBox): Pt {
  return [Math.min(Math.max(x, b.x), b.x + b.w), Math.min(Math.max(y, b.y), b.y + b.h)];
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
export function isMarkup(op: ContentOp | undefined): op is AnnotAdd & { kind: "highlight" | "underline" | "strike" } {
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
    return { id, type: "shape.add", pageKey, kind: tool, points: [a, b], stroke: style.stroke, fill: null, width: style.width, ...shapeExtras(style) } as ContentOp;
  }
  if (r.w < MIN_DRAG || r.h < MIN_DRAG) return null;
  if (tool === "whiteout") return { id, type: "whiteout.add", pageKey, rect: r } as ContentOp;
  if (tool === "redact") return { id, type: "redact.add", pageKey, rect: r, fill: "black" } as ContentOp;
  return { id, type: "shape.add", pageKey, kind: tool, rect: r, stroke: style.stroke, fill: style.fill, width: style.width, ...shapeExtras(style) } as ContentOp;
}

export function arrowHead(width: number) {
  const length = Math.max(6, width * 4);
  return { length, width: 2 * length * Math.tan((25 * Math.PI) / 180) };
}

/** Dash and opacity of new shapes, only when not the defaults (ops stay as small as before M4). */
function shapeExtras(style: ToolStyle): Partial<ShapeAdd> {
  return { ...(style.dash !== "solid" ? { dash: style.dash } : {}), ...(style.opacity < 1 ? { opacity: style.opacity } : {}) };
}

export type PolyTool = "polygon" | "polyline" | "cloud";
export const POLY_TOOLS: ReadonlySet<string> = new Set(["polygon", "polyline", "cloud"]);
/** Polygon/polyline/cloud tools: a click adds a vertex; a double-click, Enter or a click on the first vertex finishes. */
export const MIN_POLY_POINTS: Record<PolyTool, number> = { polygon: 3, cloud: 3, polyline: 2 };
/** Pixels on screen within which a click on the first vertex closes the shape. */
export const CLOSE_RADIUS = 8;

/** The shape made of the clicked vertices (consecutive duplicates dropped), or null when there are too few. */
export function polyFromPoints(tool: PolyTool, points: readonly Pt[], style: ToolStyle, pageKey: string, id: string): ShapeAdd | null {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) >= 0.5);
  if (pts.length < MIN_POLY_POINTS[tool]) return null;
  return {
    id, type: "shape.add", pageKey, kind: tool, points: pts.map((p) => [p[0], p[1]] as [number, number]),
    stroke: style.stroke, fill: tool === "polyline" ? null : style.fill, width: style.width, ...shapeExtras(style),
  };
}

/** Objects drawn on the page (they have `opacity`); text.edit, whiteout, redaction, links and annotations have not. */
export function hasOpacity(op: ContentOp | undefined): boolean {
  return !!op && ["text.add", "image.add", "signature.add", "stamp.add", "symbol.add", "shape.add", "ink.add"].includes(op.type);
}

/** Objects made of points (ink, lines, polygons): rotating one moves its points instead of setting `rotation`. */
export function isPointOp(op: ContentOp | undefined): boolean {
  return op?.type === "ink.add" || (op?.type === "shape.add" && !!(op as ShapeAdd).points);
}

/** Objects placed by a rect that turn around its centre with a `rotation` field. */
export function hasRotation(op: ContentOp | undefined): boolean {
  return !!op && hasOpacity(op) && !isPointOp(op);
}

/** Objects with a rotation handle. */
export function isRotatable(op: ContentOp | undefined): boolean {
  return hasRotation(op) || isPointOp(op);
}

export function rotationOf(op: ContentOp | undefined): number {
  return hasRotation(op) ? ((op as { rotation?: number }).rotation ?? 0) : 0;
}

export function opacityOf(op: ContentOp | undefined): number {
  return hasOpacity(op) ? ((op as { opacity?: number }).opacity ?? 1) : 1;
}

/** `p` turned `deg` degrees clockwise (on screen) around `c`. */
export function rotatePoint([x, y]: Pt, [cx, cy]: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

/** A rotation in degrees as stored in ops: in (-180, 180], rounded to 0.01°. */
export function normalizeRotation(deg: number): number {
  const r = Math.round((((deg % 360) + 360) % 360) * 100) / 100;
  return r >= 360 ? 0 : r > 180 ? r - 360 : r;
}

/** Where the top-left corner of `r` lands when `r` turns `deg` degrees clockwise around its centre. */
export function rotatedTopLeft(r: Rect, deg: number): Pt {
  return rotatePoint([r.x, r.y], [r.x + r.w / 2, r.y + r.h / 2], deg);
}

/** `next` (a re-laid-out `prev`, e.g. a text box whose height changed) moved so its rotated top-left corner stays
 *  where `prev`'s was: a turned text box grows away from its first line, as the editor shows it. */
export function keepRotatedTopLeft(prev: Rect, next: Rect, deg: number): Rect {
  if (!deg) return next;
  const [ax, ay] = rotatedTopLeft(prev, deg), [bx, by] = rotatedTopLeft(next, deg);
  return { ...next, x: next.x + ax - bx, y: next.y + ay - by };
}

/** A click of the polygon/polyline/cloud tool at `at` (page points, `scale` px per point): the vertices after it,
 *  and whether it finished the shape (a click on the first vertex, once there are enough; it is not added). */
export function polyClick(tool: PolyTool, points: readonly Pt[], at: Pt, scale: number): { points: Pt[]; finish: boolean } {
  const first = points[0];
  if (first && points.length >= MIN_POLY_POINTS[tool] && Math.hypot(at[0] - first[0], at[1] - first[1]) * scale <= CLOSE_RADIUS) {
    return { points: [...points], finish: true };
  }
  return { points: [...points, at], finish: false };
}

/** A double-click of the polygon tool (Konva reports any two quick clicks as one): the vertices to finish with
 *  when its two clicks hit the same spot (the second click's vertex dropped), else null. */
export function polyDoubleClick(points: readonly Pt[], scale: number): Pt[] | null {
  if (points.length < 2) return null;
  const a = points[points.length - 2], b = points[points.length - 1];
  return Math.hypot(a[0] - b[0], a[1] - b[1]) * scale <= CLOSE_RADIUS ? points.slice(0, -1) : null;
}

/** What the object covers on the page, its rotation included. */
export function visualBounds(op: ContentOp): Rect {
  const b = opBounds(op);
  const deg = rotationOf(op);
  if (!deg) return b;
  const c: Pt = [b.x + b.w / 2, b.y + b.h / 2];
  const pts = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => rotatePoint(p, c, deg));
  return boundsOfPoints(pts);
}

/** A point-based op with every point mapped through `f` (Konva's transform after a rotate/resize). */
export function mapPoints<T extends ContentOp>(op: T, f: (p: Pt) => Pt): T {
  const o = op as Any;
  const m = (p: number[]) => f([p[0], p[1]]);
  if (op.type === "ink.add") return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(m)) };
  if (op.type === "shape.add" && o.points) return { ...op, points: (o.points as number[][]).map(m) };
  return op;
}

/** Objects the mini-bar can copy, duplicate and align: everything except edited paragraphs and text markup,
 *  which belong to the text of their page. */
export function isCopyable(op: ContentOp | undefined): boolean {
  return !!op && op.type !== "text.edit" && !isMarkup(op);
}

/** A copy of `op` on `pageKey` with a new id, moved by (dx, dy). */
export function copyOp(op: ContentOp, pageKey: string, id: string, dx = 0, dy = 0): ContentOp {
  const clone = structuredClone(op) as ContentOp;
  return moveOp({ ...clone, id, pageKey } as ContentOp, dx, dy);
}

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** How far to move an object whose (screen) bounds are `b` so it lines up with side `a` of `page` (screen). */
export function alignDelta(b: Rect, page: Rect, a: Align): Pt {
  switch (a) {
    case "left": return [page.x - b.x, 0];
    case "center": return [page.x + (page.w - b.w) / 2 - b.x, 0];
    case "right": return [page.x + page.w - b.w - b.x, 0];
    case "top": return [0, page.y - b.y];
    case "middle": return [0, page.y + (page.h - b.h) / 2 - b.y];
    case "bottom": return [0, page.y + page.h - b.h - b.y];
  }
}

/** Distance of the Transformer's rotation handle from the selection box (px); Konva's default. */
export const ROTATE_HANDLE_OFFSET = 50;

/** Konva `rotateAnchorOffset` for a box whose top edge is `topPx` below the stage's top and `heightPx` tall: the usual
 *  offset above the box when there is room for the handle in the stage, else a negative one that puts it below the box. */
export function rotateAnchorOffset(topPx: number, heightPx: number, base = ROTATE_HANDLE_OFFSET): number {
  return topPx >= base ? base : -(heightPx + base);
}
