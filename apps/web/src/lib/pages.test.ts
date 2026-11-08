import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { blankSizeLike, clampCrop, deletePages, duplicatePages, importPages, movePage, rotatePages, setCrop, shiftPages } from "@/lib/pages";
import type { DocInfo, EditorDoc, PageEntry } from "@/store/editor";

const D = "D".repeat(22), I = "I".repeat(22);
const info: DocInfo = {
  docId: D, sha256: "s", fileName: "a.pdf",
  pages: [0, 1, 2].map((i) => ({ index: i, width: 595, height: 842, rotation: i === 2 ? 90 : 0, hasText: true })),
  imports: { [I]: [{ index: 0, width: 300, height: 400, rotation: 0, hasText: false }] },
};
const page = (i: number): PageEntry => ({ pageKey: `o${i}`, src: { doc: D, index: i }, rotate: 0 });
const white = (id: string, pageKey: string): ContentOp => ({ id, type: "whiteout.add", pageKey, rect: { x: 0, y: 0, w: 1, h: 1 } }) as ContentOp;
const doc = (): EditorDoc => ({ pages: [page(0), page(1), page(2)], objects: { a: white("a", "o0"), b: white("b", "o1") }, order: ["a", "b"] });
const keys = (d: EditorDoc) => d.pages.map((p) => p.pageKey);
const counter = (prefix: string) => { let n = 0; return () => `${prefix}${n++}`; };

describe("page operations", () => {
  it("rotates several pages; unknown keys change nothing", () => {
    const d = rotatePages(doc(), ["o0", "o2"], -90);
    expect(d.pages.map((p) => p.rotate)).toEqual([270, 0, 270]);
    const same = doc();
    expect(rotatePages(same, ["x"], 90)).toBe(same);
  });

  it("deletes pages but never the last one", () => {
    expect(keys(deletePages(doc(), ["o0", "o2"]))).toEqual(["o1"]);
    const d = doc();
    expect(deletePages(d, ["o0", "o1", "o2"])).toBe(d);
  });

  it("duplicates pages with their objects right after each original", () => {
    const d = duplicatePages(doc(), ["o0", "o1"], counter("u-k"), counter("id"));
    expect(keys(d)).toEqual(["o0", "u-k0", "o1", "u-k1", "o2"]);
    expect(d.pages[1].src).toEqual({ doc: D, index: 0 });
    expect(d.objects.id0).toEqual({ ...white("a", "o0"), id: "id0", pageKey: "u-k0" });
    expect(d.objects.id1).toMatchObject({ pageKey: "u-k1" });
    expect(d.order).toEqual(["a", "b", "id0", "id1"]);
  });

  it("shifts a selection as a block", () => {
    expect(keys(shiftPages(doc(), ["o1", "o2"], -1))).toEqual(["o1", "o2", "o0"]);
    expect(keys(shiftPages(doc(), ["o0", "o1"], 1))).toEqual(["o2", "o0", "o1"]);
    const d = doc();
    expect(shiftPages(d, ["o0"], -1)).toBe(d);
    expect(keys(movePage(doc(), "o2", 0))).toEqual(["o2", "o0", "o1"]);
  });

  it("sizes blank pages like their neighbor on screen", () => {
    expect(blankSizeLike(page(0), info)).toEqual({ width: 595, height: 842 });
    expect(blankSizeLike(page(2), info)).toEqual({ width: 842, height: 595 }); // source /Rotate 90
    expect(blankSizeLike({ ...page(0), rotate: 270 }, info)).toEqual({ width: 842, height: 595 });
    expect(blankSizeLike({ ...page(0), crop: { x: 0, y: 0, w: 100, h: 200 } }, info)).toEqual({ width: 100, height: 200 });
    expect(blankSizeLike({ pageKey: "u", src: { doc: I, index: 0 }, rotate: 0 }, info)).toEqual({ width: 300, height: 400 });
    expect(blankSizeLike(undefined, info)).toEqual({ width: 595, height: 842 });
  });

  it("inserts imported pages and remembers the import", () => {
    const d = importPages(doc(), 1, I, 2, counter("u-i"));
    expect(keys(d)).toEqual(["o0", "u-i0", "u-i1", "o1", "o2"]);
    expect(d.pages[2].src).toEqual({ doc: I, index: 1 });
    expect(d.imports).toEqual([I]);
    expect(importPages(d, 0, I, 1, counter("u-j")).imports).toEqual([I]);
  });

  it("clamps crops to the page", () => {
    expect(clampCrop({ x: -5, y: 10, w: 100, h: 900 }, { width: 595, height: 842 })).toEqual({ x: 0, y: 10, w: 95, h: 832 });
    expect(clampCrop({ x: 590, y: 0, w: 100, h: 100 }, { width: 595, height: 842 })).toBeNull(); // 5 pt left
  });

  it("crops pages and removes crops", () => {
    const crop = { x: 10, y: 10, w: 400, h: 500 };
    const d = setCrop(doc(), ["o0", "o1"], crop, info);
    expect(d.pages.map((p) => p.crop ?? null)).toEqual([crop, crop, null]);
    const imported = setCrop({ ...doc(), pages: [{ pageKey: "u", src: { doc: I, index: 0 }, rotate: 0 }] }, ["u"], crop, info);
    expect(imported.pages[0].crop).toEqual({ x: 10, y: 10, w: 290, h: 390 });
    const cleared = setCrop(d, ["o0"], null, info);
    expect(cleared.pages[0]).not.toHaveProperty("crop");
    expect(cleared.pages[1].crop).toEqual(crop);
    const same = doc();
    expect(setCrop(same, ["o0"], null, info)).toBe(same);
  });
});
