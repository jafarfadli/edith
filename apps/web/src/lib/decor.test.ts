import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FontRef, Run } from "@edith/ops";
import type { TextData } from "@/lib/api";
import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { editedBox } from "@/lib/keepLines";
import { maskRects, paragraphBox } from "@/lib/paragraphs";
import { replaceMatches } from "@/lib/search";
import { normalizeRuns, sameStyle } from "@/lib/runs";
import { decorBands, joinBands } from "@/lib/textDecor";

const FONTS = path.resolve(__dirname, "../../../../packages/fonts/files");
const metrics = new Map<string, FontMetrics>();
function bundled(f: FontRef): FontMetrics {
  if (isOriginal(f)) throw new Error("no original fonts in this fixture");
  const style = f.bold && f.italic ? "BoldItalic" : f.bold ? "Bold" : f.italic ? "Italic" : "Regular";
  const key = fontKey(f);
  if (!metrics.has(key)) metrics.set(key, metricsFromBuffer(readFileSync(path.join(FONTS, `${f.family}-${style}.ttf`))));
  return metrics.get(key)!;
}

// GET /documents/{id}/text of apps/api tests.pdfs.make_decor_pdf(): g0 has an underlined word in line 1 and an
// underlined line 2, g1 a struck (red) word and a highlighted one.
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "decor.json"), "utf8")) as TextData;
const [G0, G1] = fixture.pages[0].paragraphs;
const texts = (runs: Run[]) => runs.map((r) => [r.text, !!r.underline] as const);

describe("decorations of original text", () => {
  it("come with the runs and the lines of GET /text", () => {
    expect(texts(G0.runs)).toEqual([["Alpha beta ", false], ["underlined", true], [" gamma delta ", false], ["second line all underlined", true]]);
    expect(G0.runs[1]).toMatchObject({ underlineTop: 0.1, decorThickness: 0.067 });
    expect(G1.runs[0]).toMatchObject({ strike: true, decorColor: "#ff0000" });
    expect(G1.runs[2]).toMatchObject({ bgColor: "#ffff00" });
    expect(G0.lines.map((l) => l.decor?.length ?? 0)).toEqual([1, 1]);
  });

  it("an unchanged paragraph keeps every line (its marks stay on the page)", () => {
    const start = paragraphBox(G0, bundled);
    const box = editedBox(start, start.paragraphs, G0, bundled);
    expect(box.layout.map((l) => l.source)).toEqual([0, 1]);
  });

  it("a word typed into the underlined one is underlined like it; the other line stays kept", () => {
    const start = paragraphBox(G0, bundled);
    const runs = start.paragraphs[0].map((r) => (r.text === "underlined" ? { ...r, text: "underlinedXY" } : r));
    const box = editedBox(start, [runs], G0, bundled);
    expect(box.layout[0].source ?? null).toBeNull();
    expect(box.layout[1].source).toBe(1);
    const flat = box.paragraphs.flat();
    const seg = box.layout[0].segments.find((s) => s.text.includes("underlinedXY"))!;
    expect(flat[seg.runIndex]).toMatchObject({ underline: true, underlineTop: 0.1, decorThickness: 0.067 });
  });

  it("a line whose underline is turned off is redrawn", () => {
    const start = paragraphBox(G0, bundled);
    const runs = normalizeRuns(start.paragraphs[0].map((r) => (r.text.startsWith("second") ? { text: r.text, font: r.font, size: r.size, color: r.color } : r)));
    const box = editedBox(start, [runs], G0, bundled);
    expect(box.layout[0].source).toBe(0);
    expect(box.layout[1].source ?? null).toBeNull();
  });

  it("find & replace keeps the replaced word's decorations", () => {
    const out = replaceMatches([G0.runs], [{ start: 11, end: 21 }], "garis");
    expect(out[0].find((r) => r.text === "garis")).toMatchObject({ underline: true, underlineTop: 0.1 });
  });

  it("runs with another underline geometry or colour are another style", () => {
    const a = G0.runs[1];
    expect(sameStyle(a, { ...a })).toBe(true);
    expect(sameStyle(a, { ...a, underlineTop: 0.2 })).toBe(false);
    expect(sameStyle(a, { ...a, decorColor: "#ff0000" })).toBe(false);
  });

  it("the screen covers an edited line's marks with it", () => {
    const masks = maskRects(G1);
    const [bg, strike] = G1.lines[0].decor!;
    for (const d of [bg, strike]) {
      expect(masks.some((m) => m.x <= d.x && m.y <= d.y && m.x + m.w >= d.x + d.w && m.y + m.h >= d.y + d.h)).toBe(true);
    }
  });
});

describe("decorBands", () => {
  it("draws the original's geometry, else the bake's defaults", () => {
    const r = G0.runs[1];
    const d = decorBands(10, 100, 50, r);
    expect(d.underline!.y).toBeCloseTo(100 + 0.1 * 12);
    expect(d.underline!.h).toBeCloseTo(0.067 * 12);
    const plain = decorBands(10, 100, 50, { ...r, underlineTop: undefined, decorThickness: undefined });
    expect(plain.underline!.y).toBeCloseTo(100 + 0.075 * 12);
  });

  it("joins the bands of one line into one (no seams between characters)", () => {
    const b = (x: number, w: number, color = "#000") => ({ x, y: 1, w, h: 1, color });
    expect(joinBands([b(0, 5), b(5.2, 5), b(12, 3), b(15, 2, "#f00")])).toEqual([b(0, 10.2), b(12, 3), b(15, 2, "#f00")]);
    expect(joinBands([b(0, 5), b(4.2, 5)])).toEqual([b(0, 9.2)]); // overlapping (negative character spacing)
  });
});
