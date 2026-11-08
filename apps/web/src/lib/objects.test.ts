import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { arrowHead, clampToPage, createFromDrag, inkWidth, isMarkup, isResizable, isTextOp, MIN_INK_WIDTH, moveOp, normalizeRect, NOTE_SIZE, noteAt, opBounds, resizeOp, SYMBOL_SIZE, symbolAt } from "@/lib/objects";
import { DEFAULT_STYLE, type ToolStyle } from "@/store/editor";

const style: ToolStyle = { ...DEFAULT_STYLE, stroke: "#ff0000", fill: "#00ff00", width: 3, color: "#111111" };

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

describe("text.edit ops", () => {
  const box = { rect: { x: 10, y: 20, w: 100, h: 30 }, align: "left" as const, lineHeight: 12, paragraphs: [], layout: [] };
  const op = { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g0", box } as ContentOp;

  it("are text ops placed by their box", () => {
    expect(isTextOp(op)).toBe(true);
    expect(isTextOp({ id: "w", type: "whiteout.add", pageKey: "o0", rect: box.rect } as ContentOp)).toBe(false);
    expect(opBounds(op)).toEqual(box.rect);
    expect(opBounds(moveOp(op, 5, -5))).toEqual({ x: 15, y: 15, w: 100, h: 30 });
    expect(opBounds(resizeOp(op, { x: 0, y: 20, w: 50, h: 99 }))).toEqual({ x: 0, y: 20, w: 50, h: 30 }); // width only
  });
});

describe("objects (M3)", () => {
  const page = { width: 595, height: 842 };
  const hl = { id: "h", type: "annot.add", pageKey: "o0", kind: "highlight", color: "#ffeb3b",
    quads: [{ x: 72, y: 90, w: 100, h: 14 }, { x: 72, y: 104, w: 40, h: 14 }] } as ContentOp;

  it("markup bounds cover every quad; markup never moves or resizes", () => {
    expect(opBounds(hl)).toEqual({ x: 72, y: 90, w: 100, h: 28 });
    expect(moveOp(hl, 5, 5)).toBe(hl);
    expect(resizeOp(hl, { x: 0, y: 0, w: 1, h: 1 })).toBe(hl);
    expect(isMarkup(hl)).toBe(true);
    expect(isResizable(hl)).toBe(false);
  });

  it("bounds of markup without quads (or a note without a point) are a zero rect, not NaN/Infinity", () => {
    const base = { id: "e", type: "annot.add", pageKey: "o0", color: "#ffeb3b" };
    for (const quads of [[], null, undefined]) {
      expect(opBounds({ ...base, kind: "highlight", quads } as unknown as ContentOp)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    }
    expect(opBounds({ ...base, kind: "underline", quads: [], point: [5, 7] } as unknown as ContentOp)).toEqual({ x: 5, y: 7, w: 0, h: 0 });
    expect(opBounds({ ...base, kind: "note", point: null } as ContentOp)).toEqual({ x: 0, y: 0, w: NOTE_SIZE, h: NOTE_SIZE });
  });

  it("places notes and symbols on the page", () => {
    const note = noteAt([590, 10], style, "o0", "n", page);
    expect(note).toEqual({ id: "n", type: "annot.add", pageKey: "o0", kind: "note", point: [595 - NOTE_SIZE, 10], color: style.noteColor, content: "" });
    expect(opBounds(note)).toEqual({ x: 579, y: 10, w: 16, h: 16 });
    expect((moveOp(note, 1, 2) as { point: number[] }).point).toEqual([580, 12]);
    expect(isMarkup(note)).toBe(false);
    expect(isResizable(note)).toBe(false);
    const check = symbolAt("check", [100, 5], style, "o0", "c", page);
    expect(check).toEqual({ id: "c", type: "symbol.add", pageKey: "o0", kind: "check", rect: { x: 90, y: 0, w: SYMBOL_SIZE, h: SYMBOL_SIZE }, color: style.symbolColor });
    expect(isResizable(check)).toBe(true);
    expect((resizeOp(check, { x: 1, y: 2, w: 30, h: 30 }) as { rect: unknown }).rect).toEqual({ x: 1, y: 2, w: 30, h: 30 });
  });
});
