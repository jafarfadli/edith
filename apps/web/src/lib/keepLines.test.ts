import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FontRef, Run, TextBox, TextEdit } from "@edith/ops";
import { moveOp, resizeOp } from "@/lib/objects";
import type { Paragraph, TextData } from "@/lib/api";
import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { blankBox, editedBox, isBlankBox, KEEP_Y_EM, KEEP_Y_TOL, SPACE_CHARS } from "@/lib/keepLines";
import { layoutText } from "@/lib/layout";
import { keptLines, maskRects, paragraphBox, replacedLines } from "@/lib/paragraphs";
import { runsText } from "@/lib/runs";

const FONTS = path.resolve(__dirname, "../../../../packages/fonts/files");
const metrics = new Map<string, FontMetrics>();
function bundled(f: FontRef): FontMetrics {
  if (isOriginal(f)) throw new Error("no original fonts in this fixture");
  const style = f.bold && f.italic ? "BoldItalic" : f.bold ? "Bold" : f.italic ? "Italic" : "Regular";
  const key = fontKey(f);
  if (!metrics.has(key)) metrics.set(key, metricsFromBuffer(readFileSync(path.join(FONTS, `${f.family}-${style}.ttf`))));
  return metrics.get(key)!;
}

// GET /documents/{id}/text of apps/api tests.pdfs.make_layout_pdf(): LOREM wrapped in every alignment.
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "text.json"), "utf8")) as TextData;
const byId = (id: string) => fixture.pages[0].paragraphs.find((p) => p.id === id)!;
const LEFT = byId("g0"), JUSTIFY = byId("g1"), CENTER = byId("g2"), MONO = byId("g3");

const lineTexts = (p: Paragraph) => p.lines.map((l) => runsText(p.runs).slice(l.start, l.end));
const laidOut = (box: TextBox) => box.layout.map((l) => l.segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim());
const sources = (box: TextBox) => box.layout.map((l) => l.source ?? null);

/** The box of `p` after `change` rewrote its (single run) text. */
function edit(p: Paragraph, change: (text: string) => string): { start: TextBox; box: TextBox } {
  const start = paragraphBox(p, bundled);
  const run = start.paragraphs[0][0];
  const box = editedBox(start, [[{ ...run, text: change(runsText(start.paragraphs[0])) }]], p, bundled);
  return { start, box };
}

/** `text` with `find` (the `nth` occurrence) replaced. */
function swap(text: string, find: string, by: string, nth = 0): string {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = text.indexOf(find, at + 1);
  if (at < 0) throw new Error(`${find} not in ${text}`);
  return text.slice(0, at) + by + text.slice(at + find.length);
}

