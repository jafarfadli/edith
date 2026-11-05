"use client";

import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { isTextOp } from "@/lib/objects";
import { paragraphBox, prepareRuns } from "@/lib/paragraphs";
import { replaceMatches, type Match } from "@/lib/search";
import { relayout } from "@/lib/textbox";
import { editorStore, textEditFor } from "@/store/editor";
import { paragraphsOf, textStore } from "@/store/text";

const metrics = (f: Parameters<typeof fontStore.get>[0]) => fontStore.get(f);

/** Replaces `matches` with `text` (style of each match's first character) as ONE undo step: text ops
 *  are updated, original paragraphs become text.edit ops. Targets changed while fonts were loading
 *  (an op edited, a paragraph edited elsewhere) are left alone. */
export async function applyReplacements(matches: Match[], text: string): Promise<void> {
  const byKey = new Map<string, Match[]>();
  for (const m of matches) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
  const { doc } = editorStore.getState();
  const { pages, fonts } = textStore.getState();
  const out: { op: ContentOp; base: ContentOp | null }[] = [];
  for (const [key, ms] of byKey) {
    if (key.startsWith("op:")) {
      const op = doc.objects[key.slice(3)];
      if (!isTextOp(op)) continue;
      const paragraphs = await prepareRuns(replaceMatches(op.box.paragraphs, ms, text), fonts);
      out.push({ op: { ...op, box: relayout({ ...op.box, paragraphs }, metrics) } as TextAdd | TextEdit, base: op });
    } else {
      const [, pageKey, id] = key.split(":");
      const entry = doc.pages.find((p) => p.pageKey === pageKey);
      const p = entry ? paragraphsOf(entry.src, pages).find((x) => x.id === id) : undefined;
      if (!p || textEditFor(doc, pageKey, id)) continue;
      const [runs] = await prepareRuns([p.runs], fonts);
      const box = paragraphBox({ ...p, runs }, metrics,
        (ps, toBox) => replaceMatches(ps, ms.map((m) => ({ start: toBox(m.start), end: toBox(m.end) })), text));
      const paragraphs = await prepareRuns(box.paragraphs, fonts); // the new text may lack glyphs in the original font
      out.push({ op: { id: newId(), type: "text.edit", pageKey, paragraphId: id, box: relayout({ ...box, paragraphs }, metrics) } as TextEdit, base: null });
    }
  }
  const now = editorStore.getState().doc;
  const fresh = out.filter(({ op, base }) => base
    ? now.objects[op.id] === base
    : now.pages.some((p) => p.pageKey === op.pageKey) && !textEditFor(now, op.pageKey, (op as TextEdit).paragraphId));
  editorStore.getState().putObjects(fresh.map((x) => x.op));
}
