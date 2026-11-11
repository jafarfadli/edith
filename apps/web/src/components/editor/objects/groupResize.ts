import type { ContentOp, Rect } from "@edith/ops";
import { scaleBox } from "@/lib/arrange";
import { hasRotation, isMarkup, isTextOp, moveOp, resizeOp, rotationOf, type TextOp } from "@/lib/objects";
import { boundsOf } from "@/lib/zorder";
import { editorStore } from "@/store/editor";
import { marksLostBy, noteMarkupRemoved } from "../text/textEdit";

/** Re-lays out a text box for a new rect (PageOverlay's overlayHooks.resizeText): only its x and width count. */
export type ResizeText = (op: TextOp, to: Rect) => TextOp;

/** The group's box was resized from `from` to `to` (the handles around a multi-selection): every object moves and
 *  scales with it, as one undo step. A text box changes by its width only (it re-wraps; its glyphs are never scaled)
 *  and follows the box by its position; a turned object keeps its size and its centre follows; text markup stays on its
 *  text. */
export function resizeGroup(ids: readonly string[], from: Rect, to: Rect, resizeText?: ResizeText): boolean {
  if (from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) return false;
  const st = editorStore.getState();
  const next: ContentOp[] = [];
  const marks = new Set<string>();
  for (const id of ids) {
    const cur = st.doc.objects[id];
    if (!cur || isMarkup(cur)) continue;
    const b = boundsOf(cur), sb = scaleBox(b, from, to);
    let out: ContentOp;
    if (hasRotation(cur) && rotationOf(cur) !== 0) {
      out = moveOp(cur, sb.x + sb.w / 2 - (b.x + b.w / 2), sb.y + sb.h / 2 - (b.y + b.h / 2));
    } else if (isTextOp(cur) && resizeText) {
      const sized = resizeText(cur, sb);
      out = moveOp(sized, 0, sb.y - sized.box.rect.y);
    } else {
      out = resizeOp(cur, sb);
    }
    if (out === cur) continue;
    for (const m of marksLostBy(st.doc, cur, out)) marks.add(m);
    next.push(out);
  }
  if (!next.length) return false;
  const gone = [...marks].filter((m) => !next.some((o) => o.id === m));
  st.putObjects(next, gone);
  noteMarkupRemoved(gone);
  return true;
}
