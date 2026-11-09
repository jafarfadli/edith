import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FontRef, LayoutLine, Run, TextBox, TextEdit } from "@edith/ops";
import type { Paragraph, TextData } from "@/lib/api";
import { prefixCut } from "@/lib/editLine";
import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { editedBox } from "@/lib/keepLines";
import { layoutText } from "@/lib/layout";
import { moveOp } from "@/lib/objects";
import { keptPrefixes, maskRects, paragraphBox, replacedLines } from "@/lib/paragraphs";
import { runsText } from "@/lib/runs";

// One point per character at size 1: positions are character counts.
const MONO: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
const mono = () => MONO;
const FONT = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
type Align = Paragraph["align"];

/**
 * A paragraph of `texts` (one per line, baselines 1 pt apart) in MONO at size 1, as GET /text gives it: lines from
 * `x0` (left), around `centre` or to `x1` (right); a justified paragraph's lines but the last spread to `column` from
 * `x0`. `wordX` from those positions.
 */
function para(texts: string[], align: Align, o: { x0?: number; centre?: number; x1?: number; column?: number; maxWidth?: number } = {}): Paragraph {
  let at = 0;
  const lines = texts.map((t, k) => {
    const words = [...t.matchAll(/\S+/g)];
    const stretch = align === "justify" && k < texts.length - 1 && words.length > 1 ? (o.column! - t.length) / (words.length - 1) : 0;
    const x = align === "center" ? o.centre! - t.length / 2 : align === "right" ? o.x1! - t.length : o.x0 ?? 10;
    const w = stretch ? o.column! : t.length;
    const line = { rect: { x, y: k, w, h: 1 }, baseline: k + 1, size: 1, start: at, end: at + t.length,
      wordX: words.map((m, i) => x + m.index! + i * stretch) };
    at += t.length + 1;
    return line;
  });
  const x = Math.min(...lines.map((l) => l.rect.x)), right = Math.max(...lines.map((l) => l.rect.x + l.rect.w));
  return { id: "g0", rect: { x, y: 0, w: right - x, h: texts.length }, lines, align, lineHeight: 1, editable: true,
    runs: [{ text: texts.join(" "), font: FONT, size: 1, color: "#000000" }], ...(o.maxWidth ? { maxWidth: o.maxWidth } : {}) };
}

/** `p` edited: `find` (first occurrence) replaced by `by`. */
function edit(p: Paragraph, find: string, by: string, metricsFor: (f: FontRef) => FontMetrics = mono): { start: TextBox; box: TextBox } {
  const start = paragraphBox(p, metricsFor);
  const at = start.paragraphs.findIndex((q) => runsText(q).includes(find));
  if (at < 0) throw new Error(`${find} not in the paragraph`);
  const paragraphs = start.paragraphs.map((q, i) => (i === at ? [{ ...q[0], text: runsText(q).replace(find, by) }] : q));
  return { start, box: editedBox(start, paragraphs, p, metricsFor) };
}

const lineText = (l: LayoutLine) => l.segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
const sources = (box: TextBox) => box.layout.map((l) => l.source ?? null);
/** Absolute x of each word drawn on layout line `k` (segments merged per word). */
function wordXs(box: TextBox, k: number): number[] {
  const out: number[] = [];
  let prevEnd = -Infinity;
  for (const s of box.layout[k].segments) {
    const m = /\S/.exec(s.text);
    if (!m) continue;
    const x = box.rect.x + s.x + m.index; // MONO: 1 pt per character
    if (x > prevEnd + 0.01 || /^\s/.test(s.text)) out.push(x);
    prevEnd = box.rect.x + s.x + s.text.trimEnd().length;
  }
  return out;
}

const TEXTS = ["aaaa bbbb cccc", "dd eeeeee ff", "ggggg"]; // soft breaks: 14 + " dd" = 17, 12 + " ggggg" = 18

