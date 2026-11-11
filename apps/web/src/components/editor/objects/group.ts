import type { ContentOp } from "@edith/ops";
import { cycleSelection, readingOrder } from "@/lib/arrange";
import { toPage } from "@/lib/coords";
import { blankBox, isBlankBox } from "@/lib/keepLines";
import { moveOp } from "@/lib/objects";
import { boundsOf } from "@/lib/zorder";
import { editorStore, pageGeom } from "@/store/editor";
import { isDeletedText, isTextEdit, marksLostBy, noteMarkupRemoved, originalParagraph, textEditStore } from "../text/textEdit";

/** Actions on the whole selection (Figma's model: what applies to one object applies to a group). Each is one
 *  undo step, however many objects it touches. */

/** Arrow-key nudges within this many ms of each other are one undo step (a held key repeats well inside it). */
export const NUDGE_MS = 400;

/** The selected objects that still exist. */
export function selectedOps(): ContentOp[] {
  const s = editorStore.getState();
  return s.selected.map((id) => s.doc.objects[id]).filter((op): op is ContentOp => !!op);
}

/** Moves each object by its own (dx, dy) in page points, as one undo step; false when nothing moved. Text markup
 *  stays on its text (moveOp leaves it); an edit of original text that stops keeping its lines takes the marks on
 *  them along, with a notice (as updateTextOp does for one object). `opts.coalesce`: see putObjects. */
export function moveEach(moves: Record<string, readonly [number, number]>, opts?: { coalesce?: string; within?: number }): boolean {
  const st = editorStore.getState();
  const next: ContentOp[] = [];
  const marks = new Set<string>();
  for (const [id, [dx, dy]] of Object.entries(moves)) {
    const cur = st.doc.objects[id];
    if (!cur || (!dx && !dy)) continue;
    const moved = moveOp(cur, dx, dy);
    if (moved === cur) continue;
    for (const m of marksLostBy(st.doc, cur, moved)) marks.add(m);
    next.push(moved);
  }
  if (!next.length) return false;
  const gone = [...marks].filter((id) => !next.some((o) => o.id === id));
  st.putObjects(next, gone, opts);
  noteMarkupRemoved(gone);
  return true;
}

/** Moves objects `ids` all by (dx, dy). */
export function moveBy(ids: readonly string[], dx: number, dy: number, opts?: { coalesce?: string; within?: number }): boolean {
  return moveEach(Object.fromEntries(ids.map((id) => [id, [dx, dy] as const])), opts);
}

/** Moves the selection by (dx, dy) screen points (the page as shown: a turned page moves along its screen axes).
 *  Held or quick repeated calls are one undo step. False when nothing is selected or nothing can move. */
export function nudgeSelection(dx: number, dy: number): boolean {
  const st = editorStore.getState();
  const ops = selectedOps();
  const entry = ops[0] && st.doc.pages.find((p) => p.pageKey === ops[0].pageKey);
  if (!entry || !st.info) return false;
  const g = pageGeom(entry, st.info);
  const [x0, y0] = toPage([0, 0], g, 1), [x1, y1] = toPage([dx, dy], g, 1);
  return moveBy(ops.map((o) => o.id), x1 - x0, y1 - y0, { coalesce: `nudge:${ops.map((o) => o.id).join(",")}`, within: NUDGE_MS });
}

/** The objects of a page one can select: all but an edit of original text that deleted its text. */
function selectableOn(pageKey: string): ContentOp[] {
  const s = editorStore.getState();
  return s.doc.order.map((id) => s.doc.objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey && !isDeletedText(op));
}

/** Cmd/Ctrl+A: selects every object of the page in view (the select tool). False when it has none. */
export function selectAll(): boolean {
  const s = editorStore.getState();
  const pageKey = s.currentPage ?? s.doc.pages[0]?.pageKey;
  const ids = pageKey ? selectableOn(pageKey).map((o) => o.id) : [];
  if (!ids.length) return false;
  s.setTool("select");
  s.selectMany(ids);
  textEditStore.getState().selectParagraph(null);
  return true;
}

/** Tab / Shift+Tab: selects the next / previous object of the selection's page (top to bottom, left to right,
 *  wrapping). False when nothing is selected: Tab is then the browser's. */
export function cycleObjects(dir: 1 | -1): boolean {
  const s = editorStore.getState();
  const cur = s.selection ? s.doc.objects[s.selection] : undefined;
  if (!cur) return false;
  const order = readingOrder(selectableOn(cur.pageKey).map((op) => ({ id: op.id, rect: boundsOf(op) })));
  const next = cycleSelection(order, cur.id, dir);
  if (next === null) return false;
  s.select(next);
  return true;
}

/** Delete on objects `ids`, one undo step: an edit of original or OCR text keeps its op and loses its text (blankBox,
 *  as deleteObjectOrText does for one), any other object goes. */
export function deleteObjects(ids: readonly string[]): void {
  const st = editorStore.getState();
  const blanked: ContentOp[] = [];
  const remove = new Set<string>();
  const marks = new Set<string>();
  for (const id of ids) {
    const op = st.doc.objects[id];
    if (!op) continue;
    if (!isTextEdit(op)) { remove.add(id); continue; }
    if (isBlankBox(op.box)) continue;
    const area = op.type === "text.ocr_edit" ? op.cover : originalParagraph(st.doc, op.pageKey, op.paragraphId)?.rect ?? op.box.rect;
    const next = { ...op, box: blankBox(op.box, area) } as ContentOp;
    for (const m of marksLostBy(st.doc, op, next)) marks.add(m);
    blanked.push(next);
  }
  const gone = [...marks].filter((id) => !remove.has(id) && !blanked.some((o) => o.id === id));
  st.putObjects(blanked, [...remove, ...gone]);
  noteMarkupRemoved(gone);
}
