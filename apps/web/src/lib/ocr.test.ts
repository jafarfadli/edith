import { describe, expect, it } from "vitest";
import type { TextBox } from "@edith/ops";
import type { OcrParagraph } from "@/lib/api";
import { isLowConfidence, LOW_CONFIDENCE, ocrBadge, ocrEditOp, ocrEditsOn, ocrOverflows, ocrQualityMessage, unedited } from "@/lib/ocr";
import { objectLabel } from "@/lib/objectLabels";
import { hasOpacity, isCopyable, isRotatable, isTextOp, moveOp } from "@/lib/objects";
import { zStage } from "@/lib/zorder";
import { ocrErrorMessage, t } from "@/lib/strings";

const run = { text: "Nama Lengkap", font: { kind: "bundled" as const, family: "Tinos" }, size: 11, color: "#000000" };
const para = (id: string, x: number, y: number, confidence = 0.95): OcrParagraph => ({
  id, rect: { x, y, w: 80, h: 12 }, lines: [{ rect: { x, y, w: 80, h: 12 }, baseline: y + 10, size: 11, start: 0, end: 12 }],
  runs: [run], align: "left", lineHeight: 13, editable: true,
  ocr: true, confidence, cover: { x: x - 1.5, y: y - 1.5, w: 83, h: 15 }, coverColor: "#f7f5eb", coverUniform: true,
});
const box = (y: number, lines: number[]): TextBox => ({
  rect: { x: 90, y, w: 200, h: 0 }, align: "left", lineHeight: 13, paragraphs: [[run]],
  layout: lines.map((b) => ({ baseline: b, segments: [{ x: 0, text: "Nama Lengkap", runIndex: 0 }] })),
});

describe("OCR paragraphs", () => {
  it("flags paragraphs read with low confidence and says so on the badge", () => {
    expect(isLowConfidence({ confidence: LOW_CONFIDENCE - 0.01 })).toBe(true);
    expect(isLowConfidence({ confidence: LOW_CONFIDENCE })).toBe(false);
    expect(ocrBadge({ confidence: 0.92 })).toBe(`${t.ocr.badge} · keyakinan 92%`);
    expect(ocrBadge({ confidence: 0.4 })).toBe(`${t.ocr.badgeLow} · keyakinan 40%`);
  });

  it("an edit carries its cover, so a restored draft exports without OCR", () => {
    const p = para("ocr3", 90, 166);
    const op = ocrEditOp("e1", "o0", p, box(156, [10]));
    expect(op).toEqual({ id: "e1", type: "text.ocr_edit", pageKey: "o0", paragraphId: "ocr3", cover: p.cover, coverColor: "#f7f5eb", box: box(156, [10]) });
    expect(op.cover).not.toBe(p.cover); // a copy: the OCR result may go, the op stays
    expect(JSON.parse(JSON.stringify(op))).toEqual(op); // survives a draft (JSON)
  });

  it("an edited paragraph no longer shows as OCR text, by id or under an edit's cover", () => {
    const a = para("ocr0", 90, 166), b = para("ocr1", 90, 188), c = para("ocr2", 90, 210);
    const edits = [ocrEditOp("e1", "o0", a, box(156, [10])), ocrEditOp("e2", "o0", { ...b, id: "ocr9" }, box(178, [10]))];
    expect(unedited([a, b, c], edits).map((p) => p.id)).toEqual(["ocr2"]);
    expect(ocrEditsOn([...edits, undefined, { ...edits[0], pageKey: "o1" }], "o0")).toEqual(edits);
  });

  it("an edit whose text runs below its cover overflows (the picture there still shows)", () => {
    const p = para("ocr0", 90, 166);
    expect(ocrOverflows(ocrEditOp("e", "o0", p, box(166, [10])))).toBe(false);
    expect(ocrOverflows(ocrEditOp("e", "o0", p, box(166, [10, 23])))).toBe(true);
  });

  it("is a text object everywhere: moved like one, listed as 'Teks OCR diedit', drawn in the draw stage", () => {
    const op = ocrEditOp("e", "o0", para("ocr0", 90, 166), box(156, [10]));
    expect(isTextOp(op)).toBe(true);
    const moved = moveOp(op, 5, 7);
    expect(moved.box.rect).toMatchObject({ x: 95, y: 163 });
    expect(moved.cover).toEqual(op.cover); // the old picture stays where it was
    expect(objectLabel(op)).toEqual({ icon: "textEdit", label: t.objectKinds.textOcr, detail: "Nama Lengkap" });
    expect(zStage(op)).toBe("draw");
    // Like a text.edit: no copy (one edit per OCR paragraph), no opacity or rotation (the op has neither).
    expect(isCopyable(op)).toBe(false);
    expect(hasOpacity(op)).toBe(false);
    expect(isRotatable(op)).toBe(false);
  });

  it("says why OCR found nothing, and why it failed", () => {
    expect(ocrQualityMessage("ok", 0)).toBeNull();
    expect(ocrQualityMessage("skewed", -2.94)).toBe(t.ocr.quality.skewed(2.94));
    expect(ocrQualityMessage("skewed", 3)).toContain("3.0°");
    expect(ocrQualityMessage("unreadable", 0)).toBe(t.ocr.quality.unreadable);
    expect(ocrErrorMessage("ocr_unavailable")).toBe(t.ocr.errors.ocr_unavailable);
    expect(ocrErrorMessage("doc_expired")).toBe(t.errors.doc_expired);
    expect(ocrErrorMessage("whatever")).toBe(t.errors.generic);
  });
});
