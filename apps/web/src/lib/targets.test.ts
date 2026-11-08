import { describe, expect, it } from "vitest";
import type { ContentOp, Run } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import type { FontMetrics } from "@/lib/fonts";
import { findMatches } from "@/lib/search";
import { buildTargets, highlightRects } from "@/lib/targets";
import type { EditorDoc } from "@/store/editor";

const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const run = (text: string): Run => ({ text, font, size: 10, color: "#000000" });
const mono: FontMetrics = { unitsPerEm: 1000, ascent: 800, descent: 200, advance: () => 500 }; // 5 pt per char at 10 pt
const para = (id: string, y: number, text: string): Paragraph => ({
  id, rect: { x: 100, y, w: 200, h: 12 }, runs: [run(text)], align: "left", lineHeight: 12, editable: true,
  lines: [{ rect: { x: 100, y, w: 200, h: 12 }, baseline: y + 10, size: 10, start: 0, end: text.length }],
});
const box = (y: number, text: string) => ({
  rect: { x: 50, y, w: 200, h: 12 }, align: "left" as const, lineHeight: 12, paragraphs: [[run(text)]],
  layout: [{ baseline: 10, segments: [{ x: 0, text, runIndex: 0 }] }],
});
const doc: EditorDoc = {
  pages: [{ pageKey: "o0", src: { doc: "D", index: 0 }, rotate: 0 }, { pageKey: "u1", src: { blank: { width: 10, height: 10 } }, rotate: 0 }],
  objects: {
    e: { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g1", box: box(300, "diedit lama") } as ContentOp,
    t: { id: "t", type: "text.add", pageKey: "o0", box: box(50, "kotak lama") } as ContentOp,
    u: { id: "u", type: "text.add", pageKey: "u1", box: box(0, "lama di kosong") } as ContentOp,
  },
  order: ["e", "t", "u"],
};
const pages = { "D:0": [para("g0", 100, "asli lama"), para("g1", 300, "tergantikan lama")] };

describe("search targets", () => {
  it("lists unedited paragraphs and text ops by page and position", () => {
    expect(buildTargets(doc, pages).map((t) => t.key)).toEqual(["op:t", "para:o0:g0", "op:e", "op:u"]);
  });

  it("searches pages of imported PDFs by their own paragraphs, never the main document's at the same index", () => {
    const d: EditorDoc = { ...doc, imports: ["IMP"], pages: [...doc.pages, { pageKey: "u9", src: { doc: "IMP", index: 0 }, rotate: 0 }] };
    expect(buildTargets(d, pages).map((t) => t.key)).toEqual(["op:t", "para:o0:g0", "op:e", "op:u"]); // not loaded yet
    const withImport = { ...pages, "IMP:0": [para("g7", 200, "impor lama")] };
    const targets = buildTargets(d, withImport);
    expect(targets.map((t) => t.key)).toEqual(["op:t", "para:o0:g0", "op:e", "op:u", "para:u9:g7"]);
    const [m] = findMatches(targets.filter((t) => t.key === "para:u9:g7"), "lama", true);
    expect(highlightRects(m, d, withImport, {}, () => mono)).toEqual([{ x: 130, y: 200.5, w: 20, h: 12 }]);
    expect(highlightRects({ ...m, key: "para:u9:g0" }, d, withImport, {}, () => mono)).toEqual([]);
  });

  it("highlights a match in an original paragraph", () => {
    const [m] = findMatches(buildTargets(doc, pages).filter((t) => t.key === "para:o0:g0"), "lama", true);
    expect(highlightRects(m, doc, pages, {}, () => mono)).toEqual([{ x: 125, y: 100.5, w: 20, h: 12 }]);
  });

  it("highlights a match in a text op from its layout", () => {
    const [m] = findMatches(buildTargets(doc, pages).filter((t) => t.key === "op:t"), "lama", true);
    expect(highlightRects(m, doc, pages, {}, () => mono)).toEqual([{ x: 80, y: 50.5, w: 20, h: 12 }]);
  });

  it("falls back to the whole line before fonts load", () => {
    const [m] = findMatches(buildTargets(doc, pages).filter((t) => t.key === "para:o0:g0"), "lama", true);
    expect(highlightRects(m, doc, pages, {}, () => null)).toEqual([{ x: 100, y: 100.5, w: 200, h: 12 }]);
  });
});
