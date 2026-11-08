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

/** How the Anotasi panel lists an object: an icon, its kind and (for text, notes, stamps, links) a snippet. */
export function objectLabel(op: ContentOp): { icon: string; label: string; detail?: string } {
  const L = t.objectKinds;
  switch (op.type) {
    case "text.add": return { icon: "T", label: L.text, detail: snippet(plainText(op.box)) };
    case "text.edit": return { icon: "✎", label: L.textEdit, detail: snippet(plainText(op.box)) };
    case "image.add": return { icon: "🖼", label: L.image };
    case "signature.add": return { icon: "✍", label: L.signature };
    case "shape.add": return { icon: { rect: "□", ellipse: "○", line: "╱", arrow: "→", polygon: "⬠", polyline: "⌇", cloud: "☁" }[op.kind], label: L.shape[op.kind] };
    case "ink.add": return { icon: "✎", label: L.ink };
    case "whiteout.add": return { icon: "▭", label: L.whiteout };
    case "redact.add": return { icon: "▮", label: L.redact };
    case "stamp.add": return { icon: "🏷", label: L.stamp, detail: snippet(stampTexts(op).join(" ")) };
    case "symbol.add": return { icon: op.kind === "check" ? "✓" : "✗", label: op.kind === "check" ? L.check : L.cross };
    case "link.add": return { icon: "🔗", label: L.link, detail: "url" in op.target ? snippet(op.target.url) : undefined };
    case "annot.add": return op.kind === "note"
      ? { icon: "🗒", label: L.note, detail: snippet(op.content) }
      : { icon: "🖍", label: L.markup[op.kind] };
  }
}
