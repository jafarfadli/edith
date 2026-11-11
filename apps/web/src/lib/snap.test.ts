import { describe, expect, it } from "vitest";
import type { Rect } from "@edith/ops";
import { boundsUnion, fmtPt, guidesFor, measure, snapMove, snapResize, spacingFor } from "./snap";

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const PAGE = r(0, 0, 600, 800);
const THR = 5;

describe("boundsUnion", () => {
  it("is the box around all rects (null for none)", () => {
    expect(boundsUnion([r(10, 20, 30, 40), r(100, 5, 10, 10)])).toEqual(r(10, 5, 100, 55));
    expect(boundsUnion([])).toBeNull();
  });
});

describe("fmtPt", () => {
  it("rounds to one decimal and drops a trailing .0", () => {
    expect(fmtPt(12)).toBe("12");
    expect(fmtPt(12.04)).toBe("12");
    expect(fmtPt(12.26)).toBe("12.3");
    expect(fmtPt(-0.01)).toBe("0");
  });
});

describe("snapMove: alignment", () => {
  it("snaps the centre to the page centre, both axes, with page-long guides", () => {
    const s = snapMove(r(272, 396, 50, 10), [], PAGE, THR);
    expect(s.dx).toBe(300 - (272 + 25)); // centre x 297 -> 300
    expect(s.dy).toBe(400 - (396 + 5)); // centre y 401 -> 400
    expect(s.guides).toContainEqual({ axis: "x", pos: 300, from: 0, to: 800 });
    expect(s.guides).toContainEqual({ axis: "y", pos: 400, from: 0, to: 600 });
  });

  it("does not snap beyond the threshold", () => {
    const s = snapMove(r(100, 100, 50, 10), [], PAGE, THR);
    expect(s.dx).toBe(0);
    expect(s.dy).toBe(0);
    expect(s.guides).toEqual([]);
  });

  it("snaps to the page edges", () => {
    const s = snapMove(r(3, 100, 50, 10), [], PAGE, THR);
    expect(s.dx).toBe(-3);
    const t = snapMove(r(548, 100, 50, 10), [], PAGE, THR); // right edge 598 -> 600
    expect(t.dx).toBe(2);
  });

  it("snaps to another object's edge and centre, with a guide spanning both", () => {
    const other = r(200, 300, 100, 40);
    const s = snapMove(r(203, 100, 50, 20), [other], null, THR); // left 203 -> other's left 200
    expect(s.dx).toBe(-3);
    expect(s.guides).toContainEqual({ axis: "x", pos: 200, from: 100, to: 340 });
    const c = snapMove(r(302, 100, 50, 20), [other], null, THR); // left 302 -> other's right edge 300
    expect(c.dx).toBe(-2);
  });

  it("picks the nearest of several candidates", () => {
    const a = r(190, 0, 20, 10), b = r(194, 50, 14, 10); // stops 190/200/210 and 194/201/208
    const s = snapMove(r(206, 100, 20, 20), [a, b], null, THR); // left 206: b's right 208 is 2 away, a's right 210 is 4 away
    expect(s.dx).toBe(2);
  });

  it("compares top/middle/bottom the same way", () => {
    const other = r(0, 300, 100, 40); // top 300, middle 320, bottom 340
    const s = snapMove(r(400, 303, 50, 20), [other], null, THR); // top 303 -> 300
    expect(s.dy).toBe(-3);
    const m = snapMove(r(400, 311, 50, 20), [other], null, THR); // middle 321 -> 320
    expect(m.dy).toBe(-1);
  });

  it("shows a guide for everything aligned after the snap, not only the snapped line", () => {
    const a = r(200, 0, 40, 40), b = r(200, 500, 40, 40);
    const s = snapMove(r(202, 200, 40, 40), [a, b], null, THR);
    const g = s.guides.find((x) => x.axis === "x" && x.pos === 200)!;
    expect(g.from).toBe(0);
    expect(g.to).toBe(540);
  });
});

