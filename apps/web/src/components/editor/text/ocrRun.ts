"use client";

import type { Rect } from "@edith/ops";
import { noticeStore } from "@/lib/notices";
import { isLowConfidence, ocrErrorMessage, ocrQualityMessage } from "@/lib/ocr";
import { t } from "@/lib/strings";
import { editorStore } from "@/store/editor";
import { textStore } from "@/store/text";

/** Error codes worth a "Coba lagi" button: the server was busy or slow, or the connection dropped. */
const RETRY = new Set(["ocr_busy", "ocr_timeout", "timeout", "network", "internal", "ocr_failed"]);

/** Ids of the OCR edits on the pages showing page `index` of `doc`: an area's paragraphs never take one. */
function takenIds(doc: string, index: number): string[] {
  const { doc: d } = editorStore.getState();
  const keys = new Set(d.pages.filter((p) => "doc" in p.src && p.src.doc === doc && p.src.index === index).map((p) => p.pageKey));
  return d.order.flatMap((id) => {
    const op = d.objects[id];
    return op?.type === "text.ocr_edit" && keys.has(op.pageKey) ? [op.paragraphId] : [];
  });
}

/** Reads the pictures of print on page `index` of document `doc`, or `rect` of it (a picture picked from its menu, an
 *  area dragged), with textStore.runOcr, and says how it went: how many paragraphs were found and how many need
 *  checking, why none were, or why it failed (M5d). */
export async function runPageOcr(doc: string, index: number, rect?: Rect): Promise<void> {
  const st = await textStore.getState().runOcr(doc, index, rect, takenIds(doc, index));
  const show = noticeStore.getState().show;
  if (st.status === "error") {
    const code = st.error ?? "generic";
    show({ kind: "error", text: ocrErrorMessage(code), ...(RETRY.has(code) ? { action: { label: t.download.retry, run: () => { void runPageOcr(doc, index, rect); } } } : {}) });
    return;
  }
  if (st.status !== "ready" || !st.last) return; // another OCR of this document is running: its notice follows
  const why = ocrQualityMessage(st.last.quality, st.last.angle);
  if (why) {
    const nothing = st.last.quality === "none" || st.last.quality === "empty";
    // Text the page already has editable ("known") is no failure either: it is said as such.
    show({ kind: nothing || st.last.quality === "known" ? "info" : "error", text: rect && nothing ? t.ocr.areaEmpty : why });
    return;
  }
  const added = st.paragraphs.slice(st.paragraphs.length - st.last.found);
  const low = added.filter(isLowConfidence).length;
  show({ kind: "info", text: `${t.ocr.found(added.length)}${low ? ` (${t.ocr.toCheck(low)})` : ""}. ${t.ocr.foundHint}` });
}
