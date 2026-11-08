# Task 15: Per-character font fallback with the optional CJK pack (script and design aware, loaded lazily)

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** M2 switched a whole run to the next font of the chain as soon as one character was missing — editing one Hangul word made every character of the line change font. Now each character takes the first font of its chain that has it, and runs split there (same size, colour and decoration): characters the original subset has keep it. Chain: the run's font → for an original font its substitute → for a CJK character the pack family of its script (Hangul → KR, kana → JP, Han and CJK punctuation → the document's script: Korean if it has Hangul, Japanese if it has kana, else SC) in the run's design (serif for serif families, else sans) → Arimo → Noto Sans. Fonts load lazily along the chain, only for characters that need them (a Korean document without new characters never downloads the 6 MB fallback). The web manifest lists only fetched pack files (`sync-fonts.mjs`), so without the pack CJK characters stay "unsupported" (the warning keeps working). The fallback moves to `lib/fallback.ts` (re-exported by `lib/paragraphs.ts`); a bundled font that fails to load still rejects (no silent font change). The E2E unsupported-characters test types a hieroglyph now: with the pack, 漢字 is supported.

**Files:**
- Modify: `apps/web/e2e/text.spec.ts`
- Modify: `apps/web/scripts/sync-fonts.mjs`
- Modify: `apps/web/src/components/editor/text/textEdit.test.ts`
- Create: `apps/web/src/lib/fallback.test.ts`
- Create: `apps/web/src/lib/fallback.ts`
- Modify: `apps/web/src/lib/fonts.test.ts`
- Modify: `apps/web/src/lib/fonts.ts`
- Modify: `apps/web/src/lib/paragraphs.test.ts`
- Modify: `apps/web/src/lib/paragraphs.ts`
- Modify: `apps/web/src/store/text.test.ts`
- Modify: `apps/web/src/store/text.ts`

**Interfaces:**
- Consumes: Task 5 (manifest `cjk`, pack files); Task 4 (rebuilt original fonts served with exact coverage).
- Produces: `lib/fallback.ts`: `FontTable`, `Peek`, `CjkScript`, `FallbackFonts` (`cjkFamily`, `categoryOf`, `hanScript`, `ready?`), `cjkScript(cp, han)`, `documentScript(texts)`, `substituteOf`, `fallbackChain(font, cp, fonts, lookup)`, `resolveLoadedRuns`, `prepareRuns`, `preloadFallback`, `hasUnsupportedChars` (same signatures as before plus an optional `lookup = fontStore`); `FontStore` implements `FallbackFonts` (+ `setHanScript`); `textStore.load` sets the document's Han script.

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/e2e/text.spec.ts`:

```diff
diff --git a/apps/web/e2e/text.spec.ts b/apps/web/e2e/text.spec.ts
index b872835..a374c0b 100644
--- a/apps/web/e2e/text.spec.ts
+++ b/apps/web/e2e/text.spec.ts
@@ -118,6 +118,6 @@ test("warns about unsupported characters while typing, before commit", async ({
     await expect(editor).toBeVisible({ timeout: 1000 });
   }).toPass();
   await expect(page.getByText("beberapa karakter tidak didukung font ini")).toHaveCount(0);
-  await editor.pressSequentially("漢字");
+  await editor.pressSequentially("𓀀"); // a hieroglyph: no bundled font, CJK pack included, has it
   await expect(page.getByText("beberapa karakter tidak didukung font ini")).toBeVisible();
 });
```

Modify `apps/web/src/components/editor/text/textEdit.test.ts`:

```diff
diff --git a/apps/web/src/components/editor/text/textEdit.test.ts b/apps/web/src/components/editor/text/textEdit.test.ts
index 25a2082..531b2cd 100644
--- a/apps/web/src/components/editor/text/textEdit.test.ts
+++ b/apps/web/src/components/editor/text/textEdit.test.ts
@@ -149,15 +149,15 @@ describe("editing an original paragraph", () => {
     expect((editorStore.getState().doc.objects.e1 as TextEdit).box.layout).toEqual([{ baseline: expect.any(Number), segments: [] }]);
   });
 
-  it("swaps an original font for its substitute when a new character has no glyph", async () => {
+  it("keeps the original font for the characters it has and uses the substitute for a new one", async () => {
     const orig = { kind: "original" as const, ref: "f7" };
     openParagraph("Halo", orig);
     await commitEditing(runs("Halo", orig));
     expect(editorStore.getState().doc.order).toEqual([]); // unchanged
     openParagraph("Halo", orig);
     await commitEditing(runs("Halo!", orig));
-    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0][0].font)
-      .toEqual({ kind: "bundled", family: "Carlito", bold: false, italic: false });
+    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0].map((r) => [r.text, r.font])).toEqual([
+      ["Halo", orig], ["!", { kind: "bundled", family: "Carlito", bold: false, italic: false }]]);
   });
 });
 
@@ -190,11 +190,13 @@ describe("font fallback on commit", () => {
   const orig = { kind: "original" as const, ref: "f7" };
   const noto = { kind: "bundled", family: "Noto Sans", bold: false, italic: false };
 
-  it("goes original → substitute → Arimo → Noto Sans when the fonts are loaded (fast path)", async () => {
+  const committed = () => (editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0].map((r) => [r.text, r.font]);
+
+  it("goes original → substitute → Arimo → Noto Sans per character when the fonts are loaded (fast path)", async () => {
     gate.resolve(); fontsLoaded = true; notoOnly = "ꙮ";
     openParagraph("Halo", orig);
     await commitEditing(runs("Halo ꙮ", orig));
-    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0][0].font).toEqual(noto);
+    expect(committed()).toEqual([["Halo ", orig], ["ꙮ", noto]]);
   });
 
   it("does the same while fonts load (slow path)", async () => {
@@ -203,7 +205,7 @@ describe("font fallback on commit", () => {
     const commit = commitEditing(runs("Halo ꙮ", orig));
     gate.resolve();
     await commit;
-    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0][0].font).toEqual(noto);
+    expect(committed()).toEqual([["Halo ", orig], ["ꙮ", noto]]);
   });
 });
