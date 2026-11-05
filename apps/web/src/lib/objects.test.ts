import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { arrowHead, clampToPage, createFromDrag, inkWidth, MIN_INK_WIDTH, moveOp, normalizeRect, opBounds, resizeOp } from "@/lib/objects";
import type { ToolStyle } from "@/store/editor";

const style: ToolStyle = { stroke: "#ff0000", fill: "#00ff00", width: 3, color: "#111111", fontFamily: "Arimo", fontSize: 14, bold: false, italic: false, align: "left" };

describe("objects", () => {
  it("normalizes rects from any drag direction", () => {
    expect(normalizeRect([10, 20], [0, 5])).toEqual({ x: 0, y: 5, w: 10, h: 15 });
  });

  it("creates shapes from drags", () => {
    expect(createFromDrag("rect", [0, 0], [50, 40], style, "o0", "a")).toEqual({
      id: "a", type: "shape.add", pageKey: "o0", kind: "rect", rect: { x: 0, y: 0, w: 50, h: 40 }, stroke: "#ff0000", fill: "#00ff00", width: 3,
    });
    expect(createFromDrag("arrow", [0, 0], [50, 40], style, "o0", "b")).toMatchObject({ kind: "arrow", points: [[0, 0], [50, 40]], fill: null });
    expect(createFromDrag("whiteout", [5, 5], [20, 30], style, "o0", "c")).toEqual({ id: "c", type: "whiteout.add", pageKey: "o0", rect: { x: 5, y: 5, w: 15, h: 25 } });
    expect(createFromDrag("redact", [5, 5], [20, 30], style, "o0", "d")).toMatchObject({ type: "redact.add", fill: "black" });
  });

  it("ignores tiny drags", () => {
    expect(createFromDrag("rect", [0, 0], [2, 2], style, "o0", "a")).toBeNull();
    expect(createFromDrag("line", [0, 0], [1, 2], style, "o0", "a")).toBeNull();
  });

  it("computes bounds", () => {
    const ink = { id: "i", type: "ink.add", pageKey: "o0", paths: [[[0, 0], [10, 5]], [[20, 30]]], color: "#000000", width: 2 } as ContentOp;
    expect(opBounds(ink)).toEqual({ x: 0, y: 0, w: 20, h: 30 });
    const line = createFromDrag("line", [30, 40], [10, 0], style, "o0", "l")!;
    expect(opBounds(line)).toEqual({ x: 10, y: 0, w: 20, h: 40 });
  });

  it("moves points and rects", () => {
    const line = createFromDrag("line", [0, 0], [10, 10], style, "o0", "l")!;
    expect((moveOp(line, 5, -2) as { points: number[][] }).points).toEqual([[5, -2], [15, 8]]);
    const r = createFromDrag("rect", [0, 0], [10, 10], style, "o0", "r")!;
    expect((moveOp(r, 1, 2) as { rect: unknown }).rect).toEqual({ x: 1, y: 2, w: 10, h: 10 });
  });

  it("resizes by scaling points", () => {
    const ink = { id: "i", type: "ink.add", pageKey: "o0", paths: [[[0, 0], [10, 10]]], color: "#000000", width: 2 } as ContentOp;
    expect((resizeOp(ink, { x: 100, y: 100, w: 20, h: 40 }) as { paths: number[][][] }).paths).toEqual([[[100, 100], [120, 140]]]);
    const r = createFromDrag("ellipse", [0, 0], [10, 10], style, "o0", "e")!;
    expect((resizeOp(r, { x: 1, y: 1, w: 5, h: 6 }) as { rect: unknown }).rect).toEqual({ x: 1, y: 1, w: 5, h: 6 });
  });

  it("arrow head matches the API formula", () => {
    expect(arrowHead(1).length).toBe(6);
    expect(arrowHead(3).length).toBe(12);
    expect(arrowHead(3).width).toBeCloseTo(2 * 12 * Math.tan((25 * Math.PI) / 180));
  });

  it("clamps a pointer position to the page bounds", () => {
    expect(clampToPage([50, 60], 595, 842)).toEqual([50, 60]);
    expect(clampToPage([-20, 900], 595, 842)).toEqual([0, 842]);
    expect(clampToPage([700, -1], 595, 842)).toEqual([595, 0]);
  });

  it("keeps ink strokes visible", () => {
    expect(MIN_INK_WIDTH).toBe(0.5);
    expect(inkWidth(0)).toBe(0.5);
    expect(inkWidth(0.2)).toBe(0.5);
    expect(inkWidth(4)).toBe(4);
  });
});
