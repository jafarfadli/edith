import { describe, expect, it } from "vitest";
import { markupLine } from "@/lib/markup";

describe("markupLine", () => {
  it("matches MuPDF's underline/strike appearance (13.8 pt quad: width 0.8625, 1.971 / 5.914 above the bottom)", () => {
    const q = { x: 72, y: 89.2, w: 100, h: 13.8 };
    const u = markupLine("underline", q), s = markupLine("strike", q);
    expect(u.h).toBeCloseTo(0.8625, 4);
    expect(u.y + u.h / 2).toBeCloseTo(103 - 1.9714, 3);
    expect(s.y + s.h / 2).toBeCloseTo(103 - 5.9143, 3);
    expect([u.x, u.w]).toEqual([72, 100]);
  });
});
