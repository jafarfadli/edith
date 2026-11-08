import type { Paragraph } from "@/lib/api";

/** Original paragraphs by source page — `srcKey(doc, index)` — of the edited PDF and every imported one. */
export type ParagraphPages = Record<string, Paragraph[]>;

export function srcKey(doc: string, index: number): string {
  return `${doc}:${index}`;
}
