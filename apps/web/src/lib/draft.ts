import { PARAGRAPHS_VERSION } from "@/lib/api";
import type { EditorDoc } from "@/store/editor";

const key = (sha: string) => `edith:draft:${sha}`;

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
export function saveDraft(sha256: string, doc: EditorDoc): void {
  try { localStorage.setItem(key(sha256), JSON.stringify({ ...doc, paragraphsVersion: PARAGRAPHS_VERSION })); } catch { /* storage full or blocked */ }
}

export function loadDraft(sha256: string): EditorDoc | null {
  try {
    const raw = localStorage.getItem(key(sha256));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return isEditorDoc(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearDraft(sha256: string): void {
  try { localStorage.removeItem(key(sha256)); } catch { /* ignore */ }
}
