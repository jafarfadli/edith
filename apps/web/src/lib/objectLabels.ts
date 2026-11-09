import type { ContentOp } from "@edith/ops";
import { t } from "@/lib/strings";
import { stampTexts } from "@/lib/stamps";
import { plainText } from "@/lib/textbox";

const SNIPPET = 40;

function snippet(text: string | null | undefined): string | undefined {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > SNIPPET ? `${s.slice(0, SNIPPET - 1)}…` : s;
}

/** Which icon the Anotasi panel shows for an object (the panel maps it to a line icon). */
export type ObjectIcon = "text" | "textEdit" | "image" | "signature" | "rect" | "ellipse" | "line" | "arrow" | "polygon" | "polyline" | "cloud"
  | "ink" | "whiteout" | "redact" | "stamp" | "check" | "cross" | "link" | "note" | "highlight" | "underline" | "strike";

/** How the Anotasi panel lists an object: an icon, its kind and (for text, notes, stamps, links) a snippet. */
export function objectLabel(op: ContentOp): { icon: ObjectIcon; label: string; detail?: string } {
  const L = t.objectKinds;
  switch (op.type) {
    case "text.add": return { icon: "text", label: L.text, detail: snippet(plainText(op.box)) };
    case "text.edit": return { icon: "textEdit", label: L.textEdit, detail: snippet(plainText(op.box)) };
    case "text.ocr_edit": return { icon: "textEdit", label: L.textOcr, detail: snippet(plainText(op.box)) };
    case "image.add": return { icon: "image", label: L.image };
    case "signature.add": return { icon: "signature", label: L.signature };
    case "shape.add": return { icon: op.kind, label: L.shape[op.kind] };
    case "ink.add": return { icon: "ink", label: L.ink };
    case "whiteout.add": return { icon: "whiteout", label: L.whiteout };
    case "redact.add": return { icon: "redact", label: L.redact };
    case "stamp.add": return { icon: "stamp", label: L.stamp, detail: snippet(stampTexts(op).join(" ")) };
    case "symbol.add": return { icon: op.kind, label: op.kind === "check" ? L.check : L.cross };
    case "link.add": return { icon: "link", label: L.link, detail: "url" in op.target ? snippet(op.target.url) : undefined };
    case "annot.add": return op.kind === "note"
      ? { icon: "note", label: L.note, detail: snippet(op.content) }
      : { icon: op.kind, label: L.markup[op.kind] };
  }
}

/** Objects the Anotasi panel lists, grouped by page in page order. Objects of deleted pages stay in the doc but are not listed (or counted). */
export function listedObjects(doc: { pages: { pageKey: string }[]; order: string[]; objects: Record<string, ContentOp | undefined> }): { pageKey: string; n: number; ops: ContentOp[] }[] {
  const all = doc.order.map((id) => doc.objects[id]).filter((op): op is ContentOp => !!op);
  return doc.pages
    .map((p, i) => ({ pageKey: p.pageKey, n: i + 1, ops: all.filter((op) => op.pageKey === p.pageKey) }))
    .filter((g) => g.ops.length);
}

export function listedCount(doc: Parameters<typeof listedObjects>[0]): number {
  return listedObjects(doc).reduce((n, g) => n + g.ops.length, 0);
}
