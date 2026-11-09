import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FontRef, Run, TextBox } from "@edith/ops";
import type { Paragraph, TextData } from "@/lib/api";
import { charOffsets, fontKey, isOriginal, metricsFromBuffer, textWidth, type FontMetrics } from "@/lib/fonts";
import { layoutText } from "@/lib/layout";
import { paragraphBox, paragraphFrame, wrapWidth, paragraphWidth } from "@/lib/paragraphs";
import { runsText } from "@/lib/runs";
import { attrsOf, docToRuns, runOf, runsToDoc } from "@/lib/richtext";

// M5b F2: GET /text of apps/api tests.pdfs.make_spacing_pdf() — one paragraph each with Tz 90, Tc 1.5 and Hancom-style
// per-word gaps, in an embedded Tinos — plus every original glyph's origin x (regenerate: cd apps/api && uv run python
// -m scripts.spacing_fixture; tests/test_spacing.py bakes the same layout and checks the same origins).
const FONTS = path.resolve(__dirname, "../../../../packages/fonts/files");
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "spacing.json"), "utf8")) as TextData & { origins: Record<string, number[]> };
const [tz, tc, tw] = fixture.pages[0].paragraphs;
// The embedded subset keeps Tinos's advances: the client measures the served original with the same widths.
const tinos = metricsFromBuffer(readFileSync(path.join(FONTS, "Tinos-Regular.ttf")));
const metricsFor = () => tinos;
const TOL = 0.3; // pt: web layout width == bake width == original width

/** Every non-space glyph's page x in `box` (segment x + offsets within the segment, as TextNode and the bake place them). */
function glyphXs(box: TextBox): number[] {
  const runs = box.paragraphs.flat();
  return box.layout.flatMap((line) => line.segments.flatMap((seg) => {
    const r = runs[seg.runIndex];
    const offs = charOffsets(seg.text, metricsFor(), r.size, r);
    return [...seg.text].flatMap((ch, i) => (/\s/.test(ch) ? [] : [box.rect.x + seg.x + offs[i]]));
  }));
}

describe("original spacing (Run.hScale / charSpacing / wordSpacing)", () => {
  it("comes from the API for each kind", () => {
    expect(tz.runs[0].hScale).toBeCloseTo(0.9, 2);
    expect(tz.runs[0].size).toBeCloseTo(12, 1); // the true size, not MuPDF's 12·√0.9
    expect(tc.runs[0].charSpacing).toBeCloseTo(1.5, 2);
    expect(tw.runs[0].wordSpacing).toBeCloseTo(1.43, 2);
  });

  it.each([["Tz", tz], ["Tc", tc], ["per-word gaps", tw]] as const)(
    "lays a redrawn %s line out as wide as the original, every glyph on its original origin", (_kind, p) => {
      const box = paragraphBox(p, metricsFor);
      expect(box.layout).toHaveLength(1);
      const r = layoutText({ width: box.rect.w, align: "left", lineHeight: p.lineHeight, paragraphs: [p.runs] }, metricsFor);
      expect(Math.abs(r.contentWidth - p.rect.w)).toBeLessThan(TOL);
      const xs = glyphXs(box), want = fixture.origins[p.id];
      expect(xs).toHaveLength(want.length);
      xs.forEach((x, i) => expect(Math.abs(x - want[i]), `glyph ${i}`).toBeLessThan(TOL));
    });

  it("splits a run with character spacing into glyphs and one with word spacing into words and spaces", () => {
    const [tzLine] = paragraphBox(tz, metricsFor).layout;
    const [tcLine] = paragraphBox(tc, metricsFor).layout;
    const [twLine] = paragraphBox(tw, metricsFor).layout;
    expect(tzLine.segments).toHaveLength(1); // a scale alone: the bake scales the segment's glyphs
    expect(tcLine.segments.map((s) => s.text)).toEqual([...runsText(tc.runs)]);
    expect(twLine.segments.map((s) => s.text)).toEqual(runsText(tw.runs).match(/\s+|\S+/g));
  });

  it("measures width with the scale and the spacing, and the trailing character spacing is not ink", () => {
    const run: Run = { text: "ab c", font: { kind: "bundled", family: "Tinos" }, size: 10, color: "#000000", hScale: 0.5, charSpacing: 1, wordSpacing: 2 };
    const plain = textWidth("ab c", tinos, 10);
    expect(textWidth("ab c", tinos, 10, run)).toBeCloseTo(plain * 0.5 + 4 * 1 + 2, 6);
    expect(charOffsets("ab c", tinos, 10, run)[3]).toBeCloseTo(textWidth("ab ", tinos, 10, run), 6);
    const r = layoutText({ width: 500, align: "right", lineHeight: 12, paragraphs: [[run]] }, metricsFor);
    expect(r.contentWidth).toBeCloseTo(textWidth("ab c", tinos, 10, run) - 1, 6);
  });

  it("travels through the rich editor and back, and typed text takes it on", () => {
    const run = tz.runs[0];
    const [[back]] = docToRuns(runsToDoc([[run]]), attrsOf(run));
    expect(back).toEqual(run);
    expect(runOf("x", attrsOf(run)).hScale).toBe(run.hScale);
    expect(runOf("x", attrsOf({ ...run, hScale: undefined }))).not.toHaveProperty("hScale");
  });
});

