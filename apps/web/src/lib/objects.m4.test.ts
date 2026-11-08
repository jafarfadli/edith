import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import {
  alignDelta, clampToBounds, copyOp, createFromDrag, hasOpacity, hasRotation, isCopyable, isPointOp, isRotatable, mapPoints,
  keepRotatedTopLeft, normalizeRotation, rotateAnchorOffset, opacityOf, polyClick, polyDoubleClick, polyFromPoints, rotatedTopLeft, rotatePoint, rotationOf, visualBounds,
} from "@/lib/objects";
import { DEFAULT_STYLE, type ToolStyle } from "@/store/editor";

const style: ToolStyle = { ...DEFAULT_STYLE, stroke: "#ff0000", fill: "#00ff00", width: 2 };
const rect = (extra: object = {}) => ({ id: "r", type: "shape.add", pageKey: "o0", kind: "rect", rect: { x: 100, y: 100, w: 200, h: 100 }, stroke: "#000000", fill: null, width: 1, ...extra }) as ContentOp;
const ink = { id: "i", type: "ink.add", pageKey: "o0", paths: [[[0, 0], [10, 0]]], color: "#000000", width: 2 } as ContentOp;

describe("objects (M4)", () => {
  it("adds dash and opacity to new shapes only when not the default", () => {
    expect(createFromDrag("rect", [0, 0], [50, 40], style, "o0", "a")).not.toHaveProperty("dash");
    const s = { ...style, dash: "dotted" as const, opacity: 0.5 };
    expect(createFromDrag("rect", [0, 0], [50, 40], s, "o0", "a")).toMatchObject({ dash: "dotted", opacity: 0.5 });
    expect(createFromDrag("line", [0, 0], [50, 40], s, "o0", "a")).toMatchObject({ dash: "dotted", opacity: 0.5 });
  });

  it("builds polygons, polylines and clouds from clicked points", () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 0.2], [5, 8]];
    expect(polyFromPoints("polygon", pts, style, "o0", "p")).toEqual({
      id: "p", type: "shape.add", pageKey: "o0", kind: "polygon", points: [[0, 0], [10, 0], [5, 8]], stroke: "#ff0000", fill: "#00ff00", width: 2,
    });
    expect(polyFromPoints("polyline", pts, style, "o0", "p")).toMatchObject({ kind: "polyline", fill: null });
    expect(polyFromPoints("cloud", pts.slice(0, 2), style, "o0", "p")).toBeNull();
    expect(polyFromPoints("polyline", pts.slice(0, 2), style, "o0", "p")).not.toBeNull();
  });

  it("knows which objects turn and fade", () => {
    expect([hasOpacity(rect()), hasRotation(rect()), isPointOp(rect()), isRotatable(rect())]).toEqual([true, true, false, true]);
    expect([hasOpacity(ink), hasRotation(ink), isPointOp(ink), isRotatable(ink)]).toEqual([true, false, true, true]);
    const white = { id: "w", type: "whiteout.add", pageKey: "o0", rect: { x: 0, y: 0, w: 1, h: 1 } } as ContentOp;
    expect([hasOpacity(white), isRotatable(white)]).toEqual([false, false]);
    expect(rotationOf(rect({ rotation: 30 }))).toBe(30);
    expect(opacityOf(rect())).toBe(1);
    expect(opacityOf(rect({ opacity: 0.25 }))).toBe(0.25);
  });

  it("rotates clockwise on screen", () => {
    const [x, y] = rotatePoint([10, 0], [0, 0], 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(10);
  });

  it("visual bounds include the rotation", () => {
    expect(visualBounds(rect())).toEqual({ x: 100, y: 100, w: 200, h: 100 });
    const b = visualBounds(rect({ rotation: 90 }));
    expect(b.x).toBeCloseTo(150);
    expect(b.y).toBeCloseTo(50);
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(200);
  });

  it("maps points of point objects", () => {
    expect((mapPoints(ink, ([x, y]) => [x + 1, y * 2]) as { paths: number[][][] }).paths).toEqual([[[1, 0], [11, 0]]]);
    expect(mapPoints(rect(), () => [0, 0])).toEqual(rect());
  });

  it("copies objects to another page with a new id", () => {
    const op = rect({ rotation: 15 });
    const copy = copyOp(op, "u-x", "new", 10, 10);
    expect(copy).toMatchObject({ id: "new", pageKey: "u-x", rotation: 15, rect: { x: 110, y: 110, w: 200, h: 100 } });
    expect(op).toEqual(rect({ rotation: 15 })); // the original is untouched
    const edit = { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g0", box: {} } as ContentOp;
    const hl = { id: "h", type: "annot.add", pageKey: "o0", kind: "highlight", quads: [], color: "#ffff00" } as unknown as ContentOp;
    expect([isCopyable(op), isCopyable(edit), isCopyable(hl)]).toEqual([true, false, false]);
  });

  it("aligns bounds to the sides of the page", () => {
    const page = { x: 0, y: 0, w: 600, h: 800 }, b = { x: 100, y: 200, w: 50, h: 20 };
    expect(alignDelta(b, page, "left")).toEqual([-100, 0]);
    expect(alignDelta(b, page, "center")).toEqual([175, 0]);
    expect(alignDelta(b, page, "right")).toEqual([450, 0]);
    expect(alignDelta(b, page, "top")).toEqual([0, -200]);
    expect(alignDelta(b, page, "middle")).toEqual([0, 190]);
    expect(alignDelta(b, page, "bottom")).toEqual([0, 580]);
  });

  it("clamps to the visible part of a cropped page", () => {
    expect(clampToBounds([5, 500], { x: 20, y: 30, w: 100, h: 150 })).toEqual([20, 180]);
  });
});

