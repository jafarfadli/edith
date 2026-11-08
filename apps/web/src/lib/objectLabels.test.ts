import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { listedCount, listedObjects, objectLabel } from "@/lib/objectLabels";

const base = { id: "x", pageKey: "o0" };
const op = (o: object) => ({ ...base, ...o }) as ContentOp;
const box = (text: string) => ({ rect: { x: 0, y: 0, w: 10, h: 10 }, lineHeight: 12, layout: [],
  paragraphs: text.split("\n").map((line) => [{ text: line, font: { kind: "bundled", family: "Arimo" }, size: 12, color: "#000000" }]) });

describe("objectLabel", () => {
  it("names each kind, with a snippet where there is text", () => {
    expect(objectLabel(op({ type: "text.add", box: box("Halo\ndunia") }))).toEqual({ icon: "text", label: "Teks", detail: "Halo dunia" });
    expect(objectLabel(op({ type: "shape.add", kind: "cloud", points: [], stroke: "#000000", width: 1 }))).toEqual({ icon: "cloud", label: "Awan" });
    expect(objectLabel(op({ type: "stamp.add", preset: "disetujui", rect: {}, color: "#000000" })).detail).toBe("DISETUJUI");
    expect(objectLabel(op({ type: "stamp.add", custom: { text: "OK", date: "01/01/2026" }, rect: {}, color: "#000000" })).detail).toBe("OK 01/01/2026");
    expect(objectLabel(op({ type: "annot.add", kind: "note", point: [0, 0], color: "#000000", content: "" }))).toEqual({ icon: "note", label: "Catatan", detail: undefined });
    expect(objectLabel(op({ type: "annot.add", kind: "strike", quads: [], color: "#000000" })).label).toBe("Coret");
    expect(objectLabel(op({ type: "link.add", rect: {}, target: { pageKey: "o1" } })).detail).toBeUndefined();
  });

  it("shortens long text", () => {
    const d = objectLabel(op({ type: "text.add", box: box("x".repeat(100)) })).detail!;
    expect(d).toHaveLength(40);
    expect(d.endsWith("…")).toBe(true);
  });
});

describe("listedObjects", () => {
  const a = op({ id: "a", pageKey: "o0", type: "image.add" });
  const b = op({ id: "b", pageKey: "o1", type: "image.add" });
  const gone = op({ id: "c", pageKey: "o9", type: "image.add" });
  const doc = { pages: [{ pageKey: "o1" }, { pageKey: "o0" }], order: ["a", "b", "c"], objects: { a, b, c: gone } };

  it("groups by page order and skips objects of deleted pages", () => {
    expect(listedObjects(doc).map((g) => [g.pageKey, g.n, g.ops.map((o) => o.id)])).toEqual([["o1", 1, ["b"]], ["o0", 2, ["a"]]]);
    expect(listedCount(doc)).toBe(2);
  });
});
