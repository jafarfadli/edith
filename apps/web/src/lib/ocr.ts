import type { ContentOp, Rect, TextBox, TextOcrEdit } from "@edith/ops";
import type { OcrParagraph, OcrQuality } from "@/lib/api";
import { ocrErrorMessage, t } from "@/lib/strings";

/** A paragraph OCR read with less confidence than this (0–1, mean of its words) is flagged "perlu dicek". */
export const LOW_CONFIDENCE = 0.75;

export function isLowConfidence(p: Pick<OcrParagraph, "confidence">): boolean {
  return p.confidence < LOW_CONFIDENCE;
}

/** The label shown on an OCR paragraph (badge and tooltip). */
export function ocrBadge(p: Pick<OcrParagraph, "confidence">): string {
  return `${isLowConfidence(p) ? t.ocr.badgeLow : t.ocr.badge} · ${t.ocr.confidence(Math.round(p.confidence * 100))}`;
}

/** The text.ocr_edit that replaces OCR paragraph `p` on `pageKey` with `box`: it carries the cover (rect and colour)
 *  the API measured, so the export needs neither the OCR result nor OCR again (a restored draft exports as is). */
export function ocrEditOp(id: string, pageKey: string, p: Pick<OcrParagraph, "id" | "cover" | "coverColor">, box: TextBox): TextOcrEdit {
  return { id, type: "text.ocr_edit", pageKey, paragraphId: p.id, cover: { ...p.cover }, coverColor: p.coverColor, box };
}

/** The OCR edits of `ops` on `pageKey`. */
export function ocrEditsOn(ops: (ContentOp | undefined)[], pageKey: string): TextOcrEdit[] {
  return ops.filter((op): op is TextOcrEdit => op?.type === "text.ocr_edit" && op.pageKey === pageKey);
}

function centreIn(r: Rect, c: Rect): boolean {
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
}

/** The OCR paragraphs still to show as such: not edited. An edit names its paragraph by id, and also hides a paragraph
 *  whose middle lies under its cover (OCR run again after a draft was restored may number paragraphs otherwise). */
export function unedited<P extends Pick<OcrParagraph, "id" | "rect">>(paragraphs: P[], edits: Pick<TextOcrEdit, "paragraphId" | "cover">[]): P[] {
  return paragraphs.filter((p) => !edits.some((e) => e.paragraphId === p.id || centreIn(p.rect, e.cover)));
}

/** Slack (pt) before the new text counts as running out of the area it covers. */
const OVERFLOW_SLACK = 1;

/** True when an OCR edit's laid-out text reaches below the cover by more than the slack: it runs over the picture
 *  below, which still shows (the cover is the old text's area only). */
export function ocrOverflows(op: Pick<TextOcrEdit, "box" | "cover">): boolean {
  const lines = op.box.layout;
  if (!lines.length) return false;
  const size = Math.max(...op.box.paragraphs.flat().map((r) => r.size), 1);
  const bottom = op.box.rect.y + lines[lines.length - 1].baseline + 0.25 * size;
  return bottom > op.cover.y + op.cover.h + OVERFLOW_SLACK;
}

/** What to tell the user after OCR of a page: why nothing was found (quality other than "ok"). */
export function ocrQualityMessage(quality: OcrQuality, angle: number): string | null {
  switch (quality) {
    case "ok": return null;
    case "skewed": return t.ocr.quality.skewed(Math.abs(angle));
    default: return t.ocr.quality[quality];
  }
}

export { ocrErrorMessage };