describe("editedBox keeps the lines an edit leaves alone", () => {
  it.each([LEFT, JUSTIFY, CENTER, MONO].map((p) => [p.id, p.align, p] as const))(
    "keeps every line of %s (%s) when nothing changed, exactly where paragraphBox put them", (_id, _align, p) => {
      const { start, box } = edit(p, (t) => t);
      expect(sources(box)).toEqual(p.lines.map((_, i) => i));
      expect(box.rect).toEqual(start.rect);
      expect(box.layout.map((l) => l.baseline)).toEqual(start.layout.map((l) => l.baseline));
    });

  it("redraws only the first line after a one-character edit in it", () => {
    const { box } = edit(LEFT, (t) => swap(t, "rapi", "rapih"));
    expect(sources(box)).toEqual([null, 1, 2, 3]);
    expect(laidOut(box)).toEqual(lineTexts(LEFT).map((t, i) => (i === 0 ? swap(t, "rapi", "rapih") : t)));
  });

  it.each([{ hScale: 0.95 }, { charSpacing: 0.01 }, { wordSpacing: 0.01 }])(
    "keeps no line whose run's scale or spacing differs from the original's (%o), as the bake checks", (spacing) => {
      const start = paragraphBox(LEFT, bundled);
      const run = start.paragraphs[0][0];
      const box = editedBox(start, [[{ ...run, ...spacing }]], LEFT, bundled);
      expect(keptLines(box).size).toBe(0);
      expect(keptLines(editedBox(start, [[{ ...run }]], LEFT, bundled)).size).toBe(LEFT.lines.length);
    });

  it("redraws only a middle line after an edit in it", () => {
    const { box } = edit(LEFT, (t) => swap(t, "selebar", "selebat"));
    expect(sources(box)).toEqual([0, null, 2, 3]);
  });

  it("redraws only the last line after an edit in it", () => {
    const { box } = edit(LEFT, (t) => swap(t, "sama.", "sama!"));
    expect(sources(box)).toEqual([0, 1, 2, null]);
  });

  it("redraws every line an insertion re-wraps, down to the end when the reflow never settles", () => {
    // "baru sekali " makes line 2 wider than any line the original's soft breaks allow: it no longer fits (M5d).
    const { box } = edit(MONO, (t) => swap(t, "Teks mengalir", "Teks baru sekali mengalir"));
    expect(laidOut(box)).toEqual(["Edith menyunting paragraf asli dengan", "rapi. Teks baru sekali mengalir ulang",
      "di dalam kotak selebar tetap, dan gaya", "bisa diatur per kata tanpa merusak", "baris lain di halaman yang sama."]);
    expect(sources(box)).toEqual([0, null, null, null, null]);
  });

  it("lets an edited line grow into the room beside it while the original's soft breaks allow it (M5d)", () => {
    // Line 2 (34 characters) + "baru " = 39: wider than the widest line (37), narrower than any line + next word (40).
    const { box } = edit(MONO, (t) => swap(t, "Teks mengalir", "Teks baru mengalir"));
    expect(laidOut(box)).toEqual(["Edith menyunting paragraf asli dengan", "rapi. Teks baru mengalir ulang di dalam",
      "kotak selebar tetap, dan gaya bisa", "diatur per kata tanpa merusak baris", "lain di halaman yang sama."]);
    expect(sources(box)).toEqual([0, null, 2, 3, 4]);
  });

  it("keeps the lines after an insertion once the re-wrap settled on an original line start", () => {
    // Monospaced 1 pt per character, 20 pt wide. Line 1 has room for "dddd", pushed down by "xx"; line 2 starts as before.
    const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
    const text = "aaaa bbbb cccc dddd ee ffff gggg hh iiiiii jjjj kkkk mmmm";
    const spans = [[0, 19], [20, 35], [36, 52], [53, 57]];
    const p: Paragraph = {
      id: "g0", rect: { x: 10, y: 0, w: 20, h: 4 }, align: "left", lineHeight: 1, editable: true,
      lines: spans.map(([start, end], i) => ({ rect: { x: 10, y: i, w: end - start, h: 1 }, baseline: i + 1, size: 1, start, end })),
      runs: [{ text, font: { kind: "bundled", family: "Arimo" }, size: 1, color: "#000000" }],
    };
    const start = paragraphBox(p, () => mono);
    expect(sources(editedBox(start, start.paragraphs, p, () => mono))).toEqual([0, 1, 2, 3]);
    const box = editedBox(start, [[{ ...p.runs[0], text: swap(text, "aaaa", "aaaaxx") }]], p, () => mono);
    expect(laidOut(box)).toEqual(["aaaaxx bbbb cccc", "dddd ee ffff gggg hh", "iiiiii jjjj kkkk", "mmmm"]);
    expect(sources(box)).toEqual([null, null, 2, 3]);
    expect(box.layout.map((l) => box.rect.y + l.baseline)).toEqual([1, 2, 3, 4]);
  });

  it("redraws the lines below a deleted line (they move up) and keeps the ones above", () => {
    const lines = lineTexts(LEFT);
    const { box } = edit(LEFT, (t) => t.replace(`${lines[1]} `, ""));
    expect(box.layout).toHaveLength(3);
    expect(sources(box)).toEqual([0, null, null]);
    expect(laidOut(box)).toEqual([lines[0], lines[2], lines[3]]);
  });

  it("keeps the stretched lines of a justified paragraph and redraws the edited one", () => {
    const { start, box } = edit(JUSTIFY, (t) => swap(t, "kotak", "kotaK"));
    expect(sources(box)).toEqual([0, null, 2]);
    expect(box.layout[1].segments.at(-1)!.x).toBeCloseTo(start.layout[1].segments.at(-1)!.x, 1); // still justified
  });

  it("redraws a line whose style changed (a word recoloured) and keeps the others", () => {
    const start = paragraphBox(LEFT, bundled);
    const run = start.paragraphs[0][0];
    const text = runsText(start.paragraphs[0]);
    const at = text.indexOf("selebar");
    const runs: Run[] = [{ ...run, text: text.slice(0, at) }, { ...run, text: "selebar", color: "#cc0000" }, { ...run, text: text.slice(at + 7) }];
    expect(sources(editedBox(start, [runs], LEFT, bundled))).toEqual([0, null, 2, 3]);
  });

  it("keeps nothing once the box moved or was resized", () => {
    const start = paragraphBox(LEFT, bundled);
    for (const rect of [{ ...start.rect, x: start.rect.x + 5 }, { ...start.rect, y: start.rect.y + 5 }, { ...start.rect, w: start.rect.w + 20 }]) {
      expect(sources(editedBox({ ...start, rect }, start.paragraphs, LEFT, bundled)).every((s) => s === null)).toBe(true);
    }
    expect(sources(editedBox({ ...start, align: "center" }, start.paragraphs, LEFT, bundled)).every((s) => s === null)).toBe(true);
  });

  it("does not keep a line whose grid baseline is off its uneven original one (as the bake would not)", () => {
    // Baselines 100, 112, 124, 141 at 10 pt (lineHeight = median 12): the grid puts line 4 at 136, 5 pt off.
    const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
    const texts = ["aaaa bbbb cccc dddd", "ee ffff gggg hh", "iiiiii jjjj kkkk", "mmmm"];
    let at = 0;
    const lines = texts.map((t, i) => {
      const b = [100, 112, 124, 141][i];
      const line = { rect: { x: 10, y: b - 8, w: t.length * 10, h: 12 }, baseline: b, size: 10, start: at, end: at + t.length };
      at += t.length + 1;
      return line;
    });
    const p: Paragraph = { id: "g0", rect: { x: 10, y: 92, w: 200, h: 52 }, align: "left", lineHeight: 12, editable: true, lines,
      runs: [{ text: texts.join(" "), font: { kind: "bundled", family: "Arimo" }, size: 10, color: "#000000" }] };
    const start = paragraphBox(p, () => mono);
    expect(sources(editedBox(start, start.paragraphs, p, () => mono))).toEqual([0, 1, 2, null]);
    const typo = editedBox(start, [[{ ...p.runs[0], text: swap(p.runs[0].text, "aaaa", "aaab") }]], p, () => mono);
    expect(sources(typo)).toEqual([null, 1, 2, null]);
    expect(KEEP_Y_TOL).toBe(1);
    expect(KEEP_Y_EM).toBe(0.4); // apps/api/edith/bake/text.py KEEP_Y_TOL, KEEP_Y_EM = 1.0, 0.4
  });

  it("drops the kept lines when the op is moved or resized (every line is drawn then)", () => {
    const { box } = edit(LEFT, (t) => swap(t, "rapi", "rapih"));
    const op: TextEdit = { id: "e", type: "text.edit", pageKey: "o0", paragraphId: LEFT.id, box };
    for (const moved of [moveOp(op, 3, 0), resizeOp(op, { ...box.rect, w: box.rect.w + 10 })]) {
      expect(sources(moved.box).every((s) => s === null)).toBe(true);
      expect(moved.box.layout.map((l) => l.segments)).toEqual(box.layout.map((l) => l.segments));
    }
  });

  it("drops the kept lines in the text resize hook even while its fonts load (no relayout yet)", async () => {
    const { installTextTool } = await import("@/components/editor/text/install");
    const { overlayHooks } = await import("@/components/editor/PageOverlay");
    installTextTool();
    const { box } = edit(LEFT, (t) => swap(t, "rapi", "rapih"));
    const op: TextEdit = { id: "e", type: "text.edit", pageKey: "o0", paragraphId: LEFT.id, box };
    const resized = overlayHooks.resizeText!(op, { ...box.rect, w: box.rect.w + 10 }); // the test's fonts are not in fontStore
    expect(resized.box.rect.w).toBeCloseTo(box.rect.w + 10);
    expect(sources(resized.box).every((s) => s === null)).toBe(true);
  });

  it("recomputes from the original when an edited box is edited again (undo of the typo keeps everything)", () => {
    const { box } = edit(LEFT, (t) => swap(t, "rapi", "rapih"));
    const back = editedBox(box, [[{ ...box.paragraphs[0][0], text: runsText(LEFT.runs) }]], LEFT, bundled);
    expect(sources(back)).toEqual([0, 1, 2, 3]);
  });
});

