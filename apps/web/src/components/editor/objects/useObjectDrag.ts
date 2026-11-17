"use client";

import { useRef, type MutableRefObject } from "react";
import type Konva from "konva";
import type { ContentOp, Rect } from "@edith/ops";
import { pageBounds, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { newId } from "@/lib/id";
import { copyOp, isCopyable } from "@/lib/objects";
import { boundsUnion, fmtPt, snapMove, type Gap, type Guide } from "@/lib/snap";
import { isMac } from "@/lib/keys";
import { boundsOf, nextBelow } from "@/lib/zorder";
import { crossPageStore } from "@/store/crossPage";
import { editorStore, pageGeom } from "@/store/editor";
import { snapStore } from "@/store/snap";
import { textEditStore } from "../text/textEdit";
import { moveBy } from "./group";
import { sizeBadge, snapTargets } from "./snapTargets";

/** Distance (screen px) within which a dragged box snaps to a guide. */
export const SNAP_PX = 5;

interface Drag {
  ids: string[]; homes: Map<string, { x: number; y: number }>;
  base: Rect; targets: Rect[]; page: Rect; dup: boolean; dx: number; dy: number;
  /** Where the press was (client px), and the selection's box on screen then: for a drag onto another page. */
  start: Pt | null; startBox: { left: number; top: number; width: number; height: number } | null;
  /** The other page the pointer is over (only when every dragged object can move to another page), and the pointer. */
  cross: { pageKey: string; at: Pt } | null;
}

/** Within this many px of the top or bottom of the pages' scroller, a drag scrolls it (towards another page) … */
const EDGE_PX = 48;
/** … by up to this many px a frame, faster closer to the edge. */
const EDGE_SPEED = 18;

/** Scrolls the pages while a drag holds the pointer near the scroller's top or bottom edge; `stop` ends it. */
function edgeScroller(): { move(at: Pt): void; stop(): void } {
  let at: Pt | null = null, frame = 0;
  const tick = () => {
    frame = 0;
    const el = document.getElementById("page-scroller");
    if (!el || !at) return;
    const r = el.getBoundingClientRect();
    const v = at[1] < r.top + EDGE_PX ? -(r.top + EDGE_PX - at[1]) : at[1] > r.bottom - EDGE_PX ? at[1] - (r.bottom - EDGE_PX) : 0;
    if (!v) return;
    el.scrollTop += Math.sign(v) * Math.min(EDGE_SPEED, Math.ceil(Math.abs(v) / EDGE_PX * EDGE_SPEED));
    frame = requestAnimationFrame(tick);
  };
  return {
    move(p) { at = p; if (!frame) frame = requestAnimationFrame(tick); },
    stop() { at = null; if (frame) cancelAnimationFrame(frame); frame = 0; },
  };
}

/** The page (its key and box on screen) under client point (x, y), if any. */
export function pageUnder(x: number, y: number): { key: string; rect: DOMRect } | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-testid="page"]')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && el.dataset.pageKey) return { key: el.dataset.pageKey, rect: r };
  }
  return null;
}

/** The point of page `key` under client point `at`, in page points (its geometry and the zoom as drawn). */
export function pagePoint(key: string, at: Pt): Pt | null {
  const s = editorStore.getState();
  const entry = s.doc.pages.find((p) => p.pageKey === key);
  const el = document.querySelector<HTMLElement>(`[data-testid="page"][data-page-key="${key}"]`);
  if (!entry || !s.info || !el) return null;
  const r = el.getBoundingClientRect();
  return toPage([at[0] - r.left, at[1] - r.top], pageGeom(entry, s.info), s.zoom);
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
  const edge = useRef(edgeScroller());
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
    const start: Pt | null = e.evt && "clientX" in e.evt ? [e.evt.clientX, e.evt.clientY] : null;
    const el = document.querySelector<HTMLElement>(`[data-testid="page"][data-page-key="${pageKey}"]`)?.getBoundingClientRect();
    const corners = ([[base.x, base.y], [base.x + base.w, base.y], [base.x, base.y + base.h], [base.x + base.w, base.y + base.h]] as Pt[])
      .map((c) => toScreen(c, geom, scale));
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    drag.current = {
      ids, base, dup: !!p?.dup, dx: 0, dy: 0,
      homes: new Map(ops.map((op) => [op.id, home(op)])),
      targets: snapTargets(pageKey, new Set(ids)),
      page: pageBounds(geom),
      start,
      startBox: el ? { left: el.left + Math.min(...xs), top: el.top + Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } : null,
      cross: null,
    };
  }

  function onDragMove(e: DragEvt, id: string) {
    const d = drag.current, g = e.currentTarget as Konva.Group, h = d?.homes.get(id);
    if (!d || !h) return;
    // Over another page: the selection would land there (shown as a ghost: this page's canvas clips it).
    const at: Pt | null = "clientX" in e.evt ? [e.evt.clientX, e.evt.clientY] : null;
    if (at) edge.current.move(at);
    const under = at ? pageUnder(at[0], at[1]) : null;
    const s0 = editorStore.getState();
    if (under && under.key !== pageKey && d.start && d.startBox && d.ids.every((x) => isCopyable(s0.doc.objects[x]))) {
      d.cross = { pageKey: under.key, at: at! };
      snapStore.getState().clear();
      crossPageStore.getState().show({ pageKey: under.key, box: { ...d.startBox, left: d.startBox.left + at![0] - d.start[0], top: d.startBox.top + at![1] - d.start[1] } });
      return;
    }
    if (d.cross) { d.cross = null; crossPageStore.getState().clear(); }
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
    crossPageStore.getState().clear();
    edge.current.stop();
    if (!d) return;
    // The nodes go back home: the store's new positions redraw them (an undo then needs no stale node position).
    for (const [oid, at] of d.homes) nodes.current.get(oid)?.position(at);
    const s = editorStore.getState();
    if (d.cross && d.start) {
      // Dropped on another page: there, as far from the pointer as it was from the press (one undo step; Alt: a copy).
      const from = pagePoint(pageKey, d.start), to = pagePoint(d.cross.pageKey, d.cross.at);
      if (from && to) {
        const dx = to[0] - from[0], dy = to[1] - from[1];
        const moved = d.ids.map((x) => s.doc.objects[x]).filter((op) => isCopyable(op))
          .map((op) => copyOp(op, d.cross!.pageKey, d.dup ? newId() : op.id, dx, dy));
        if (moved.length) {
          s.putObjects(moved);
          s.selectMany(moved.map((c) => c.id));
          s.setCurrentPage(d.cross.pageKey);
        }
      }
      return;
    }
    if (!d.dx && !d.dy) return;
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
