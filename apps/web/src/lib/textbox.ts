import type { FontRef, Run, TextBox } from "@edith/ops";
import type { FontMetrics } from "@/lib/fonts";
import { fontKey } from "@/lib/fonts";
import { layoutText } from "@/lib/layout";
import { applyPatch, attrsOf, runOf, type FontTable, type StylePatch } from "@/lib/richtext";

export const DEFAULT_BOX_WIDTH = 200;
export interface TextStyle { family: string; bold: boolean; italic: boolean; size: number; color: string; align: "left" | "center" | "right" | "justify" }

function runFrom(style: TextStyle, text: string): Run {
  return { text, font: { kind: "bundled", family: style.family, bold: style.bold, italic: style.italic }, size: style.size, color: style.color };
}

function lineHeightFor(size: number): number {
  return Math.round(size * 1.2 * 100) / 100;
}

/** Line height of a text box (`text.add`): 1.2 × its largest run size (runs with text; all runs when empty). */
export function boxLineHeight(paragraphs: Run[][]): number {
  const all = paragraphs.flat();
  const withText = all.filter((r) => r.text);
  return lineHeightFor(Math.max(...(withText.length ? withText : all).map((r) => r.size)));
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

export type BoxPatch = StylePatch & { align?: TextBox["align"] };

/** `patch` applied to every run (and the box alignment); a size change resets the line height to 1.2 × size. */
export function withStyle(box: TextBox, patch: BoxPatch, fonts: FontTable = {}): TextBox {
  const paragraphs = box.paragraphs.map((p) => p.map((r) => runOf(r.text, applyPatch(attrsOf(r), patch, fonts))));
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