describe("snapMove: equal spacing", () => {
  it("centres between two objects (equal gaps) and reports both gaps", () => {
    const a = r(0, 100, 100, 50), b = r(300, 100, 100, 50); // gap a-b = 200
    const s = snapMove(r(172, 100, 50, 50), [a, b], null, THR); // equal gaps: x = 100 + (200-50)/2 = 175
    expect(s.dx).toBe(3);
    expect(s.gaps).toContainEqual({ axis: "x", from: 100, to: 175, at: 125 });
    expect(s.gaps).toContainEqual({ axis: "x", from: 225, to: 300, at: 125 });
  });

  it("repeats an existing gap to the right of the last object", () => {
    const a = r(0, 100, 50, 50), b = r(80, 100, 50, 50); // gap 30
    const s = snapMove(r(162, 100, 50, 50), [a, b], null, THR); // 130 + 30 = 160
    expect(s.dx).toBe(-2);
    expect(s.gaps).toContainEqual({ axis: "x", from: 50, to: 80, at: 125 }); // the existing gap
    expect(s.gaps).toContainEqual({ axis: "x", from: 130, to: 160, at: 125 }); // the new one
  });

  it("repeats a gap above (vertical)", () => {
    const a = r(100, 0, 50, 50), b = r(100, 90, 50, 50); // gap 40
    const s = snapMove(r(100, 183, 50, 50), [a, b], null, THR); // 140 + 40 = 180
    expect(s.dy).toBe(-3);
    expect(s.gaps.every((g) => g.axis === "y")).toBe(true);
    expect(s.gaps.length).toBe(2);
  });

  it("ignores objects that are not in the same row (no overlap across)", () => {
    const a = r(0, 400, 100, 50), b = r(300, 400, 100, 50);
    const s = snapMove(r(147, 100, 50, 50), [a, b], null, THR);
    expect(s.dx).toBe(0);
    expect(s.gaps).toEqual([]);
  });

  it("does not make a negative gap", () => {
    const a = r(0, 100, 100, 50), b = r(110, 100, 100, 50); // 10 between, box is 50 wide
    const s = snapMove(r(80, 100, 50, 50), [a, b], null, THR);
    expect(s.gaps).toEqual([]);
  });

  it("an alignment closer than a spacing snap wins", () => {
    const a = r(0, 100, 100, 50), b = r(300, 100, 100, 50);
    const wall = r(176, 300, 10, 10); // left 176 is 1 from the spacing position 175... and 2 from the box at 174
    const s = snapMove(r(174, 100, 50, 50), [a, b, wall], null, THR);
    expect(s.dx).toBe(1); // spacing (175) is |1|, the wall's left (176) is |2|: spacing is nearer
    const t = snapMove(r(177, 100, 50, 50), [a, b, wall], null, THR);
    expect(t.dx).toBe(-1); // wall's left 176 (1 away) vs spacing 175 (2 away)
  });
});

describe("guidesFor / spacingFor are what is exactly true now", () => {
  it("guidesFor finds only exact alignments", () => {
    expect(guidesFor(r(10, 10, 20, 20), [r(10, 100, 5, 5)], null)).toEqual([{ axis: "x", pos: 10, from: 10, to: 105 }]);
    expect(guidesFor(r(11, 10, 20, 20), [r(10, 100, 5, 5)], null)).toEqual([]);
  });

  it("spacingFor needs equal gaps", () => {
    const a = r(0, 0, 10, 10), b = r(30, 0, 10, 10);
    expect(spacingFor(r(20 + 30, 0, 10, 10), [a, b])).toEqual([]); // not equal: 10 vs 10? a-b gap 20, b-box gap 10
    expect(spacingFor(r(60, 0, 10, 10), [a, b]).length).toBe(2); // 20 and 20
  });
});

describe("snapResize", () => {
  it("snaps the edge that moved to the page edge / centre / another object", () => {
    const old = r(100, 100, 100, 50);
    const s = snapResize(old, r(100, 100, 197, 50), [], PAGE, THR); // right edge 297 -> centre 300
    expect(s.rect).toEqual(r(100, 100, 200, 50));
    expect(s.guides).toContainEqual({ axis: "x", pos: 300, from: 0, to: 800 });
  });

  it("leaves the edges that did not move alone", () => {
    const old = r(2, 100, 100, 50); // left edge 2 from the page edge
    const s = snapResize(old, r(2, 100, 140, 50), [], PAGE, THR);
    expect(s.rect.x).toBe(2);
  });

  it("snaps the left edge (x and w change together)", () => {
    const old = r(100, 100, 100, 50);
    const s = snapResize(old, r(52, 100, 148, 50), [r(50, 300, 10, 10)], null, THR);
    expect(s.rect).toEqual(r(50, 100, 150, 50));
  });

  it("snaps the bottom edge", () => {
    const old = r(100, 100, 100, 50);
    const s = snapResize(old, r(100, 100, 100, 98), [r(0, 200, 10, 10)], null, THR); // bottom 198 -> 200
    expect(s.rect).toEqual(r(100, 100, 100, 100));
  });

  it("does not collapse the box", () => {
    const old = r(100, 100, 100, 50);
    const s = snapResize(old, r(100, 100, 3, 50), [r(103, 0, 0, 10), r(99, 0, 0, 10)], null, THR);
    expect(s.rect.w).toBeGreaterThanOrEqual(1);
  });
});

describe("measure (Alt: distances to the hovered object)", () => {
  it("gives the gap between two separate boxes", () => {
    const g = measure(r(0, 0, 50, 50), r(100, 10, 50, 30));
    expect(g).toContainEqual({ axis: "x", from: 50, to: 100, at: 25 + 0 }); // cross-overlap 10..40 -> mid 25
  });

  it("gives the four distances of a box inside another", () => {
    const g = measure(r(40, 40, 20, 20), r(0, 0, 100, 100));
    expect(g.map((x) => [x.axis, x.to - x.from].join(":")).sort()).toEqual(["x:40", "x:40", "y:40", "y:40"]);
  });

  it("nothing for identical boxes", () => {
    expect(measure(r(0, 0, 10, 10), r(0, 0, 10, 10))).toEqual([]);
  });
});
