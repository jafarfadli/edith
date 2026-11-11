import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp, Rect } from "@edith/ops";
import { editorStore, type DocInfo } from "@/store/editor";
import { resizeGroup } from "./groupResize";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "s", fileName: "a.pdf",
  pages: [{ index: 0, width: 600, height: 800, rotation: 0, hasText: true }],
};
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const shape = (id: string, rect: Rect, extra: object = {}) =>
  ({ id, type: "shape.add", pageKey: "o0", kind: "rect", rect, stroke: "#000000", fill: null, width: 1, ...extra }) as ContentOp;
const s = () => editorStore.getState();
const rectOf = (id: string) => (s().doc.objects[id] as unknown as { rect: Rect }).rect;

beforeEach(() => {
  s().init(info);
  s().addObject(shape("a", r(100, 100, 50, 50)));
  s().addObject(shape("b", r(200, 100, 50, 50)));
});

describe("resizeGroup", () => {
  it("scales positions and sizes with the group's box, as one undo step", () => {
    resizeGroup(["a", "b"], r(100, 100, 150, 50), r(100, 100, 300, 100));
    expect(rectOf("a")).toEqual(r(100, 100, 100, 100));
    expect(rectOf("b")).toEqual(r(300, 100, 100, 100));
    s().undo();
    expect(rectOf("a")).toEqual(r(100, 100, 50, 50));
    expect(rectOf("b")).toEqual(r(200, 100, 50, 50));
  });

  it("scales the points of ink and lines", () => {
    s().addObject({ id: "l", type: "shape.add", pageKey: "o0", kind: "line", points: [[100, 100], [250, 150]], stroke: "#000000", fill: null, width: 1 } as ContentOp);
    resizeGroup(["l", "a"], r(100, 100, 150, 50), r(100, 100, 300, 100));
    expect((s().doc.objects.l as unknown as { points: number[][] }).points).toEqual([[100, 100], [400, 200]]);
  });

  it("a text box changes by its width only (its glyphs are not scaled) and follows the group's position", () => {
    const text = { id: "t", type: "text.add", pageKey: "o0", box: { rect: r(100, 120, 80, 20), paragraphs: [], layout: [], lineHeight: 14 } } as unknown as ContentOp;
    s().addObject(text);
    const seen: Rect[] = [];
    resizeGroup(["t", "b"], r(100, 100, 150, 50), r(100, 100, 300, 100), (op, to) => {
      seen.push(to);
      return { ...op, box: { ...op.box, rect: { ...op.box.rect, x: to.x, w: to.w } } };
    });
    expect(seen[0]).toMatchObject({ x: 100, w: 160 });
    const rect = (s().doc.objects.t as unknown as { box: { rect: Rect } }).box.rect;
    expect(rect).toMatchObject({ x: 100, y: 140, w: 160, h: 20 }); // y scaled (100 + 20 * 2), height as the re-wrap left it
  });

  it("leaves text markup alone and keeps the size of a turned object, moving its centre", () => {
    s().addObject({ id: "m", type: "annot.add", pageKey: "o0", kind: "highlight", quads: [{ x: 100, y: 100, w: 10, h: 10 }], color: "#ffeb3b" } as unknown as ContentOp);
    s().addObject(shape("rot", r(210, 100, 20, 10), { type: "symbol.add", rotation: 90 }));
    resizeGroup(["m", "rot", "a"], r(100, 100, 150, 50), r(100, 100, 300, 100));
    expect((s().doc.objects.m as unknown as { quads: Rect[] }).quads[0]).toEqual(r(100, 100, 10, 10));
    const turned = rectOf("rot");
    expect(turned.w).toBe(20);
    expect(turned.h).toBe(10);
    expect(turned.x + turned.w / 2).toBeCloseTo(100 + (220 - 100) * 2); // centre 220 -> 340
  });

  it("does nothing when the box did not change", () => {
    const n = s().past.length;
    resizeGroup(["a", "b"], r(100, 100, 150, 50), r(100, 100, 150, 50));
    expect(s().past.length).toBe(n);
  });
});
