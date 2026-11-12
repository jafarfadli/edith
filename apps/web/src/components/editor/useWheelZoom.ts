import { useEffect, useLayoutEffect, useRef } from "react";
import { clampZoom, scrollFor, wheelFactor, type Anchor } from "@/lib/zoomGesture";
import { editorStore, useEditor } from "@/store/editor";

/** The page under (x, y) in the scroller, or null between pages. */
function pageAt(scroller: HTMLElement, x: number, y: number): HTMLElement | null {
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-testid="page"]')) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}

function anchorAt(scroller: HTMLElement, clientX: number, clientY: number): Anchor {
  const view = scroller.getBoundingClientRect();
  const cx = clientX - view.left, cy = clientY - view.top;
  const page = pageAt(scroller, clientX, clientY);
  if (page) {
    const r = page.getBoundingClientRect();
    return { cx, cy, fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height, page: page.dataset.pageKey ?? null };
  }
  return { cx, cy, fx: (scroller.scrollLeft + cx) / scroller.scrollWidth, fy: (scroller.scrollTop + cy) / scroller.scrollHeight, page: null };
}

/** Pinch on a trackpad and Ctrl/⌘ + wheel zoom the pages (a plain wheel scrolls, as before), around the pointer.
 *  Chrome, Firefox and Edge report a pinch as a wheel event with ctrlKey; Safari as gesture events. Both stop the
 *  browser from zooming the whole page. Events are applied once per frame. */
export function useWheelZoom(scrollerId: string) {
  const zoom = useEditor((s) => s.zoom);
  const anchor = useRef<Anchor | null>(null);

  // After the pages are laid out at the new zoom, put the anchored point back under the pointer.
  useLayoutEffect(() => {
    const a = anchor.current;
    const scroller = document.getElementById(scrollerId);
    anchor.current = null;
    if (!a || !scroller) return;
    const view = scroller.getBoundingClientRect();
    const page = a.page ? scroller.querySelector<HTMLElement>(`[data-testid="page"][data-page-key="${a.page}"]`) : null;
    const box = page
      ? (() => { const r = page.getBoundingClientRect(); return { left: r.left - view.left, top: r.top - view.top, width: r.width, height: r.height }; })()
      : { left: -scroller.scrollLeft, top: -scroller.scrollTop, width: scroller.scrollWidth, height: scroller.scrollHeight };
    const { dx, dy } = scrollFor(a, box);
    scroller.scrollLeft += dx;
    scroller.scrollTop += dy;
  }, [zoom, scrollerId]);

  useEffect(() => {
    const scroller = document.getElementById(scrollerId);
    if (!scroller) return;
    let factor = 1, at: { x: number; y: number } | null = null, frame = 0;
    let gesture: { zoom: number } | null = null;

    const apply = (next: number, x: number, y: number) => {
      const s = editorStore.getState();
      const z = clampZoom(next);
      if (z === s.zoom) return;
      anchor.current = anchorAt(scroller, x, y);
      s.setZoom(z);
    };
    const flush = () => {
      frame = 0;
      if (at) apply(editorStore.getState().zoom * factor, at.x, at.y);
      factor = 1;
      at = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // a plain wheel scrolls
      e.preventDefault();
      factor *= wheelFactor(e.deltaY, e.deltaMode);
      at = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(flush);
    };

    // Safari's pinch: the scale is relative to where the gesture began.
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    const onStart = (e: Event) => { e.preventDefault(); gesture = { zoom: editorStore.getState().zoom }; };
    const onChange = (e: Event) => {
      if (!gesture) return;
      e.preventDefault();
      const g = e as GestureEvent;
      apply(gesture.zoom * g.scale, g.clientX, g.clientY);
    };
    const onEnd = (e: Event) => { e.preventDefault(); gesture = null; };

    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("gesturestart", onStart);
    scroller.addEventListener("gesturechange", onChange);
    scroller.addEventListener("gestureend", onEnd);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("gesturestart", onStart);
      scroller.removeEventListener("gesturechange", onChange);
      scroller.removeEventListener("gestureend", onEnd);
    };
  }, [scrollerId]);
}
