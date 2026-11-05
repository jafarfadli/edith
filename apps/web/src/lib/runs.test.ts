import { describe, expect, it } from "vitest";
import type { Run } from "@edith/ops";
import { normalizeRuns, paragraphsEqual, runsText, sliceRuns, styleAt } from "@/lib/runs";

const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const r = (text: string, color = "#000000", extra: Partial<Run> = {}): Run => ({ text, font, size: 12, color, ...extra });

describe("runs", () => {
  it("merges same-style neighbours and drops empty runs", () => {
    expect(normalizeRuns([r("a"), r(""), r("b"), r("c", "#ff0000")])).toEqual([r("ab"), r("c", "#ff0000")]);
    expect(normalizeRuns([r("", "#ff0000"), r("")])).toEqual([r("", "#ff0000")]);
  });

  it("treats missing decoration fields as defaults", () => {
    expect(normalizeRuns([r("a"), r("b", "#000000", { underline: false, bgColor: null })])).toEqual([r("ab")]);
  });

  it("slices across runs", () => {
    const runs = [r("abc"), r("def", "#ff0000")];
    expect(sliceRuns(runs, 2, 4)).toEqual([r("c"), r("d", "#ff0000")]);
    expect(sliceRuns(runs, 3, 3)).toEqual([]);
    expect(runsText(runs)).toBe("abcdef");
  });

  it("finds the style at an offset", () => {
    const runs = [r("ab"), r("cd", "#ff0000")];
    expect(styleAt(runs, 1).color).toBe("#000000");
    expect(styleAt(runs, 2).color).toBe("#ff0000");
    expect(styleAt(runs, 4).color).toBe("#ff0000");
  });

  it("compares paragraphs by text and style", () => {
    expect(paragraphsEqual([[r("a")]], [[{ ...r("a"), strike: false }]])).toBe(true);
    expect(paragraphsEqual([[r("a")]], [[r("a", "#ff0000")]])).toBe(false);
  });
});
