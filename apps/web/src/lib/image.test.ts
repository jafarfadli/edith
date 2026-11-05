import { describe, expect, it } from "vitest";
import { fitImage } from "@/lib/image";

describe("fitImage", () => {
  it("keeps small images at natural size, centered", () => {
    expect(fitImage(100, 40, 600, 800)).toEqual({ x: 262.5, y: 385, w: 75, h: 30 });
  });
  it("shrinks large images to half the page keeping aspect", () => {
    const r = fitImage(4000, 2000, 600, 800);
    expect(r.w).toBeCloseTo(300);
    expect(r.h).toBeCloseTo(150);
    expect(r.x).toBeCloseTo(150);
  });
});
