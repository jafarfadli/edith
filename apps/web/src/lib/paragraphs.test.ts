import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FontRef } from "@edith/ops";
import type { Paragraph, TextData } from "@/lib/api";
import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { runsText } from "@/lib/runs";
import { hardBreaks, maskRects, overflowsOriginal, paragraphBox, paragraphRuns, rawToBox } from "@/lib/paragraphs";

const FONTS = path.resolve(__dirname, "../../../../packages/fonts/files");
const metrics = new Map<string, FontMetrics>();
function bundled(f: FontRef): FontMetrics {
  if (isOriginal(f)) throw new Error("no original fonts in this fixture");
  const style = f.bold && f.italic ? "BoldItalic" : f.bold ? "Bold" : f.italic ? "Italic" : "Regular";
  const key = fontKey(f);
  if (!metrics.has(key)) metrics.set(key, metricsFromBuffer(readFileSync(path.join(FONTS, `${f.family}-${style}.ttf`))));
  return metrics.get(key)!;
}

// GET /documents/{id}/text of apps/api tests.pdfs.make_layout_pdf() (regenerate: cd apps/api && uv run python -m scripts.text_fixture).
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "text.json"), "utf8")) as TextData;
const paragraphs = fixture.pages[0].paragraphs;
const lineTexts = (p: Paragraph) => p.lines.map((l) => p.runs.map((r) => r.text).join("").slice(l.start, l.end));
const laidOut = (box: ReturnType<typeof paragraphBox>) => box.layout.map((l) => l.segments.map((s) => s.text).join(" ").replace(/\s+/g, " "));

describe("paragraphBox", () => {
  it.each(paragraphs.map((p) => [p.id, p.align, p] as const))("keeps the original line breaks of %s (%s)", (_id, _align, p) => {
    const box = paragraphBox(p, bundled);
    expect(laidOut(box)).toEqual(lineTexts(p).map((t) => t.replace(/\s+/g, " ")));
  });

  it.each(paragraphs.map((p) => [p.id, p] as const))("puts every baseline of %s within 0.5 pt of the original", (_id, p) => {
    const box = paragraphBox(p, bundled);
    box.layout.forEach((line, i) => expect(Math.abs(box.rect.y + line.baseline - p.lines[i].baseline)).toBeLessThanOrEqual(0.5));
    expect(box.rect.x).toBe(p.rect.x);
  });

  it("gets hand-broken lines as paragraphs of their own from the API (segmentation version 2)", () => {
    // "Jl. Merdeka Barat No. 17, Jakarta" / "Pusat" / "Indonesia": "Pusat" ended early, so "Indonesia" is a paragraph.
    const texts = paragraphs.map((p) => runsText(p.runs));
    expect(texts).toContain("Jl. Merdeka Barat No. 17, Jakarta Pusat");
    expect(texts).toContain("Indonesia");
  });

  it("keeps wrapped lines in one logical paragraph", () => {
    const p = paragraphs.find((x) => x.align === "justify")!;
    expect(paragraphRuns(p, hardBreaks(p, p.rect.w + 0.01, bundled))).toHaveLength(1);
  });

  it("maps joined-text offsets onto the split paragraphs", () => {
    // "ab-" / "cd" / "ef": the hyphen line has no joining space; every break is hard at width 10.
    const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
    const line = (start: number, end: number) => ({ rect: { x: 0, y: 0, w: 3, h: 1 }, baseline: 1, size: 1, start, end });
    const p: Paragraph = { id: "g0", rect: { x: 0, y: 0, w: 3, h: 3 }, lines: [line(0, 3), line(3, 5), line(6, 8)],
      runs: [{ text: "ab-cd ef", font: { kind: "bundled", family: "Arimo" }, size: 1, color: "#000000" }], align: "left", lineHeight: 1, editable: true };
    const breaks = hardBreaks(p, 10, () => mono);
    expect(breaks).toEqual([0, 1]);
    expect(paragraphRuns(p, breaks).map((ps) => ps[0].text)).toEqual(["ab-", "cd", "ef"]); // box text "ab-\ncd\nef"
    const toBox = rawToBox(p, breaks);
    expect([0, 3, 4, 5, 6, 8].map(toBox)).toEqual([0, 3, 5, 6, 7, 9]);
  });

  it("applies an edit to the logical paragraphs before layout", () => {
    // "ab-" / "cd" / "ef" again, in a box 10 units wide: three logical paragraphs.
    const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
    const line = (start: number, end: number, y: number) => ({ rect: { x: 0, y, w: 3, h: 1 }, baseline: y + 1, size: 1, start, end });
    const p: Paragraph = { id: "g0", rect: { x: 0, y: 0, w: 10, h: 3 }, lines: [line(0, 3, 0), line(3, 5, 1), line(6, 8, 2)],
      runs: [{ text: "ab-cd ef", font: { kind: "bundled", family: "Arimo" }, size: 1, color: "#000000" }], align: "left", lineHeight: 1, editable: true };
    const box = paragraphBox(p, () => mono, (ps, toBox) => {
      expect(toBox(6)).toBe(7); // "e": start of the third logical paragraph ("ab-\ncd\nef")
      return [ps[0], ps[1], [{ ...ps[2][0], text: "RI" }]];
    });
    expect(box.paragraphs.map((ps) => ps.map((r) => r.text).join(""))).toEqual(["ab-", "cd", "RI"]);
    expect(box.layout).toHaveLength(3);
  });
});

describe("maskRects", () => {
  it("covers each line around its baseline", () => {
    const p = paragraphs[0];
    const [m] = maskRects(p);
    expect(m.y).toBeCloseTo(p.lines[0].baseline - 0.95 * p.lines[0].size);
    expect(m.h).toBeCloseTo(1.2 * p.lines[0].size);
  });
});

describe("overflowsOriginal", () => {
  const p = paragraphs[0];
  it("is false for the unchanged paragraph and true when the text needs another line", () => {
    const box = paragraphBox(p, bundled);
    expect(overflowsOriginal(box, p)).toBe(false);
    const longer = paragraphBox(p, bundled, (ps) => [[...ps[0], { ...ps[0][0], text: " tambahan kalimat yang cukup panjang untuk satu baris lagi" }], ...ps.slice(1)]);
    expect(longer.layout.length).toBeGreaterThan(box.layout.length);
    expect(overflowsOriginal(longer, p)).toBe(true);
  });
  it("is false when the edit got shorter", () => {
    const shorter = paragraphBox(p, bundled, (ps) => [[{ ...ps[0][0], text: "Pendek." }]]);
    expect(overflowsOriginal(shorter, p)).toBe(false);
  });
});
