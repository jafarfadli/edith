import type { EditorDoc } from "@/store/editor";

export function restoreDraft(draft: EditorDoc | null, docId: string, pageCount: number): EditorDoc | null {
  if (!draft || !Array.isArray(draft.pages) || draft.pages.length === 0) return null;
  const pages = [];
  for (const p of draft.pages) {
    if ("doc" in p.src) {
      if (p.src.index >= pageCount) return null;
      pages.push({ ...p, src: { doc: docId, index: p.src.index } });
    } else {
      pages.push(p);
    }
  }
  return { ...draft, pages };
}