describe("whitespace", () => {
  it("is exactly SPACE_CHARS for the layout (\\s), as the bake's SPACE_CHARS lists it", () => {
    const space: string[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) if (/\s/.test(String.fromCharCode(cp))) space.push(String.fromCharCode(cp));
    expect(space.join("")).toBe(SPACE_CHARS);
    for (const c of "\x1c\x1d\x1e\x1f\x85") expect(SPACE_CHARS).not.toContain(c); // Python's isspace() would take these
  });
});

describe("kept lines on screen", () => {
  it("covers only the original lines the box replaces, an edited line only from its first edited word on", () => {
    const { box } = edit(LEFT, (t) => swap(t, "selebar", "selebat"));
    expect([...keptLines(box)]).toEqual([0, 2, 3]);
    // Line 2 "mengalir ulang di dalam kotak selebar tetap, dan": its first five words keep their glyphs (M5d).
    const line = LEFT.lines[1], cut = line.wordX![5];
    expect(box.layout[1].prefix).toEqual({ source: 1, segments: 5 }); // one segment per word
    expect(box.layout[1].segments.slice(0, 5).map((s) => s.text).join("")).toBe("mengalir ulang di dalam kotak ");
    const rest = { ...line, rect: { ...line.rect, x: cut, w: line.rect.x + line.rect.w - cut } };
    expect(replacedLines(LEFT, box)).toEqual([rest]);
    const [cover] = maskRects(LEFT, box);
    expect(cover.x).toBe(cut);
    expect(cover.x + cover.w).toBeCloseTo(line.rect.x + line.rect.w + 0.5);
    expect(maskRects(LEFT)).toHaveLength(4); // no box (the editor is open): every line
  });

  it("stops a cover where a kept neighbour's band starts at tight leading (descenders stay visible)", () => {
    // 10 pt lines at a 10 pt leading: bands (0.95 above, 0.25 below the baseline) overlap by 2 pt.
    const line = (baseline: number) => ({ rect: { x: 10, y: baseline - 9, w: 100, h: 12 }, baseline, size: 10, start: 0, end: 1 });
    const p = { ...LEFT, lines: [line(100), line(110), line(120)] };
    const layout = (sources: (number | null)[]) => ({ ...paragraphBox(LEFT, bundled), layout: sources.map((s) => ({ baseline: 0, segments: [], ...(s === null ? {} : { source: s }) })) });
    const [middle] = maskRects(p, layout([0, null, 2]));
    expect(middle.y).toBeCloseTo(102.5); // below the upper line's descenders (0.25 em) …
    expect(middle.y + middle.h).toBeCloseTo(112.5); // … above the lower line's ascenders (0.75 em)
    expect(middle.y).toBeLessThanOrEqual(110 - 0.75 * 10); // still over the replaced line's own ascenders
    // Two replaced lines next to each other keep their full covers between them.
    const [first, second] = maskRects(p, layout([null, null, 2]));
    expect(first.y).toBeCloseTo(100 - 9.5);
    expect(first.y + first.h).toBeCloseTo(102.5);
    expect(second.y).toBeCloseTo(110 - 9.5);
    // Wide leading: nothing to share, the usual covers.
    const loose = { ...LEFT, lines: [line(100), line(120)] };
    expect(maskRects(loose, layout([0, null]))[0]).toEqual({ x: 9.5, y: 120 - 9.5, w: 101, h: 12 });
  });

  it.each(["", "  \n "])("text left blank (%j) deletes the paragraph: no line kept, every line covered, the box over it", (blank) => {
    const { start, box } = edit(LEFT, () => blank);
    expect(isBlankBox(box)).toBe(true);
    expect(box.paragraphs).toEqual([[{ ...start.paragraphs[0][0], text: "" }]]);
    expect(box.layout).toEqual([{ baseline: expect.any(Number), segments: [] }]);
    expect(box.rect.y + box.layout[0].baseline).toBeCloseTo(start.rect.y + start.layout[0].baseline);
    expect(box.rect.y).toBeLessThanOrEqual(LEFT.rect.y);
    expect(box.rect.y + box.rect.h).toBeGreaterThanOrEqual(LEFT.rect.y + LEFT.rect.h);
    expect([box.rect.x, box.rect.w]).toEqual([start.rect.x, start.rect.w]);
    expect(keptLines(box).size).toBe(0);
    expect(replacedLines(LEFT, box)).toEqual(LEFT.lines);
    expect(maskRects(LEFT, box)).toHaveLength(LEFT.lines.length);
    expect(blankBox(box, LEFT.rect)).toEqual(box); // deleting it again changes nothing
  });

  it("treats an op from an older draft (no `source`) as redrawing every line, as before", () => {
    const { box } = edit(LEFT, (t) => swap(t, "selebar", "selebat"));
    const old: TextBox = JSON.parse(JSON.stringify({ ...box, layout: box.layout.map((l) => ({ baseline: l.baseline, segments: l.segments })) }));
    expect(keptLines(old).size).toBe(0);
    expect(maskRects(LEFT, old)).toHaveLength(4);
    // Edited again, it is compared with the original afresh.
    expect(sources(editedBox(old, old.paragraphs, LEFT, bundled))).toEqual([0, null, 2, 3]);
  });
});

