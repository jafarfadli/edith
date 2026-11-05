import type { EditorDoc } from "@/store/editor";

const key = (sha: string) => `edith:draft:${sha}`;

export function saveDraft(sha256: string, doc: EditorDoc): void {
  try { localStorage.setItem(key(sha256), JSON.stringify(doc)); } catch { /* storage full or blocked */ }
}

export function loadDraft(sha256: string): EditorDoc | null {
  try {
    const raw = localStorage.getItem(key(sha256));
    return raw ? (JSON.parse(raw) as EditorDoc) : null;
  } catch {
    return null;
  }
}

export function clearDraft(sha256: string): void {
  try { localStorage.removeItem(key(sha256)); } catch { /* ignore */ }
}
