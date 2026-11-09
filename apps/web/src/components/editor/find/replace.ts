"use client";

import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { isTextOp } from "@/lib/objects";
import { paragraphBox, prepareRuns } from "@/lib/paragraphs";
import { replaceMatches, type Match } from "@/lib/search";
import { opKey } from "@/lib/targets";
import { relayout } from "@/lib/textbox";
import { editorStore, textEditFor } from "@/store/editor";
import { paragraphsOf, textStore } from "@/store/text";
import { markupUnderEdits, noteMarkupRemoved, originalParagraph } from "../text/textEdit";
import { editedBox } from "@/lib/keepLines";

const metrics = (f: Parameters<typeof fontStore.get>[0]) => fontStore.get(f);

/** Where a replacement ended: target key after the replace (an original paragraph becomes `op:<id>`)
 *  and the offset right after the new text in that target's text. */
export interface Replaced { key: string; end: number }

/** End offsets (in the replaced text) of `text` put over the non-overlapping `ranges`. */
function endsAfter(ranges: { start: number; end: number }[], text: string): number[] {
  let shift = 0;
  return [...ranges].sort((a, b) => a.start - b.start).map((r) => {
    const end = r.start + shift + text.length;
    shift += text.length - (r.end - r.start);
    return end;
  });
}

/** Replaces `matches` with `text` (style of each match's first character) as ONE undo step: text ops
 *  are updated, original paragraphs become text.edit ops, and text markup on those paragraphs is deleted. Targets changed while fonts were loading
 *  (an op edited, a paragraph edited elsewhere) are left alone. Returns where each applied
 *  replacement ended (sorted by target, then offset). */
export async function applyReplacements(matches: Match[], text: string): Promise<Replaced[]> {
  const byKey = new Map<string, Match[]>();
  for (const m of matches) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
  const { doc } = editorStore.getState();
  const { pages, fonts } = textStore.getState();
  const out: { op: ContentOp; base: ContentOp | null; ends: number[] }[] = [];
  for (const [key, ms] of byKey) {
    if (key.startsWith("op:")) {
      const op = doc.objects[key.slice(3)];
      if (!isTextOp(op)) continue;
      const paragraphs = await prepareRuns(replaceMatches(op.box.paragraphs, ms, text), fonts);
      // A rewritten paragraph keeps the original lines the replacement leaves alone (editedBox).
      const p = op.type === "text.edit" ? originalParagraph(doc, op.pageKey, op.paragraphId) : undefined;
      const original = p ? await prepareRuns([p.runs], fonts).catch(() => null) : null;
      const box = p && original ? editedBox(op.box, paragraphs, { ...p, runs: original[0] }, metrics) : relayout({ ...op.box, paragraphs }, metrics);
      out.push({ op: { ...op, box } as TextAdd | TextEdit, base: op, ends: endsAfter(ms, text) });
    } else {
      const [, pageKey, id] = key.split(":");
      const entry = doc.pages.find((p) => p.pageKey === pageKey);
      const p = entry ? paragraphsOf(entry.src, pages).find((x) => x.id === id) : undefined;
      if (!p || textEditFor(doc, pageKey, id)) continue;
      const [runs] = await prepareRuns([p.runs], fonts);
      let ends: number[] = [];
      const start = paragraphBox({ ...p, runs }, metrics);
      const box = paragraphBox({ ...p, runs }, metrics, (ps, toBox) => {
        const ranges = ms.map((m) => ({ start: toBox(m.start), end: toBox(m.end) }));
        ends = endsAfter(ranges, text);
        return replaceMatches(ps, ranges, text);
      });
      const paragraphs = await prepareRuns(box.paragraphs, fonts); // the new text may lack glyphs in the original font
      out.push({ op: { id: newId(), type: "text.edit", pageKey, paragraphId: id, box: editedBox(start, paragraphs, { ...p, runs }, metrics) } as TextEdit, base: null, ends });
    }
  }
  const now = editorStore.getState().doc;
  const fresh = out.filter(({ op, base }) => base
    ? now.objects[op.id] === base
    : now.pages.some((p) => p.pageKey === op.pageKey) && !textEditFor(now, op.pageKey, (op as TextEdit).paragraphId));
  // Marks on the original lines of rewritten paragraphs go in the same undo step (see markupUnderEdits).
  const removed = markupUnderEdits(now, fresh.map((x) => x.op).filter((op): op is TextEdit => op.type === "text.edit"));
  editorStore.getState().putObjects(fresh.map((x) => x.op), removed);
  noteMarkupRemoved(removed);
  return fresh.flatMap(({ op, ends }) => ends.map((end) => ({ key: opKey(op.id), end })));
}