describe("layoutText forced breaks", () => {
  const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
  const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
  const run = (text: string): Run => ({ text, font, size: 10, color: "#000000" });
  const texts = (r: ReturnType<typeof layoutText>) => r.lines.map((l) => l.segments.map((s) => s.text).join("|"));

  it("starts a line at each forced offset even when the next word would fit", () => {
    const r = layoutText({ width: 1000, align: "left", lineHeight: 12, paragraphs: [[run("aa bb cc dd")]], breaks: [3, 9] }, () => mono);
    expect(texts(r)).toEqual(["aa", "bb cc", "dd"]);
    expect(r.ranges).toEqual([{ start: 0, end: 2, last: false }, { start: 3, end: 8, last: false }, { start: 9, end: 11, last: true }]);
  });

  it("splits a word at a forced offset inside it (CJK wraps between characters)", () => {
    const r = layoutText({ width: 1000, align: "left", lineHeight: 12, paragraphs: [[run("신청서작성"), run("방법")]], breaks: [3, 6] }, () => mono);
    expect(texts(r)).toEqual(["신청서", "작성|방", "법"]);
    expect(r.ranges.map((x) => [x.start, x.end])).toEqual([[0, 3], [3, 6], [6, 7]]);
  });

  it("counts the newline between paragraphs in its offsets", () => {
    const r = layoutText({ width: 1000, align: "left", lineHeight: 12, paragraphs: [[run("ab cd")], [run("")], [run("ef")]] }, () => mono);
    expect(r.ranges).toEqual([{ start: 0, end: 5, last: true }, { start: 6, end: 6, last: true }, { start: 7, end: 9, last: true }]);
  });
});