// GET /text of tests.pdfs.make_layout_pdf() (Arimo/Tinos, bundled): wrap width and width clamps (P3).
const layoutFixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "text.json"), "utf8")) as TextData;
const metrics = new Map<string, FontMetrics>();
function bundled(f: FontRef): FontMetrics {
  if (isOriginal(f)) throw new Error("no original fonts in this fixture");
  const style = f.bold && f.italic ? "BoldItalic" : f.bold ? "Bold" : f.italic ? "Italic" : "Regular";
  const key = fontKey(f);
  if (!metrics.has(key)) metrics.set(key, metricsFromBuffer(readFileSync(path.join(FONTS, `${f.family}-${style}.ttf`))));
  return metrics.get(key)!;
}

describe("wrap slack and width clamps", () => {
  const wrapped = layoutFixture.pages[0].paragraphs.filter((p) => p.lines.length > 1 && p.align === "left" && p.maxWidth);

  it.each(wrapped.map((p) => [p.id, p] as const))("wraps %s wider than its widest line but keeps every original break", (_id, p) => {
    const natural = paragraphWidth(p, bundled);
    const width = wrapWidth(p, natural, bundled);
    expect(width).toBeGreaterThanOrEqual(natural);
    expect(width).toBeLessThanOrEqual(p.maxWidth! + 0.01);
    expect(paragraphFrame(p, bundled).width).toBe(width);
    const box = paragraphBox(p, bundled);
    expect(box.layout).toHaveLength(p.lines.length);
  });

  it("does not re-wrap a paragraph when one character is added to its widest line", () => {
    const p = wrapped.find((q) => wrapWidth(q, paragraphWidth(q, bundled), bundled) > paragraphWidth(q, bundled) + 8)!;
    expect(p).toBeDefined();
    const typo = (ps: ReturnType<typeof paragraphFrame>["paragraphs"]) => ps.map((runs, i) => (i ? runs : [{ ...runs[0], text: runs[0].text.replace(/^(\S+)/, "$1x") }, ...runs.slice(1)]));
    expect(paragraphBox(p, bundled, typo).layout).toHaveLength(p.lines.length);
    const tight = paragraphBox({ ...p, maxWidth: undefined }, bundled, typo); // the widest line as the width: no slack
    expect(paragraphFrame({ ...p, maxWidth: undefined }, bundled).width).toBeCloseTo(paragraphWidth(p, bundled), 6);
    expect(tight.rect.w).toBeLessThan(paragraphBox(p, bundled).rect.w);
  });

  it("clamps a single line measured wider than its room: it wraps instead of running off the page", () => {
    const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
    const p: Paragraph = {
      id: "g0", rect: { x: 500, y: 0, w: 60, h: 1 }, lines: [{ rect: { x: 500, y: 0, w: 60, h: 1 }, baseline: 1, size: 10, start: 0, end: 11 }],
      runs: [{ text: "abcde fghij", font: { kind: "bundled", family: "Arimo" }, size: 10, color: "#000000" }],
      align: "left", lineHeight: 12, editable: true, maxWidth: 80,
    };
    expect(paragraphFrame(p, () => mono).width).toBeCloseTo(80.01 + 1, 6); // measured 110 pt: room + OVERSHOOT
    expect(paragraphBox(p, () => mono).layout).toHaveLength(2);
    expect(paragraphFrame({ ...p, maxWidth: 200 }, () => mono).width).toBeCloseTo(200.01, 6); // room enough: the room
  });
});
