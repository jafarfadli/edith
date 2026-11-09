"use client";

import type { TextOp } from "@/lib/objects";
import { ocrOverflows } from "@/lib/ocr";
import { overflowsOriginal } from "@/lib/paragraphs";
import { useEditor } from "@/store/editor";
import { paragraphsOf, useText } from "@/store/text";

/** True when `op` is an edited paragraph whose text is now taller than the original paragraph, or an edited OCR
 *  paragraph whose text runs below the area it covers (the old picture there still shows). */
export function useOverflow(op: TextOp | undefined): boolean {
  const src = useEditor((s) => (op ? s.doc.pages.find((p) => p.pageKey === op.pageKey)?.src : undefined));
  const paragraph = useText((s) => (op?.type === "text.edit" && src ? paragraphsOf(src, s.pages).find((p) => p.id === op.paragraphId) : undefined));
  if (op?.type === "text.ocr_edit") return ocrOverflows(op);
  return op?.type === "text.edit" && !!paragraph && overflowsOriginal(op.box, paragraph);
}
