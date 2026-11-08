import type { ContentOp } from "@edith/ops";
import { pageBounds, type PageGeom } from "@/lib/coords";
import { moveOp } from "@/lib/objects";
import { editorStore, pageGeom, type PageEntry } from "@/store/editor";

/** The page in view (or the first one), its geometry and the size of its visible part (its crop): where
 *  stamps, signatures and images go. Rects made for `size` are placed with placeObject(). */
export function currentPage(): { entry: PageEntry; geom: PageGeom; size: { width: number; height: number } } | null {
  const st = editorStore.getState();
  const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage) ?? st.doc.pages[0];
  if (!entry || !st.info) return null;
  const geom = pageGeom(entry, st.info);
  const b = pageBounds(geom);
  return { entry, geom, size: { width: b.w, height: b.h } };
}

/** Adds `op` — positioned relative to the visible part of its page — and selects it with the select tool
 *  (it can be moved/resized right away). */
export function placeObject(op: ContentOp): void {
  const st = editorStore.getState();
  const entry = st.doc.pages.find((p) => p.pageKey === op.pageKey);
  const crop = entry?.crop;
  st.addObject(crop ? moveOp(op, crop.x, crop.y) : op);
  st.setTool("select");
  st.select(op.id);
}
