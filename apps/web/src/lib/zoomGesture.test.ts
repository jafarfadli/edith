import { describe, expect, it } from "vitest";
import { clampZoom, scrollFor, wheelFactor } from "./zoomGesture";

describe("wheelFactor", () => {
  it("zooms in on wheel up and out on wheel down", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
  });

  it("counts a mouse notch as a step of about 10 % whatever the mode", () => {
    for (const f of [wheelFactor(-100, 0), wheelFactor(-3, 1), wheelFactor(-1, 2)]) expect(f).toBeCloseTo(1.105, 2);
  });

  it("makes a trackpad pinch event a small step", () => {
    expect(wheelFactor(-2)).toBeCloseTo(1.01, 2);
  });

  it("zooming in and out by the same amount comes back", () => {
    expect(wheelFactor(-7) * wheelFactor(7)).toBeCloseTo(1, 10);
  });
});

describe("clampZoom", () => {
  it("keeps the zoom between 25 % and 400 %", () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe("scrollFor", () => {
  it("scrolls by how far the anchored point moved from under the pointer", () => {
    // The pointer is at (300, 200) of the scroller, on the page's centre; the page, now twice as large, lies at (-100, 50).
    const anchor = { cx: 300, cy: 200, fx: 0.5, fy: 0.5, page: "p" };
    expect(scrollFor(anchor, { left: -100, top: 50, width: 1000, height: 1400 })).toEqual({ dx: 100, dy: 550 });
  });

  it("does not scroll when the point is already under the pointer", () => {
    const anchor = { cx: 300, cy: 200, fx: 0.25, fy: 0.5, page: null };
    expect(scrollFor(anchor, { left: 50, top: -500, width: 1000, height: 1400 })).toEqual({ dx: 0, dy: 0 });
  });
});
