import type { FontRef, Run, TextBox } from "@edith/ops";
import type { FontMetrics } from "@/lib/fonts";
import { fontKey, isOriginal } from "@/lib/fonts";
import { layoutText } from "@/lib/layout";

export const DEFAULT_BOX_WIDTH = 200;
export interface TextStyle { family: string; bold: boolean; italic: boolean; size: number; color: string; align: "left" | "center" | "right" | "justify" }

function runFrom(style: TextStyle, text: string): Run {
  return { text, font: { kind: "bundled", family: style.family, bold: style.bold, italic: style.italic }, size: style.size, color: style.color };
}

function lineHeightFor(size: number): number {
  return Math.round(size * 1.2 * 100) / 100;
}

export function newBox([x, y]: [number, number], style: TextStyle): TextBox {
  const lineHeight = lineHeightFor(style.size);
  return { rect: { x, y, w: DEFAULT_BOX_WIDTH, h: lineHeight }, align: style.align, lineHeight, paragraphs: [[runFrom(style, "")]], layout: [] };
}

export function plainText(box: TextBox): string {
  return box.paragraphs.map((p) => p.map((r) => r.text).join("")).join("\n");
}

export function withText(box: TextBox, text: string): TextBox {
  const first = box.paragraphs[0]?.[0];
  if (!first) throw new Error("withText: box has no runs");
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n").map((line) => [{ ...first, text: line }]);
  return { ...box, paragraphs };
}

/** `font` with the family/bold/italic of `patch` applied; an original font becomes a bundled one only when the patch touches those. */
function restyle(font: FontRef, patch: Partial<TextStyle>): FontRef {
  if (patch.family === undefined && patch.bold === undefined && patch.italic === undefined) return font;
  const base = isOriginal(font) ? { family: patch.family ?? "Arimo", bold: false, italic: false } : font;
  return { kind: "bundled", family: patch.family ?? base.family, bold: patch.bold ?? base.bold ?? false, italic: patch.italic ?? base.italic ?? false };
}

export function withStyle(box: TextBox, patch: Partial<TextStyle>): TextBox {
  const paragraphs = box.paragraphs.map((p) => p.map((r) => ({
    ...r,
    size: patch.size ?? r.size,
    color: patch.color ?? r.color,
    font: restyle(r.font, patch),
  })));
  return {
    ...box,
    paragraphs,
    align: patch.align ?? box.align,
    lineHeight: patch.size !== undefined ? lineHeightFor(patch.size) : box.lineHeight,
  };
}

export function relayout(box: TextBox, metricsFor: (f: FontRef) => FontMetrics): TextBox {
  const r = layoutText({ width: box.rect.w, align: box.align ?? "left", lineHeight: box.lineHeight, paragraphs: box.paragraphs }, metricsFor);
  return { ...box, layout: r.lines, rect: { ...box.rect, h: Math.max(r.height, box.lineHeight) } };
}

export function boxFonts(box: TextBox): FontRef[] {
  const seen = new Map<string, FontRef>();
  for (const r of box.paragraphs.flat()) seen.set(fontKey(r.font), r.font);
  return [...seen.values()];
}
