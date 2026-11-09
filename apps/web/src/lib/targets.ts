import type { ContentOp, Rect, Run, TextAdd, TextBox, TextEdit } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { charOffsets, textWidth, type FontMetrics } from "@/lib/fonts";
import { isTextOp } from "@/lib/objects";
import { measureRange, substituteOf, type FontTable } from "@/lib/paragraphs";
import { matchSegments, type Match, type SearchTarget } from "@/lib/search";
import { srcKey, type ParagraphPages } from "@/lib/sources";
import type { EditorDoc } from "@/store/editor";

type Peek = (f: Run["font"]) => FontMetrics | null;
const HL_ASCENT = 0.95, HL_HEIGHT = 1.2; // highlight band around the baseline (× size)

/** Key of a search target: `op:<id>` for a text op, `para:<pageKey>:<paragraphId>` for an original paragraph. */
export const opKey = (id: string) => `op:${id}`;
export const paraKey = (pageKey: string, id: string) => `para:${pageKey}:${id}`;

/** Everything Find searches, in page order then reading order (top to bottom, left to right). */
export function buildTargets(doc: EditorDoc, pages: ParagraphPages): SearchTarget[] {
  const out: SearchTarget[] = [];
  for (const entry of doc.pages) {
    const ops = doc.order.map((id) => doc.objects[id]).filter((op): op is TextAdd | TextEdit => isTextOp(op) && op.pageKey === entry.pageKey);
    const edited = new Set(ops.filter((op): op is TextEdit => op.type === "text.edit").map((op) => op.paragraphId));
    const items: { x: number; y: number; target: SearchTarget }[] = [];
    if ("doc" in entry.src) {
      for (const p of pages[srcKey(entry.src.doc, entry.src.index)] ?? []) {
        if (p.editable && !edited.has(p.id)) items.push({ x: p.rect.x, y: p.rect.y, target: { key: paraKey(entry.pageKey, p.id), pageKey: entry.pageKey, paragraphs: [p.runs] } });
      }
    }
    for (const op of ops) items.push({ x: op.box.rect.x, y: op.box.rect.y, target: { key: opKey(op.id), pageKey: entry.pageKey, paragraphs: op.box.paragraphs } });
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    out.push(...items.map((i) => i.target));
  }
  return out;
}

/** Page rectangles to highlight for `m`; empty when the fonts to measure it are not loaded. */
export function highlightRects(m: Match, doc: EditorDoc, pages: ParagraphPages, fonts: FontTable, peek: Peek): Rect[] {
  if (m.key.startsWith("op:")) {
    const op = doc.objects[m.key.slice(3)] as ContentOp | undefined;
    return isTextOp(op) ? boxRects(op.box, m, peek) : [];
  }
  const [, pageKey, id] = m.key.split(":");
  const entry = doc.pages.find((p) => p.pageKey === pageKey);
  const p = entry && "doc" in entry.src ? pages[srcKey(entry.src.doc, entry.src.index)]?.find((x) => x.id === id) : undefined;
  return p ? paragraphRects(p, m, (f) => peek(f) ?? peek(substituteOf(f, fonts))) : [];
}

function boxRects(box: TextBox, m: Match, peek: Peek): Rect[] {
  const runs = box.paragraphs.flat();
  return matchSegments(box, m.start, m.end).flatMap(({ line, segment, from, to }) => {
    const l = box.layout[line], seg = l.segments[segment], r = runs[seg.runIndex];
    const metrics = peek(r.font);
    if (!metrics) return [];
    const offs = [...charOffsets(seg.text, metrics, r.size, r), textWidth(seg.text, metrics, r.size, r)];
    return [{ x: box.rect.x + seg.x + offs[from], y: box.rect.y + l.baseline - HL_ASCENT * r.size, w: offs[to] - offs[from], h: HL_HEIGHT * r.size }];
  });
}

function paragraphRects(p: Paragraph, m: Match, peek: Peek): Rect[] {
  const metricsFor = (f: Run["font"]) => { const x = peek(f); if (!x) throw new Error("font not loaded"); return x; };
  return p.lines.flatMap((l) => {
    const a = Math.max(m.start, l.start), b = Math.min(m.end, l.end);
    if (a >= b) return [];
    const y = l.baseline - HL_ASCENT * l.size, h = HL_HEIGHT * l.size;
    try {
      const x0 = measureRange(p.runs, l.start, a, metricsFor, false);
      const x1 = measureRange(p.runs, l.start, b, metricsFor, false);
      return [{ x: l.rect.x + x0, y, w: x1 - x0, h }];
    } catch {
      return [{ x: l.rect.x, y, w: l.rect.w, h }]; // fonts not loaded yet: the whole line
    }
  });
}
