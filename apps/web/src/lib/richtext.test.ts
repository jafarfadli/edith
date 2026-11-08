import { describe, expect, it } from "vitest";
import type { Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { fontKey } from "@/lib/fonts";
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

  it("builds editor CSS", () => {
    const css = runCss(attrsOf(r("", { underline: true, strike: true, bgColor: "#ffff00" })));
    expect(css).toContain('font-family:"edith-Arimo-regular"');
    expect(css).toContain("font-size:calc(var(--edith-scale, 1) * 12px)");
    expect(css).toContain("text-decoration-line:underline line-through");
    expect(css).toContain("background-color:#ffff00");
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
