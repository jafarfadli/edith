/** Zoom by wheel or pinch: how far one event zooms, and where the scroll goes so the point under the pointer stays put. */

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
/** The most one wheel event counts for, in pixels: a mouse notch (±100, or ±3 lines) is a step of about 10 %, a
 *  trackpad pinch (events of ±1…±10) a few percent each. */
const MAX_DELTA = 20;
const PER_PIXEL = 0.005;
const LINE_PX = 16;
const PAGE_PX = 400;

/** The factor one wheel event (`deltaY`, in `deltaMode` units) multiplies the zoom by: wheel up (negative) zooms in. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaY * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? PAGE_PX : 1);
  return Math.exp(-Math.max(-MAX_DELTA, Math.min(MAX_DELTA, px)) * PER_PIXEL);
}

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** What stays under the pointer while the zoom changes: the point of the page under it (as a fraction of the page's
 *  size, so it holds at any zoom), or, between pages, the point of the scroller's content (as a fraction of it). */
export type Anchor = { cx: number; cy: number; fx: number; fy: number; page: string | null };

/** The scroll position that puts the anchored point back under the pointer, given where its page (or the whole
 *  content) now lies relative to the scroller's top-left corner and how large it is. */
export function scrollFor(anchor: Anchor, box: { left: number; top: number; width: number; height: number }): { dx: number; dy: number } {
  return { dx: box.left + anchor.fx * box.width - anchor.cx, dy: box.top + anchor.fy * box.height - anchor.cy };
}
