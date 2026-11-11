"use client";

import { useEffect, useRef, useState } from "react";
import type { Rect } from "@edith/ops";
import { marqueeHits, type Boxed } from "@/lib/arrange";
import { normalizeRect, type Pt } from "@/lib/objects";
import { editorStore } from "@/store/editor";
import { textEditStore } from "../text/textEdit";

/** Screen pixels the pointer must move before a press on the empty page becomes a marquee (a click stays a click). */
export const MARQUEE_MIN_PX = 3;

/** The marquee of the select tool: drag on the empty page (or on original text, which is most of a text page) to
 *  select the page's objects it touches, live while dragging. Shift keeps the current selection and adds. Escape
 *  stops it. Pointer moves are tracked on window so a drag released outside the stage still ends. `pos` reads the
 *  pointer on the page (clamped to it: the marquee never leaves its page); `items` the boxes that can be selected. */
export function useMarquee(scale: number, pos: (evt?: PointerEvent) => Pt, items: () => Boxed[]) {
  const [rect, setRect] = useState<Rect | null>(null);
  const run = useRef<{ stop: () => void } | null>(null);

  function begin(start: Pt, additive: boolean) {
    run.current?.stop();
    const base = additive ? [...editorStore.getState().selected] : [];
    let active = false;
    const update = (at: Pt) => {
      if (!active) {
        if (Math.hypot(at[0] - start[0], at[1] - start[1]) * scale < MARQUEE_MIN_PX) return;
        active = true;
        textEditStore.getState().selectParagraph(null); // the press that began on a paragraph selected it
      }
      const r = normalizeRect(start, at);
      setRect(r);
      editorStore.getState().selectMany([...base, ...marqueeHits(r, items())]);
    };
    const move = (e: PointerEvent) => { if (e.buttons === 0) stop(); else update(pos(e)); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") stop(); };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", key, true);
      setRect(null);
      run.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", key, true);
    run.current = { stop };
  }

  useEffect(() => () => run.current?.stop(), []);
  return { rect, begin, stop: () => run.current?.stop() };
}
