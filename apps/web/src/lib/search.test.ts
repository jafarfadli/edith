import { describe, expect, it } from "vitest";
import type { Run, TextBox } from "@edith/ops";
import { boxText, findMatches, matchSegments, replaceMatches, replaceRange, type SearchTarget } from "@/lib/search";

const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const r = (text: string, color = "#000000"): Run => ({ text, font, size: 12, color });
const target = (key: string, ...paragraphs: Run[][]): SearchTarget => ({ key, pageKey: "o0", paragraphs });

describe("find", () => {
  const targets = [target("a", [r("Kata lama, "), r("lama", "#ff0000")]), target("b", [r("LAMA")], [r("tidak")])];

  it("is case-insensitive by default and case-sensitive on request", () => {
    expect(findMatches(targets, "lama", false).map((m) => [m.key, m.start])).toEqual([["a", 5], ["a", 11], ["b", 0]]);
    expect(findMatches(targets, "lama", true).map((m) => [m.key, m.start])).toEqual([["a", 5], ["a", 11]]);
  });

  it("matches across run boundaries", () => {
    const t = [target("x", [r("ka"), r("ta", "#ff0000")])];
    expect(findMatches(t, "kata", true)).toEqual([{ key: "x", pageKey: "o0", start: 0, end: 4 }]);
  });

  it("does not overlap matches and ignores an empty query", () => {
    expect(findMatches([target("x", [r("aaaa")])], "aa", true).map((m) => m.start)).toEqual([0, 2]);
    expect(findMatches(targets, "", false)).toEqual([]);
  });

  it("keeps offsets when lower-casing changes length", () => {
    expect(findMatches([target("x", [r("İstanbul ada")])], "ada", false)[0].start).toBe(9);
  });
});

describe("replace", () => {
  it("keeps the style of the first matched character, across runs", () => {
    const out = replaceRange([[r("ka"), r("ta lain", "#ff0000")]], 0, 4, "KATA");
    expect(out).toEqual([[r("KATA"), r(" lain", "#ff0000")]]);
  });

  it("works in a later paragraph", () => {
    const ps = [[r("satu")], [r("dua lama")]];
    expect(boxText(replaceRange(ps, 9, 13, "baru"))).toBe("satu\ndua baru");
  });

  it("replaces all matches of a target", () => {
    const ps = [[r("lama dan lama")]];
    const ms = findMatches([target("x", ...ps)], "lama", true);
    expect(boxText(replaceMatches(ps, ms, "baru sekali"))).toBe("baru sekali dan baru sekali");
  });

  it("joins paragraphs when the range spans them", () => {
    expect(replaceRange([[r("satu")], [r("dua")]], 2, 7, "-")).toEqual([[r("sa-a")]]);
  });

  it("can empty a paragraph", () => {
    expect(replaceRange([[r("lama")]], 0, 4, "")).toEqual([[r("")]]);
  });
});

describe("matchSegments", () => {
  it("maps a range onto wrapped, justified segments", () => {
    const box: TextBox = {
      rect: { x: 0, y: 0, w: 10, h: 10 }, align: "justify", lineHeight: 12,
      paragraphs: [[r("aa bb "), r("cc", "#ff0000")], [r("dd")]],
      layout: [
        { baseline: 10, segments: [{ x: 0, text: "aa", runIndex: 0 }, { x: 30, text: "bb", runIndex: 0 }] },
        { baseline: 22, segments: [{ x: 0, text: "cc", runIndex: 1 }] },
        { baseline: 34, segments: [{ x: 0, text: "dd", runIndex: 2 }] },
      ],
    };
    // "aa bb cc\ndd": "b cc" = 4..8, "dd" = 9..11
    expect(matchSegments(box, 4, 8)).toEqual([{ line: 0, segment: 1, from: 1, to: 2 }, { line: 1, segment: 0, from: 0, to: 2 }]);
    expect(matchSegments(box, 9, 11)).toEqual([{ line: 2, segment: 0, from: 0, to: 2 }]);
  });
});
