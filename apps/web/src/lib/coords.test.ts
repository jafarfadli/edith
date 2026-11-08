import { describe, expect, it } from "vitest";
import { cropOffset, groupTransform, normRotation, pageBounds, screenSize, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";

const W = 200, H = 300;
const g = (rotation: 0 | 90 | 180 | 270): PageGeom => ({ width: W, height: H, rotation });

function applyGroup(p: Pt, t: ReturnType<typeof groupTransform>): Pt {
  const r = (t.rotation * Math.PI) / 180;
  const x = p[0] * t.scale, y = p[1] * t.scale;
  return [t.x + x * Math.cos(r) - y * Math.sin(r), t.y + x * Math.sin(r) + y * Math.cos(r)];
}

describe("coords", () => {
  it("normalizes rotation", () => {
    expect(normRotation(-90)).toBe(270);
    expect(normRotation(450)).toBe(90);
    expect(normRotation(360)).toBe(0);
  });

  it("swaps screen size for 90/270", () => {
    expect(screenSize(g(0), 2)).toEqual({ width: 400, height: 600 });
    expect(screenSize(g(90), 2)).toEqual({ width: 600, height: 400 });
  });

  it("maps corners clockwise", () => {
    expect(toScreen([0, 0], g(90), 1)).toEqual([H, 0]);   // top-left goes to top-right
    expect(toScreen([0, H], g(90), 1)).toEqual([0, 0]);   // bottom-left goes to top-left
    expect(toScreen([0, 0], g(180), 1)).toEqual([W, H]);
    expect(toScreen([0, 0], g(270), 1)).toEqual([0, W]);
    expect(toScreen([10, 20], g(0), 2)).toEqual([20, 40]);
  });

  it("round-trips for every rotation and scale", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      for (const s of [0.5, 1, 1.75]) {
        const p: Pt = [37, 121];
        const back = toPage(toScreen(p, g(rot), s), g(rot), s);
        expect(back[0]).toBeCloseTo(37);
        expect(back[1]).toBeCloseTo(121);
      }
    }
  });

  it("groupTransform agrees with toScreen", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const t = groupTransform(g(rot), 1.5);
      for (const p of [[0, 0], [W, 0], [13, 250]] as Pt[]) {
        const a = applyGroup(p, t), b = toScreen(p, g(rot), 1.5);
        expect(a[0]).toBeCloseTo(b[0]);
        expect(a[1]).toBeCloseTo(b[1]);
      }
    }
  });
});

describe("coords with a crop", () => {
  const crop = { x: 20, y: 30, w: 100, h: 150 };
  const cg = (rotation: 0 | 90 | 180 | 270): PageGeom => ({ width: W, height: H, rotation, crop });

  function applyCroppedGroup(p: Pt, t: ReturnType<typeof groupTransform>): Pt {
    return applyGroup([p[0] - t.offsetX, p[1] - t.offsetY], t);
  }

  it("shows only the crop", () => {
    expect(screenSize(cg(0), 2)).toEqual({ width: 200, height: 300 });
    expect(screenSize(cg(90), 1)).toEqual({ width: 150, height: 100 });
    expect(pageBounds(cg(0))).toEqual(crop);
    expect(pageBounds(g(0))).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it("puts the crop's corner at the screen origin", () => {
    expect(toScreen([20, 30], cg(0), 1)).toEqual([0, 0]);
    expect(toScreen([20, 180], cg(90), 1)).toEqual([0, 0]); // bottom-left of the crop is top-left on screen
    expect(toScreen([120, 30], cg(270), 1)).toEqual([0, 0]);
  });

  it("round-trips and agrees with groupTransform", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      for (const s of [0.5, 1.5]) {
        const p: Pt = [57, 101];
        const back = toPage(toScreen(p, cg(rot), s), cg(rot), s);
        expect(back[0]).toBeCloseTo(57);
        expect(back[1]).toBeCloseTo(101);
        const a = applyCroppedGroup(p, groupTransform(cg(rot), s)), b = toScreen(p, cg(rot), s);
        expect(a[0]).toBeCloseTo(b[0]);
        expect(a[1]).toBeCloseTo(b[1]);
      }
    }
  });

  it("offsets the full-page canvas so the crop shows", () => {
    expect(cropOffset(g(0), 1)).toEqual([0, 0]);
    expect(cropOffset(cg(0), 2)).toEqual([-40, -60]);
    // 90 degrees: the full page is H wide on screen; the crop's bottom edge (y = 180) maps to screen x = H - 180.
    expect(cropOffset(cg(90), 1)).toEqual([-(H - 180), -20]);
    for (const rot of [0, 90, 180, 270] as const) {
      // The page point under the visible origin is the same whether drawn whole (shifted) or cropped.
      const full: PageGeom = { width: W, height: H, rotation: rot };
      const [ox, oy] = cropOffset(cg(rot), 1);
      const p = toPage([-ox, -oy], full, 1), q = toPage([0, 0], cg(rot), 1);
      expect(p[0]).toBeCloseTo(q[0]);
      expect(p[1]).toBeCloseTo(q[1]);
    }
  });
});
