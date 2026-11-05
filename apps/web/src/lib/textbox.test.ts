import { describe, expect, it } from "vitest";
import type { DocFont } from "@/lib/api";
import type { FontMetrics } from "@/lib/fonts";
import { boxFonts, newBox, plainText, relayout, withStyle, withText } from "@/lib/textbox";

const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
const style = { family: "Arimo", bold: false, italic: false, size: 10, color: "#111111", align: "left" as const };

describe("textbox", () => {
  it("creates an empty box at a point", () => {
    const b = newBox([30, 40], style);
    expect(b.rect).toEqual({ x: 30, y: 40, w: 200, h: 12 });
    expect(b.lineHeight).toBe(12);
    expect(plainText(b)).toBe("");
  });

  it("sets text as paragraphs and keeps style", () => {
    const b = withText(newBox([0, 0], { ...style, color: "#ff0000" }), "satu\ndua");
    expect(b.paragraphs.length).toBe(2);
    expect(b.paragraphs[1][0]).toMatchObject({ text: "dua", color: "#ff0000", size: 10 });
    expect(plainText(b)).toBe("satu\ndua");
  });

  it("applies style to all runs and updates line height", () => {
    const b = withStyle(withText(newBox([0, 0], style), "a\nb"), { size: 20, bold: true, align: "center" });
    expect(b.paragraphs.flat().every((r) => r.size === 20 && r.font.kind !== "original" && r.font.bold)).toBe(true);
    expect(b.lineHeight).toBe(24);
    expect(b.align).toBe("center");
  });

  it("relayout computes layout and height", () => {
    const b = relayout({ ...withText(newBox([0, 0], style), "aa bb"), rect: { x: 0, y: 0, w: 30, h: 0 } }, () => mono);
    expect(b.layout.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["aa", "bb"]);
    expect(b.rect.h).toBeCloseTo(22);
  });

  it("lists fonts", () => {
    const b = withStyle(withText(newBox([0, 0], style), "x"), { family: "Tinos", italic: true });
    expect(boxFonts(b)).toEqual([{ kind: "bundled", family: "Tinos", bold: false, italic: true }]);
  });
});

describe("withStyle with original fonts", () => {
  const calibri = (ref: string, bold: boolean): DocFont => ({
    ref, name: bold ? "Calibri-Bold" : "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold, italic: false,
    substitute: { kind: "bundled", family: "Carlito", bold, italic: false },
  });
  const fonts = { f1: calibri("f1", false), f2: calibri("f2", true) };
  const box = { ...newBox([0, 0], style), paragraphs: [[{ text: "x", font: { kind: "original" as const, ref: "f1" }, size: 10, color: "#111111" }]] };

  it("switches to the document's bold variant and keeps the font for other changes", () => {
    expect(withStyle(box, { bold: true }, fonts).paragraphs[0][0].font).toEqual({ kind: "original", ref: "f2" });
    expect(withStyle(box, { underline: true, bgColor: "#ffff00" }, fonts).paragraphs[0][0])
      .toEqual({ text: "x", font: { kind: "original", ref: "f1" }, size: 10, color: "#111111", underline: true, bgColor: "#ffff00" });
  });
});
