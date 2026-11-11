import { describe, expect, it } from "vitest";
import { dominantColor, stripsAround } from "./pageBackground";

const px = (...c: [number, number, number, number?][]) => c.flatMap(([r, g, b, a]) => [r, g, b, a ?? 255]);

describe("dominantColor", () => {
  it("is the background around ink: the most common colour wins", () => {
    const tint = [250, 240, 200] as [number, number, number];
    const got = dominantColor(px(tint, tint, tint, tint, [0, 0, 0], [20, 20, 20]));
    expect(got).toBe("#faf0c8");
  });
  it("averages the shades of one bucket", () => {
    expect(dominantColor(px([200, 200, 200], [202, 202, 202]))).toBe("#c9c9c9");
  });
  it("skips transparent pixels, and is null with nothing opaque", () => {
    expect(dominantColor(px([10, 10, 10, 0], [10, 10, 10, 0]))).toBeNull();
    expect(dominantColor([])).toBeNull();
  });
});

describe("stripsAround", () => {
  it("gives the four strips outside the rect, not touching it", () => {
    const [left, right, above, below] = stripsAround({ x: 100, y: 50, w: 80, h: 14 });
    expect(left.x + left.w).toBeLessThan(100);
    expect(right.x).toBeGreaterThan(180);
    expect(above.y + above.h).toBeLessThan(50);
    expect(below.y).toBeGreaterThan(64);
  });
});
