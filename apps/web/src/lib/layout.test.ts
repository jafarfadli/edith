import { describe, expect, it } from "vitest";
import type { Run } from "@edith/ops";
import type { FontMetrics } from "@/lib/fonts";
import { layoutText } from "@/lib/layout";

// Every char is 1 em wide → width = chars × size. Ascent 0.8 em, descent 0.2 em.
const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
const metrics = () => mono;
const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const run = (text: string, size = 10): Run => ({ text, font, size, color: "#000000" });
const texts = (r: ReturnType<typeof layoutText>) => r.lines.map((l) => l.segments.map((s) => s.text).join("|"));

describe("layoutText", () => {
  it("wraps greedily and drops wrap spaces", () => {
    const r = layoutText({ width: 55, align: "left", lineHeight: 12, paragraphs: [[run("aa bb cc")]] }, metrics);
    expect(texts(r)).toEqual(["aa bb", "cc"]);
    expect(r.lines.map((l) => l.baseline)).toEqual([8, 20]);
    expect(r.height).toBeCloseTo(22);
    expect(r.contentWidth).toBe(50);
  });

  it("aligns right and center using width without trailing space", () => {
    const right = layoutText({ width: 100, align: "right", lineHeight: 12, paragraphs: [[run("ab ")]] }, metrics);
    expect(right.lines[0].segments[0].x).toBe(80);
    const center = layoutText({ width: 100, align: "center", lineHeight: 12, paragraphs: [[run("ab")]] }, metrics);
    expect(center.lines[0].segments[0].x).toBe(40);
  });

  it("justifies all but the last line, one segment per word", () => {
    const r = layoutText({ width: 60, align: "justify", lineHeight: 12, paragraphs: [[run("aa bb cc")]] }, metrics);
    expect(r.lines[0].segments).toEqual([
      { x: 0, text: "aa", runIndex: 0 },
      { x: 40, text: "bb", runIndex: 0 },
    ]);
    expect(r.lines[1].segments).toEqual([{ x: 0, text: "cc", runIndex: 0 }]);
  });

  it("breaks long words by character", () => {
    const r = layoutText({ width: 35, align: "left", lineHeight: 12, paragraphs: [[run("abcdefgh")]] }, metrics);
    expect(texts(r)).toEqual(["abc", "def", "gh"]);
  });

  it("keeps run indexes across runs and paragraphs", () => {
    const r = layoutText({ width: 1000, align: "left", lineHeight: 12, paragraphs: [[run("ab"), run("cd ef")], [run("gh")]] }, metrics);
    expect(r.lines[0].segments).toEqual([
      { x: 0, text: "ab", runIndex: 0 },
      { x: 20, text: "cd ef", runIndex: 1 },
    ]);
    expect(r.lines[1].segments).toEqual([{ x: 0, text: "gh", runIndex: 2 }]);
  });

  it("uses the largest ascent on the first line", () => {
    const r = layoutText({ width: 1000, align: "left", lineHeight: 30, paragraphs: [[run("a", 10), run("B", 20)]] }, metrics);
    expect(r.lines[0].baseline).toBe(16);
  });

  it("empty paragraph makes an empty line", () => {
    const r = layoutText({ width: 100, align: "left", lineHeight: 12, paragraphs: [[run("a")], [run("")], [run("b")]] }, metrics);
    expect(r.lines.length).toBe(3);
    expect(r.lines[1].segments).toEqual([]);
    expect(r.lines[2].baseline).toBe(32);
  });

  it("keeps a word whole across run boundaries when wrapping", () => {
    const r = layoutText({ width: 55, align: "left", lineHeight: 12, paragraphs: [[run("ab "), run("cd"), run("ef")]] }, metrics);
    expect(texts(r)).toEqual(["ab", "cd|ef"]);
    expect(r.lines[1].segments).toEqual([
      { x: 0, text: "cd", runIndex: 1 },
      { x: 20, text: "ef", runIndex: 2 },
    ]);
  });

  it("splits an over-wide word spanning runs by character", () => {
    const r = layoutText({ width: 35, align: "left", lineHeight: 12, paragraphs: [[run("abcd"), run("efgh")]] }, metrics);
    expect(texts(r)).toEqual(["abc", "d|ef", "gh"]);
    expect(r.lines[1].segments.map((s) => s.runIndex)).toEqual([0, 1]);
  });

  it("treats a line that fits exactly at a non-integer width as fitting", () => {
    // 0.1 + 0.2 = 0.30000000000000004 > 0.3 without an epsilon.
    const tenth: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
    const r = layoutText(
      { width: 0.3, align: "left", lineHeight: 1, paragraphs: [[{ ...run("a"), size: 0.1 }, { ...run("b"), size: 0.2 }]] },
      () => tenth,
    );
    expect(texts(r)).toEqual(["a|b"]);
    const r2 = layoutText(
      { width: 0.3, align: "left", lineHeight: 1, paragraphs: [[{ ...run("a b"), size: 0.1 }, { ...run(" c"), size: 0.1 }]] },
      () => tenth,
    );
    expect(r2.lines.length).toBe(2);
  });

  it("throws a clear error for a paragraph with no runs", () => {
    expect(() => layoutText({ width: 100, align: "left", lineHeight: 12, paragraphs: [[run("a")], []] }, metrics)).toThrow(
      "layoutText: paragraph 1 has no runs",
    );
  });
});