```

Create `apps/web/src/lib/fallback.test.ts`:

```ts
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
```

Modify `apps/web/src/lib/fonts.test.ts`:

```diff
diff --git a/apps/web/src/lib/fonts.test.ts b/apps/web/src/lib/fonts.test.ts
index 0c9b83d..ef6e0ca 100644
--- a/apps/web/src/lib/fonts.test.ts
+++ b/apps/web/src/lib/fonts.test.ts
@@ -58,6 +58,27 @@ describe("FontStore", () => {
     expect(store.get(font)).toBe(m);
   });
 
+  it("knows the fetched CJK pack: fallback families by script and design, not offered in the picker", async () => {
+    const withCjk = { ...manifest, cjk: {
+      "Noto Sans KR": { category: "sans", script: "kr", files: { regular: "cjk/NotoSansKR-Regular.ttf", bold: "cjk/NotoSansKR-Bold.ttf" } },
+      "Noto Serif KR": { category: "serif", script: "kr", files: { regular: "cjk/NotoSerifKR-Regular.ttf" } },
+      "Noto Sans JP": { category: "sans", script: "jp", files: { regular: "cjk/NotoSansJP-Regular.ttf" } },
+    } };
+    const fetchMock = vi.fn(async (url: string) => (url.endsWith("manifest.json") ? json(withCjk) : new Response(bytes(), { status: 200 })));
+    vi.stubGlobal("fetch", fetchMock);
+    const store = new FontStore("/fonts");
+    expect(store.cjkFamily("kr", "sans")).toBeNull(); // manifest not loaded yet
+    expect(await store.families()).toEqual(["Arimo"]);
+    expect([store.cjkFamily("kr", "sans"), store.cjkFamily("kr", "serif"), store.cjkFamily("jp", "serif"), store.cjkFamily("sc", "sans")])
+      .toEqual(["Noto Sans KR", "Noto Serif KR", "Noto Sans JP", null]);
+    expect([store.categoryOf("Arimo"), store.categoryOf("Noto Serif KR"), store.categoryOf("Lato")]).toEqual(["sans", "serif", null]);
+    await store.load({ kind: "bundled", family: "Noto Sans KR", bold: true, italic: true });
+    expect(fetchMock).toHaveBeenLastCalledWith("/fonts/cjk/NotoSansKR-Bold.ttf"); // no italic: bold
+    expect(store.hanScript()).toBe("sc");
+    store.setHanScript("kr");
+    expect(store.hanScript()).toBe("kr");
+  });
+
   it("rejects a failed TTF fetch and retries later", async () => {
     const fetchMock = vi.fn(async (url: string) => {
       if (url.endsWith("manifest.json")) return json(manifest);
```

Modify `apps/web/src/lib/paragraphs.test.ts`:

```diff
diff --git a/apps/web/src/lib/paragraphs.test.ts b/apps/web/src/lib/paragraphs.test.ts
index b68bcf4..ccef44f 100644
--- a/apps/web/src/lib/paragraphs.test.ts
+++ b/apps/web/src/lib/paragraphs.test.ts
@@ -1,11 +1,11 @@
 import { readFileSync } from "node:fs";
 import path from "node:path";
 import { describe, expect, it } from "vitest";
-import type { FontRef, Run } from "@edith/ops";
-import type { DocFont, Paragraph, TextData } from "@/lib/api";
+import type { FontRef } from "@edith/ops";
+import type { Paragraph, TextData } from "@/lib/api";
 import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
 import { runsText } from "@/lib/runs";
-import { preloadFallback, hardBreaks, hasUnsupportedChars, maskRects, overflowsOriginal, paragraphBox, paragraphRuns, prepareRuns, rawToBox, resolveLoadedRuns, resolveRunFonts } from "@/lib/paragraphs";
+import { hardBreaks, maskRects, overflowsOriginal, paragraphBox, paragraphRuns, rawToBox } from "@/lib/paragraphs";
 
 const FONTS = path.resolve(__dirname, "../../../../packages/fonts/files");
 const metrics = new Map<string, FontMetrics>();
@@ -75,77 +75,6 @@ describe("paragraphBox", () => {
   });
 });
 
-const ORIG = { kind: "original" as const, ref: "f9" };
-const fonts: Record<string, DocFont> = {
-  f9: { ref: "f9", name: "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold: false, italic: false,
-        substitute: { kind: "bundled", family: "Carlito", bold: false, italic: false } },
-};
-const run = (text: string): Run => ({ text, font: ORIG, size: 12, color: "#000000" });
-const onlyAbc: FontMetrics = { unitsPerEm: 1000, ascent: 800, descent: 200, advance: () => 500, hasGlyph: (cp) => "abc ".includes(String.fromCodePoint(cp)) };
-
-describe("original fonts", () => {
-  it("keep a run whose glyphs exist and swap the others for the substitute", () => {
-    const out = resolveRunFonts([run("abc"), run("abz")], fonts, () => onlyAbc);
-    expect(out[0].font).toEqual(ORIG);
-    expect(out[1].font).toEqual({ kind: "bundled", family: "Carlito", bold: false, italic: false });
-  });
-
-  it("swap when the font did not load", () => {
-    expect(resolveRunFonts([run("a")], fonts, () => null)[0].font).toMatchObject({ family: "Carlito" });
-  });
-
-  it("swap a bundled family lacking a glyph for Arimo", () => {
-    const lato = { ...run("abz"), font: { kind: "bundled" as const, family: "Lato", bold: true, italic: false } };
-    expect(resolveRunFonts([lato], fonts, () => onlyAbc)[0].font).toEqual({ kind: "bundled", family: "Arimo", bold: true, italic: false });
-    expect(resolveRunFonts([lato], fonts, () => null)[0]).toBe(lato); // not loaded yet: unchanged
-  });
-
-  it("prepareRuns loads originals first and tolerates their failure", async () => {
-    const loaded: string[] = [];
-    const store = {
-      async load(f: FontRef) { if (isOriginal(f)) throw new Error("404"); loaded.push(fontKey(f)); return onlyAbc; },
-      peek: (f: FontRef) => (loaded.includes(fontKey(f)) ? onlyAbc : null),
-    };
-    const out = await prepareRuns([[run("abc")]], fonts, store);
-    expect(out[0][0].font).toMatchObject({ kind: "bundled", family: "Carlito" });
-    expect(loaded).toContain("Carlito-regular");
-  });
-
-  it("swap Arimo lacking a glyph for Noto Sans, and stop there", () => {
-    const arimo = { ...run("abz"), font: { kind: "bundled" as const, family: "Arimo", bold: false, italic: true } };
-    expect(resolveRunFonts([arimo], fonts, () => onlyAbc)[0].font).toEqual({ kind: "bundled", family: "Noto Sans", bold: false, italic: true });
-    const noto = { ...arimo, font: { kind: "bundled" as const, family: "Noto Sans", bold: false, italic: true } };
-    expect(resolveRunFonts([noto], fonts, () => onlyAbc)[0]).toBe(noto);
-  });
-
-  it("prepareRuns falls back: original → substitute → Arimo → Noto Sans", async () => {
-    const onlyAbcz: FontMetrics = { ...onlyAbc, hasGlyph: (cp) => "abcz ".includes(String.fromCodePoint(cp)) };
-    const store = { load: async () => onlyAbc, peek: (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? onlyAbcz : onlyAbc) };
-    const out = await prepareRuns([[run("abz")]], fonts, store);
-    expect(out[0][0].font).toEqual({ kind: "bundled", family: "Noto Sans", bold: false, italic: false });
-  });
-});
-
-describe("resolveLoadedRuns", () => {
-  const onlyAbcz: FontMetrics = { ...onlyAbc, hasGlyph: (cp) => "abcz ".includes(String.fromCodePoint(cp)) };
-  const peekAll = (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? onlyAbcz : onlyAbc);
-
-  it("runs the whole chain with loaded fonts, like prepareRuns", async () => {
-    const sync = resolveLoadedRuns([[run("abz")]], fonts, peekAll);
-    expect(sync?.[0][0].font).toEqual({ kind: "bundled", family: "Noto Sans", bold: false, italic: false });
-    expect(sync).toEqual(await prepareRuns([[run("abz")]], fonts, { load: async () => onlyAbc, peek: peekAll }));
-  });
-
-  it("returns null when a font it needs is not loaded", () => {
-    expect(resolveLoadedRuns([[run("abz")]], fonts, (f) => (isOriginal(f) ? onlyAbc : null))).toBeNull();
-  });
-
-  it("returns the same runs when nothing needs a fallback", () => {
-    const p = [[run("abc")]];
-    expect(resolveLoadedRuns(p, fonts, () => onlyAbc)?.[0][0]).toBe(p[0][0]);
-  });
-});
-
 describe("maskRects", () => {
   it("covers each line around its baseline", () => {
     const p = paragraphs[0];
@@ -169,35 +98,3 @@ describe("overflowsOriginal", () => {
     expect(overflowsOriginal(shorter, p)).toBe(false);
   });
 });
-
-describe("hasUnsupportedChars", () => {
-  const notoAbcz: FontMetrics = { ...onlyAbc, hasGlyph: (cp) => "abcz ".includes(String.fromCodePoint(cp)) };
-  const peek = (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? notoAbcz : onlyAbc);
-  it("is false when the fallback chain covers every character", () => {
-    expect(hasUnsupportedChars([[run("abz")]], fonts, peek)).toBe(false); // z: Noto Sans has it
-    expect(hasUnsupportedChars([[run("ab c\n")]], fonts, peek)).toBe(false);
-  });
-  it("is true when even the last fallback lacks a glyph", () => {
-    expect(hasUnsupportedChars([[run("ab✓")]], fonts, peek)).toBe(true);
-  });
-  it("waits for the fonts of the chain", () => {
-    expect(hasUnsupportedChars([[run("ab✓")]], fonts, (f) => (isOriginal(f) ? onlyAbc : null))).toBe(false);
-  });
-});
-
-describe("preloadFallback", () => {
-  it("loads the chain so the unsupported warning resolves after the preload", async () => {
-    const notoAbcz: FontMetrics = { ...onlyAbc, hasGlyph: (cp) => "abcz ".includes(String.fromCodePoint(cp)) };
-    const loaded = new Set<string>([fontKey(ORIG)]);
-    const metricsOf = (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? notoAbcz : onlyAbc);
-    const store = {
-      async load(f: FontRef) { loaded.add(fontKey(f)); return metricsOf(f); },
-      peek: (f: FontRef) => (loaded.has(fontKey(f)) ? metricsOf(f) : null),
-    };
-    const peek = (f: FontRef) => store.peek(f);
-    const runs = [[run("ab✓")]];
-    expect(hasUnsupportedChars(runs, fonts, peek)).toBe(false); // cold: chain not loaded
-    await preloadFallback(runs, fonts, store);
-    expect(hasUnsupportedChars(runs, fonts, peek)).toBe(true);
-  });
-});
```

Modify `apps/web/src/store/text.test.ts`:

```diff
diff --git a/apps/web/src/store/text.test.ts b/apps/web/src/store/text.test.ts
index d13c0ad..535be33 100644
--- a/apps/web/src/store/text.test.ts
+++ b/apps/web/src/store/text.test.ts
@@ -32,6 +32,14 @@ describe("textStore", () => {
     expect(url({ kind: "original", ref: "f5", doc: "I" })).toBe("http://localhost:8000/documents/I/fonts/f5");
   });
 
+  it("sets the script Han characters fall back to from the document's text", async () => {
+    const korean = { ...para, runs: [{ text: "사증 漢字", font: { kind: "original", ref: "f5" }, size: 12, color: "#000000" }] };
+    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ doc_id: "D", pages: [{ index: 0, paragraphs: [korean] }], fonts: [font] }), { status: 200 })));
+    const set = vi.spyOn(fontStore, "setHanScript");
+    await textStore.getState().load("D");
+    expect(set).toHaveBeenCalledWith("kr");
+  });
+
   it("adds an imported PDF's text with its fonts named after it", async () => {
     const run = { text: "Impor", font: { kind: "original", ref: "f5" }, size: 12, color: "#000000" };
     const imported = { doc_id: "I", pages: [{ index: 0, paragraphs: [{ ...para, runs: [run] }] }], fonts: [font] };
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w apps/web -- src/lib/fallback.test.ts src/lib/fonts.test.ts src/store/text.test.ts src/components/editor/text/textEdit.test.ts`

Expected: FAIL — `lib/fallback.ts` is missing; runs still switch font as a whole. Spike output (last lines):

```
TypeError: store.cjkFamily is not a function
 FAIL  src/store/text.test.ts > textStore > sets the script Han characters fall back to from the document's text
Error: setHanScript does not exist
 FAIL  src/components/editor/text/textEdit.test.ts > editing an original paragraph > keeps the original font for the characters it has and uses the substitute for a new one
AssertionError: expected [ [ 'Halo!', …(1) ] ] to deeply equal [ [ 'Halo', …(1) ], …(1) ]
 FAIL  src/components/editor/text/textEdit.test.ts > font fallback on commit > goes original → substitute → Arimo → Noto Sans per character when the fonts are loaded (fast path)
AssertionError: expected [ [ 'Halo ꙮ', …(1) ] ] to deeply equal [ [ 'Halo ', …(1) ], …(1) ]
 FAIL  src/components/editor/text/textEdit.test.ts > font fallback on commit > does the same while fonts load (slow path)
npm error Lifecycle script `test` failed with error:
npm error command failed
```

- [ ] **Step 3: Implement**

Modify `apps/web/scripts/sync-fonts.mjs`:

```diff
diff --git a/apps/web/scripts/sync-fonts.mjs b/apps/web/scripts/sync-fonts.mjs
index b52162a..60805b8 100644
--- a/apps/web/scripts/sync-fonts.mjs
+++ b/apps/web/scripts/sync-fonts.mjs
@@ -1,4 +1,4 @@
-import { cp, mkdir, rm } from "node:fs/promises";
+import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
 import path from "node:path";
 import { createRequire } from "node:module";
 import { fileURLToPath } from "node:url";
@@ -9,9 +9,19 @@ const src = path.resolve(here, "../../../packages/fonts");
 const dest = path.resolve(here, "../public/fonts");
 await rm(dest, { recursive: true, force: true }); // drop files no longer in the manifest
 await mkdir(dest, { recursive: true });
-await cp(path.join(src, "manifest.json"), path.join(dest, "manifest.json"));
+// The optional CJK pack (packages/fonts/scripts/fetch-cjk.mjs) may be missing: the web manifest lists only the
+// families and styles whose files are there, so the editor never asks for a font that is not served.
+const manifest = JSON.parse(await readFile(path.join(src, "manifest.json"), "utf8"));
+const exists = (file) => access(path.join(src, "files", file)).then(() => true, () => false);
+const cjk = {};
+for (const [family, info] of Object.entries(manifest.cjk ?? {})) {
+  const files = {};
+  for (const [style, file] of Object.entries(info.files)) if (await exists(file)) files[style] = file;
+  if (files.regular) cjk[family] = { ...info, files };
+}
+await writeFile(path.join(dest, "manifest.json"), JSON.stringify({ ...manifest, cjk }, null, 1));
 await cp(path.join(src, "files"), dest, { recursive: true });
-console.log("fonts synced to", dest);
+console.log("fonts synced to", dest, `(CJK pack: ${Object.keys(cjk).length ? Object.keys(cjk).join(", ") : "not fetched"})`);
 
 const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
 await cp(path.join(pdfjsDir, "build", "pdf.worker.min.mjs"), path.resolve(here, "../public/pdf.worker.min.mjs"));
```

Create `apps/web/src/lib/fallback.ts`:

```ts
import type { BundledFont, FontRef, Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { covers, fontId, fontKey, fontStore, isOriginal, type FontMetrics } from "@/lib/fonts";

/** Fonts of the edited PDF and its imports, by `fontId`. */
export type FontTable = Record<string, DocFont>;
export type Peek = (f: FontRef) => FontMetrics | null;
export type CjkScript = "kr" | "jp" | "sc";

/** What the font fallback needs to know about the font manifest (FontStore implements it). */
export interface FallbackFonts {
  /** The family of the optional CJK pack for `script` in design `category` (serif, else sans); null when the pack
   *  was not fetched or the manifest is not loaded yet. */
  cjkFamily(script: CjkScript, category: string): string | null;
  /** Category of a bundled or CJK family (sans | serif | mono | script); null when unknown. */
  categoryOf(family: string): string | null;
  /** The script Han characters (shared by Chinese, Japanese and Korean) are drawn in: the document's. */
  hanScript(): CjkScript;
  /** Loads what the lookups need (the manifest); awaited before resolving with loads. */
  ready?(): Promise<unknown>;
}
type Loader = { load(f: FontRef): Promise<FontMetrics>; peek: Peek };

const ARIMO = "Arimo";
const NOTO_SANS = "Noto Sans";
/** Rounds of loading in prepareRuns: one per step of the longest chain (original, substitute, CJK, Arimo, Noto Sans). */
const MAX_ROUNDS = 6;

const inRange = (cp: number, ranges: [number, number][]) => ranges.some(([a, b]) => cp >= a && cp <= b);
const HANGUL: [number, number][] = [[0x1100, 0x11ff], [0x3130, 0x318f], [0xa960, 0xa97f], [0xac00, 0xd7af], [0xd7b0, 0xd7ff]];
const KANA: [number, number][] = [[0x3040, 0x30ff], [0x31f0, 0x31ff], [0xff66, 0xff9f]];
// Han ideographs plus the CJK punctuation, symbols and full-width forms every CJK font has.
const HAN: [number, number][] = [[0x2e80, 0x2fdf], [0x3000, 0x303f], [0x3190, 0x31ef], [0x3200, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xffef], [0x20000, 0x3134f]];

/** The CJK script a character needs: Hangul → kr, kana → jp, Han / CJK punctuation → `han` (the document's); else null. */
export function cjkScript(cp: number, han: CjkScript): CjkScript | null {
  if (inRange(cp, HANGUL)) return "kr";
  if (inRange(cp, KANA)) return "jp";
  if (inRange(cp, HAN)) return han;
  return null;
}

/** The script of a document's Han characters: Korean when it has Hangul (at least as much as kana), Japanese when it
 *  has kana, else Simplified Chinese. */
export function documentScript(texts: Iterable<string>): CjkScript {
  let hangul = 0, kana = 0;
  for (const text of texts) {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (inRange(cp, HANGUL)) hangul++;
      else if (inRange(cp, KANA)) kana++;
    }
  }
  if (hangul && hangul >= kana) return "kr";
  return kana ? "jp" : "sc";
}

const ARIMO_REGULAR: BundledFont = { kind: "bundled", family: ARIMO, bold: false, italic: false };

export function substituteOf(f: FontRef, fonts: FontTable): BundledFont {
  return isOriginal(f) ? fonts[fontId(f)]?.substitute ?? ARIMO_REGULAR : f;
}

/** The fonts that may draw character `cp` of a run set in `font`, in order: the font itself; for an original font, its
 *  substitute; for a CJK character, the CJK pack family of its script in the run's design (serif or sans) when the
 *  pack is there; Arimo (Latin, Greek, Cyrillic); Noto Sans (wider Unicode). Fallbacks keep the run's bold/italic. */
export function fallbackChain(font: FontRef, cp: number, fonts: FontTable, lookup: FallbackFonts): FontRef[] {
  const base = substituteOf(font, fonts);
  const style = { bold: !!base.bold, italic: !!base.italic };
  const chain: FontRef[] = [font];
  if (isOriginal(font)) chain.push(base);
  const script = cjkScript(cp, lookup.hanScript());
  if (script) {
    const family = lookup.cjkFamily(script, lookup.categoryOf(base.family) ?? "sans");
    if (family) chain.push({ kind: "bundled", family, ...style });
  }
  chain.push({ kind: "bundled", family: ARIMO, ...style }, { kind: "bundled", family: NOTO_SANS, ...style });
  const seen = new Set<string>();
  return chain.filter((f) => (seen.has(fontKey(f)) ? false : (seen.add(fontKey(f)), true)));
}

type Resolved = { runs: Run[][] } | { pending: FontRef[] };

/** Every character of every run in the first font of its chain that is loaded and has a glyph for it — runs split
 *  where that font changes, so characters an original font has keep it. A character no font has stays in the last
 *  font of the chain that loaded. `skip`: fonts that failed to load. Pending when a font the decision needs is not
 *  loaded yet. A run that keeps its font for every character is returned as is. */
function resolve(paragraphs: Run[][], fonts: FontTable, peek: Peek, lookup: FallbackFonts,
  skip: (f: FontRef) => boolean): Resolved {
  const pending = new Map<string, FontRef>();
  const out = paragraphs.map((runs) => runs.flatMap((r) => {
    const pieces: { font: FontRef; text: string }[] = [];
    for (const ch of r.text) {
      let chosen: FontRef | null = null, last: FontRef | null = null;
      for (const f of fallbackChain(r.font, ch.codePointAt(0)!, fonts, lookup)) {
        if (skip(f)) continue;
        const m = peek(f);
        if (!m) { pending.set(fontKey(f), f); chosen = null; last = null; break; }
        last = f;
        if (covers(m, ch)) { chosen = f; break; }
      }
      const font = chosen ?? last ?? r.font;
      const prev = pieces[pieces.length - 1];
      if (prev && fontKey(prev.font) === fontKey(font)) prev.text += ch;
      else pieces.push({ font, text: ch });
    }
    if (pieces.length <= 1 && (!pieces.length || fontKey(pieces[0].font) === fontKey(r.font))) return [r];
    return pieces.map((p) => ({ ...r, text: p.text, font: p.font }));
  }));
  return pending.size ? { pending: [...pending.values()] } : { runs: out };
}

const never = () => false;

/** The font fallback using only fonts that are already loaded (same result as `prepareRuns` once its fonts are
 *  in); `null` when a font it needs is not loaded yet. */
export function resolveLoadedRuns(paragraphs: Run[][], fonts: FontTable, peek: Peek, lookup: FallbackFonts = fontStore): Run[][] | null {
  const r = resolve(paragraphs, fonts, peek, lookup, never);
  return "runs" in r ? r.runs : null;
}

async function settle(paragraphs: Run[][], fonts: FontTable, store: Loader, lookup: FallbackFonts): Promise<Run[][] | null> {
  await lookup.ready?.().catch(() => {}); // the manifest: bundled and CJK families
  const failed = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const r = resolve(paragraphs, fonts, (f) => store.peek(f), lookup, (f) => failed.has(fontKey(f)));
    if ("runs" in r) return r.runs;
    const results = await Promise.allSettled(r.pending.map((f) => store.load(f)));
    results.forEach((x, i) => {
      if (x.status !== "rejected") return;
      if (!isOriginal(r.pending[i])) throw x.reason; // a bundled font that won't load: no silent change of the chosen font
      failed.add(fontKey(r.pending[i]));
    });
  }
  return null;
}

/** Loads the fonts the paragraphs need, character by character along each run's fallback chain (an original font
 *  that fails to load counts as having no glyphs), and returns the runs split by the font that draws them. CJK pack
 *  fonts load only when a character needs them. Rejects when a bundled font cannot be loaded. */
export async function prepareRuns(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore, lookup: FallbackFonts = fontStore): Promise<Run[][]> {
  const out = await settle(paragraphs, fonts, store, lookup);
  if (!out) throw new Error("font fallback did not settle");
  await Promise.all(out.flat().map((r) => store.load(r.font)));
  return out;
}

/** Loads the fonts `prepareRuns` would, so `resolveLoadedRuns` and `hasUnsupportedChars` can answer synchronously.
 *  Never rejects: a font that fails to load just stays unresolved. */
export async function preloadFallback(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore, lookup: FallbackFonts = fontStore): Promise<void> {
  await settle(paragraphs, fonts, store, lookup).catch(() => null);
}

/** True when some character has no glyph in any font of its chain (with the loaded fonts): the bake draws it with a
 *  builtin font or as a box (CJK without the pack, emoji, rare symbols …). False while a font of a chain is loading. */
export function hasUnsupportedChars(paragraphs: Run[][], fonts: FontTable, peek: Peek, lookup: FallbackFonts = fontStore): boolean {
  const resolved = resolveLoadedRuns(paragraphs, fonts, peek, lookup);
  if (!resolved) return false;
  return resolved.flat().some((r) => {
    const m = peek(r.font);
    return !!m && !covers(m, r.text.replace(/[\n\r\t]/g, ""));
  });
}
```

Modify `apps/web/src/lib/fonts.ts`:

```diff
diff --git a/apps/web/src/lib/fonts.ts b/apps/web/src/lib/fonts.ts
index 281cb74..19d6abc 100644
--- a/apps/web/src/lib/fonts.ts
+++ b/apps/web/src/lib/fonts.ts
@@ -1,5 +1,6 @@
 import * as fontkit from "fontkit";
 import type { BundledFont, FontRef, OriginalFont } from "@edith/ops";
+import type { CjkScript, FallbackFonts } from "@/lib/fallback";
 
 export interface FontMetrics {
   unitsPerEm: number; ascent: number; descent: number;
@@ -99,10 +100,14 @@ export function cssFamily(f: FontRef): string {
   return `edith-${fontKey(f)}`;
 }
 
-interface Manifest { default: string; families: Record<string, { category: string; files: Partial<Record<Style, string>> }> }
+interface Family { category: string; files: Partial<Record<Style, string>> }
+/** `cjk`: the optional CJK pack, only the families (and styles) whose files were fetched (scripts/sync-fonts.mjs). */
+interface Manifest { default: string; families: Record<string, Family>; cjk?: Record<string, Family & { script: CjkScript }> }
 
-export class FontStore {
+export class FontStore implements FallbackFonts {
   private manifest?: Promise<Manifest>;
+  private manifestNow: Manifest | null = null;
+  private han: CjkScript = "sc";
   private loaded = new Map<string, FontMetrics>();
   private pending = new Map<string, Promise<FontMetrics>>();
   private originalUrl: ((f: OriginalFont) => string) | null = null;
@@ -120,9 +125,9 @@ export class FontStore {
   private getManifest(): Promise<Manifest> {
     if (!this.manifest) {
       const url = `${this.baseUrl}/manifest.json`;
-      const p = fetch(url).then((r) => {
+      const p = fetch(url).then(async (r) => {
         if (!r.ok) throw new Error(`font fetch failed: ${url} (${r.status})`);
-        return r.json() as Promise<Manifest>;
+        return (this.manifestNow = (await r.json()) as Manifest);
       });
       this.manifest = p;
       p.catch(() => { if (this.manifest === p) this.manifest = undefined; });
@@ -130,16 +135,42 @@ export class FontStore {
     return this.manifest;
   }
 
+  /** Families of the font picker (the CJK pack only serves as a fallback). */
   async families(): Promise<string[]> {
     return Object.keys((await this.getManifest()).families);
   }
 
+  ready(): Promise<unknown> {
+    return this.getManifest();
+  }
+
+  cjkFamily(script: CjkScript, category: string): string | null {
+    const wanted = category === "serif" ? "serif" : "sans";
+    const found = Object.entries(this.manifestNow?.cjk ?? {}).filter(([, f]) => f.script === script);
+    return (found.find(([, f]) => f.category === wanted) ?? found[0])?.[0] ?? null;
+  }
+
+  categoryOf(family: string): string | null {
+    const m = this.manifestNow;
+    return (m?.families[family] ?? m?.cjk?.[family])?.category ?? null;
+  }
+
+  hanScript(): CjkScript {
+    return this.han;
+  }
+
+  /** The script of the open document's Han characters (see documentScript). */
+  setHanScript(script: CjkScript): void {
+    this.han = script;
+  }
+
   private async url(f: FontRef): Promise<string> {
     if (isOriginal(f)) {
       if (!this.originalUrl) throw new Error(`no source for original font ${f.ref}`);
       return this.originalUrl(f);
     }
-    const fam = (await this.getManifest()).families[f.family];
+    const m = await this.getManifest();
+    const fam = m.families[f.family] ?? m.cjk?.[f.family];
     if (!fam) throw new Error(`unknown font family ${f.family}`);
     return `${this.baseUrl}/${pickFile(fam.files, style(f))}`;
   }
```

Modify `apps/web/src/lib/paragraphs.ts`:

```diff
diff --git a/apps/web/src/lib/paragraphs.ts b/apps/web/src/lib/paragraphs.ts
index 4c60aae..406aca2 100644
--- a/apps/web/src/lib/paragraphs.ts
+++ b/apps/web/src/lib/paragraphs.ts
@@ -1,15 +1,13 @@
-import type { BundledFont, FontRef, Rect, Run, TextBox } from "@edith/ops";
-import type { DocFont, Paragraph } from "@/lib/api";
-import { covers, fontId, fontStore, isOriginal, textWidth, type FontMetrics } from "@/lib/fonts";
+import type { FontRef, Rect, Run, TextBox } from "@edith/ops";
+import type { Paragraph } from "@/lib/api";
+import { textWidth, type FontMetrics } from "@/lib/fonts";
 import { normalizeRuns, runsText, sliceRuns } from "@/lib/runs";
-import { boxFonts, relayout } from "@/lib/textbox";
+import { relayout } from "@/lib/textbox";
 
-export type MetricsFor = (f: FontRef) => FontMetrics;
-export type FontTable = Record<string, DocFont>;
-type Loader = Pick<typeof fontStore, "load" | "peek">;
+// Font fallback lives in lib/fallback.ts (per character since M5); re-exported for its existing users.
+export { hasUnsupportedChars, preloadFallback, prepareRuns, resolveLoadedRuns, substituteOf, type FontTable } from "@/lib/fallback";
 
-const ARIMO: BundledFont = { kind: "bundled", family: "Arimo", bold: false, italic: false };
-const NOTO_SANS = "Noto Sans";
+export type MetricsFor = (f: FontRef) => FontMetrics;
 /** Extra box width so a line measured at exactly the box width still fits. */
 const WIDTH_SLACK = 0.01;
 /** On-screen cover of an edited paragraph's original line (× size around the baseline). */
@@ -90,81 +88,6 @@ export function paragraphBox(
   return { ...box, rect: { ...box.rect, y: p.lines[0].baseline - first } };
 }
 
-export function substituteOf(f: FontRef, fonts: FontTable): BundledFont {
-  return isOriginal(f) ? fonts[fontId(f)]?.substitute ?? ARIMO : f;
-}
-
-/** One step of font fallback: a run whose original font is not loaded or lacks a glyph of its text
- *  switches to the substitute; a run whose loaded bundled family lacks a glyph switches to Arimo
- *  (Latin, Greek, Cyrillic), and Arimo to Noto Sans (wider Unicode coverage). Runs whose bundled font is not loaded yet stay as they are. */
-export function resolveRunFonts(runs: Run[], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Run[] {
-  return runs.map((r) => {
-    const m = peek(r.font);
-    if (m && covers(m, r.text)) return r;
-    if (isOriginal(r.font)) return { ...r, font: substituteOf(r.font, fonts) };
-    if (m && r.font.family === NOTO_SANS) return r;
-    if (m) return { ...r, font: { ...r.font, family: r.font.family === ARIMO.family ? NOTO_SANS : ARIMO.family } };
-    return r;
-  });
-}
-
-const fontsOf = (paragraphs: Run[][]) => boxFonts({ paragraphs } as TextBox);
-
-/** Fallback steps of the longest chain: original → substitute → Arimo → Noto Sans. */
-const FALLBACK_STEPS = 3;
-
-/** One fallback step over every paragraph; `null` when no run changed. */
-function fallbackStep(paragraphs: Run[][], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Run[][] | null {
-  let changed = false;
-  const next = paragraphs.map((p) => {
-    const q = resolveRunFonts(p, fonts, peek);
-    if (q.some((r, i) => r !== p[i])) changed = true;
-    return q;
-  });
-  return changed ? next : null;
-}
-
-/** The full font fallback using only fonts that are already loaded (same result as `prepareRuns`
- *  once its fonts are in); `null` when a font it needs is not loaded yet. */
-export function resolveLoadedRuns(paragraphs: Run[][], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Run[][] | null {
-  let out = paragraphs;
-  for (let step = 0; step <= FALLBACK_STEPS; step++) {
-    if (fontsOf(out).some((f) => !peek(f))) return null;
-    const next = fallbackStep(out, fonts, peek);
-    if (!next) return out;
-    out = next;
-  }
-  return fontsOf(out).every((f) => peek(f)) ? out : null;
-}
-
-/** Loads every font the paragraphs need and applies font fallback (original → substitute → Arimo → Noto Sans).
- *  Rejects when a bundled font cannot be loaded. */
-export async function prepareRuns(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore): Promise<Run[][]> {
-  let out = paragraphs;
-  for (let step = 0; step <= FALLBACK_STEPS; step++) {
-    await Promise.allSettled(fontsOf(out).map((f) => store.load(f)));
-    const next = fallbackStep(out, fonts, (f) => store.peek(f));
-    if (!next) break;
-    out = next;
-  }
-  await Promise.all(fontsOf(out).map((f) => store.load(f)));
-  return out;
-}
-
-/** Loads the fonts of the whole fallback chain the paragraphs may need (original -> substitute -> Arimo
- *  -> Noto Sans, in the runs' bold/italic styles) so `resolveLoadedRuns` can answer synchronously.
- *  Never rejects: a font that fails to load just stays unresolved. */
-export async function preloadFallback(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore): Promise<void> {
-  let out = paragraphs;
-  for (let step = 0; step <= FALLBACK_STEPS; step++) {
-    await Promise.allSettled(fontsOf(out).map((f) => store.load(f)));
-    const next = fallbackStep(out, fonts, (f) => store.peek(f));
-    if (!next) return;
-    out = next;
-  }
-  await Promise.allSettled(fontsOf(out).map((f) => store.load(f)));
-}
-
 /** White covers hiding an edited paragraph's original lines on screen (the bake redacts them). */
 export function maskRects(p: Paragraph): Rect[] {
   return p.lines.map((l) => ({
@@ -184,15 +107,3 @@ export function overflowsOriginal(box: TextBox, p: Paragraph): boolean {
   const original = p.lines[p.lines.length - 1].baseline - p.lines[0].baseline;
   return height > original + OVERFLOW_SLACK;
 }
-
-/** True when some character has no glyph even after the whole font fallback (original -> substitute ->
- *  Arimo -> Noto Sans) with the loaded fonts: the bake draws it with a builtin font or as a box (CJK,
- *  emoji, check marks ...). False while a font of the chain is not loaded yet. */
-export function hasUnsupportedChars(paragraphs: Run[][], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): boolean {
-  const resolved = resolveLoadedRuns(paragraphs, fonts, peek);
-  if (!resolved) return false;
-  return resolved.flat().some((r) => {
-    const m = peek(r.font);
-    return !!m && !covers(m, r.text.replace(/[\n\r\t]/g, ""));
-  });
-}
```

Modify `apps/web/src/store/text.ts`:

```diff
diff --git a/apps/web/src/store/text.ts b/apps/web/src/store/text.ts
index 163dde0..4e5be90 100644
--- a/apps/web/src/store/text.ts
+++ b/apps/web/src/store/text.ts
@@ -2,6 +2,7 @@ import { createStore } from "zustand/vanilla";
 import { useStore } from "zustand";
 import type { FontRef, Run } from "@edith/ops";
 import { fontFileUrl, getText, type DocFont, type Paragraph, type TextData } from "@/lib/api";
+import { documentScript } from "@/lib/fallback";
 import { fontId, fontStore, isOriginal } from "@/lib/fonts";
 import type { FontTable } from "@/lib/richtext";
 import { srcKey, type ParagraphPages } from "@/lib/sources";
@@ -44,6 +45,8 @@ export const textStore = createStore<TextState>()((set, get) => ({
       const data = await getText(docId);
       if (get().docId !== docId) return;
       const t = tagged({ ...data, doc_id: docId }, null);
+      // Han characters typed into this document fall back to the CJK font of its own script (Korean, Japanese …).
+      fontStore.setHanScript(documentScript(data.pages.flatMap((p) => p.paragraphs.flatMap((g) => g.runs.map((r) => r.text)))));
       set({ status: "ready", pages: { ...get().pages, ...t.pages }, fonts: { ...get().fonts, ...t.fonts } });
     } catch (e) {
       console.warn("text extraction failed; original text cannot be edited", e);
```

- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web` → 322 passed; tsc and eslint clean. E2E on your ports → 12 passed (`text.spec` "warns about unsupported characters" with 𓀀).

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add apps/web/e2e/text.spec.ts apps/web/scripts/sync-fonts.mjs apps/web/src/components/editor/text/textEdit.test.ts apps/web/src/lib/fallback.test.ts apps/web/src/lib/fallback.ts apps/web/src/lib/fonts.test.ts apps/web/src/lib/fonts.ts apps/web/src/lib/paragraphs.test.ts apps/web/src/lib/paragraphs.ts apps/web/src/store/text.test.ts apps/web/src/store/text.ts
git commit -m "feat(web): per-character font fallback with the optional CJK pack (script and design aware, loaded lazily)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
