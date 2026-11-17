import { describe, expect, it } from "vitest";
import { clearPaper } from "./clearPaper";

/** A sheet `w` × `h`, lit from the left (paper 240 falling to 170), with a blue stroke across rows 40-44, x 30-170. */
function photo(w = 200, h = 100) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const paper = 240 - (70 * x) / w;
      const ink = y >= 40 && y <= 44 && x >= 30 && x <= 170;
      d[i] = ink ? paper * 0.15 : paper;
      d[i + 1] = ink ? paper * 0.25 : paper;
      d[i + 2] = ink ? paper * 0.75 : paper - 4;
      d[i + 3] = 255;
    }
  }
  return d;
}

const at = (d: Uint8ClampedArray, w: number, x: number, y: number) => [...d.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];

describe("clearPaper", () => {
  it("leaves the ink, its colour kept, and clears the paper on both the bright and the shaded side", () => {
    const d = photo();
    const box = clearPaper(d, 200, 100);
    expect(box).toEqual({ x: 30, y: 40, w: 141, h: 5 });
    expect(at(d, 200, 10, 10)[3]).toBe(0); // bright paper
    expect(at(d, 200, 190, 90)[3]).toBe(0); // shaded paper
    const [r, , b, a] = at(d, 200, 100, 42);
    expect(a).toBe(255);
    expect(b).toBeGreaterThan(r + 60); // still blue
  });

  it("finds nothing on a blank sheet", () => {
    const d = new Uint8ClampedArray(64 * 64 * 4).fill(230);
    expect(clearPaper(d, 64, 64)).toBeNull();
    expect(d.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });
});
