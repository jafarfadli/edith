import { describe, expect, it } from "vitest";
import type { FontRef, Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { fontKey, type FontMetrics } from "@/lib/fonts";
import { applyPatch, attrsOf, docToRuns, fontStyle, patchFont, runCss, runOf, runsToDoc } from "@/lib/richtext";

const arimo = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const r = (text: string, extra: Partial<Run> = {}): Run => ({ text, font: arimo, size: 12, color: "#111111", ...extra });
const doc = (ref: string, name: string, bold: boolean, reusable = true): DocFont => ({
  ref, name, embedded: true, format: "ttf", reusable, family: "calibri", bold, italic: false,
  substitute: { kind: "bundled", family: "Carlito", bold, italic: false },
});
const fonts = { f1: doc("f1", "Calibri", false), f2: doc("f2", "Calibri-Bold", true) };

describe("rich text model", () => {
  it("round-trips runs through the editor JSON", () => {
    const paragraphs = [[r("Halo "), r("tebal", { font: { ...arimo, bold: true }, underline: true })], [r("akhir", { bgColor: "#ffff00" })]];
    expect(docToRuns(runsToDoc(paragraphs), attrsOf(r("")))).toEqual(paragraphs);
  });

  it("gives an empty paragraph the style of the text before it", () => {
    const red = r("merah", { color: "#ff0000" });
    expect(docToRuns(runsToDoc([[red], [r("")]]), attrsOf(r(""))))
      .toEqual([[red], [r("", { color: "#ff0000" })]]);
  });

  it("gives unmarked text the previous style or the fallback", () => {
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "tempel" }] }] };
    expect(docToRuns(json, attrsOf(r("", { color: "#ff0000" })))).toEqual([[r("tempel", { color: "#ff0000" })]]);
    expect(docToRuns({ type: "doc" }, attrsOf(r("")))).toEqual([[r("")]]);
  });

  it("keeps the previous font when a pasted mark has none", () => {
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "run", attrs: { font: null, size: 20 } }] }] }] };
    expect(docToRuns(json, attrsOf(r("")))[0][0]).toEqual(r("x", { size: 20 }));
  });

  it("ignores null mark attrs and inherits the previous or fallback style", () => {
    const mark = { type: "run", attrs: { font: null, size: null, color: null, bgColor: null, underline: true } };
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [mark] }] }] };
    expect(docToRuns(json, attrsOf(r("", { size: 14, color: "#ff0000" })))[0][0]).toEqual(r("x", { size: 14, color: "#ff0000", underline: true }));
  });

  it("leaves default decoration fields out", () => {
    expect(runOf("x", attrsOf(r("")))).toEqual(r("x"));
  });

  it("toggles bold on a bundled font", () => {
    expect(patchFont(arimo, { bold: true }, {})).toEqual({ ...arimo, bold: true });
    expect(patchFont(arimo, { size: 3 }, {})).toBe(arimo);
  });

  it("keeps an original font when the document has the variant, else uses the substitute", () => {
    expect(patchFont({ kind: "original", ref: "f1" }, { bold: true }, fonts)).toEqual({ kind: "original", ref: "f2" });
    expect(patchFont({ kind: "original", ref: "f1" }, { italic: true }, fonts)).toEqual({ kind: "bundled", family: "Carlito", bold: false, italic: true });
    expect(patchFont({ kind: "original", ref: "f1" }, { family: "Lora" }, fonts)).toEqual({ kind: "bundled", family: "Lora", bold: false, italic: false });
    expect(fontStyle({ kind: "original", ref: "f2" }, fonts)).toEqual({ family: "Carlito", bold: true, italic: false, original: "f2" });
  });

  it("applies a patch", () => {
    const a = applyPatch(attrsOf(r("")), { size: 20, bgColor: "#00ff00", strike: true }, {});
    expect(a).toMatchObject({ size: 20, bgColor: "#00ff00", strike: true, underline: false, color: "#111111" });
    expect(applyPatch(a, { bgColor: null }, {}).bgColor).toBeNull();
  });

  it("keeps the original's measured scale and spacing for a colour or decoration, drops them for another font or size", () => {
    const spaced = { ...attrsOf(r("")), hScale: 0.947, charSpacing: -0.3, wordSpacing: 1.2 };
    const keep = { hScale: 0.947, charSpacing: -0.3, wordSpacing: 1.2 };
    expect(applyPatch(spaced, { color: "#ff0000", underline: true }, {})).toMatchObject(keep);
    for (const patch of [{ family: "Lora" }, { size: 14 }, { bold: true }]) {
      const out = applyPatch(spaced, patch, {});
      expect(out, JSON.stringify(patch)).not.toHaveProperty("hScale");
      expect(out).not.toHaveProperty("charSpacing");
      expect(out).not.toHaveProperty("wordSpacing");
    }
    expect(applyPatch(spaced, { size: spaced.size }, {})).toMatchObject(keep); // the same size: unchanged
  });

  it("builds editor CSS", () => {
    const css = runCss(attrsOf(r("", { underline: true, strike: true, bgColor: "#ffff00" })));
    expect(css).toContain('font-family:"edith-Arimo-regular"');
    expect(css).toContain("font-size:calc(var(--edith-scale, 1) * 12px)");
    expect(css).toContain("text-decoration-line:underline line-through");
    expect(css).toContain("background-color:#ffff00");
  });
});

