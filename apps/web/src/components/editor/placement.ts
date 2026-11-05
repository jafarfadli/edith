import type { ContentOp } from "@edith/ops";
import type { PageGeom } from "@/lib/coords";
import { editorStore, pageGeom, type PageEntry } from "@/store/editor";

/** The page in view (or the first one) and its geometry: where stamps, signatures and images go. */
export function currentPage(): { entry: PageEntry; geom: PageGeom } | null {
  const st = editorStore.getState();
  const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage) ?? st.doc.pages[0];
  if (!entry || !st.info) return null;
  return { entry, geom: pageGeom(entry, st.info) };
}

/** Adds `op` and selects it with the select tool (it can be moved/resized right away). */
export function placeObject(op: ContentOp): void {
  const st = editorStore.getState();
  st.addObject(op);
  st.setTool("select");
  st.select(op.id);
}