describe("a one-character edit does not re-wrap a line that still fits (M5d)", () => {
  it("left: the edited line grows into the room beside it; its first word keeps its glyphs, the rest moves by the growth", () => {
    const p = para(TEXTS, "left", { x0: 10, maxWidth: 30 });
    const { box } = edit(p, "bbbb", "bbbbxx"); // line 1: 16 wide, under the narrowest soft break (17)
    expect(box.layout.map(lineText)).toEqual(["aaaa bbbbxx cccc", "dd eeeeee ff", "ggggg"]);
    expect(sources(box)).toEqual([null, 1, 2]);
    expect(box.layout[0].prefix).toEqual({ source: 0, segments: 1 });
    expect(wordXs(box, 0)).toEqual([10, 15, 22]); // aaaa and bbbb where they were, cccc 2 pt further
    // Wider than the original's soft breaks allow (18 > 17): it reflows, as before.
    expect(sources(edit(p, "bbbb", "bbbbxxxx").box)).toEqual([null, null, null]);
  });

  it("left without room (maxWidth = its width): the line re-wraps as the column is full", () => {
    const p = para(TEXTS, "left", { x0: 10, maxWidth: 14 });
    expect(edit(p, "bbbb", "bbbbxx").box.layout.map(lineText)).toEqual(["aaaa bbbbxx", "cccc dd eeeeee", "ff ggggg"]);
  });

  it("left: a shorter line keeps its break unless the next line's first word now fits on it", () => {
    const p = para(TEXTS, "left", { x0: 10, maxWidth: 30 });
    expect(edit(p, "cccc", "ccc").box.layout.map(lineText)).toEqual(["aaaa bbbb ccc", "dd eeeeee ff", "ggggg"]);
    expect(edit(p, " cccc", "").box.layout.map(lineText)).toEqual(["aaaa bbbb dd", "eeeeee ff ggggg"]);
  });

  it("centred: the line grows around its centre (every word moves by half the growth, none is kept)", () => {
    const p = para(TEXTS, "center", { centre: 50, maxWidth: 30 });
    const { box } = edit(p, "bbbb", "bbbbxx");
    expect(box.layout.map(lineText)).toEqual(["aaaa bbbbxx cccc", "dd eeeeee ff", "ggggg"]);
    expect(sources(box)).toEqual([null, 1, 2]);
    expect(box.layout[0].prefix).toBeUndefined();
    const [a, b, c] = p.lines[0].wordX!;
    expect(wordXs(box, 0)).toEqual([a - 1, b - 1, c + 1]);
  });

  it("right-aligned: the line grows leftwards (the words after the edit stay, the ones before move by the growth)", () => {
    const p = para(TEXTS, "right", { x1: 80, maxWidth: 30 });
    const { box } = edit(p, "bbbb", "bbbbxx");
    expect(box.layout.map(lineText)).toEqual(["aaaa bbbbxx cccc", "dd eeeeee ff", "ggggg"]);
    expect(sources(box)).toEqual([null, 1, 2]);
    const [a, b, c] = p.lines[0].wordX!;
    expect(wordXs(box, 0)).toEqual([a - 2, b - 2, c]);
  });

  describe("justified", () => {
    // 17 characters spread to 20: 5 gaps of 1.6 pt (spaces 1 pt). Next first words long: soft breaks.
    const J = ["aa bb cc dd ee ff", "gggggg hh ii jjj", "kkkkkk ll"];
    const p = para(J, "justify", { x0: 10, column: 20 });

    it("a line one letter too wide compresses its spaces instead of re-wrapping", () => {
      const { box } = edit(p, "bb", "bbxxxx"); // 21 wide: 1 pt over the column, 5 spaces may give 1.25
      expect(box.layout.map(lineText)).toEqual(["aa bbxxxx cc dd ee ff", "gggggg hh ii jjj", "kkkkkk ll"]);
      expect(sources(box)).toEqual([null, 1, 2]);
      const xs = wordXs(box, 0);
      expect(xs[0]).toBe(10);
      expect(xs[5] + 2).toBeCloseTo(30, 5); // still ends on the column
      // Compressed past JUSTIFY_SQUEEZE (two letters more: 23 for 21.25): it re-wraps (and settles on line 3).
      expect(sources(edit(p, "bb", "bbxxxxxx").box)).toEqual([null, null, 2]);
    });

    it("keeps the words before the edit (their glyphs) and its right edge; the gaps after the edit narrow evenly", () => {
      const { box } = edit(p, "cc", "ccxx");
      expect(sources(box)).toEqual([null, 1, 2]);
      expect(box.layout[0].prefix).toEqual({ source: 0, segments: 2 });
      const want = p.lines[0].wordX!;
      const xs = wordXs(box, 0);
      expect(xs.slice(0, 3)).toEqual(want.slice(0, 3)); // aa, bb kept; cc starts where it did
      expect(xs[5] + 2).toBeCloseTo(30, 5);
      const gaps = xs.slice(3).map((x, i) => x - (xs[2 + i] + (i === 0 ? 4 : 2)));
      for (const g of gaps) expect(g).toBeCloseTo(1.6 - 2 / 3, 5);
    });
  });

  it("re-places nothing in right-to-left text (layoutText's placement stands)", () => {
    const p = para(["אבג דהו זחט", "יכל מנס", "עפצ"], "left", { x0: 10, maxWidth: 30 });
    const { box } = edit(p, "דהו", "דהוx");
    expect(sources(box)).toEqual([null, 1, 2]);
    expect(box.layout[0].prefix).toBeUndefined();
    expect(box.layout[0].segments).toHaveLength(1); // one merged segment: the plain layout
  });

  it("keeps old behaviour without word positions (an older API): no prefix, the plain layout", () => {
    const p = para(TEXTS, "left", { x0: 10, maxWidth: 30 });
    const old = { ...p, lines: p.lines.map((l) => ({ ...l, wordX: undefined })) };
    const { box } = edit(old, "bbbb", "bbbbxx");
    expect(sources(box)).toEqual([null, 1, 2]);
    expect(box.layout[0].prefix).toBeUndefined();
  });
});

