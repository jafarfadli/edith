import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FontRef, Run } from "@edith/ops";
import type { DocFont, Paragraph, TextData } from "@/lib/api";
import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { runsText } from "@/lib/runs";
import { hardBreaks, hasUnsupportedChars, maskRects, overflowsOriginal, paragraphBox, paragraphRuns, prepareRuns, rawToBox, resolveLoadedRuns, resolveRunFonts } from "@/lib/paragraphs";

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

  it("splits hand-broken lines into logical paragraphs", () => {
    const address = paragraphs.find((p) => p.runs[0].text.startsWith("Jl."))!;
    const box = paragraphBox(address, bundled);
    expect(box.paragraphs.map((ps) => ps.map((r) => r.text).join(""))).toEqual(["Jl. Merdeka Barat No. 17, Jakarta Pusat", "Indonesia"]);
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
    const address = paragraphs.find((p) => p.runs[0].text.startsWith("Jl."))!;
    const raw = runsText(address.runs).indexOf("Indonesia");
    const box = paragraphBox(address, bundled, (ps, toBox) => {
      expect(toBox(raw)).toBe(runsText(ps[0]).length + 1); // start of the second logical paragraph
      return [ps[0], [{ ...ps[1][0], text: "RI" }]];
    });
    expect(box.paragraphs.map((ps) => ps.map((r) => r.text).join(""))).toEqual(["Jl. Merdeka Barat No. 17, Jakarta Pusat", "RI"]);
    expect(box.layout).toHaveLength(3);
  });
});

const ORIG = { kind: "original" as const, ref: "f9" };
const fonts: Record<string, DocFont> = {
  f9: { ref: "f9", name: "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold: false, italic: false,
        substitute: { kind: "bundled", family: "Carlito", bold: false, italic: false } },
};
const run = (text: string): Run => ({ text, font: ORIG, size: 12, color: "#000000" });
const onlyAbc: FontMetrics = { unitsPerEm: 1000, ascent: 800, descent: 200, advance: () => 500, hasGlyph: (cp) => "abc ".includes(String.fromCodePoint(cp)) };

describe("original fonts", () => {
  it("keep a run whose glyphs exist and swap the others for the substitute", () => {
    const out = resolveRunFonts([run("abc"), run("abz")], fonts, () => onlyAbc);
    expect(out[0].font).toEqual(ORIG);
    expect(out[1].font).toEqual({ kind: "bundled", family: "Carlito", bold: false, italic: false });
  });

  it("swap when the font did not load", () => {
    expect(resolveRunFonts([run("a")], fonts, () => null)[0].font).toMatchObject({ family: "Carlito" });
  });

  it("swap a bundled family lacking a glyph for Arimo", () => {
    const lato = { ...run("abz"), font: { kind: "bundled" as const, family: "Lato", bold: true, italic: false } };
    expect(resolveRunFonts([lato], fonts, () => onlyAbc)[0].font).toEqual({ kind: "bundled", family: "Arimo", bold: true, italic: false });
    expect(resolveRunFonts([lato], fonts, () => null)[0]).toBe(lato); // not loaded yet: unchanged
  });

  it("prepareRuns loads originals first and tolerates their failure", async () => {
    const loaded: string[] = [];
    const store = {
      async load(f: FontRef) { if (isOriginal(f)) throw new Error("404"); loaded.push(fontKey(f)); return onlyAbc; },
      peek: (f: FontRef) => (loaded.includes(fontKey(f)) ? onlyAbc : null),
    };
    const out = await prepareRuns([[run("abc")]], fonts, store);
    expect(out[0][0].font).toMatchObject({ kind: "bundled", family: "Carlito" });
    expect(loaded).toContain("Carlito-regular");
  });

  it("swap Arimo lacking a glyph for Noto Sans, and stop there", () => {
    const arimo = { ...run("abz"), font: { kind: "bundled" as const, family: "Arimo", bold: false, italic: true } };
    expect(resolveRunFonts([arimo], fonts, () => onlyAbc)[0].font).toEqual({ kind: "bundled", family: "Noto Sans", bold: false, italic: true });
    const noto = { ...arimo, font: { kind: "bundled" as const, family: "Noto Sans", bold: false, italic: true } };
    expect(resolveRunFonts([noto], fonts, () => onlyAbc)[0]).toBe(noto);
  });

  it("prepareRuns falls back: original → substitute → Arimo → Noto Sans", async () => {
    const onlyAbcz: FontMetrics = { ...onlyAbc, hasGlyph: (cp) => "abcz ".includes(String.fromCodePoint(cp)) };
    const store = { load: async () => onlyAbc, peek: (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? onlyAbcz : onlyAbc) };
    const out = await prepareRuns([[run("abz")]], fonts, store);
    expect(out[0][0].font).toEqual({ kind: "bundled", family: "Noto Sans", bold: false, italic: false });
  });
});

describe("resolveLoadedRuns", () => {
  const onlyAbcz: FontMetrics = { ...onlyAbc, hasGlyph: (cp) => "abcz ".includes(String.fromCodePoint(cp)) };
  const peekAll = (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? onlyAbcz : onlyAbc);

  it("runs the whole chain with loaded fonts, like prepareRuns", async () => {
    const sync = resolveLoadedRuns([[run("abz")]], fonts, peekAll);
    expect(sync?.[0][0].font).toEqual({ kind: "bundled", family: "Noto Sans", bold: false, italic: false });
    expect(sync).toEqual(await prepareRuns([[run("abz")]], fonts, { load: async () => onlyAbc, peek: peekAll }));
  });

  it("returns null when a font it needs is not loaded", () => {
    expect(resolveLoadedRuns([[run("abz")]], fonts, (f) => (isOriginal(f) ? onlyAbc : null))).toBeNull();
  });

  it("returns the same runs when nothing needs a fallback", () => {
    const p = [[run("abc")]];
    expect(resolveLoadedRuns(p, fonts, () => onlyAbc)?.[0][0]).toBe(p[0][0]);
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

describe("hasUnsupportedChars", () => {
  const notoAbcz: FontMetrics = { ...onlyAbc, hasGlyph: (cp) => "abcz ".includes(String.fromCodePoint(cp)) };
  const peek = (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? notoAbcz : onlyAbc);
  it("is false when the fallback chain covers every character", () => {
    expect(hasUnsupportedChars([[run("abz")]], fonts, peek)).toBe(false); // z: Noto Sans has it
    expect(hasUnsupportedChars([[run("ab c\n")]], fonts, peek)).toBe(false);
  });
  it("is true when even the last fallback lacks a glyph", () => {
    expect(hasUnsupportedChars([[run("ab✓")]], fonts, peek)).toBe(true);
  });
  it("waits for the fonts of the chain", () => {
    expect(hasUnsupportedChars([[run("ab✓")]], fonts, (f) => (isOriginal(f) ? onlyAbc : null))).toBe(false);
  });
});