describe("formatting of original text", () => {
  // DocFonts as GET /text gives them for a Word PDF: the family key without style and vendor suffixes, bold / italic
  // from the name (or the program), the bundled substitute.
  const font = (ref: string, name: string, family: string, bold: boolean, italic: boolean, sub: string, reusable = true): DocFont => ({
    ref, name, embedded: true, format: "ttf", reusable, family, bold, italic, substitute: { kind: "bundled", family: sub, bold, italic },
  });
  const word = {
    f10: font("f10", "TimesNewRomanPSMT", "timesnewroman", false, false, "Tinos"),
    f11: font("f11", "TimesNewRomanPS-BoldMT", "timesnewroman", true, false, "Tinos"),
    f12: font("f12", "TimesNewRomanPS-ItalicMT", "timesnewroman", false, true, "Tinos"),
    f20: font("f20", "Calibri-Bold", "calibri", true, false, "Carlito"),
    f30: font("f30", "Arial-BoldMT", "arial", true, false, "Arimo"),
    f40: font("f40", "Dotum", "dotum", false, false, "Noto Sans KR"),
    f50: font("f50", "Tahoma-Bold", "tahoma", true, false, "Arimo", false),
  };
  const orig = (ref: string) => ({ kind: "original" as const, ref });

  it("shows the original font's bold and italic in the toolbar", () => {
    expect(fontStyle(orig("f20"), word)).toMatchObject({ bold: true, italic: false, original: "f20" });
    expect(fontStyle(orig("f30"), word)).toMatchObject({ bold: true, italic: false });
    expect(fontStyle(orig("f12"), word)).toMatchObject({ bold: false, italic: true });
    expect(fontStyle(orig("f40"), word)).toMatchObject({ bold: false, italic: false });
    // Not reusable: the run is in its substitute, which keeps the style.
    expect(fontStyle(word.f50.substitute, word)).toMatchObject({ family: "Arimo", bold: true });
  });

  it("toggles bold / italic to the original variant of the same family, else to the bundled substitute's", () => {
    expect(patchFont(orig("f10"), { bold: true }, word)).toEqual(orig("f11"));
    expect(patchFont(orig("f11"), { bold: false }, word)).toEqual(orig("f10"));
    expect(patchFont(orig("f10"), { italic: true }, word)).toEqual(orig("f12"));
    expect(patchFont(orig("f11"), { italic: true }, word)).toEqual({ kind: "bundled", family: "Tinos", bold: true, italic: true });
    expect(patchFont(orig("f20"), { italic: true }, word)).toEqual({ kind: "bundled", family: "Carlito", bold: true, italic: true });
    expect(patchFont(orig("f40"), { bold: true }, word)).toEqual({ kind: "bundled", family: "Noto Sans KR", bold: true, italic: false });
  });

  it("toggles a word to the embedded variant only when it draws the whole word, else the whole word to the substitute", () => {
    // The bold subset has only "Bab I": a word it lacks a letter of goes to the bundled Tinos Bold as a whole.
    const boldSubset = { hasGlyph: (cp: number) => "Bab I".includes(String.fromCodePoint(cp)) } as FontMetrics;
    const peek = (f: FontRef) => (fontKey(f) === fontKey(orig("f11")) ? boldSubset : null);
    expect(patchFont(orig("f10"), { bold: true }, word, { text: "Bab I", peek })).toEqual(orig("f11"));
    expect(patchFont(orig("f10"), { bold: true }, word, { text: "Bab II", peek })).toEqual(orig("f11"));
    expect(patchFont(orig("f10"), { bold: true }, word, { text: "Pendahuluan", peek }))
      .toEqual({ kind: "bundled", family: "Tinos", bold: true, italic: false });
    // The variant not loaded yet: its glyphs are unknown, the substitute draws the word.
    expect(patchFont(orig("f10"), { bold: true }, word, { text: "Bab", peek: () => null }))
      .toEqual({ kind: "bundled", family: "Tinos", bold: true, italic: false });
    expect(applyPatch({ ...attrsOf(r("")), font: orig("f10") }, { bold: true }, word, { text: "Pendahuluan", peek }).font)
      .toEqual({ kind: "bundled", family: "Tinos", bold: true, italic: false });
  });

  const underlined = r("garis", { underline: true, underlineTop: 0.116, decorThickness: 0.064, decorColor: "#0000ff" });

  it("carries the original's underline geometry and colour through the editor, copy/paste and a restyle", () => {
    expect(runOf("garis", attrsOf(underlined))).toEqual(underlined);
    expect(docToRuns(runsToDoc([[underlined, r(" biasa")]]), attrsOf(r("")))).toEqual([[underlined, r(" biasa")]]);
    // Bigger text: the geometry is in ems, it stays; underline off: it goes; on again: the default geometry.
    expect(applyPatch(attrsOf(underlined), { size: 20, color: "#ff0000" }, {})).toMatchObject({ underlineTop: 0.116, decorThickness: 0.064, decorColor: "#0000ff" });
    const off = applyPatch(attrsOf(underlined), { underline: false }, {});
    expect(runOf("x", off)).toEqual(r("x"));
    expect(runOf("x", applyPatch(off, { underline: true }, {}))).toEqual(r("x", { underline: true }));
    // A strikethrough keeps the shared thickness and colour, not the underline's position.
    expect(runOf("x", applyPatch(attrsOf(underlined), { underline: false, strike: true }, {})))
      .toEqual(r("x", { strike: true, decorThickness: 0.064, decorColor: "#0000ff" }));
  });

  it("draws the original's line colour and thickness in the editor", () => {
    const css = runCss(attrsOf(underlined));
    expect(css).toContain("text-decoration-color:#0000ff");
    expect(css).toContain("text-decoration-thickness:calc(var(--edith-scale, 1) * 0.768px)");
    expect(runCss(attrsOf(r("")))).not.toContain("text-decoration-color");
  });
});

describe("fonts of imported PDFs", () => {
  const info = (ref: string, doc: string | undefined, bold: boolean) => ({
    ref, doc, name: "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold, italic: false,
    substitute: { kind: "bundled" as const, family: "Carlito", bold, italic: false },
  });
  const fonts = { f1: info("f1", undefined, false), f2: info("f2", undefined, true), "I/f1": info("f1", "I", false), "I/f9": info("f9", "I", true) };

  it("resolve by document and switch to a variant of the same PDF", () => {
    expect(fontStyle({ kind: "original", ref: "f1", doc: "I" }, fonts).original).toBe("I/f1");
    expect(patchFont({ kind: "original", ref: "f1", doc: "I" }, { bold: true }, fonts)).toEqual({ kind: "original", ref: "f9", doc: "I" });
    expect(patchFont({ kind: "original", ref: "f1" }, { bold: true }, fonts)).toEqual({ kind: "original", ref: "f2" });
    expect(fontKey({ kind: "original", ref: "f1", doc: "I" })).toBe("orig-I-f1");
  });
});
