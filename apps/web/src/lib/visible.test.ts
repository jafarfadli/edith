import { describe, expect, it } from "vitest";
import { pickVisible, pruneRatios } from "@/lib/visible";

describe("pickVisible", () => {
  it("picks the key with the highest ratio", () => {
    const r = new Map([["a", 0.2], ["b", 0.9], ["c", 0.5]]);
    expect(pickVisible(r, new Set(["a", "b", "c"]))).toBe("b");
  });

  it("returns null when nothing is visible", () => {
    expect(pickVisible(new Map([["a", 0]]), new Set(["a"]))).toBeNull();
    expect(pickVisible(new Map(), new Set(["a"]))).toBeNull();
  });

  it("ignores and removes stale keys", () => {
    const r = new Map([["gone", 1], ["b", 0.3]]);
    expect(pickVisible(r, new Set(["b"]))).toBe("b");
    expect(r.has("gone")).toBe(false);
  });
});

describe("pruneRatios", () => {
  it("drops keys not in the page set", () => {
    const r = new Map([["a", 1], ["b", 1]]);
    pruneRatios(r, new Set(["b"]));
    expect([...r.keys()]).toEqual(["b"]);
  });
});
