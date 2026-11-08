import { ApiError, getStructure, uploadDocument } from "@/lib/api";
import { noticeStore } from "@/lib/notices";
import { errorMessage, t } from "@/lib/strings";
import { editorStore } from "@/store/editor";
import { textStore } from "@/store/text";

/** Uploads `file` as another document and inserts all its pages after `afterKey` (null: before the first page)
 *  as one undo step. Returns the new pages' keys (none on failure; a notice says why). */
export async function importPdf(file: File, afterKey: string | null): Promise<string[]> {
  try {
    const up = await uploadDocument(file, file.name);
    const st = await getStructure(up.doc_id);
    const s = editorStore.getState();
    s.addImport(up.doc_id, st.pages);
    void textStore.getState().loadImport(up.doc_id); // its paragraphs and fonts, for editing and Find
    const keys = s.insertImportAfter(afterKey, up.doc_id);
    noticeStore.getState().show({ kind: "info", text: t.pages.imported(keys.length) });
    return keys;
  } catch (e) {
    noticeStore.getState().show({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
    return [];
  }
}

/** Opens the file picker for a PDF to import; resolves with the chosen file (or null). */
export function pickPdf(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.dataset.testid = "import-input";
    input.style.display = "none";
    input.addEventListener("change", () => { resolve(input.files?.[0] ?? null); input.remove(); });
    input.addEventListener("cancel", () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
