import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { visualBounds } from "@/lib/objects";
import { editorStore, type DocInfo } from "@/store/editor";
import { alignSelection, clearClipboard, copySelection, duplicateSelection, hasClipboard, pasteClipboard, PASTE_OFFSET } from "./clipboard";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "s", fileName: "a.pdf",
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