describe("object transforms (Task 11)", () => {
  it("normalizes a Konva rotation to (-180, 180] in 0.01° steps", () => {
    expect(normalizeRotation(45)).toBe(45);
    expect(normalizeRotation(270)).toBe(-90);
    expect(normalizeRotation(-90)).toBe(-90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(720.004)).toBe(0);
    expect(normalizeRotation(359.999)).toBe(0);
    expect(normalizeRotation(12.3456)).toBe(12.35);
  });

  it("keeps the rotated top-left corner of a box whose height changed", () => {
    const prev = { x: 100, y: 100, w: 200, h: 100 };
    // Not rotated: unchanged.
    expect(keepRotatedTopLeft(prev, { ...prev, h: 140 }, 0)).toEqual({ ...prev, h: 140 });
    const next = keepRotatedTopLeft(prev, { ...prev, h: 140 }, 90);
    expect(next.w).toBe(200);
    expect(next.h).toBe(140);
    const [ax, ay] = rotatedTopLeft(prev, 90), [bx, by] = rotatedTopLeft(next, 90);
    expect(bx).toBeCloseTo(ax, 9);
    expect(by).toBeCloseTo(ay, 9);
    // 90° clockwise around (200, 150): the top-left (100, 100) lands at (250, 50).
    expect(ax).toBeCloseTo(250, 9);
    expect(ay).toBeCloseTo(50, 9);
  });

  it("adds polygon vertices; a click on the first vertex finishes without adding it", () => {
    let st = polyClick("polygon", [], [0, 0], 1);
    expect(st).toEqual({ points: [[0, 0]], finish: false });
    st = polyClick("polygon", st.points, [100, 0], 1);
    // Too few vertices to close: a click near the first one is a vertex.
    expect(polyClick("polygon", st.points, [3, 3], 1)).toEqual({ points: [[0, 0], [100, 0], [3, 3]], finish: false });
    st = polyClick("polygon", st.points, [100, 100], 1);
    expect(polyClick("polygon", st.points, [3, 3], 1)).toEqual({ points: [[0, 0], [100, 0], [100, 100]], finish: true });
    // The close radius is in screen pixels: at zoom 4, 3 pt is 12 px (too far).
    expect(polyClick("polygon", st.points, [3, 0], 4).finish).toBe(false);
    // A polyline closes on its first vertex after two.
    expect(polyClick("polyline", [[0, 0], [50, 0]], [1, 1], 1)).toEqual({ points: [[0, 0], [50, 0]], finish: true });
  });

  it("finishes on a double-click only when its two clicks hit the same spot, dropping the second", () => {
    expect(polyDoubleClick([[0, 0], [100, 0], [100, 100], [101, 101]], 1)).toEqual([[0, 0], [100, 0], [100, 100]]);
    expect(polyDoubleClick([[0, 0], [100, 0], [100, 100], [150, 100]], 1)).toBeNull();
    expect(polyDoubleClick([[0, 0]], 1)).toBeNull();
    expect(polyDoubleClick([], 1)).toBeNull();
    // Same spot = within CLOSE_RADIUS screen pixels.
    expect(polyDoubleClick([[0, 0], [100, 0], [103, 0]], 2)).toEqual([[0, 0], [100, 0]]);
    expect(polyDoubleClick([[0, 0], [100, 0], [103, 0]], 3)).toBeNull();
  });
});

describe("rotation handle placement", () => {
  it("sits above the box when there is room, else below it", () => {
    expect(rotateAnchorOffset(200, 80)).toBe(50);
    expect(rotateAnchorOffset(50, 80)).toBe(50);
    expect(rotateAnchorOffset(49.9, 80)).toBe(-130);
    expect(rotateAnchorOffset(-10, 20)).toBe(-70);
  });
});
