import { ApiError, getStructure, uploadAsset, uploadDocument, type Structure } from "@/lib/api";
import { loadDraft, saveDraft } from "@/lib/draft";
import { getAssets, getRecord, getSource, remapAssets, saveRecord, setAssets } from "@/lib/library";

/** Whether the server has dropped a document (it keeps one for an hour after its last use). */
export const isGone = (e: unknown) => e instanceof ApiError && (e.code === "doc_expired" || e.code === "doc_not_found");

/** The structure of edit `editId`'s document on the server. If the server no longer has it, the PDF this browser kept
 *  is uploaded again, together with the images placed on it, and the draft is pointed at the new images: the person
 *  never sees a session end. Without a local copy the error is the server's (the document is gone). */
export function openEdit(editId: string): Promise<Opened> {
  // One at a time per edit: two opens at once (React runs an effect twice in development, two tabs) would each put
  // the PDF back, and one of them would work on the document the other has just left.
  const running = opening.get(editId);
  if (running) return running;
  const p = reopen(editId).finally(() => opening.delete(editId));
  opening.set(editId, p);
  return p;
}

type Opened = { serverId: string; structure: Structure };
const opening = new Map<string, Promise<Opened>>();

async function reopen(editId: string): Promise<Opened> {
  const rec = getRecord(editId);
  const serverId = rec?.serverId ?? editId;
  try {
    return { serverId, structure: await getStructure(serverId) };
  } catch (e) {
    if (!isGone(e) || !rec) throw e;
    const pdf = await getSource(editId).catch(() => undefined);
    if (!pdf) throw e;
    const up = await uploadDocument(pdf, rec.name);
    const map: Record<string, string> = {}, fresh: Record<string, Blob> = {};
    for (const [assetId, blob] of Object.entries(await getAssets(editId).catch(() => ({} as Record<string, Blob>)))) {
      map[assetId] = (await uploadAsset(up.doc_id, blob)).asset_id;
      fresh[map[assetId]] = blob;
    }
    if (Object.keys(map).length) {
      const draft = loadDraft(editId);
      if (draft) saveDraft(editId, remapAssets(draft, map));
      await setAssets(editId, fresh).catch(() => undefined);
    }
    saveRecord({ ...rec, serverId: up.doc_id });
    return { serverId: up.doc_id, structure: await getStructure(up.doc_id) };
  }
}

/** How often an open editor reaches for its document so the server keeps it (it drops one an hour after its last use). */
export const KEEP_ALIVE_MS = 10 * 60 * 1000;

/** Keeps the edit's document on the server and finds out whether it moved: "moved" when the server had dropped it and it
 *  was put back (or another tab did), so the page must reopen the edit; "alive" otherwise, also when the answer is not
 *  known (no network) or the document is gone for good (nothing to put back: the error shows where it matters). */
export async function checkAlive(editId: string, docId: string): Promise<"alive" | "moved"> {
  try {
    return (await openEdit(editId)).serverId === docId ? "alive" : "moved";
  } catch {
    return "alive";
  }
}
