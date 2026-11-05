import type { EditorDoc } from "@/store/editor";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validSrc(src: unknown): boolean {
  if (typeof src !== "object" || src === null) return false;
  const s = src as Record<string, unknown>;
  if ("doc" in s) return typeof s.doc === "string" && Number.isInteger(s.index) && (s.index as number) >= 0;
  const b = s.blank as Record<string, unknown> | null | undefined;
  return typeof b === "object" && b !== null && isNum(b.width) && isNum(b.height);
}

export function restoreDraft(draft: EditorDoc | null, docId: string, pageCount: number): EditorDoc | null {
  if (!draft || !Array.isArray(draft.pages) || draft.pages.length === 0) return null;
  const pages = [];
  for (const p of draft.pages) {
    if (typeof p !== "object" || p === null || !validSrc(p.src)) return null;
    if ("doc" in p.src) {
      if (p.src.index >= pageCount) return null;
      pages.push({ ...p, src: { doc: docId, index: p.src.index } });
    } else {
      pages.push(p);
    }
  }
  return { ...draft, pages };
}
