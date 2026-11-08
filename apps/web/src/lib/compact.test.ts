import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { compact, failedOpId } from "@/lib/compact";
import type { EditorDoc } from "@/store/editor";

const op = (id: string, pageKey: string): ContentOp =>
  ({ id, type: "whiteout.add", pageKey, rect: { x: 0, y: 0, w: 1, h: 1 } }) as ContentOp;

describe("compact", () => {
  it("emits layout first then objects in order, dropping orphans", () => {
    const doc: EditorDoc = {
      pages: [
        { pageKey: "o1", src: { doc: "D", index: 1 }, rotate: 90 },
        { pageKey: "u-b", src: { blank: { width: 100, height: 200 } }, rotate: 0 },
      ],
      objects: { a: op("a", "o1"), b: op("b", "o0"), c: op("c", "u-b") },
      order: ["c", "b", "a"],
    };
    const ops = compact(doc);
    expect(ops[0]).toEqual({ id: "layout", type: "pages.layout", pages: doc.pages });
    expect(ops.slice(1).map((o) => o.id)).toEqual(["c", "a"]);
  });
});

describe("failedOpId", () => {
  const sent = [{ id: "layout" }, { id: "a" }, { id: "b" }] as never[];
  it("maps bake_failed op_id and invalid_op op_index to the op", () => {
    expect(failedOpId("bake_failed", { op_id: "b" }, sent)).toBe("b");
    expect(failedOpId("invalid_op", { op_index: 1 }, sent)).toBe("a");
  });
  it("ignores missing or out-of-range details", () => {
    expect(failedOpId("invalid_op", { op_index: 9 }, sent)).toBeUndefined();
    expect(failedOpId("invalid_op", {}, sent)).toBeUndefined();
    expect(failedOpId("network", { op_index: 1 }, sent)).toBeUndefined();
  });
});

describe("compact (M3)", () => {
  const pages = [
    { pageKey: "o0", src: { doc: "D", index: 0 }, rotate: 0 as const },
    { pageKey: "o2", src: { doc: "D", index: 2 }, rotate: 0 as const },
  ];
  const link = (id: string, target: { url: string } | { pageKey: string }): ContentOp =>
    ({ id, type: "link.add", pageKey: "o0", rect: { x: 0, y: 0, w: 10, h: 10 }, target }) as ContentOp;

  it("drops links to pages that are gone", () => {
    const doc: EditorDoc = {
      pages,
      objects: { a: link("a", { pageKey: "o2" }), b: link("b", { pageKey: "o1" }), c: link("c", { url: "https://a.b" }) },
      order: ["a", "b", "c"],
    };
    expect(compact(doc).slice(1).map((o) => o.id)).toEqual(["a", "c"]);
  });

  it("sends form values as form.set ops after the content", () => {
    const doc: EditorDoc = { pages, objects: { w: op("w", "o0") }, order: ["w"], forms: { nama: "Budi", setuju: true } };
    expect(compact(doc).slice(1)).toEqual([
      op("w", "o0"),
      { id: "form-0", type: "form.set", fieldName: "nama", value: "Budi" },
      { id: "form-1", type: "form.set", fieldName: "setuju", value: true },
    ]);
  });
});

describe("compact (M4)", () => {
  const D = "D".repeat(22);
  it("sends crops only when set and drops values of fields whose pages are gone", () => {
    const doc: EditorDoc = {
      pages: [{ pageKey: "o0", src: { doc: D, index: 0 }, rotate: 0, crop: { x: 1, y: 2, w: 30, h: 40 } }, { pageKey: "o2", src: { doc: D, index: 2 }, rotate: 0, crop: null }],
      objects: {}, order: [], forms: { kept: "a", gone: "b", both: true },
    };
    const fields = [
      { name: "kept", page: 0 }, { name: "gone", page: 1 }, { name: "both", page: 1 }, { name: "both", page: 2 },
    ] as never[];
    const ops = compact(doc, { docId: D, fields });
    expect((ops[0] as { pages: unknown[] }).pages).toEqual([
      { pageKey: "o0", src: { doc: D, index: 0 }, rotate: 0, crop: { x: 1, y: 2, w: 30, h: 40 } },
      { pageKey: "o2", src: { doc: D, index: 2 }, rotate: 0 },
    ]);
    expect(ops.slice(1).map((o) => (o as { fieldName: string }).fieldName)).toEqual(["kept", "both"]);
    expect(compact(doc).length).toBe(4); // without info every value is sent
  });
});
