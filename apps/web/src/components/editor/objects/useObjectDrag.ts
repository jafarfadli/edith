"use client";

import { useRef, type MutableRefObject } from "react";
import type Konva from "konva";
import type { ContentOp, Rect } from "@edith/ops";
import { pageBounds, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import { copyOp, isCopyable } from "@/lib/objects";
import { boundsUnion, fmtPt, snapMove, type Gap, type Guide } from "@/lib/snap";
import { isMac } from "@/lib/keys";
import { boundsOf, nextBelow } from "@/lib/zorder";
import { editorStore } from "@/store/editor";
import { snapStore } from "@/store/snap";
import { textEditStore } from "../text/textEdit";
import { moveBy } from "./group";
import { sizeBadge, snapTargets } from "./snapTargets";

/** Distance (screen px) within which a dragged box snaps to a guide. */
export const SNAP_PX = 5;

interface Drag {
  ids: string[]; homes: Map<string, { x: number; y: number }>;
  base: Rect; targets: Rect[]; page: Rect; dup: boolean; dx: number; dy: number;
}

/** What a press on an object started: whether the next drag copies (Alt), whether a release without a drag is a
 *  click on one object of a group (it then becomes the only selected one) or an Alt+click to cycle beneath. */
interface Press { id: string; dup: boolean; collapse: boolean; cycle: boolean; dragged: boolean }

type PointerEvt = Konva.KonvaEventObject<PointerEvent>;
type DragEvt = Konva.KonvaEventObject<DragEvent>;

/** Pressing and dragging the page's objects with the select tool, as Figma does: a press selects (Shift toggles; on
 *  a member of a group it keeps the group); dragging moves the whole selection as one undo step, snapping the
 *  selection's box to the page's guides unless Cmd/Ctrl is held; Alt+drag moves a copy. `home` is an object's group
 *  position at rest (its Konva origin), `stackAt` the objects under the pointer, topmost first. */
export function useObjectDrag(args: {
  pageKey: string; geom: PageGeom; scale: number; nodes: MutableRefObject<Map<string, Konva.Group>>;
  home: (op: ContentOp) => { x: number; y: number }; stackAt: () => string[];
}) {
  const { pageKey, geom, scale, nodes, home, stackAt } = args;
  const drag = useRef<Drag | null>(null);
  const press = useRef<Press | null>(null);

  /** A press on object `id`: selects it; Shift toggles it in the selection; Alt selects the next object beneath the
   *  selection at the pointer instead (cycling), or, on an object already selected, copies it when dragged; other
   *  buttons leave the selection to the context menu, and so does Ctrl+click on the Mac (its right-click). */
  function onPress(e: PointerEvt, id: string) {
    e.cancelBubble = true; // not a press on the empty page
    if (e.evt.button !== 0 || (e.evt.ctrlKey && isMac())) return;
    textEditStore.getState().selectParagraph(null);
    const s = editorStore.getState();
    const p: Press = { id, dup: false, collapse: false, cycle: false, dragged: false };
    press.current = p;
    if (e.evt.shiftKey) { s.toggleSelected(id); return; }
    if (e.evt.altKey) {
      if (s.selected.includes(id)) { p.dup = true; p.cycle = true; return; } // a drag copies; a release cycles
      const target = nextBelow(stackAt(), s.selection) ?? id;
      s.select(target);
      p.dup = target === id; // nothing beneath to pick: Alt+drag copies it
      return;
    }
    if (s.selected.includes(id)) { p.collapse = s.selected.length > 1; return; } // part of a group: keep it for the drag
    s.select(id);
  }

  /** The press ended without a drag: a click on a member of a group selects it alone; an Alt+click cycles. */
  function onRelease(id: string) {
    const p = press.current;
    press.current = null;
    if (!p || p.id !== id || p.dragged) return;
    const s = editorStore.getState();
    if (p.cycle) s.select(nextBelow(stackAt(), s.selection) ?? id);
    else if (p.collapse) s.select(id);
  }

  function onDragStart(e: DragEvt, id: string) {
    const p = press.current;
    if (p) p.dragged = true;
    // Alt+drag on an object that was only picked beneath another would move the one on top: no drag then.
    if (e.evt?.altKey && !p?.dup) { e.target.stopDrag(); return; }
    const s = editorStore.getState();
    const ids = (s.selected.includes(id) ? s.selected : [id]).filter((x) => nodes.current.has(x) && s.doc.objects[x]);
    const ops = ids.map((x) => s.doc.objects[x]);
    const base = boundsUnion(ops.map(boundsOf));
    if (!base) return;
    drag.current = {
      ids, base, dup: !!p?.dup, dx: 0, dy: 0,
      homes: new Map(ops.map((op) => [op.id, home(op)])),
      targets: snapTargets(pageKey, new Set(ids)),
      page: pageBounds(geom),
    };
  }

  function onDragMove(e: DragEvt, id: string) {
    const d = drag.current, g = e.currentTarget as Konva.Group, h = d?.homes.get(id);
    if (!d || !h) return;
    let dx = g.x() - h.x, dy = g.y() - h.y;
    let guides: Guide[] = [], gaps: Gap[] = [];
    // Cmd/Ctrl while dragging turns snapping off.
    if (!(e.evt.metaKey || e.evt.ctrlKey)) {
      const snap = snapMove({ ...d.base, x: d.base.x + dx, y: d.base.y + dy }, d.targets, d.page, SNAP_PX / scale);
      dx += snap.dx; dy += snap.dy; guides = snap.guides; gaps = snap.gaps;
    }
    d.dx = dx; d.dy = dy;
    for (const [oid, at] of d.homes) nodes.current.get(oid)?.position({ x: at.x + dx, y: at.y + dy });
    const box = { ...d.base, x: d.base.x + dx, y: d.base.y + dy };
    snapStore.getState().show({ pageKey, guides, gaps, badge: { at: sizeBadge(box, geom, scale), text: `${fmtPt(box.w)} × ${fmtPt(box.h)}` } });
  }

  function onDragEnd() {
    const d = drag.current;
    drag.current = null;
    snapStore.getState().clear();
    if (!d) return;
    // The nodes go back home: the store's new positions redraw them (an undo then needs no stale node position).
    for (const [oid, at] of d.homes) nodes.current.get(oid)?.position(at);
    if (!d.dx && !d.dy) return;
    const s = editorStore.getState();
    if (d.dup) {
      const copies = d.ids.map((x) => s.doc.objects[x]).filter((op) => isCopyable(op)).map((op) => copyOp(op, pageKey, newId(), d.dx, d.dy));
      if (copies.length) {
        s.putObjects(copies);
        s.selectMany(copies.map((c) => c.id));
        return;
      }
    }
    moveBy(d.ids, d.dx, d.dy);
  }

  return { onPress, onRelease, onDragStart, onDragMove, onDragEnd };
}
