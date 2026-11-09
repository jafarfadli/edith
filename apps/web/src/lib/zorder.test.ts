import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { compact } from "@/lib/compact";
import { nextBelow, reorder, stacked, zMoveForKey, zMoves, zStage } from "@/lib/zorder";

const R = { x: 0, y: 0, w: 10, h: 10 };
const rect = (id: string, pageKey = "o0"): ContentOp =>
  ({ id, type: "shape.add", pageKey, kind: "rect", rect: R, stroke: "#000000", fill: null, width: 1 }) as ContentOp;
const hl = (id: string, pageKey = "o0"): ContentOp =>
  ({ id, type: "annot.add", pageKey, kind: "highlight", quads: [R], color: "#ffeb3b" }) as ContentOp;
const redact = (id: string, pageKey = "o0"): ContentOp => ({ id, type: "redact.add", pageKey, rect: R, fill: "black" }) as ContentOp;
const link = (id: string, pageKey = "o0"): ContentOp => ({ id, type: "link.add", pageKey, rect: R, target: { url: "https://a.b" } }) as ContentOp;

function doc(...ops: ContentOp[]) {
  return { order: ops.map((o) => o.id), objects: Object.fromEntries(ops.map((o) => [o.id, o])) };
}

describe("reorder", () => {
  const d = doc(rect("a"), rect("b"), rect("c"), rect("d"));

  it("moves one object to the front, the back, one step up and down", () => {
    expect(reorder(d, ["b"], "front")).toEqual(["a", "c", "d", "b"]);
    expect(reorder(d, ["c"], "back")).toEqual(["c", "a", "b", "d"]);
    expect(reorder(d, ["b"], "forward")).toEqual(["a", "c", "b", "d"]);
    expect(reorder(d, ["c"], "backward")).toEqual(["a", "c", "b", "d"]);
  });

  it("is a no-op (null) at the ends and for unknown ids", () => {
    expect(reorder(d, ["d"], "front")).toBeNull();
    expect(reorder(d, ["d"], "forward")).toBeNull();
    expect(reorder(d, ["a"], "back")).toBeNull();
    expect(reorder(d, ["a"], "backward")).toBeNull();
    expect(reorder(d, ["zz"], "front")).toBeNull();
    expect(reorder(d, [], "front")).toBeNull();
    expect(reorder(d, ["zz", "a"], "front")).toEqual(["b", "c", "d", "a"]); // the unknown id is ignored
  });

  it("moves a group keeping its relative order", () => {
    expect(reorder(d, ["c", "a"], "front")).toEqual(["b", "d", "a", "c"]);
    expect(reorder(d, ["d", "b"], "back")).toEqual(["b", "d", "a", "c"]);
    // A block climbs past one object as a whole; separated members each climb one.
    expect(reorder(d, ["a", "b"], "forward")).toEqual(["c", "a", "b", "d"]);
    expect(reorder(d, ["a", "c"], "forward")).toEqual(["b", "a", "d", "c"]);
    expect(reorder(d, ["c", "d"], "backward")).toEqual(["a", "c", "d", "b"]);
    // Already together at the top: nothing to pass.
    expect(reorder(d, ["c", "d"], "front")).toBeNull();
    expect(reorder(d, ["c", "d"], "forward")).toBeNull();
  });

  it("only swaps with objects of the same page, other pages keep their slots", () => {
    const p = doc(rect("a"), rect("x", "o1"), rect("b"), rect("y", "o1"), rect("c"));
    expect(reorder(p, ["a"], "front")).toEqual(["b", "x", "c", "y", "a"]);
    expect(reorder(p, ["a"], "forward")).toEqual(["b", "x", "a", "y", "c"]);
    expect(reorder(p, ["y"], "back")).toEqual(["a", "y", "b", "x", "c"]);
    expect(reorder(p, ["c"], "front")).toBeNull(); // the top of page o0, though "y" (o1) follows it nowhere
    expect(reorder(p, ["y"], "front")).toBeNull();
    // A selection on two pages moves on each.
    expect(reorder(p, ["a", "x"], "front")).toEqual(["b", "y", "c", "x", "a"]);
  });

  it("only swaps with objects of the same bake stage", () => {
    const m = doc(rect("a"), hl("h"), rect("b"), redact("r"), link("l"));
    expect(reorder(m, ["a"], "front")).toEqual(["b", "h", "a", "r", "l"]); // past "b", not the highlight
    expect(reorder(m, ["h"], "back")).toBeNull(); // the only annotation on the page
    expect(reorder(m, ["r"], "front")).toBeNull();
    expect(zMoves(m, ["h"])).toEqual({ front: false, forward: false, backward: false, back: false });
    expect(zMoves(m, ["b"])).toEqual({ front: false, forward: false, backward: true, back: true });
  });

  it("keeps the order array consistent (same ids, each once)", () => {
    const p = doc(rect("a"), rect("x", "o1"), hl("h"), rect("b"), rect("y", "o1"), rect("c"));
    for (const move of ["front", "forward", "backward", "back"] as const) {
      for (const ids of [["a"], ["b", "y"], ["c", "h"], ["a", "b", "c"]]) {
        const out = reorder(p, ids, move) ?? p.order;
        expect([...out].sort()).toEqual([...p.order].sort());
      }
    }
  });

  it("feeds the export: compact emits the new order", () => {
    const pages = [{ pageKey: "o0", src: { doc: "D", index: 0 }, rotate: 0 as const }];
    const base = doc(rect("a"), rect("b"));
    const order = reorder(base, ["a"], "front")!;
    expect(compact({ pages, ...base, order }).slice(1).map((o) => o.id)).toEqual(["b", "a"]);
  });
});

describe("stacked / zStage", () => {
  it("stacks redactions, drawn objects, annotations, links (stable within each)", () => {
    const ops = [hl("h1"), link("l"), rect("a"), redact("r"), hl("h2"), rect("b")];
    expect(stacked(ops).map((o) => o.id)).toEqual(["r", "a", "b", "h1", "h2", "l"]);
    expect(ops.map(zStage)).toEqual(["annot", "link", "draw", "redact", "annot", "draw"]);
  });
});

describe("nextBelow", () => {
  it("cycles downwards through the stack, from the topmost when the selection is elsewhere", () => {
    expect(nextBelow(["top", "mid", "low"], "top")).toBe("mid");
    expect(nextBelow(["top", "mid", "low"], "mid")).toBe("low");
    expect(nextBelow(["top", "mid", "low"], "low")).toBe("top");
    expect(nextBelow(["top", "mid", "low"], null)).toBe("mid");
    expect(nextBelow(["top", "mid", "low"], "other")).toBe("mid");
    expect(nextBelow(["only"], "only")).toBe("only");
    expect(nextBelow([], "a")).toBeNull();
  });
});

describe("zMoveForKey", () => {
  const k = (key: string, mod: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    zMoveForKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mod });
  it("maps Ctrl/Cmd (+Shift) + brackets", () => {
    expect(k("]", { ctrlKey: true })).toBe("forward");
    expect(k("[", { metaKey: true })).toBe("backward");
    expect(k("}", { ctrlKey: true, shiftKey: true })).toBe("front");
    expect(k("{", { metaKey: true, shiftKey: true })).toBe("back");
    expect(k("]", { ctrlKey: true, shiftKey: true })).toBe("front");
  });
  it("ignores other keys and missing or extra modifiers", () => {
    expect(k("]")).toBeNull();
    expect(k("]", { ctrlKey: true, altKey: true })).toBeNull();
    expect(k("+", { ctrlKey: true })).toBeNull();
  });
});
