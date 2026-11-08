import { describe, expect, it } from "vitest";
import type { FontRef, Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { cjkScript, documentScript, fallbackChain, hasUnsupportedChars, preloadFallback, prepareRuns, resolveLoadedRuns, type CjkScript, type FallbackFonts } from "@/lib/fallback";
import { fontKey, isOriginal, type FontMetrics } from "@/lib/fonts";

const ORIG = { kind: "original" as const, ref: "f9" };
const bundled = (family: string, bold = false, italic = false): FontRef => ({ kind: "bundled", family, bold, italic });
const fonts: Record<string, DocFont> = {
  f9: { ref: "f9", name: "Dotum", embedded: true, format: "ttf", reusable: true, family: "dotum", bold: false, italic: false,
        substitute: { kind: "bundled", family: "Arimo", bold: false, italic: false } },
};
const run = (text: string, font: FontRef = ORIG): Run => ({ text, font, size: 12, color: "#000000" });
const has = (chars: string): FontMetrics => ({ unitsPerEm: 1000, ascent: 800, descent: 200, advance: () => 500,
  hasGlyph: (cp) => chars.includes(String.fromCodePoint(cp)) });

const LATIN = "abcdefghijklmnopqrstuvwxyz ";
/** What each font has: the original subset "신청서 ab"; Arimo Latin; Noto Sans Latin + "✓"; the CJK pack families Hangul
 *  + Han; nothing has "😀". */
const glyphs: Record<string, FontMetrics> = {
  [fontKey(ORIG)]: has("신청서 ab"),
  "Arimo-regular": has(LATIN), "Arimo-bold": has(LATIN), "Tinos-regular": has(LATIN),
  "Noto Sans-regular": has(LATIN + "✓"), "Noto Sans-bold": has(LATIN + "✓"),
  "Noto Sans KR-regular": has(LATIN + "변경신청서漢字"), "Noto Serif KR-regular": has(LATIN + "변경신청서漢字"),
  "Noto Sans JP-regular": has(LATIN + "漢字かな"),
};
const peekAll = (f: FontRef) => glyphs[fontKey(f)] ?? null;
const PACK: Record<CjkScript, Record<string, string>> = {
  kr: { sans: "Noto Sans KR", serif: "Noto Serif KR" }, jp: { sans: "Noto Sans JP" }, sc: {},
};
const lookup = (han: CjkScript = "kr", pack = PACK): FallbackFonts => ({
  cjkFamily: (script, category) => pack[script][category === "serif" ? "serif" : "sans"] ?? Object.values(pack[script])[0] ?? null,
  categoryOf: (family) => ({ Arimo: "sans", Tinos: "serif", Lato: "sans" } as Record<string, string>)[family] ?? null,
  hanScript: () => han,
});
const texts = (rs: Run[][] | null) => rs?.flat().map((r) => [r.text, isOriginal(r.font) ? "orig" : r.font.family]);

describe("cjkScript / documentScript", () => {
  it("knows Hangul, kana and Han (Han and CJK punctuation follow the document)", () => {
    expect(["한", "ㄱ", "か", "カ", "漢", "。", "Ａ", "a"].map((c) => cjkScript(c.codePointAt(0)!, "sc"))).toEqual(["kr", "kr", "jp", "jp", "sc", "sc", "sc", null]);
  });
  it("picks the document's script for Han characters", () => {
    expect(documentScript(["사증발급신청서 漢字姓名"])).toBe("kr");
    expect(documentScript(["漢字かな"])).toBe("jp");
    expect(documentScript(["汉字", "Latin"])).toBe("sc");
  });
});

describe("fallbackChain", () => {
  it("original → substitute → CJK pack (script, design) → Arimo → Noto Sans", () => {
    const chain = (f: FontRef, ch: string, l = lookup()) => fallbackChain(f, ch.codePointAt(0)!, fonts, l).map((x) => (isOriginal(x) ? "orig" : x.family));
    expect(chain(ORIG, "변")).toEqual(["orig", "Arimo", "Noto Sans KR", "Noto Sans"]);
    expect(chain(ORIG, "x")).toEqual(["orig", "Arimo", "Noto Sans"]);
    expect(chain(bundled("Tinos"), "변")).toEqual(["Tinos", "Noto Serif KR", "Arimo", "Noto Sans"]); // serif design
    expect(chain(bundled("Tinos"), "漢", lookup("jp"))).toEqual(["Tinos", "Noto Sans JP", "Arimo", "Noto Sans"]); // no JP serif
    expect(chain(bundled("Lato"), "변", lookup("kr", { kr: {}, jp: {}, sc: {} }))).toEqual(["Lato", "Arimo", "Noto Sans"]); // no pack
    expect(fallbackChain(bundled("Lato", true, false), "변".codePointAt(0)!, fonts, lookup())[1]).toEqual(bundled("Noto Sans KR", true, false));
  });
});

describe("resolveLoadedRuns", () => {
  it("keeps every character the original font has in it and splits off the others", () => {
    expect(texts(resolveLoadedRuns([[run("신청서 변경 ab✓")]], fonts, peekAll, lookup()))).toEqual([
      ["신청서 ", "orig"], ["변경", "Noto Sans KR"], [" ab", "orig"], ["✓", "Noto Sans"]]);
  });
  it("returns runs that need no fallback as they are", () => {
    const p = [[run("신청서 ab")]];
    expect(resolveLoadedRuns(p, fonts, peekAll, lookup())?.[0][0]).toBe(p[0][0]);
  });
  it("keeps a character no font has in the last font of its chain", () => {
    expect(texts(resolveLoadedRuns([[run("a😀", bundled("Lato"))]], fonts, (f) => (fontKey(f) === "Lato-regular" ? has("a") : peekAll(f)), lookup())))
      .toEqual([["a", "Lato"], ["😀", "Noto Sans"]]);
  });
  it("is null while a font the decision needs is not loaded", () => {
    expect(resolveLoadedRuns([[run("변")]], fonts, (f) => (isOriginal(f) ? peekAll(f) : null), lookup())).toBeNull();
    expect(resolveLoadedRuns([[run("ab")]], fonts, (f) => (isOriginal(f) ? peekAll(f) : null), lookup())).not.toBeNull(); // the original has them
  });
});

describe("prepareRuns", () => {
  const store = (failing: (f: FontRef) => boolean = () => false) => {
    const loaded: string[] = [];
    return {
      loaded,
      async load(f: FontRef) { if (failing(f) || !glyphs[fontKey(f)]) throw new Error("404"); if (!loaded.includes(fontKey(f))) loaded.push(fontKey(f)); return glyphs[fontKey(f)]; },
      peek: (f: FontRef) => (loaded.includes(fontKey(f)) ? glyphs[fontKey(f)] : null),
    };
  };

  it("loads fonts down the chain only for the characters that need them (CJK fonts lazily)", async () => {
    const s = store();
    expect(texts(await prepareRuns([[run("신청서 ab")]], fonts, s, lookup()))).toEqual([["신청서 ab", "orig"]]);
    expect(s.loaded).toEqual([fontKey(ORIG)]);
    expect(texts(await prepareRuns([[run("신청서 변경")]], fonts, s, lookup()))).toEqual([["신청서 ", "orig"], ["변경", "Noto Sans KR"]]);
    expect(s.loaded).toEqual([fontKey(ORIG), "Arimo-regular", "Noto Sans KR-regular"]); // never Noto Sans or JP
  });

  it("treats an original that fails to load as having no glyphs", async () => {
    const s = store(isOriginal);
    expect(texts(await prepareRuns([[run("ab 변")]], fonts, s, lookup()))).toEqual([["ab ", "Arimo"], ["변", "Noto Sans KR"]]);
  });

  it("matches resolveLoadedRuns once the fonts are in", async () => {
    const s = store();
    const out = await prepareRuns([[run("신청서 변경 ✓")]], fonts, s, lookup());
    expect(resolveLoadedRuns([[run("신청서 변경 ✓")]], fonts, s.peek, lookup())).toEqual(out);
  });

  it("calls the loader as an object (FontStore's methods use `this`)", async () => {
    class Store {
      private loaded = new Map<string, FontMetrics>();
      async load(f: FontRef) { this.loaded.set(fontKey(f), glyphs[fontKey(f)]); return glyphs[fontKey(f)]; }
      peek(f: FontRef) { return this.loaded.get(fontKey(f)) ?? null; }
    }
    expect(texts(await prepareRuns([[run("신청서 변경")]], fonts, new Store(), lookup()))).toEqual([["신청서 ", "orig"], ["변경", "Noto Sans KR"]]);
  });

  it("rejects when a bundled font the result uses cannot load", async () => {
    await expect(prepareRuns([[run("a", bundled("Lato"))]], fonts, store(), lookup())).rejects.toThrow();
  });
});

describe("hasUnsupportedChars", () => {
  it("is false when the chain covers every character, true when nothing has one", () => {
    expect(hasUnsupportedChars([[run("신청서 변경 ab✓\n")]], fonts, peekAll, lookup())).toBe(false);
    expect(hasUnsupportedChars([[run("변경")]], fonts, peekAll, lookup("kr", { kr: {}, jp: {}, sc: {} }))).toBe(true); // no CJK pack
    expect(hasUnsupportedChars([[run("ab😀")]], fonts, peekAll, lookup())).toBe(true);
  });
  it("waits for the fonts of the chain, which preloadFallback loads", async () => {
    const loaded = new Set<string>([fontKey(ORIG)]);
    const s = { async load(f: FontRef) { loaded.add(fontKey(f)); return glyphs[fontKey(f)]; }, peek: (f: FontRef) => (loaded.has(fontKey(f)) ? glyphs[fontKey(f)] : null) };
    const runs = [[run("ab😀")]];
    expect(hasUnsupportedChars(runs, fonts, s.peek, lookup())).toBe(false); // cold: chain not loaded
    await preloadFallback(runs, fonts, s, lookup());
    expect(hasUnsupportedChars(runs, fonts, s.peek, lookup())).toBe(true);
  });
});
