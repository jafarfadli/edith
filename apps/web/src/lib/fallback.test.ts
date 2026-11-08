import { describe, expect, it, vi } from "vitest";
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
  it("counts enclosed, compatibility and half-width Hangul as Korean and Bopomofo as Chinese", () => {
    const of = (cps: number[], han: CjkScript = "jp") => cps.map((cp) => cjkScript(cp, han));
    expect(of([0x3131, 0x318e, 0x3200, 0x321e, 0x3260, 0x327e, 0x327f, 0xffa0, 0xffdc])).toEqual(Array(9).fill("kr"));
    expect(of([0x3220, 0x3280, 0x3290])).toEqual(["jp", "jp", "jp"]); // enclosed ideographs: the document's script
    expect(of([0x3100, 0x3105, 0x312f, 0x31a0], "kr")).toEqual(["sc", "sc", "sc", "sc"]); // Bopomofo
    expect(documentScript(["㉠㈀ 漢字"])).toBe("kr");
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
  it("keeps a combining mark or variation selector with its base's font when that font has it", () => {
    // "café" with a combining acute (e + U+0301): Lato lacks "e", so "e" goes to Arimo, and the accent follows it there
    // although Lato (first in the accent's own chain) has it.
    const peek = (marks: string) => (f: FontRef) => ({ "Lato-regular": has("caf́̂"), "Arimo-regular": has(LATIN + marks) } as Record<string, FontMetrics>)[fontKey(f)] ?? peekAll(f);
    const lato = (text: string) => [[run(text, bundled("Lato"))]];
    expect(texts(resolveLoadedRuns(lato("café"), fonts, peek("́"), lookup()))).toEqual([["caf", "Lato"], ["é", "Arimo"]]);
    // The base's font lacks the mark: it takes the first font of its own chain.
    expect(texts(resolveLoadedRuns(lato("cafê"), fonts, peek(""), lookup()))).toEqual([["caf", "Lato"], ["e", "Arimo"], ["̂", "Lato"]]);
    expect(texts(resolveLoadedRuns(lato("cá"), fonts, peek(""), lookup()))).toEqual([["cá", "Lato"]]); // same font anyway
    // Variation selector / ZWJ after a fallback character stay with it, though the original has them too.
    const vs = (f: FontRef) => (fontKey(f) === "Noto Sans-regular" ? has(LATIN + "✓️‍") : isOriginal(f) ? has("ab️‍") : peekAll(f));
    expect(texts(resolveLoadedRuns([[run("ab✓️‍")]], fonts, vs, lookup()))).toEqual([["ab", "orig"], ["✓️‍", "Noto Sans"]]);
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

  it("rejects when a font the user picked cannot load", async () => {
    await expect(prepareRuns([[run("a", bundled("Lato"))]], fonts, store(), lookup())).rejects.toThrow();
  });

  it("skips a fallback font that fails to load (once), and the warning shows for what nothing else draws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = store((f) => fontKey(f) === "Noto Sans KR-regular"); // 404, timeout or a font the browser rejects
    const attempts = vi.spyOn(s, "load");
    const l = lookup();
    const p = [[run("신청서 변경 ab")]];
    expect(texts(await prepareRuns(p, fonts, s, l))).toEqual([["신청서 ", "orig"], ["변경", "Noto Sans"], [" ab", "orig"]]);
    expect(warn).toHaveBeenCalledOnce();
    expect(hasUnsupportedChars(p, fonts, s.peek, l)).toBe(true); // Noto Sans lacks Hangul
    expect(texts(resolveLoadedRuns(p, fonts, s.peek, l))).toEqual([["신청서 ", "orig"], ["변경", "Noto Sans"], [" ab", "orig"]]);
    await prepareRuns(p, fonts, s, l);
    await preloadFallback(p, fonts, s, l);
    expect(attempts.mock.calls.filter(([f]) => fontKey(f) === "Noto Sans KR-regular")).toHaveLength(1); // not retried
    // A substitute the system chose is skipped the same way; the user's own pick still rejects.
    const t = store((f) => fontKey(f) === "Arimo-regular");
    expect(texts(await prepareRuns([[run("x 변")]], fonts, t, lookup()))).toEqual([["x", "Noto Sans"], [" ", "orig"], ["변", "Noto Sans KR"]]);
    await expect(prepareRuns([[run("x", bundled("Arimo"))]], fonts, t, lookup())).rejects.toThrow();
    warn.mockRestore();
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
