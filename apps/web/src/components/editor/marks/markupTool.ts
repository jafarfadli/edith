import type { AnnotAdd, TextEdit } from "@edith/ops";
import { caretAt, markupQuads, usableLines, type CharLine } from "@/lib/markup";
import { maskRects } from "@/lib/paragraphs";
import { editorStore, type MarkupTool } from "@/store/editor";
import { charLines } from "@/store/chars";
import { paragraphsOf } from "@/store/text";

type Pt = [number, number];

/** The original lines of `pageKey` that text markup can go on (loaded ones; edited paragraphs excluded). */
export function markLines(pageKey: string): CharLine[] {
  const s = editorStore.getState();
  const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
  if (!entry || !("doc" in entry.src)) return [];
  const edited = new Set(Object.values(s.doc.objects)
    .filter((op): op is TextEdit => op.type === "text.edit" && op.pageKey === pageKey).map((op) => op.paragraphId));
  const hidden = paragraphsOf(entry.src).filter((p) => edited.has(p.id)).flatMap(maskRects);
  return usableLines(charLines(entry.src.index), hidden);
}

/** True when a press at `at` lands on markable text. */
export function onMarkableText(pageKey: string, at: Pt): boolean {
  return caretAt(markLines(pageKey), at, true) !== null;
}

/** The markup a drag from `start` to `at` makes (null when it covers no character). */
export function markupFromDrag(tool: MarkupTool, pageKey: string, start: Pt, at: Pt, id: string): AnnotAdd | null {
  const lines = markLines(pageKey);
  const a = caretAt(lines, start, true);
  const b = caretAt(lines, at, false);
  if (!a || !b) return null;
  const [first, ...rest] = markupQuads(lines, a, b);
  if (!first) return null;
  return { id, type: "annot.add", pageKey, kind: tool, quads: [first, ...rest], color: editorStore.getState().style.markup[tool] };
}
