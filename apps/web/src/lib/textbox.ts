import type { BundledFont, Run, TextBox } from "@edith/ops";
import type { FontMetrics } from "@/lib/fonts";
import { fontKey } from "@/lib/fonts";
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

export function withStyle(box: TextBox, patch: Partial<TextStyle>): TextBox {
  const paragraphs = box.paragraphs.map((p) => p.map((r) => ({
    ...r,
    size: patch.size ?? r.size,
    color: patch.color ?? r.color,
    font: { ...r.font, family: patch.family ?? r.font.family, bold: patch.bold ?? r.font.bold, italic: patch.italic ?? r.font.italic },
  })));
  return {
    ...box,
    paragraphs,
    align: patch.align ?? box.align,
    lineHeight: patch.size !== undefined ? lineHeightFor(patch.size) : box.lineHeight,
  };
}

export function relayout(box: TextBox, metricsFor: (f: BundledFont) => FontMetrics): TextBox {
  const r = layoutText({ width: box.rect.w, align: box.align ?? "left", lineHeight: box.lineHeight, paragraphs: box.paragraphs }, metricsFor);
  return { ...box, layout: r.lines, rect: { ...box.rect, h: Math.max(r.height, box.lineHeight) } };
}

export function boxFonts(box: TextBox): BundledFont[] {
  const seen = new Map<string, BundledFont>();
  for (const r of box.paragraphs.flat()) seen.set(fontKey(r.font), r.font);
  return [...seen.values()];
}
