import type { ContentOp, Rect } from "@edith/ops";
import { alignMoves, distributeMoves } from "@/lib/arrange";
import { pageBounds, screenSize, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { newId } from "@/lib/id";
import { copyOp, isCopyable, isMarkup, moveOp, visualBounds, type Align } from "@/lib/objects";
import { boundsUnion } from "@/lib/snap";
import { editorStore, pageGeom } from "@/store/editor";
import { deleteObjects, moveEach, selectedOps } from "./group";

/** The editor's own clipboard (objects, not the system clipboard): Salin/Tempel/Duplikat of the mini-bar and
 *  Ctrl/Cmd+C, X, V, D. It holds a group as it lies: pasting keeps how its objects sit to each other. */
export const PASTE_OFFSET = 10; // pt: a paste or duplicate on the same page lands this far down-right

let clip: { ops: ContentOp[]; pastes: number } | null = null;

export function hasClipboard(): boolean {
  return clip !== null;
}

/** The selected objects that can be copied (not edits of original text, not text markup). */
function selected(): ContentOp[] {
  return selectedOps().filter(isCopyable);
}

function geomOf(pageKey: string): PageGeom | null {
  const s = editorStore.getState();
  const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
  return entry && s.info ? pageGeom(entry, s.info) : null;
}

/** `ops` moved together (as little as possible) so that the group lies inside the visible part of its page. */
function keepOnPage(ops: ContentOp[], g: PageGeom): ContentOp[] {
  const b = boundsUnion(ops.map(visualBounds)), p = pageBounds(g);
  if (!b) return ops;
  const dx = Math.min(Math.max(b.x, p.x), Math.max(p.x + p.w - b.w, p.x)) - b.x;
  const dy = Math.min(Math.max(b.y, p.y), Math.max(p.y + p.h - b.h, p.y)) - b.y;
  return dx || dy ? ops.map((op) => moveOp(op, dx, dy)) : ops;
}

/** Adds `ops` as one step, with the select tool, and selects them; returns the primary's id. */
function place(ops: ContentOp[]): string {
  const s = editorStore.getState();
  s.putObjects(ops);
  s.setTool("select");
  s.selectMany(ops.map((o) => o.id));
  return ops[ops.length - 1].id;
}

export function copySelection(): boolean {
  const ops = selected();
  if (!ops.length) return false;
  clip = { ops: structuredClone(ops), pastes: 0 };
  return true;
}

/** Cut: copies the selected objects and deletes them (one undo step). False when nothing could be copied. */
export function cutSelection(): boolean {
  if (!copySelection()) return false;
  deleteObjects(selected().map((o) => o.id));
  return true;
}

/** Pastes the clipboard on the page in view: where it was on another page, a little further each time on the
 *  same page. Returns the id of the last new object (the primary of the new selection). */
export function pasteClipboard(): string | null {
  const s = editorStore.getState();
  const pageKey = s.currentPage ?? s.doc.pages[0]?.pageKey;
  const g = pageKey ? geomOf(pageKey) : null;
  if (!clip || !pageKey || !g) return null;
  const from = clip.ops[0].pageKey;
  const same = from === pageKey && s.doc.pages.some((p) => p.pageKey === from);
  const shift = same ? PASTE_OFFSET * ++clip.pastes : 0;
  return place(keepOnPage(clip.ops.map((op) => copyOp(op, pageKey, newId(), shift, shift)), g));
}

/** Copies of the selected objects next to them on their page (the clipboard is left alone). */
export function duplicateSelection(): string | null {
  const ops = selected();
  const g = ops.length ? geomOf(ops[0].pageKey) : null;
  if (!g) return null;
  return place(keepOnPage(ops.map((op) => copyOp(op, op.pageKey, newId(), PASTE_OFFSET, PASTE_OFFSET)), g));
}

/** The selected objects that move (everything but text markup), with the page they lie on. */
function movable(): { ops: ContentOp[]; g: PageGeom } | null {
  const ops = selectedOps().filter((op) => !isMarkup(op));
  const g = ops.length ? geomOf(ops[0].pageKey) : null;
  return g ? { ops, g } : null;
}

/** What `op` covers as seen on screen (rotation and crop included), at scale 1. */
function screenRect(op: ContentOp, g: PageGeom): Rect {
  const b = visualBounds(op);
  const corners = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => toScreen(p, g, 1));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Screen deltas to page deltas. */
function pageDelta(g: PageGeom, dx: number, dy: number): [number, number] {
  const [x0, y0] = toPage([0, 0], g, 1), [x1, y1] = toPage([dx, dy], g, 1);
  return [x1 - x0, y1 - y0];
}

/** Lines the selection up with a side (or the middle) of the screen as seen: one object with its page, several with
 *  their common bounding box (Figma), as one undo step. Rotation and crop count. */
export function alignSelection(a: Align): void {
  const at = movable();
  if (!at) return;
  const rects = Object.fromEntries(at.ops.map((op) => [op.id, screenRect(op, at.g)]));
  const size = screenSize(at.g, 1);
  const ref = at.ops.length === 1 ? { x: 0, y: 0, w: size.width, h: size.height } : boundsUnion(Object.values(rects))!;
  const moves = alignMoves(rects, a, ref);
  moveEach(Object.fromEntries(Object.entries(moves).map(([id, [dx, dy]]) => [id, pageDelta(at.g, dx, dy)])));
}

/** Evens out the gaps between three or more selected objects (`axis`: along the screen's x or y), the outer two
 *  staying; one undo step. */
export function distributeSelection(axis: "x" | "y"): void {
  const at = movable();
  if (!at || at.ops.length < 3) return;
  const along = distributeMoves(at.ops.map((op) => ({ id: op.id, rect: screenRect(op, at.g) })), axis);
  moveEach(Object.fromEntries(Object.entries(along).map(([id, d]) => [id, pageDelta(at.g, axis === "x" ? d : 0, axis === "y" ? d : 0)])));
}

/** Test hook: forget the clipboard. */
export function clearClipboard(): void {
  clip = null;
}
