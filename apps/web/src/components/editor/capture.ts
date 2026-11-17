import type { ContentOp, Rect } from "@edith/ops";
import { newId } from "@/lib/id";
import { putAsset } from "@/lib/library";
import { noticeStore } from "@/lib/notices";
import { t } from "@/lib/strings";
import { pdfStore } from "@/store/pdfs";
import { CLIP_ID, setClipboard } from "./objects/clipboard";

/** Resolution an area of a page is taken at (dpi), and the most pixels its picture may have along a side. */
const CAPTURE_DPI = 300;
const MAX_SIDE = 4000;
/** Above this many pixels the picture is a JPEG (a photo); below, a PNG (writing and lines stay sharp). */
const PNG_PIXELS = 2_000_000;

/** "Salin area halaman": what is printed in `rect` (page points) of page `index` of document `doc`, drawn by pdf.js
 *  at 300 dpi and put on the clipboard as a picture where it lay. A logo, a table, a signature, a chart: anything of
 *  the page itself (not the objects added over it), to paste here or into another document. Where nothing is printed
 *  the picture is see-through. */
export async function captureArea(doc: string, index: number, pageKey: string, rect: Rect): Promise<boolean> {
  const pdf = pdfStore.getState().docs[doc];
  if (!pdf || typeof pdf === "string") return false;
  try {
    const page = await pdf.getPage(index + 1);
    const k = Math.min(CAPTURE_DPI / 72, MAX_SIDE / Math.max(rect.w, rect.h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.w * k));
    canvas.height = Math.max(1, Math.round(rect.h * k));
    // A PNG keeps what is not printed see-through (a logo lands on another page without a white box); a JPEG (a big
    // area: a photo) has the page's white paper behind it.
    const png = canvas.width * canvas.height <= PNG_PIXELS;
    const viewport = page.getViewport({ scale: k, rotation: 0, offsetX: -rect.x * k, offsetY: -rect.y * k });
    // Its own context, with alpha (pdf.js would make one without, and the see-through parts would come out black).
    const canvasContext = canvas.getContext("2d", { alpha: true })!;
    await page.render({ canvas: null, canvasContext, viewport, background: png ? "rgba(0,0,0,0)" : "#ffffff" }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, png ? "image/png" : "image/jpeg", 0.9));
    if (!blob) return false;
    const assetId = `area-${newId()}`;
    await putAsset(CLIP_ID, assetId, blob);
    setClipboard([{ id: newId(), type: "image.add", pageKey, rect, assetId } as ContentOp], [assetId]);
    noticeStore.getState().show({ kind: "info", text: t.capture.done });
    return true;
  } catch (err) {
    console.warn("capture: render failed", err);
    noticeStore.getState().show({ kind: "error", text: t.capture.failed });
    return false;
  }
}