describe("a kept prefix on screen", () => {
  const p = para(TEXTS, "left", { x0: 10, maxWidth: 30 });
  const { box } = edit(p, "bbbb", "bbbbxx");

  it("is where the original's next word starts, as the bake counts it (non-space characters)", () => {
    expect(keptPrefixes(p, box)).toEqual(new Map([[0, 15]]));
    expect(prefixCut(runsText(p.runs), p.lines[0], box.layout[0].segments, 1)).toBe(15);
    expect(prefixCut(runsText(p.runs), p.lines[0], [{ x: 0, text: "aaaa bbbb cccc", runIndex: 0 }], 1)).toBe(24); // all: the end
  });

  it("is not covered nor counted as replaced; the rest of the line is", () => {
    const [cover] = maskRects(p, box);
    expect(cover.x).toBe(15);
    expect(cover.x + cover.w).toBe(24.5);
    expect(replacedLines(p, box)[0].rect).toEqual({ x: 15, y: 0, w: 9, h: 1 });
  });

  it("goes when the op is moved (every line is drawn then)", () => {
    const op: TextEdit = { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g0", box };
    expect(moveOp(op, 2, 0).box.layout.every((l) => !l.prefix && l.source == null)).toBe(true);
  });
});

describe("layoutText squeeze (justified text, M5d)", () => {
  const run = (text: string): Run => ({ text, font: FONT, size: 1, color: "#000000" });
  const ends = (l: LayoutLine) => Math.max(...l.segments.map((s) => s.x + s.text.trimEnd().length));

  it("keeps a line its spaces can absorb on one line and sets it to the width", () => {
    const input = { width: 20, align: "justify" as const, lineHeight: 1, paragraphs: [[run("aa bb cc dd ee ffffff xx")]] };
    expect(layoutText(input, mono).lines).toHaveLength(2); // "aa bb cc dd ee ffffff" is 21 wide
    const r = layoutText({ ...input, squeeze: 0.25 }, mono);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].segments.map((s) => s.text).join(" ")).toBe("aa bb cc dd ee ffffff");
    expect(ends(r.lines[0])).toBeCloseTo(20, 5);
  });

  it("compresses a last line that only fits so, and leaves a short last line ragged", () => {
    const r = layoutText({ width: 20, align: "justify", lineHeight: 1, squeeze: 0.25, paragraphs: [[run("aa bb cc dd ee ffffff")]] }, mono);
    expect(ends(r.lines[0])).toBeCloseTo(20, 5);
    const short = layoutText({ width: 20, align: "justify", lineHeight: 1, squeeze: 0.25, paragraphs: [[run("aa bb")]] }, mono);
    expect(ends(short.lines[0])).toBe(5);
  });
});

// The fixture (GET /text of apps/api tests.pdfs.make_layout_pdf()), real bundled fonts.
const FONTS = path.resolve(__dirname, "../../../../packages/fonts/files");
const metrics = new Map<string, FontMetrics>();
function bundled(f: FontRef): FontMetrics {
  if (isOriginal(f)) throw new Error("no original fonts in this fixture");
  const style = f.bold && f.italic ? "BoldItalic" : f.bold ? "Bold" : f.italic ? "Italic" : "Regular";
  if (!metrics.has(fontKey(f))) metrics.set(fontKey(f), metricsFromBuffer(readFileSync(path.join(FONTS, `${f.family}-${style}.ttf`))));
  return metrics.get(fontKey(f))!;
}
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "text.json"), "utf8")) as TextData;
const byId = (id: string) => fixture.pages[0].paragraphs.find((x) => x.id === id)!;

describe("real fonts: the words before an edit stay within 0.5 pt of the original", () => {
  it.each([["g0", "selebar", "selebat"], ["g1", "selebar", "selebarx"], ["g2", "kotak", "kotaks"], ["g4", "merusak", "merusakk"]])(
    "%s: %s → %s", (id, find, by) => {
      const p = byId(id);
      const { box } = edit(p, find, by, bundled);
      expect(box.layout).toHaveLength(p.lines.length); // no re-wrap
      const k = box.layout.findIndex((l) => l.source == null);
      const text = runsText(p.runs).slice(p.lines[k].start, p.lines[k].end);
      const before = text.slice(0, text.indexOf(find)).match(/\S+/g)!.length;
      const pos = wordXs2(box, k);
      const want = p.lines[k].wordX!;
      if (p.align === "left" || p.align === "justify") {
        expect(box.layout[k].prefix?.source).toBe(k);
        for (let i = 0; i < before; i++) expect(Math.abs(pos[i] - want[i])).toBeLessThan(0.5);
      } else {
        // Centred or right-aligned: every word keeps its place relative to the others (the line moved as a whole).
        const shift = pos[0] - want[0];
        for (let i = 0; i < before; i++) expect(Math.abs(pos[i] - want[i] - shift)).toBeLessThan(0.5);
      }
    });
});

/** Absolute x of each word of layout line `k` from its segments (real fonts: a segment starts a word or holds spaces). */
function wordXs2(box: TextBox, k: number): number[] {
  return box.layout[k].segments.filter((s) => /^\S/.test(s.text)).map((s) => box.rect.x + s.x);
}
