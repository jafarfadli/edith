import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { compact } from "@/lib/compact";
import { formatKeys } from "@/lib/keys";
import { nextBelow, reorder, stacked, zKeys, zMoveForKey, zMoves, zStage } from "@/lib/zorder";

const R = { x: 0, y: 0, w: 10, h: 10 };
const rect = (id: string, pageKey = "o0", r = R, extra: Record<string, unknown> = {}): ContentOp =>
  ({ id, type: "shape.add", pageKey, kind: "rect", rect: r, stroke: "#000000", fill: null, width: 1, ...extra }) as ContentOp;
const at = (x: number, y: number, w = 10, h = 10) => ({ x, y, w, h });
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

describe("reorder: one step goes past the next object it overlaps", () => {
  // a and b overlap each other; c (elsewhere on the page) sits between them in the order.
  const a = rect("a", "o0", at(0, 0, 50, 50)), c = rect("c", "o0", at(200, 200)), b = rect("b", "o0", at(25, 25, 50, 50));

  it("skips objects it does not overlap", () => {
    const d = doc(a, c, b);
    expect(reorder(d, ["a"], "forward")).toEqual(["c", "b", "a"]);
    expect(reorder(d, ["b"], "backward")).toEqual(["b", "a", "c"]);
  });

  it("is a no-op (disabled) with nothing overlapping in that direction", () => {
    const d = doc(a, c, b);
    expect(zMoves(d, ["c"])).toEqual({ front: true, forward: false, backward: false, back: true });
    expect(zMoves(d, ["a"])).toEqual({ front: true, forward: true, backward: false, back: false });
    expect(reorder(doc(b, a, c), ["a"], "forward")).toBeNull(); // only c (not touching) above it
  });

  it("stops at the nearest overlapping object, not the farthest", () => {
    const e = rect("e", "o0", at(20, 20, 10, 10)); // overlaps a and b
    expect(reorder(doc(a, c, e, b), ["a"], "forward")).toEqual(["c", "e", "a", "b"]);
    expect(reorder(doc(a, e, c, b), ["b"], "backward")).toEqual(["a", "b", "e", "c"]);
  });

  it("counts touching edges, lines without height and rotation", () => {
    const line = { id: "l", type: "shape.add", pageKey: "o0", kind: "line", points: [[0, 60], [100, 60]], stroke: "#000000", width: 1 } as unknown as ContentOp;
    const tall = rect("t", "o0", at(40, 55, 10, 20));
    expect(reorder(doc(line, c, tall), ["l"], "forward")).toEqual(["c", "t", "l"]);
    const edge = rect("g", "o0", at(50, 0, 10, 10)); // touches a's right edge
    expect(reorder(doc(a, edge), ["a"], "forward")).toEqual(["g", "a"]);
    // A 10 x 100 bar beside a, turned 90° about its centre, lies across it.
    const bar = rect("r", "o0", at(100, -20, 10, 100), { rotation: 90 });
    expect(reorder(doc(a, bar), ["a"], "forward")).toBeNull();
    expect(reorder(doc(a, rect("r", "o0", at(100, -20, 10, 100))), ["a"], "forward")).toBeNull();
    const across = rect("x", "o0", at(60, -20, 10, 100), { rotation: 90 });
    expect(reorder(doc(a, across), ["a"], "forward")).toEqual(["x", "a"]);
  });

  it("moves a group without one member passing another", () => {
    // a and b selected, x overlaps only a and sits above b: a may not jump over b.
    const x = rect("x", "o0", at(0, 0, 5, 5));
    const bb = rect("b", "o0", at(300, 300));
    expect(reorder(doc(a, bb, x), ["a", "b"], "forward")).toBeNull();
    expect(reorder(doc(a, x, bb), ["a", "b"], "forward")).toEqual(["x", "a", "b"]);
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

describe("zMoveForKey / zKeys", () => {
  type Mods = Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>;
  const k = (key: string, mod: Mods = {}, mac = false) =>
    zMoveForKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mod }, mac);
  it("off the Mac: Ctrl + brackets, with Shift to the end", () => {
    expect(k("]", { ctrlKey: true })).toBe("forward");
    expect(k("[", { ctrlKey: true })).toBe("backward");
    expect(k("}", { ctrlKey: true, shiftKey: true })).toBe("front");
    expect(k("{", { ctrlKey: true, shiftKey: true })).toBe("back");
    expect(k("]", { ctrlKey: true, shiftKey: true })).toBe("front");
    expect(k("]", { ctrlKey: true, altKey: true, code: "BracketRight" })).toBeNull();
  });
  it("on the Mac: Cmd + brackets, Cmd+Option (by key position) to the end, Cmd+Shift left to the browser", () => {
    expect(k("]", { metaKey: true }, true)).toBe("forward");
    expect(k("[", { metaKey: true }, true)).toBe("backward");
    expect(k("‘", { metaKey: true, altKey: true, code: "BracketRight" }, true)).toBe("front");
    expect(k("“", { metaKey: true, altKey: true, code: "BracketLeft" }, true)).toBe("back");
    expect(k("}", { metaKey: true, shiftKey: true, code: "BracketRight" }, true)).toBeNull();
    expect(k("‘", { ctrlKey: true, altKey: true, code: "BracketRight" }, true)).toBeNull();
    expect(k("+", { metaKey: true, altKey: true, code: "Equal" }, true)).toBeNull();
  });
  it("ignores other keys and missing modifiers", () => {
    expect(k("]")).toBeNull();
    expect(k("+", { ctrlKey: true })).toBeNull();
    expect(k("+", { ctrlKey: true, code: "BracketRight" })).toBeNull(); // German layout: Ctrl + "+" is zoom
  });
  it("names the keys per platform", () => {
    expect(zKeys(true)).toEqual({ front: "Mod+Alt+]", forward: "Mod+]", backward: "Mod+[", back: "Mod+Alt+[" });
    expect(zKeys(false).front).toBe("Mod+Shift+]");
    expect(formatKeys(zKeys(true).front, true)).toEqual(["⌘", "⌥", "]"]);
    expect(formatKeys(zKeys(false).back, false)).toEqual(["Ctrl", "Shift", "["]);
  });
});
