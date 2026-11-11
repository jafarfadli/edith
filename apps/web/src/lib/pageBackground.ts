import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { screenSize, toScreen, type PageGeom } from "@/lib/coords";
import type { Rect } from "@edith/ops";

/** What the white cover of an edited paragraph should look like: the page's own background around the text, read from
 *  the pdf.js rendering (paper that is not white, a shaded or coloured table cell). The export paints no cover at all
 *  (it only removes the old glyphs), so this is the editor's picture of what the export leaves there. */

const PAPER = "#ffffff";
/** pt: how far outside a rect the background is read, and how wide the strips are. */
const GAP = 0.6, STRIP = 1.6;

interface Rendered { canvas: HTMLCanvasElement; geom: PageGeom; scale: number }
const rendered = new Map<string, Rendered>();
const cache = new Map<string, string>(); // `${pageKey}|${x},${y},${w},${h}` → colour, dropped whenever the page renders again

/** A page's render count: a component that reads colours subscribes to it, to read them again once the page has drawn. */
const renderCount = createStore<{ n: Record<string, number> }>()(() => ({ n: {} }));
export const useRendered = (pageKey: string): number => useStore(renderCount, (s) => s.n[pageKey] ?? 0);

/** PageCanvas: `pageKey` has drawn on `canvas` (the whole page, at `scale` and `geom`'s rotation). */
export function pageRendered(pageKey: string, r: Rendered): void {
  rendered.set(pageKey, r);
  for (const k of cache.keys()) if (k.startsWith(`${pageKey}|`)) cache.delete(k);
  renderCount.setState((s) => ({ n: { ...s.n, [pageKey]: (s.n[pageKey] ?? 0) + 1 } }));
}

/** PageCanvas: its canvas is gone. */
export function pageGone(pageKey: string, canvas: HTMLCanvasElement): void {
  if (rendered.get(pageKey)?.canvas === canvas) rendered.delete(pageKey);
}

/** The most common colour among RGBA `pixels` (16 levels per channel, the mean of the winning bucket), or null when
 *  none is opaque: around a line of text the background outweighs glyph edges and borders. */
export function dominantColor(pixels: ArrayLike<number>): string | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best) return null;
  const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/** The strips just outside `r` (page points): left, right, above and below it. */
export function stripsAround(r: Rect): Rect[] {
  const x0 = r.x - GAP - STRIP, x1 = r.x + r.w + GAP, y0 = r.y - GAP - STRIP, y1 = r.y + r.h + GAP;
  return [
    { x: x0, y: r.y, w: STRIP, h: r.h }, { x: x1, y: r.y, w: STRIP, h: r.h },
    { x: r.x, y: y0, w: r.w, h: STRIP }, { x: r.x, y: y1, w: r.w, h: STRIP },
  ];
}

/** The page's background around `r` (page points): paper white where it is not known (the page has not drawn yet, or
 *  its pixels cannot be read). */
export function backgroundAround(pageKey: string, r: Rect): string {
  const page = rendered.get(pageKey);
  if (!page || !page.canvas.width) return PAPER;
  const key = `${pageKey}|${r.x.toFixed(2)},${r.y.toFixed(2)},${r.w.toFixed(2)},${r.h.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const color = read(page, r) ?? PAPER;
  cache.set(key, color);
  return color;
}

function read({ canvas, geom, scale }: Rendered, r: Rect): string | null {
  const full: PageGeom = { ...geom, crop: null };
  const k = canvas.width / screenSize(full, scale).width; // device pixels per css pixel
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const all: number[] = [];
  try {
    for (const s of stripsAround(r)) {
      const a = toScreen([s.x, s.y], full, scale), b = toScreen([s.x + s.w, s.y + s.h], full, scale);
      const x = Math.max(0, Math.floor(Math.min(a[0], b[0]) * k)), y = Math.max(0, Math.floor(Math.min(a[1], b[1]) * k));
      const w = Math.min(canvas.width - x, Math.max(1, Math.ceil(Math.abs(a[0] - b[0]) * k)));
      const h = Math.min(canvas.height - y, Math.max(1, Math.ceil(Math.abs(a[1] - b[1]) * k)));
      if (w <= 0 || h <= 0) continue;
      const px = ctx.getImageData(x, y, w, h).data;
      for (let i = 0; i < px.length; i++) all.push(px[i]);
    }
  } catch {
    return null; // a canvas that cannot be read
  }
  return dominantColor(all);
}
