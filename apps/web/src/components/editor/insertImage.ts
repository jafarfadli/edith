import type { ContentOp } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { newId } from "@/lib/id";
import { fitImage } from "@/lib/image";
import { putAsset } from "@/lib/library";
import type { NoticeMsg } from "@/lib/notices";
import { errorMessage } from "@/lib/strings";
import { editorStore } from "@/store/editor";
import { currentPage, placeObject } from "./placement";

/** Puts picture `f` (PNG or JPEG) on the page in view, fitted, selected; a notice says why when it cannot. */
export async function insertImage(f: File, onNotice: (n: NoticeMsg) => void): Promise<void> {
  const st = editorStore.getState();
  const at = currentPage();
  if (!st.info || !at) return;
  try {
    const asset = await uploadAsset(st.info.docId, f);
    void putAsset(st.info.editId, asset.asset_id, f).catch(() => undefined); // kept for when the server drops the document
    const rect = fitImage(asset.width, asset.height, at.size.width, at.size.height);
    placeObject({ id: newId(), type: "image.add", pageKey: at.entry.pageKey, rect, assetId: asset.asset_id } as ContentOp);
  } catch (e) {
    onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
  }
}
