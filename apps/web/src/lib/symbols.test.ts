import { describe, expect, it } from "vitest";
import { symbolPaths } from "@/lib/symbols";

describe("symbols", () => {
  it("scales the unit paths into the rect (same numbers as apps/api/tests/test_bake_marks.py)", () => {
    const check = symbolPaths("check", { x: 10, y: 20, w: 50, h: 40 });
    expect(check.paths.map((p) => p.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6])))
      .toEqual([[[16, 40.8], [30, 52], [54, 28]]]);
    expect(check.width).toBeCloseTo(4.8, 9);
    expect(symbolPaths("cross", { x: 0, y: 0, w: 100, h: 100 }).paths).toEqual([[[18, 18], [82, 82]], [[82, 18], [18, 82]]]);
  });
});
