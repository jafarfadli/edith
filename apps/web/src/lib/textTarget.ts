import type { ContentOp, Rect, TextAdd, TextEdit } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { isTextOp } from "@/lib/objects";

type Pt = [number, number];

const inside = (r: Rect, [x, y]: Pt) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** What a double-click at `at` edits when it lands on a text markup (which sits above the text):
 *  the topmost text object of the page (`ops`, in z-order) containing it, else the editable original
 *  paragraph there that has no text.edit yet. */
export function textTargetAt(ops: ContentOp[], paragraphs: Paragraph[], at: Pt):
  { op: TextAdd | TextEdit } | { paragraph: Paragraph } | null {
  const texts = ops.filter(isTextOp);
  for (let i = texts.length - 1; i >= 0; i--) if (inside(texts[i].box.rect, at)) return { op: texts[i] };
  const edited = new Set(texts.filter((op): op is TextEdit => op.type === "text.edit").map((op) => op.paragraphId));
  const paragraph = paragraphs.find((p) => p.editable && !edited.has(p.id) && inside(p.rect, at));
  return paragraph ? { paragraph } : null;
}
