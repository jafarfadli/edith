import { describe, expect, it } from "vitest";
import { decorBands } from "@/lib/textDecor";

const run = { text: "x", font: { kind: "bundled" as const, family: "Arimo" }, size: 20, color: "#000000" };

describe("decorBands", () => {
  it("matches the API bake geometry (bake/text.py BG_ASCENT, UNDERLINE_TOP, STRIKE_TOP, DECOR_THICKNESS)", () => {
    const d = decorBands(105, 215, 50, { ...run, bgColor: "#ffff00", underline: true, strike: true });
    expect(d.bg).toEqual({ x: 105, y: 197, w: 50, h: 23 });
    expect(d.underline!.y).toBeCloseTo(216.5);
    expect(d.underline!.h).toBeCloseTo(1.2);
    expect(d.strike!.y).toBeCloseTo(209);
  });

  it("is empty for a plain run", () => {
    expect(decorBands(0, 0, 10, run)).toEqual({});
  });
});
