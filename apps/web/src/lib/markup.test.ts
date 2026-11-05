import { describe, expect, it } from "vitest";
import { caretAt, markupLine, markupQuads, usableLines, type CharLine } from "@/lib/markup";

describe("markupLine", () => {
  it("matches MuPDF's underline/strike appearance (13.8 pt quad: width 0.8625, 1.971 / 5.914 above the bottom)", () => {
    const q = { x: 72, y: 89.2, w: 100, h: 13.8 };
    const u = markupLine("underline", q), s = markupLine("strike", q);
    expect(u.h).toBeCloseTo(0.8625, 4);
    expect(u.y + u.h / 2).toBeCloseTo(103 - 1.9714, 3);
    expect(s.y + s.h / 2).toBeCloseTo(103 - 5.9143, 3);
    expect([u.x, u.w]).toEqual([72, 100]);
  });
});

const line = (text: string, x0: number, baseline: number, size = 12, adv = 6): CharLine => ({
  text, baseline, size, boxes: Array.from(text).map((_, i) => [x0 + i * adv, x0 + (i + 1) * adv] as [number, number]),
});
// "Hello world" at x 72 (6 pt per char), baseline 100; "second line" below it.
const lines = [line("Hello world", 72, 100), line("second line", 72, 114.4)];

describe("caretAt", () => {
  it("finds the caret between characters on a press inside a line", () => {
    expect(caretAt(lines, [72 + 6 * 6 + 1, 95], true)).toEqual({ line: 0, index: 6 }); // left half of "w": before it
    expect(caretAt(lines, [72 + 6 * 6 + 4, 95], true)).toEqual({ line: 0, index: 7 }); // right half: after it
    expect(caretAt(lines, [71, 95], true)).toEqual({ line: 0, index: 0 });
  });
  it("needs the line under a press but takes the nearest line while dragging", () => {
    expect(caretAt(lines, [72, 60], true)).toBeNull();
    expect(caretAt(lines, [300, 95], true)).toBeNull();
    expect(caretAt(lines, [300, 95], false)).toEqual({ line: 0, index: 11 });
    expect(caretAt(lines, [100, 200], false)).toEqual({ line: 1, index: 5 });
    expect(caretAt([], [0, 0], false)).toBeNull();
  });
});

describe("markupQuads", () => {
  it("covers the selected characters with the text band, in either drag direction", () => {
    const q = { x: 72 + 6 * 6, y: 100 - 0.9 * 12, w: 5 * 6, h: 100 + 0.25 * 12 - (100 - 0.9 * 12) };
    expect(markupQuads(lines, { line: 0, index: 6 }, { line: 0, index: 11 })).toEqual([q]);
    expect(markupQuads(lines, { line: 0, index: 11 }, { line: 0, index: 6 })).toEqual([q]);
  });
  it("makes one quad per line and trims spaces at the ends", () => {
    const qs = markupQuads(lines, { line: 0, index: 5 }, { line: 1, index: 7 }); // " world" … "second "
    expect(qs.map((r) => [r.x, r.w])).toEqual([[72 + 6 * 6, 30], [72, 36]]);
    expect(markupQuads(lines, { line: 0, index: 5 }, { line: 0, index: 6 })).toEqual([]); // only a space
  });
});

describe("usableLines", () => {
  it("drops lines under hidden rects (edited paragraphs)", () => {
    expect(usableLines(lines, [{ x: 70, y: 105, w: 100, h: 12 }]).map((l) => l.text)).toEqual(["Hello world"]);
    expect(usableLines(lines, [])).toHaveLength(2);
  });
});
