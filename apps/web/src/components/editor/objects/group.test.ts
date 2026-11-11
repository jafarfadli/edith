import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { editorStore, type DocInfo } from "@/store/editor";
import { deleteObjects, moveBy, moveEach, nudgeSelection, selectedOps } from "./group";
import { selectedIds } from "./layering";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "s", fileName: "a.pdf",
  pages: [0, 1].map((i) => ({ index: i, width: 600, height: 800, rotation: i === 1 ? 90 : 0, hasText: true })),
};
const rect = (id: string, x: number, y: number, pageKey = "o0"): ContentOp =>
  ({ id, type: "shape.add", pageKey, kind: "rect", rect: { x, y, w: 50, h: 20 }, stroke: "#000000", fill: null, width: 1 }) as ContentOp;
const markup = (id: string): ContentOp =>
  ({ id, type: "annot.add", pageKey: "o0", kind: "highlight", quads: [{ x: 0, y: 0, w: 10, h: 10 }], color: "#ffeb3b" }) as unknown as ContentOp;
const s = () => editorStore.getState();
const at = (id: string) => (s().doc.objects[id] as { rect: { x: number; y: number } }).rect;

beforeEach(() => {
  s().init(info);
  s().addObject(rect("a", 10, 10));
  s().addObject(rect("b", 100, 100));
  s().addObject(rect("c", 200, 200));
  s().selectMany(["a", "b"]);
});

describe("selectedOps / selectedIds", () => {
  it("are the whole selection", () => {
    expect(selectedIds()).toEqual(["a", "b"]);
    expect(selectedOps().map((o) => o.id)).toEqual(["a", "b"]);
  });
});

describe("moveBy / moveEach", () => {
  it("moves the whole selection as one undo step", () => {
    expect(moveBy(selectedIds(), 5, -3)).toBe(true);
    expect(at("a")).toMatchObject({ x: 15, y: 7 });
    expect(at("b")).toMatchObject({ x: 105, y: 97 });
    expect(at("c")).toMatchObject({ x: 200, y: 200 });
    s().undo();
    expect(at("a")).toMatchObject({ x: 10, y: 10 });
    expect(at("b")).toMatchObject({ x: 100, y: 100 });
  });

  it("moves each by its own delta", () => {
    moveEach({ a: [1, 2], b: [3, 4] });
    expect(at("a")).toMatchObject({ x: 11, y: 12 });
    expect(at("b")).toMatchObject({ x: 103, y: 104 });
  });

  it("leaves text markup where it is and does nothing when nothing moves", () => {
    s().addObject(markup("m"));
    expect(moveBy(["m"], 5, 5)).toBe(false);
    expect(s().past.length).toBe(4); // three rectangles + the markup, no step for the move
  });

  it("does nothing for a zero move", () => {
    expect(moveBy(["a"], 0, 0)).toBe(false);
  });
});

describe("nudgeSelection", () => {
  it("moves by screen points on an upright page", () => {
    expect(nudgeSelection(1, 0)).toBe(true);
    expect(at("a")).toMatchObject({ x: 11, y: 10 });
    nudgeSelection(0, 10);
    expect(at("a")).toMatchObject({ x: 11, y: 20 });
  });

  it("follows the screen on a rotated page (turned 90°: screen right is page up)", () => {
    s().addObject(rect("q", 100, 100, "o1"));
    s().select("q");
    nudgeSelection(1, 0);
    expect(at("q")).toMatchObject({ x: 100, y: 99 });
  });

  it("is zoom independent: it works in points", () => {
    s().setZoom(3);
    nudgeSelection(1, 0);
    expect(at("a").x).toBe(11);
  });

  it("repeated nudges in quick succession are one undo step", () => {
    nudgeSelection(1, 0);
    nudgeSelection(1, 0);
    nudgeSelection(1, 0);
    expect(at("a").x).toBe(13);
    s().undo();
    expect(at("a").x).toBe(10);
    expect(at("b").x).toBe(100);
  });

  it("a new selection starts a new step", () => {
    nudgeSelection(1, 0);
    s().select("c");
    nudgeSelection(1, 0);
    s().undo();
    expect(at("c").x).toBe(200);
    expect(at("a").x).toBe(11);
  });

  it("nothing selected: false", () => {
    s().select(null);
    expect(nudgeSelection(1, 0)).toBe(false);
  });
});

describe("deleteObjects", () => {
  it("removes the whole selection as one undo step", () => {
    deleteObjects(selectedIds());
    expect(Object.keys(s().doc.objects)).toEqual(["c"]);
    expect(s().selected).toEqual([]);
    s().undo();
    expect(Object.keys(s().doc.objects).sort()).toEqual(["a", "b", "c"]);
  });
});
