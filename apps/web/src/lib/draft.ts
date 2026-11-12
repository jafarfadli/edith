import { PARAGRAPHS_VERSION } from "@/lib/api";
import type { EditorDoc } from "@/store/editor";

/** A draft is kept per edit (lib/library.ts), not per file: uploading the same file again starts a clean edit. */
const key = (editId: string) => `edith:draft:${editId}`;

function isEditorDoc(v: unknown): v is EditorDoc {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    Array.isArray(d.pages) &&
    Array.isArray(d.order) &&
    typeof d.objects === "object" && d.objects !== null && !Array.isArray(d.objects)
  );
}

/** Stores `doc` stamped with the paragraph segmentation its text.edit ids belong to (see dropStaleTextEdits). */
export function saveDraft(editId: string, doc: EditorDoc): void {
  try { localStorage.setItem(key(editId), JSON.stringify({ ...doc, paragraphsVersion: PARAGRAPHS_VERSION })); } catch { /* storage full or blocked */ }
}

export function loadDraft(editId: string): EditorDoc | null {
  try {
    const raw = localStorage.getItem(key(editId));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return isEditorDoc(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearDraft(editId: string): void {
  try { localStorage.removeItem(key(editId)); } catch { /* ignore */ }
}
