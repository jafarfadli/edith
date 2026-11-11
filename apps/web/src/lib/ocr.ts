import type { ContentOp, Rect, TextBox, TextOcrEdit } from "@edith/ops";
import type { OcrParagraph, OcrQuality } from "@/lib/api";
import { ocrErrorMessage, t } from "@/lib/strings";

/** A paragraph OCR read with less confidence than this (0–1, mean of its words) is flagged "perlu dicek". */
export const LOW_CONFIDENCE = 0.75;

export function isLowConfidence(p: Pick<OcrParagraph, "confidence">): boolean {
  return p.confidence < LOW_CONFIDENCE;
}

/** The label shown on an OCR paragraph (badge and tooltip); a hidden paragraph's text is known, not read. */
export function ocrBadge(p: Pick<OcrParagraph, "confidence" | "source">): string {
  if (p.source === "hidden") return t.ocr.badgeHidden;
  return `${isLowConfidence(p) ? t.ocr.badgeLow : t.ocr.badge} · ${t.ocr.confidence(Math.round(p.confidence * 100))}`;
}

/** Ids of the locked hidden paragraphs (gN) a page shows no locked target for: those measured (`hidden`, replacing
 *  them) and those rewritten already (an hgN edit, e.g. from a restored draft, whatever the measurement says now). */
export function replacedIds(hidden: Pick<OcrParagraph, "replaces">[], edits: Pick<TextOcrEdit, "paragraphId">[]): Set<string> {
  return new Set([
    ...hidden.flatMap((p) => (p.replaces ? [p.replaces] : [])),
    ...edits.filter((e) => e.paragraphId.startsWith("hg")).map((e) => e.paragraphId.slice(1)),
  ]);
}

/** The key of an area OCR read on a page (a picture's rect, an area dragged), so it is read once. */
export function areaKey(r: Rect): string {
  return [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10).join(",");
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const holds = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Ids of paragraphs read in an area start here: a page's own OCR numbers its paragraphs from 0, the same way each time
 *  (an edit from an earlier session names one of them), so the two never meet. */
export const AREA_IDS = 1000;

/** `incoming` OCR paragraphs added to the `existing` ones of a page: one read already (its middle inside an existing
 *  paragraph) is left out. A page's own OCR (`area` false) keeps the server's ids unless one is shown already; an area's
 *  (true) are numbered from AREA_IDS on, never one already shown nor one of `taken` (the page's edits' ids). */
export function mergeOcr(existing: OcrParagraph[], incoming: OcrParagraph[], taken: Iterable<string>, area: boolean): OcrParagraph[] {
  const used = new Set([...existing.map((p) => p.id), ...taken]);
  const num = (id: string) => (/^ocr\d+$/.test(id) ? Number(id.slice(3)) : -1);
  let next = Math.max(area ? AREA_IDS : 0, ...[...used].map((id) => num(id) + 1));
  const out = [...existing];
  for (const p of incoming) {
    if (existing.some((e) => holds(e.rect, centre(p.rect)))) continue;
    const keep = !area && !out.some((e) => e.id === p.id);
    const id = keep ? p.id : `ocr${next++}`;
    out.push(keep ? p : { ...p, id });
  }
  return out;
}

/** What an OCR paragraph's edit paints over the old picture of it: one rect per line (`covers`; `cover` is their
 *  bounding box, all there is in ops without `covers`) in `coverColor`. */
export type OcrCover = { cover: Rect; covers?: Rect[] | null; coverColor: string };

/** The rects an OCR edit paints (as the bake does: `covers`, else `cover`). */
export function coverRects(c: Pick<OcrCover, "cover" | "covers">): Rect[] {
  return c.covers?.length ? c.covers : [c.cover];
}

/** The text.ocr_edit that replaces OCR paragraph `p` on `pageKey` with `box`: it carries the covers (rects and colour)
 *  the API measured, so the export needs neither the OCR result nor OCR again (a restored draft exports as is). */
export function ocrEditOp(id: string, pageKey: string, p: { id: string } & OcrCover, box: TextBox): TextOcrEdit {
  return {
    id, type: "text.ocr_edit", pageKey, paragraphId: p.id, cover: { ...p.cover },
    ...(p.covers?.length ? { covers: p.covers.map((r) => ({ ...r })) as TextOcrEdit["covers"] } : {}), coverColor: p.coverColor, box,
  };
}

/** The OCR edits of `ops` on `pageKey`. */
export function ocrEditsOn(ops: (ContentOp | undefined)[], pageKey: string): TextOcrEdit[] {
  return ops.filter((op): op is TextOcrEdit => op?.type === "text.ocr_edit" && op.pageKey === pageKey);
}

/** The OCR paragraphs still to show as such: not edited (an edit names its paragraph by id; only that one goes, never
 *  a neighbour its covers come near). */
export function unedited<P extends Pick<OcrParagraph, "id">>(paragraphs: P[], edits: Pick<TextOcrEdit, "paragraphId">[]): P[] {
  return paragraphs.filter((p) => !edits.some((e) => e.paragraphId === p.id));
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
