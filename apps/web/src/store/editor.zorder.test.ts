import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { createEditorStore, type DocInfo } from "@/store/editor";

const info: DocInfo = {
  docId: "D".repeat(22), editId: "E".repeat(22), fileName: "a.pdf",
  pages: [0, 1].map((i) => ({ index: i, width: 595, height: 842, rotation: 0, hasText: true })),
};
const rect = (id: string, pageKey = "o0"): ContentOp =>
  ({ id, type: "shape.add", pageKey, kind: "rect", rect: { x: 0, y: 0, w: 10, h: 10 }, stroke: "#000000", fill: null, width: 1 }) as ContentOp;

let store: ReturnType<typeof createEditorStore>;
beforeEach(() => {
  store = createEditorStore();
  store.getState().init(info);
  for (const op of [rect("a"), rect("x", "o1"), rect("b"), rect("c")]) store.getState().addObject(op);
});
const s = () => store.getState();

describe("editor store: reorderObjects", () => {
  it("is one undo step, redoable", () => {
    const past = s().past.length;
    expect(s().reorderObjects(["a"], "front")).toBe(true);
    expect(s().doc.order).toEqual(["b", "x", "c", "a"]);
    expect(s().past.length).toBe(past + 1);
    s().undo();
    expect(s().doc.order).toEqual(["a", "x", "b", "c"]);
    s().redo();
    expect(s().doc.order).toEqual(["b", "x", "c", "a"]);
  });

  it("adds no history when nothing changes", () => {
    const past = s().past.length;
    const doc = s().doc;
    expect(s().reorderObjects(["c"], "front")).toBe(false);
    expect(s().reorderObjects(["a"], "backward")).toBe(false);
    expect(s().reorderObjects(["missing"], "back")).toBe(false);
    expect(s().doc).toBe(doc);
    expect(s().past.length).toBe(past);
  });

  it("moves a group within its page and leaves the other page's object in its slot", () => {
    s().reorderObjects(["c", "b"], "back");
    expect(s().doc.order).toEqual(["b", "x", "c", "a"]);
    s().reorderObjects(["x"], "front");
    expect(s().doc.order).toEqual(["b", "x", "c", "a"]); // alone on its page: unchanged
  });

  it("keeps the selection and the objects themselves", () => {
    s().select("b");
    const objects = s().doc.objects;
    s().reorderObjects(["b"], "forward");
    expect(s().selection).toBe("b");
    expect(s().doc.objects).toBe(objects);
  });
});
