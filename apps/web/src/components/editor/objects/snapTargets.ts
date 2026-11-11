import type { Rect } from "@edith/ops";
import { toScreen, type PageGeom } from "@/lib/coords";
import { isMarkup } from "@/lib/objects";
import { boundsOf } from "@/lib/zorder";
import { editorStore, textEditFor } from "@/store/editor";
import { paragraphsOf } from "@/store/text";
import { isDeletedText } from "../text/textEdit";

/** Where the size badge of a dragged or resized `box` goes: below it as seen on screen, centred (screen px). */
export function sizeBadge(box: Rect, geom: PageGeom, scale: number): [number, number] {
  const corners = ([[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]] as [number, number][])
    .map((p) => toScreen(p, geom, scale));
  return [(Math.min(...corners.map((c) => c[0])) + Math.max(...corners.map((c) => c[0]))) / 2, Math.max(...corners.map((c) => c[1]))];
}

/** The boxes an object dragged or resized on `pageKey` snaps to: the page's other objects (not text markup, which sits
 *  on its text, nor the `exclude`d ones being moved) and the frames of its original paragraphs that were not edited
 *  (an edited one is its op). Page points, rotation included. */
export function snapTargets(pageKey: string, exclude: ReadonlySet<string>): Rect[] {
  const s = editorStore.getState();
  const out: Rect[] = [];
  for (const id of s.doc.order) {
    const op = s.doc.objects[id];
    if (!op || op.pageKey !== pageKey || exclude.has(id) || isMarkup(op) || op.type === "link.add" || isDeletedText(op)) continue;
    out.push(boundsOf(op));
  }
  const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
  if (entry) for (const p of paragraphsOf(entry.src)) if (!textEditFor(s.doc, pageKey, p.id)) out.push(p.rect);
  return out;
}
