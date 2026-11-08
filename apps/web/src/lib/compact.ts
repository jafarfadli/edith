import type { ContentOp, Op } from "@edith/ops";
import type { FormField } from "@/lib/api";
import type { DocInfo, EditorDoc } from "@/store/editor";

/** False for a link to a page that is no longer in the document (it goes with the page). */
function targetKept(op: ContentOp, keys: ReadonlySet<string>): boolean {
  return op.type !== "link.add" || !("pageKey" in op.target) || keys.has(op.target.pageKey);
}

/** Names of the fields of document `docId` (`fields`) that still have a widget on one of the pages. */
function keptFields(doc: EditorDoc, docId: string, fields: FormField[]): Set<string> {
  const shown = new Set(doc.pages.flatMap((p) => ("doc" in p.src && p.src.doc === docId ? [p.src.index] : [])));
  return new Set(fields.filter((f) => shown.has(f.page)).map((f) => f.name));
}

/** The ops sent to the API. With `info`, values of form fields whose pages were all deleted are dropped;
 *  values of imported PDFs' fields go as form.set with `doc`. */
export function compact(doc: EditorDoc, info?: Pick<DocInfo, "docId" | "fields" | "importFields">): Op[] {
  const keys = new Set(doc.pages.map((p) => p.pageKey));
  const pages = doc.pages.map(({ crop, ...p }) => (crop ? { ...p, crop } : p)); // no `crop: null` on the wire
  const layout = { id: "layout", type: "pages.layout", pages } as Op;
  const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey) && targetKept(op, keys));
  const fields = info ? keptFields(doc, info.docId, info.fields ?? []) : null;
  const forms = Object.entries(doc.forms ?? {})
    .filter(([name]) => !fields || fields.has(name))
    .map(([fieldName, value], i) => ({ id: `form-${i}`, type: "form.set", fieldName, value }) as Op);
  const imported = Object.entries(doc.importForms ?? {}).flatMap(([d, values]) => {
    const kept = info ? keptFields(doc, d, info.importFields?.[d] ?? []) : null;
    return Object.entries(values).filter(([name]) => !kept || kept.has(name)).map(([fieldName, value]) => ({ fieldName, value, doc: d }));
  }).map((f, i) => ({ id: `form-import-${i}`, type: "form.set", ...f }) as Op);
  return [layout, ...content, ...forms, ...imported];
}

/** The id of the op an export error points at: `op_id` (bake_failed) or `op_index` into the sent ops (invalid_op). */
export function failedOpId(code: string, extra: Record<string, unknown>, sent: readonly { id: string }[]): string | undefined {
  if (code === "bake_failed" && typeof extra.op_id === "string") return extra.op_id;
  if (code === "invalid_op" && typeof extra.op_index === "number") return sent[extra.op_index]?.id;
  return undefined;
}
