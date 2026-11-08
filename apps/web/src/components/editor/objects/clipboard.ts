import type { ContentOp } from "@edith/ops";
import { pageBounds, screenSize, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { newId } from "@/lib/id";
import { alignDelta, copyOp, isCopyable, moveOp, visualBounds, type Align } from "@/lib/objects";
import { editorStore, pageGeom } from "@/store/editor";

/** The editor's own clipboard (objects, not the system clipboard): Salin/Tempel/Duplikat of the mini-bar and
 *  Ctrl/Cmd+C, V, D. */
export const PASTE_OFFSET = 10; // pt: a paste or duplicate on the same page lands this far down-right

let clip: { op: ContentOp; pastes: number } | null = null;

export function hasClipboard(): boolean {
  return clip !== null;
}

function selected(): ContentOp | null {
  const s = editorStore.getState();
  const op = s.selection ? s.doc.objects[s.selection] : undefined;
  return op && isCopyable(op) ? op : null;
}

function geomOf(pageKey: string): PageGeom | null {
  const s = editorStore.getState();
  const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
  return entry && s.info ? pageGeom(entry, s.info) : null;
}

/** `op` moved (as little as possible) so that it lies inside the visible part of its page. */
function keepOnPage(op: ContentOp, g: PageGeom): ContentOp {
  const b = visualBounds(op), p = pageBounds(g);
  const dx = Math.min(Math.max(b.x, p.x), Math.max(p.x + p.w - b.w, p.x)) - b.x;
  const dy = Math.min(Math.max(b.y, p.y), Math.max(p.y + p.h - b.h, p.y)) - b.y;
  return dx || dy ? moveOp(op, dx, dy) : op;
}

function place(op: ContentOp): string {
  const s = editorStore.getState();
  s.addObject(op);
  s.setTool("select");
  s.select(op.id);
  return op.id;
}

export function copySelection(): boolean {
  const op = selected();
  if (!op) return false;
  clip = { op: structuredClone(op), pastes: 0 };
  return true;
}

/** Pastes the clipboard on the page in view: where it was on another page, a little further each time on the
 *  same page. Returns the new object's id. */
export function pasteClipboard(): string | null {
  const s = editorStore.getState();
  const pageKey = s.currentPage ?? s.doc.pages[0]?.pageKey;
  const g = pageKey ? geomOf(pageKey) : null;
  if (!clip || !pageKey || !g) return null;
  const same = clip.op.pageKey === pageKey && s.doc.pages.some((p) => p.pageKey === clip!.op.pageKey);
  const shift = same ? PASTE_OFFSET * ++clip.pastes : 0;
  return place(keepOnPage(copyOp(clip.op, pageKey, newId(), shift, shift), g));
}

/** A copy of the selected object next to it on its page (the clipboard is left alone). */
export function duplicateSelection(): string | null {
  const op = selected();
  const g = op ? geomOf(op.pageKey) : null;
  if (!op || !g) return null;
  return place(keepOnPage(copyOp(op, op.pageKey, newId(), PASTE_OFFSET, PASTE_OFFSET), g));
}

/** Lines the selected object up with a side (or the middle) of its page as seen on screen (rotation and crop
 *  included). */
export function alignSelection(a: Align): void {
  const s = editorStore.getState();
  const op = selected();
  const g = op ? geomOf(op.pageKey) : null;
  if (!op || !g) return;
  const b = visualBounds(op);
  const corners = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => toScreen(p, g, 1));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const screen = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const size = screenSize(g, 1);
  const [dx, dy] = alignDelta(screen, { x: 0, y: 0, w: size.width, h: size.height }, a);
  if (!dx && !dy) return;
  const [x0, y0] = toPage([0, 0], g, 1), [x1, y1] = toPage([dx, dy], g, 1);
  s.updateObject(op.id, moveOp(op, x1 - x0, y1 - y0));
}

/** Test hook: forget the clipboard. */
export function clearClipboard(): void {
  clip = null;
}
