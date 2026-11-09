"use client";

import { noticeStore } from "@/lib/notices";
import { isLowConfidence, ocrErrorMessage, ocrQualityMessage } from "@/lib/ocr";
import { t } from "@/lib/strings";
import { textStore } from "@/store/text";

/** Error codes worth a "Coba lagi" button: the server was busy or slow, or the connection dropped. */
const RETRY = new Set(["ocr_busy", "ocr_timeout", "timeout", "network", "internal", "ocr_failed"]);

/** Reads the pictures of print on page `index` of document `doc` (textStore.runOcr) and says how it went: how many
 *  paragraphs were found and how many need checking, why none were, or why it failed (M5d). */
export async function runPageOcr(doc: string, index: number): Promise<void> {
  const st = await textStore.getState().runOcr(doc, index);
  const show = noticeStore.getState().show;
  if (st.status === "error") {
    const code = st.error ?? "generic";
    show({ kind: "error", text: ocrErrorMessage(code), ...(RETRY.has(code) ? { action: { label: t.download.retry, run: () => { void runPageOcr(doc, index); } } } : {}) });
    return;
  }
  if (st.status !== "ready") return; // another page of this document is being read: its notice follows
  const why = ocrQualityMessage(st.quality ?? "empty", st.angle ?? 0);
  if (why) {
    show({ kind: st.quality === "none" || st.quality === "empty" ? "info" : "error", text: why });
    return;
  }
  const low = st.paragraphs.filter(isLowConfidence).length;
  show({ kind: "info", text: `${t.ocr.found(st.paragraphs.length)}${low ? ` (${t.ocr.toCheck(low)})` : ""}. ${t.ocr.foundHint}` });
}
