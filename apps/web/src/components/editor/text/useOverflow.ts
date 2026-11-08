"use client";

import type { TextAdd, TextEdit } from "@edith/ops";
import { overflowsOriginal } from "@/lib/paragraphs";
import { useEditor } from "@/store/editor";
import { paragraphsOf, useText } from "@/store/text";

/** True when `op` is an edited paragraph whose text is now taller than the original paragraph. */
export function useOverflow(op: TextAdd | TextEdit | undefined): boolean {
  const src = useEditor((s) => (op ? s.doc.pages.find((p) => p.pageKey === op.pageKey)?.src : undefined));
  const paragraph = useText((s) => (op?.type === "text.edit" && src ? paragraphsOf(src, s.pages).find((p) => p.id === op.paragraphId) : undefined));
  return op?.type === "text.edit" && !!paragraph && overflowsOriginal(op.box, paragraph);
}
