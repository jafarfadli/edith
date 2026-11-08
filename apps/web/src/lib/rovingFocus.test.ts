import { describe, expect, it } from "vitest";
import { moveIndex } from "@/lib/rovingFocus";

describe("moveIndex", () => {
  it("a vertical menu moves with Up/Down, wrapping, and jumps with Home/End", () => {
    expect(moveIndex("ArrowDown", 0, 3, "vertical")).toBe(1);
    expect(moveIndex("ArrowDown", 2, 3, "vertical")).toBe(0);
    expect(moveIndex("ArrowUp", 0, 3, "vertical")).toBe(2);
    expect(moveIndex("Home", 2, 3, "vertical")).toBe(0);
    expect(moveIndex("End", 0, 3, "vertical")).toBe(2);
  });

  it("Left/Right only move in a grid of swatches, not in a vertical menu", () => {
    expect(moveIndex("ArrowRight", 0, 3, "vertical")).toBeNull();
    expect(moveIndex("ArrowLeft", 0, 3, "vertical")).toBeNull();
    expect(moveIndex("ArrowRight", 2, 3, "both")).toBe(0);
    expect(moveIndex("ArrowLeft", 0, 3, "both")).toBe(2);
    expect(moveIndex("ArrowDown", 1, 3, "both")).toBe(2);
  });

  it("other keys and empty lists do not move", () => {
    expect(moveIndex("Enter", 0, 3, "both")).toBeNull();
    expect(moveIndex("a", 0, 3, "both")).toBeNull();
    expect(moveIndex("ArrowDown", 0, 0, "both")).toBeNull();
  });

  it("from nowhere (-1), Down goes to the first item and Up to the last", () => {
    expect(moveIndex("ArrowDown", -1, 3, "vertical")).toBe(0);
    expect(moveIndex("ArrowUp", -1, 3, "vertical")).toBe(2);
  });
});
