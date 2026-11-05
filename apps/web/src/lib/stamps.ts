import presets from "@edith/ops/stamp-presets.json";
import type { BundledFont, Rect, StampAdd } from "@edith/ops";
import { textWidth, type FontMetrics } from "@/lib/fonts";

export interface StampPreset { id: string; label: string; color: string }

/** The shared preset table (packages/ops/stamp-presets.json, also read by the API): 17 English then the 17 Indonesian equivalents. */
export const STAMP_PRESETS: StampPreset[] = presets;
export const STAMPS_EN: StampPreset[] = STAMP_PRESETS.slice(0, 17);
export const STAMPS_ID: StampPreset[] = STAMP_PRESETS.slice(17);
const LABELS = new Map(STAMP_PRESETS.map((p) => [p.id, p.label]));

/** The 5 stamp colors (custom stamps pick one; presets have their own from the table). */
export const STAMP_COLORS = ["#1d4ed8", "#15803d", "#b91c1c", "#c2410c", "#111111"] as const;

/** Stamp geometry — shared contract with apps/api/edith/bake/stamps.py (same names, same numbers). */
export const STAMP_FONT: BundledFont = { kind: "bundled", family: "Arimo", bold: true, italic: false };
export const STAMP = {
  capHeight: 0.688, border: 0.05, radius: 0.2, pad: 0.12,
  oneLineSize: 0.5, labelSize: 0.36, subSize: 0.2, labelBaseline: 0.5, subBaseline: 0.78,
} as const;

export interface StampLine { text: string; size: number; x: number; baseline: number }
export type StampKind = Pick<StampAdd, "preset" | "custom">;

/** The label, then the date/time line (custom stamps that have one). */
export function stampTexts(s: StampKind): string[] {
  if (s.preset) return [LABELS.get(s.preset) ?? s.preset];
  const c = s.custom;
  if (!c) return [""];
  const sub = [c.date, c.time].filter(Boolean).join(" ");
  return sub ? [c.text, sub] : [c.text];
}

export function borderWidth(w: number, h: number): number {
  return Math.max(0.5, STAMP.border * Math.min(w, h));
}

/** Sizes and positions (relative to the rect) of the stamp's lines in a `w` × `h` rect. */
export function stampLayout(w: number, h: number, texts: string[], m: FontMetrics): StampLine[] {
  const unit = (t: string) => textWidth(t, m, 1);
  const avail = Math.max(w - 2 * (STAMP.pad * h + borderWidth(w, h)), 1);
  const fit = (t: string, size: number) => (unit(t) > 0 ? Math.min(size, avail / unit(t)) : size);
  const rows: [string, number, number][] = [];
  if (texts.length === 1) {
    const s = fit(texts[0], STAMP.oneLineSize * h);
    rows.push([texts[0], s, h / 2 + (STAMP.capHeight * s) / 2]);
  } else {
    rows.push([texts[0], fit(texts[0], STAMP.labelSize * h), STAMP.labelBaseline * h]);
    rows.push([texts[1], fit(texts[1], STAMP.subSize * h), STAMP.subBaseline * h]);
  }
  return rows.map(([text, size, baseline]) => ({ text, size, x: (w - unit(text) * size) / 2, baseline }));
}

/** The border rect (inset by half the border width) and its corner radius, relative to the stamp rect. */
export function stampBorder(w: number, h: number): { x: number; y: number; w: number; h: number; width: number; radius: number } {
  const bw = borderWidth(w, h);
  const iw = w - bw, ih = h - bw;
  return { x: bw / 2, y: bw / 2, w: iw, h: ih, width: bw, radius: STAMP.radius * Math.min(iw, ih) };
}

/** Default rect of a new stamp, centred on the page: 40 pt tall (54 with a date/time line), as wide as the label needs. */
export function stampRect(s: StampKind, m: FontMetrics, page: { width: number; height: number }): Rect {
  const texts = stampTexts(s);
  const h = texts.length === 1 ? 40 : 54;
  const size = (texts.length === 1 ? STAMP.oneLineSize : STAMP.labelSize) * h;
  const pad = 2 * (STAMP.pad * h + borderWidth(200, h));
  const w = Math.max(60, Math.max(...texts.map((t, i) => textWidth(t, m, i === 0 ? size : STAMP.subSize * h))) + pad + 1);
  return { x: (page.width - w) / 2, y: (page.height - h) / 2, w, h };
}
