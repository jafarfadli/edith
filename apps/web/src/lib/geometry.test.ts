import { describe, expect, it } from "vitest";
import { cloudBeziers, dashPattern, KAPPA, signedArea2, type Pt } from "@/lib/geometry";
import { CLOUD_PARITY } from "@/lib/fixtures/cloudParity";

// Shared contract with apps/api/tests/test_bake_shapes.py: same inputs, same numbers.
const SQUARE: Pt[] = [[0, 0], [20, 0], [20, 20], [0, 20]];

describe("geometry", () => {
  it("dash patterns", () => {
    expect(dashPattern("solid", 2)).toBeNull();
    expect(dashPattern(undefined, 2)).toBeNull();
    expect(dashPattern("dashed", 2)).toEqual({ dash: [6, 4], lineCap: "butt" });
    expect(dashPattern("dotted", 2)).toEqual({ dash: [0, 4], lineCap: "round" });
    expect(dashPattern("dashed", 0)).toEqual({ dash: [1.5, 1], lineCap: "butt" });
  });

  it("dash values are rounded to 6 significant digits like the bake's `:g`", () => {
    // Python (dashes_arg) for w = 0.7777777777: "[2.33333 1.55556] 0" and "[0 1.55556] 0".
    expect(dashPattern("dashed", 0.7777777777)?.dash).toEqual([2.33333, 1.55556]);
    expect(dashPattern("dotted", 0.7777777777)?.dash).toEqual([0, 1.55556]);
    expect(dashPattern("dashed", 123456.789)?.dash).toEqual([370370, 246914]);
  });

  it("cloud of a square", () => {
    expect(signedArea2(SQUARE)).toBe(800);
    const arcs = cloudBeziers(SQUARE, 1);
    expect(arcs).toHaveLength(16);
    const k = KAPPA * 5;
    expect(arcs[0][0]).toEqual([0, 0]);
    expect(arcs[0][3]).toEqual([5, -5]);
    expect(arcs[0][1][0]).toBeCloseTo(0);
    expect(arcs[0][1][1]).toBeCloseTo(-k);
    expect(arcs[0][2][0]).toBeCloseTo(5 - k);
    expect(arcs[0][2][1]).toBeCloseTo(-5);
    expect(arcs[1][3]).toEqual([10, 0]);
    expect(arcs[15][3][0]).toBeCloseTo(0);
    expect(arcs[15][3][1]).toBeCloseTo(0);
  });

  it("bulges outward for either winding", () => {
    const ccw = [...SQUARE].reverse();
    expect(cloudBeziers(ccw, 1)[0][3]).toEqual([5, 25]);
    for (const b of cloudBeziers(ccw, 1).filter((_, i) => i % 2 === 0)) {
      const [x, y] = b[3];
      expect(x > 0 && x < 20 && y > 0 && y < 20).toBe(false);
    }
  });

  it("short and zero-length edges", () => {
    expect(cloudBeziers([[0, 0], [4, 0], [2, 3]], 1)).toHaveLength(6);
    expect(cloudBeziers([[0, 0], [0, 0], [4, 0], [2, 3]], 1)[0][0]).toEqual([0, 0]);
  });

  it("rounds the chord count half up (Python's round would go to even)", () => {
    // arc = 10, edge 25: 25 / 10 + 0.5 = 3 -> 3 chords (banker's round(2.5) would give 2).
    expect(cloudBeziers([[0, 0], [25, 0], [25, 15]], 1).length).toBe(2 * (3 + 2 + 3));
  });

  it("matches the API's cloud_beziers number for number", () => {
    for (const { points, width, beziers } of CLOUD_PARITY) {
      const got = cloudBeziers(points, width);
      expect(got).toHaveLength(beziers.length);
      got.forEach((b, i) => b.forEach((p, j) => {
        expect(p[0]).toBeCloseTo(beziers[i][j][0], 9);
        expect(p[1]).toBeCloseTo(beziers[i][j][1], 9);
      }));
    }
  });
});
