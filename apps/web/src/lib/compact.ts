import type { Op } from "@edith/ops";
import type { EditorDoc } from "@/store/editor";

export function compact(doc: EditorDoc): Op[] {
  const keys = new Set(doc.pages.map((p) => p.pageKey));
  const layout = { id: "layout", type: "pages.layout", pages: doc.pages } as Op;
  const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey));
  return [layout, ...content];
}
