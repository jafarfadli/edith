"use client";

import { useEffect, useRef } from "react";
import { boundsUnion, measure } from "@/lib/snap";
import { boundsOf } from "@/lib/zorder";
import { editorStore } from "@/store/editor";
import { snapStore } from "@/store/snap";

/** Alt held with an object selected and the pointer over another: the distances between the two (Figma). `stackAt`
 *  gives the objects under the pointer, topmost first. Returns `{ move(alt), leave() }`: call them on pointer moves
 *  (with the event's Alt state) and when the pointer leaves the page; Alt presses and releases are tracked here, for the
 *  page the pointer is over. A drag or resize in progress (its size badge is up) is never disturbed. */
export function useAltMeasure(pageKey: string, enabled: boolean, stackAt: () => string[]) {
  const shown = useRef(false);
  const inside = useRef(false); // the pointer is over this page (Konva has a pointer position only then)

  const clear = () => {
    if (!shown.current) return;
    shown.current = false;
    if (!snapStore.getState().view?.badge) snapStore.getState().clear();
  };

  const update = (alt: boolean) => {
    if (snapStore.getState().view?.badge) return; // a drag or resize owns the guides
    if (!alt || !enabled) { clear(); return; }
    const s = editorStore.getState();
    const mine = s.selected.map((id) => s.doc.objects[id]).filter((op) => !!op && op.pageKey === pageKey);
    const over = stackAt().find((id) => !s.selected.includes(id));
    const a = boundsUnion(mine.map(boundsOf));
    if (!a || !over || !s.doc.objects[over]) { clear(); return; }
    shown.current = true;
    snapStore.getState().show({ pageKey, guides: [], gaps: measure(a, boundsOf(s.doc.objects[over])), badge: null });
  };

  const latest = useRef(update);
  useEffect(() => { latest.current = update; });
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Alt" && inside.current) latest.current(e.type === "keydown"); };
    const blur = () => latest.current(false);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); window.removeEventListener("blur", blur); };
  }, []);

  return {
    move: (alt: boolean) => { inside.current = true; update(alt); },
    leave: () => { inside.current = false; update(false); },
  };
}
