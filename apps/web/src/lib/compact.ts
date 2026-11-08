import type { ContentOp, Op } from "@edith/ops";
import type { EditorDoc } from "@/store/editor";

/** False for a link to a page that is no longer in the document (it goes with the page). */
function targetKept(op: ContentOp, keys: ReadonlySet<string>): boolean {
  return op.type !== "link.add" || !("pageKey" in op.target) || keys.has(op.target.pageKey);
}

export function compact(doc: EditorDoc): Op[] {
  const keys = new Set(doc.pages.map((p) => p.pageKey));
  const layout = { id: "layout", type: "pages.layout", pages: doc.pages } as Op;
  const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey) && targetKept(op, keys));
  const forms = Object.entries(doc.forms ?? {}).map(([fieldName, value], i) => ({ id: `form-${i}`, type: "form.set", fieldName, value }) as Op);
  return [layout, ...content, ...forms];
}

/** The id of the op an export error points at: `op_id` (bake_failed) or `op_index` into the sent ops (invalid_op). */
export function failedOpId(code: string, extra: Record<string, unknown>, sent: readonly { id: string }[]): string | undefined {
  if (code === "bake_failed" && typeof extra.op_id === "string") return extra.op_id;
  if (code === "invalid_op" && typeof extra.op_index === "number") return sent[extra.op_index]?.id;
  return undefined;
}
