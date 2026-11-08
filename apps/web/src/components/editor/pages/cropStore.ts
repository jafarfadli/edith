import { createStore } from "zustand/vanilla";
import type { CropBox } from "@/lib/coords";
import { pageBounds } from "@/lib/coords";
import { clampCrop } from "@/lib/pages";
import { editorStore, pageGeom } from "@/store/editor";

/** The crop being edited: the page shows whole, with the crop rect over it, until applied or cancelled. */
export interface CropState {
  pageKey: string | null;
  rect: CropBox | null;
  /** Starts cropping `pageKey` from its current crop, or from the page inset by 5 %. */
  open(pageKey: string): void;
  setRect(rect: CropBox): void;
  close(): void;
}

export const CROP_INSET = 0.05;

export const cropStore = createStore<CropState>()((set) => ({
  pageKey: null, rect: null,
  open(pageKey) {
    const s = editorStore.getState();
    const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
    if (!entry || !s.info) return;
    const g = pageGeom(entry, s.info);
    const b = pageBounds(g);
    const rect = entry.crop ? b : { x: g.width * CROP_INSET, y: g.height * CROP_INSET, w: g.width * (1 - 2 * CROP_INSET), h: g.height * (1 - 2 * CROP_INSET) };
    s.select(null);
    s.setTool("select");
    set({ pageKey, rect });
  },
  setRect: (rect) => set({ rect }),
  close: () => set({ pageKey: null, rect: null }),
}));

/** Applies the edited crop to its page, or to every page ("semua halaman"), as one undo step. */
export function applyCrop(all: boolean): void {
  const { pageKey, rect } = cropStore.getState();
  if (!pageKey || !rect) return;
  const s = editorStore.getState();
  s.setCrop(all ? s.doc.pages.map((p) => p.pageKey) : [pageKey], rect);
  cropStore.getState().close();
}

/** Removes the crop of the page being edited. */
export function clearCrop(): void {
  const { pageKey } = cropStore.getState();
  if (pageKey) editorStore.getState().setCrop([pageKey], null);
  cropStore.getState().close();
}

/** `next` clamped to the page; the previous rect when nothing valid (smaller than the minimum) is left. */
export function fitRect(next: CropBox, prev: CropBox, size: { width: number; height: number }): CropBox {
  return clampCrop(next, size) ?? prev;
}
