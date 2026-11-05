import type { Op } from "@edith/ops";
import type { EditorDoc } from "@/store/editor";

export function compact(doc: EditorDoc): Op[] {
  const keys = new Set(doc.pages.map((p) => p.pageKey));
  const layout = { id: "layout", type: "pages.layout", pages: doc.pages } as Op;
  const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey));
  return [layout, ...content];
}

/** The id of the op an export error points at: `op_id` (bake_failed) or `op_index` into the sent ops (invalid_op). */
export function failedOpId(code: string, extra: Record<string, unknown>, sent: readonly { id: string }[]): string | undefined {
  if (code === "bake_failed" && typeof extra.op_id === "string") return extra.op_id;
  if (code === "invalid_op" && typeof extra.op_index === "number") return sent[extra.op_index]?.id;
  return undefined;
}
