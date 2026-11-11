import { describe, expect, it } from "vitest";
import type { Rect } from "@edith/ops";
import { alignMoves, cycleSelection, distributeMoves, marqueeHits, readingOrder } from "./arrange";

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const item = (id: string, rect: Rect) => ({ id, rect });

describe("marqueeHits", () => {
  const items = [item("a", r(10, 10, 20, 20)), item("b", r(100, 100, 20, 20)), item("c", r(50, 50, 0, 40))];

  it("selects what the marquee touches, not only what it holds", () => {
    expect(marqueeHits(r(25, 25, 100, 100), items)).toEqual(["a", "b", "c"]); // a is only clipped by it
  });

  it("an edge that just meets the marquee counts (a line has no width)", () => {
    expect(marqueeHits(r(50, 60, 30, 10), items)).toEqual(["c"]);
  });

  it("selects nothing in empty space", () => {
    expect(marqueeHits(r(200, 200, 10, 10), items)).toEqual([]);
  });

  it("skips an object that holds the whole marquee (a page-sized scan under it)", () => {
    const all = [item("scan", r(0, 0, 600, 800)), item("a", r(10, 10, 20, 20))];
    expect(marqueeHits(r(5, 5, 40, 40), all)).toEqual(["a"]);
    expect(marqueeHits(r(5, 5, 4, 4), all)).toEqual([]);
  });

  it("a marquee wider than the scan does select it", () => {
    expect(marqueeHits(r(-10, -10, 700, 900), [item("scan", r(0, 0, 600, 800))])).toEqual(["scan"]);
  });
});

describe("alignMoves", () => {
  const rects = { a: r(10, 10, 20, 20), b: r(100, 50, 40, 10), c: r(60, 200, 10, 30) };
  const ref = r(10, 10, 130, 220); // their union

  it("left / right / centre", () => {
    expect(alignMoves(rects, "left", ref)).toEqual({ a: [0, 0], b: [-90, 0], c: [-50, 0] });
    expect(alignMoves(rects, "right", ref)).toEqual({ a: [110, 0], b: [0, 0], c: [70, 0] });
    expect(alignMoves(rects, "center", ref)).toEqual({ a: [55, 0], b: [-45, 0], c: [10, 0] }); // centre x 75
  });

  it("top / bottom / middle", () => {
    expect(alignMoves(rects, "top", ref)).toEqual({ a: [0, 0], b: [0, -40], c: [0, -190] });
    expect(alignMoves(rects, "bottom", ref)).toEqual({ a: [0, 200], b: [0, 170], c: [0, 0] });
    expect(alignMoves(rects, "middle", ref)).toEqual({ a: [0, 100], b: [0, 65], c: [0, -95] }); // centre y 120
  });
});

describe("distributeMoves", () => {
  it("evens out the gaps between three, keeping the outer two", () => {
    const m = distributeMoves([item("a", r(0, 0, 10, 10)), item("b", r(20, 0, 10, 10)), item("c", r(100, 0, 10, 10))], "x");
    // 110 span - 30 widths = 80 free, 40 each: b goes to x 50
    expect(m).toEqual({ a: 0, b: 30, c: 0 });
  });

  it("orders by position, not by the order given", () => {
    const m = distributeMoves([item("c", r(100, 0, 10, 10)), item("a", r(0, 0, 10, 10)), item("b", r(20, 0, 10, 10))], "x");
    expect(m).toEqual({ a: 0, b: 30, c: 0 });
  });

  it("works vertically with different heights", () => {
    const m = distributeMoves([item("a", r(0, 0, 10, 10)), item("b", r(0, 12, 10, 30)), item("c", r(0, 90, 10, 10))], "y");
    // span 100 - 50 heights = 50 free, 25 each: b top = 35
    expect(m).toEqual({ a: 0, b: 23, c: 0 });
  });

  it("needs three objects", () => {
    expect(distributeMoves([item("a", r(0, 0, 10, 10)), item("b", r(50, 0, 10, 10))], "x")).toEqual({});
  });
});

describe("readingOrder / cycleSelection", () => {
  const items = [item("c", r(10, 200, 10, 10)), item("b", r(200, 10, 10, 10)), item("a", r(10, 10, 10, 10))];

  it("reads top to bottom, then left to right", () => {
    expect(readingOrder(items)).toEqual(["a", "b", "c"]);
  });

  it("Tab goes to the next, wrapping; Shift+Tab to the previous", () => {
    const order = readingOrder(items);
    expect(cycleSelection(order, "a", 1)).toBe("b");
    expect(cycleSelection(order, "c", 1)).toBe("a");
    expect(cycleSelection(order, "a", -1)).toBe("c");
  });

  it("starts at the ends with nothing (or something unknown) selected", () => {
    const order = readingOrder(items);
    expect(cycleSelection(order, null, 1)).toBe("a");
    expect(cycleSelection(order, null, -1)).toBe("c");
    expect(cycleSelection(order, "gone", 1)).toBe("a");
    expect(cycleSelection([], "a", 1)).toBeNull();
  });
});
