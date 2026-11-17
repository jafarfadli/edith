import { getSourceFile, uploadDocument } from "@/lib/api";
import { putSource, saveRecord } from "@/lib/library";

/** Uploads a PDF to edit (`password`: of a locked one) and keeps a copy in this browser, so the edit goes on when the
 *  server has dropped its own (lib/session.ts): of a locked PDF, the unlocked copy the server made (the password is
 *  not kept). Returns the editor's address for it. Throws ApiError as uploadDocument does. */
export async function openPdf(file: File, password?: string): Promise<string> {
  const res = await uploadDocument(file, file.name, password);
  saveRecord({ id: res.doc_id, serverId: res.doc_id, name: file.name, pageCount: res.page_count, edited: false, updatedAt: Date.now() });
  const copy = password ? await getSourceFile(res.doc_id).catch(() => null) : file;
  if (copy) await putSource(res.doc_id, copy).catch(() => undefined);
  return editPath(res.doc_id, file.name);
}

export const editPath = (id: string, name: string) => `/edit/${id}?name=${encodeURIComponent(name)}`;
