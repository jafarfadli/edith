import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { visualBounds } from "@/lib/objects";
import { editorStore, type DocInfo } from "@/store/editor";
import { alignSelection, clearClipboard, copySelection, cutSelection, distributeSelection, duplicateSelection, hasClipboard, pasteClipboard, PASTE_OFFSET } from "./clipboard";

const info: DocInfo = {
  docId: "D".repeat(22), editId: "E".repeat(22), fileName: "a.pdf",
  pages: [0, 1].map((i) => ({ index: i, width: 600, height: 800, rotation: i === 1 ? 90 : 0, hasText: true })),
};
const box = (extra: object = {}) => ({ id: "r", type: "shape.add", pageKey: "o0", kind: "rect", rect: { x: 100, y: 200, w: 50, h: 20 }, stroke: "#000000", fill: null, width: 1, ...extra }) as ContentOp;
const s = () => editorStore.getState();
const rectOf = (id: string) => (s().doc.objects[id] as { rect: { x: number; y: number } }).rect;

beforeEach(() => { s().init(info); clearClipboard(); s().addObject(box()); s().select("r"); s().setCurrentPage("o0"); });

describe("clipboard", () => {
  it("pastes on the same page a little further each time", () => {
    expect(copySelection()).toBe(true);
    const a = pasteClipboard()!, b = pasteClipboard()!;
    expect(rectOf(a)).toMatchObject({ x: 100 + PASTE_OFFSET, y: 200 + PASTE_OFFSET });
    expect(rectOf(b)).toMatchObject({ x: 100 + 2 * PASTE_OFFSET, y: 200 + 2 * PASTE_OFFSET });
    expect(s().selection).toBe(b);
  });

  it("pastes at the same place on another page", () => {
    copySelection();
    s().setCurrentPage("o1");
    const id = pasteClipboard()!;
    expect(s().doc.objects[id]).toMatchObject({ pageKey: "o1", rect: { x: 100, y: 200 } });
  });

  it("keeps a paste inside a smaller (cropped) page", () => {
    s().updateObject("r", { rect: { x: 500, y: 700, w: 50, h: 20 } } as Partial<ContentOp>);
    copySelection();
    s().setCrop(["o1"], { x: 0, y: 0, w: 300, h: 300 });
    s().setCurrentPage("o1");
    const id = pasteClipboard()!;
    expect(rectOf(id)).toMatchObject({ x: 250, y: 280 });
  });

  it("does not copy edited paragraphs; nothing to paste before a copy", () => {
    expect(hasClipboard()).toBe(false);
    expect(pasteClipboard()).toBeNull();
    s().addObject({ id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g0", box: { rect: { x: 0, y: 0, w: 1, h: 1 }, lineHeight: 1, paragraphs: [], layout: [] } } as ContentOp);
    s().select("e");
    expect(copySelection()).toBe(false);
  });

  it("duplicates next to the original and selects the copy", () => {
    const id = duplicateSelection()!;
    expect(rectOf(id)).toMatchObject({ x: 110, y: 210 });
    expect(s().selection).toBe(id);
    expect(hasClipboard()).toBe(false);
  });

  it("aligns to the page as seen on screen", () => {
    alignSelection("right");
    expect(rectOf("r")).toMatchObject({ x: 550, y: 200 });
    alignSelection("bottom");
    expect(rectOf("r")).toMatchObject({ x: 550, y: 780 });
    // A rotated object lines up by what it covers.
    s().updateObject("r", { rotation: 90, rect: { x: 100, y: 200, w: 50, h: 20 } } as Partial<ContentOp>);
    alignSelection("left");
    expect(visualBounds(s().doc.objects.r).x).toBeCloseTo(0);
  });

  it("aligns on a rotated page by the screen's left edge", () => {
    s().addObject(box({ id: "q", pageKey: "o1" }));
    s().select("q");
    alignSelection("left"); // page turned 90°: the screen's left edge is the page's bottom (y = 800)
    expect(rectOf("q")).toMatchObject({ x: 100, y: 780 });
  });
});

describe("clipboard with a group", () => {
  const at = (id: string) => (s().doc.objects[id] as { rect: { x: number; y: number } }).rect;
  beforeEach(() => {
    s().addObject(box({ id: "r2", rect: { x: 300, y: 400, w: 50, h: 20 } }));
    s().selectMany(["r", "r2"]);
  });

  it("copies and pastes the whole group, keeping how its objects lie, as one undo step and selects the copies", () => {
    expect(copySelection()).toBe(true);
    const before = Object.keys(s().doc.objects).length;
    const id = pasteClipboard()!;
    expect(s().selected.length).toBe(2);
    expect(s().selection).toBe(id);
    const [a, b] = s().selected;
    expect(at(a)).toMatchObject({ x: 100 + PASTE_OFFSET, y: 200 + PASTE_OFFSET });
    expect(at(b)).toMatchObject({ x: 300 + PASTE_OFFSET, y: 400 + PASTE_OFFSET });
    s().undo();
    expect(Object.keys(s().doc.objects).length).toBe(before);
  });

  it("duplicates the group", () => {
    const id = duplicateSelection()!;
    expect(s().selected.length).toBe(2);
    expect(s().selection).toBe(id);
    expect(Object.keys(s().doc.objects).length).toBe(4);
  });

  it("keeps a pasted group on the page as a group", () => {
    s().updateObject("r2", { rect: { x: 545, y: 400, w: 50, h: 20 } } as Partial<ContentOp>);
    copySelection();
    pasteClipboard(); // 10 pt down-right would push r2's right edge to 605
    const [a, b] = s().selected;
    expect(at(b).x).toBe(550); // the group's right edge stops at 600
    expect(at(b).x - at(a).x).toBe(445); // spacing kept
  });

  it("cuts: copies and removes the group in one step; the paste brings it back", () => {
    expect(cutSelection()).toBe(true);
    expect(Object.keys(s().doc.objects)).toEqual([]);
    expect(s().selected).toEqual([]);
    pasteClipboard();
    expect(s().selected.length).toBe(2);
    s().undo();
    s().undo();
    expect(Object.keys(s().doc.objects).sort()).toEqual(["r", "r2"]);
  });

  it("aligns a group to its bounding box", () => {
    alignSelection("left");
    expect(at("r").x).toBe(100);
    expect(at("r2").x).toBe(100);
    alignSelection("bottom"); // r2 is lower
    expect(at("r").y).toBe(400);
  });

  it("aligns a group in one undo step", () => {
    alignSelection("left");
    s().undo();
    expect(at("r2").x).toBe(300);
  });

  it("distributes three or more", () => {
    s().addObject(box({ id: "r3", rect: { x: 120, y: 500, w: 50, h: 20 } }));
    s().selectMany(["r", "r2", "r3"]);
    distributeSelection("x"); // r 100..150, r3 120..170, r2 300..350
    const xs = ["r", "r3", "r2"].map((id) => at(id).x);
    const gap1 = xs[1] - (xs[0] + 50), gap2 = xs[2] - (xs[1] + 50);
    expect(gap1).toBeCloseTo(gap2);
    expect(at("r").x).toBe(100);
    expect(at("r2").x).toBe(300);
    s().undo();
    expect(at("r3").x).toBe(120);
  });

  it("distribute does nothing for two", () => {
    const n = s().past.length;
    distributeSelection("x");
    expect(s().past.length).toBe(n);
  });
});
