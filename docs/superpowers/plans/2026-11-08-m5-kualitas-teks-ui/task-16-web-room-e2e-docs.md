# Task 16: Labels grow into their room, first baseline kept, Korean form E2E, README

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Use Task 6's `maxWidth`: a left-aligned single-line paragraph's edit box is as wide as its room, so a longer label stays on its line instead of wrapping inside its old width. Per-character fallback mixes fonts in a line, and a CJK fallback has a taller ascent: the first line's baseline moved down by ~1 pt (seen in the spike's E2E), so a committed `text.edit` now keeps the first baseline where the session's box had it. The new E2E edits one cell of `form-ko.pdf` ("1.2 성별 Sex" → "1.2 성별 Gender"), checks the editor holds only that cell, that no unsupported warning shows, downloads after editing, and checks the PDF: the neighbouring cell is untouched, the line reads "1.2 성별 Gender" on its baseline, characters the Dotum subset has are drawn in it and only G, d, r in a fallback. `text.spec` waits for the debounced autosave before reading the draft (it flaked once in 3 repeated runs). README: features (segmentation, font reuse, no Catatan/Link), E2E ports, the new scripts.

**Files:**
- Modify: `README.md`
- Create: `apps/web/e2e/form-ko.spec.ts`
- Modify: `apps/web/e2e/text.spec.ts`
- Modify: `apps/web/src/components/editor/text/textEdit.test.ts`
- Modify: `apps/web/src/components/editor/text/textEdit.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/paragraphs.test.ts`
- Modify: `apps/web/src/lib/paragraphs.ts`

**Interfaces:**
- Consumes: Tasks 6 (`maxWidth`, fixture), 14, 15; Tasks 7–13 UI (`Unduh`, `text-editor`).
- Produces: `Paragraph.maxWidth?` in `lib/api.ts`; `paragraphBox` widens single left-aligned lines to `maxWidth`; `keepBaseline` in `textEdit.ts`; `e2e/form-ko.spec.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/e2e/form-ko.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import path from "node:path";
import { pdfInfo } from "./pdfText";
import { pdfSpans } from "./pdfSpans";

// apps/api/scripts/e2e_form_pdf.py: Korean + Latin in a cmap-less CID subset named Dotum (as Hancom exports it); the
// table labels "1.1 성명 Full name in English" (ends at x 294) and "1.2 성별 Sex" (x 306, baseline 167) share a
// baseline across the cell border at x 300.
const FORM = path.join(__dirname, "fixtures", "form-ko.pdf");
const LABEL = "1.1 성명 Full name in English";

test("edit one cell of a Korean form in its own font and download it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(FORM);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  // The cell next to the border is a paragraph of its own: its editor holds only its text.
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 330, box.y + 163);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toHaveText("1.2 성별 Sex");
  await editor.evaluate((el) => {
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
    const i = node.textContent!.indexOf("Sex");
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 3);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.type("Gender");
  await expect(editor).toHaveText("1.2 성별 Gender");
  await expect(page.getByText("beberapa karakter tidak didukung font ini")).toHaveCount(0); // G, d, r: a fallback has them
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "form-ko.pdf");
  await (await downloadPromise).saveAs(file);

  const text = (await pdfInfo(file)).pages[0].text;
  expect(text).toContain(LABEL); // the neighbouring cell is untouched
  expect(text).not.toContain("Sex");
  const line = pdfSpans(file)[0].filter((s) => Math.abs(s.origin[1] - 167) < 1 && s.origin[0] > 300);
  expect(line.map((s) => s.text).join("")).toBe("1.2 성별 Gender");
  // Characters the embedded subset has keep it; only the missing ones (G, d, r) use a fallback font.
  expect(line[0].text.startsWith("1.2 성별")).toBe(true);
  expect(line[0].font).toContain("Dotum");
  expect(line.some((s) => s.text.includes("G") && !s.font.includes("Dotum"))).toBe(true);
});
```

Modify `apps/web/e2e/text.spec.ts`:

```diff
diff --git a/apps/web/e2e/text.spec.ts b/apps/web/e2e/text.spec.ts
index a374c0b..fa321b1 100644
--- a/apps/web/e2e/text.spec.ts
+++ b/apps/web/e2e/text.spec.ts
@@ -91,12 +91,14 @@ test("edit an original paragraph, find & replace, download", async ({ page }) =>
   }
 
   // The baked baselines are where the editor laid the lines out (±0.5 pt).
-  const draft = await page.evaluate(() => {
-    const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"))!;
-    return JSON.parse(localStorage.getItem(key)!) as { objects: Record<string, { type: string; box: { rect: { y: number }; layout: { baseline: number }[] } }> };
+  type Draft = { objects: Record<string, { type: string; box: { rect: { y: number }; layout: { baseline: number }[] } }> };
+  const readDraft = () => page.evaluate(() => {
+    const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
+    return key ? (JSON.parse(localStorage.getItem(key)!) as Draft) : null;
   });
-  const edits = Object.values(draft.objects).filter((o) => o.type === "text.edit");
-  expect(edits).toHaveLength(2);
+  const editsOf = (d: Draft | null) => Object.values(d?.objects ?? {}).filter((o) => o.type === "text.edit");
+  await expect.poll(async () => editsOf(await readDraft()).length).toBe(2); // the autosave is debounced
+  const edits = editsOf(await readDraft());
   for (const op of edits) {
     for (const line of op.box.layout) {
       const y = op.box.rect.y + line.baseline;
```

Modify `apps/web/src/components/editor/text/textEdit.test.ts`:

```diff
diff --git a/apps/web/src/components/editor/text/textEdit.test.ts b/apps/web/src/components/editor/text/textEdit.test.ts
index 531b2cd..5f7fb76 100644
--- a/apps/web/src/components/editor/text/textEdit.test.ts
+++ b/apps/web/src/components/editor/text/textEdit.test.ts
@@ -6,7 +6,7 @@ import type { Paragraph } from "@/lib/api";
 import { fontStore, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
 import { noticeStore } from "@/lib/notices";
 import { t } from "@/lib/strings";
-import { boxLineHeight, newBox } from "@/lib/textbox";
+import { boxLineHeight, newBox, relayout } from "@/lib/textbox";
 import { editorStore, type DocInfo } from "@/store/editor";
 import { textStore } from "@/store/text";
 import { afterTextCommitted, commitEditing, materializeParagraph, startParagraphEdit, startTextAt, textEditStore, whenTextCommitted } from "./textEdit";
@@ -199,6 +199,20 @@ describe("font fallback on commit", () => {
     expect(committed()).toEqual([["Halo ", orig], ["ꙮ", noto]]);
   });
 
+  it("keeps an edited paragraph's first baseline when a fallback font is taller", async () => {
+    gate.resolve(); fontsLoaded = true; notoOnly = "ꙮ";
+    const tall: FontMetrics = { ...notoSans, ascent: notoSans.ascent * 2 };
+    const pick = (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? tall : metricsOf(f));
+    vi.spyOn(fontStore, "peek").mockImplementation(pick);
+    vi.spyOn(fontStore, "get").mockImplementation(pick);
+    const before = relayout({ ...newBox([72, 90], style), paragraphs: runs("Halo", orig) }, pick);
+    textEditStore.getState().start({ id: "e1", pageKey: "o0", box: before, isNew: true, kind: "text.edit", paragraphId: "g3", initial: before.paragraphs });
+    await commitEditing(runs("Halo ꙮ", orig));
+    const after = (editorStore.getState().doc.objects.e1 as TextEdit).box;
+    expect(after.layout[0].baseline).toBeGreaterThan(before.layout[0].baseline); // the taller line …
+    expect(after.rect.y + after.layout[0].baseline).toBeCloseTo(before.rect.y + before.layout[0].baseline); // … stays put
+  });
+
   it("does the same while fonts load (slow path)", async () => {
     notoOnly = "ꙮ";
     openParagraph("Halo", orig);
```

Modify `apps/web/src/lib/paragraphs.test.ts`:

```diff
diff --git a/apps/web/src/lib/paragraphs.test.ts b/apps/web/src/lib/paragraphs.test.ts
index ccef44f..0d08dc9 100644
--- a/apps/web/src/lib/paragraphs.test.ts
+++ b/apps/web/src/lib/paragraphs.test.ts
@@ -1,7 +1,7 @@
 import { readFileSync } from "node:fs";
 import path from "node:path";
 import { describe, expect, it } from "vitest";
-import type { FontRef } from "@edith/ops";
+import type { FontRef, Run } from "@edith/ops";
 import type { Paragraph, TextData } from "@/lib/api";
 import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
 import { runsText } from "@/lib/runs";
@@ -42,6 +42,16 @@ describe("paragraphBox", () => {
     expect(texts).toContain("Indonesia");
   });
 
+  it("lets a left-aligned single line grow into its room (maxWidth) instead of wrapping", () => {
+    const label = paragraphs.find((p) => p.lines.length === 1 && p.maxWidth && p.align === "left")!;
+    const longer = (ps: Run[][]) => [[{ ...ps[0][0], text: `${runsText(ps[0])} dengan tambahan` }]];
+    const grown = paragraphBox(label, bundled, longer);
+    expect(grown.rect.w).toBeCloseTo(label.maxWidth! + 0.01);
+    expect(grown.layout).toHaveLength(1);
+    const tight = paragraphBox({ ...label, maxWidth: undefined }, bundled, longer);
+    expect(tight.layout.length).toBeGreaterThan(1); // without room it wraps at its own width
+  });
+
   it("keeps wrapped lines in one logical paragraph", () => {
     const p = paragraphs.find((x) => x.align === "justify")!;
     expect(paragraphRuns(p, hardBreaks(p, p.rect.w + 0.01, bundled))).toHaveLength(1);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -w apps/web -- src/lib/paragraphs.test.ts src/components/editor/text/textEdit.test.ts`

Expected: FAIL — the label wraps and the baseline moves. Spike output (last lines):

```
 ❯ src/components/editor/text/textEdit.test.ts (22 tests | 1 failed) 14ms
   × font fallback on commit > keeps an edited paragraph's first baseline when a fallback font is taller 3ms
 Test Files  2 failed (2)
      Tests  2 failed | 42 passed (44)
 FAIL  src/lib/paragraphs.test.ts > paragraphBox > lets a left-aligned single line grow into its room (maxWidth) instead of wrapping
AssertionError: expected 47.71 to be close to 161.01, received difference is 113.29999999999998, but expected 0.005
 FAIL  src/components/editor/text/textEdit.test.ts > font fallback on commit > keeps an edited paragraph's first baseline when a fallback font is taller
AssertionError: expected 115.34765625 to be close to 102.673828125, received difference is 12.673828125, but expected 0.005
npm error Lifecycle script `test` failed with error:
npm error command failed
```

- [ ] **Step 3: Implement**

Modify `README.md`:

```diff
diff --git a/README.md b/README.md
index 30b3d93..5e2d1bf 100644
--- a/README.md
+++ b/README.md
@@ -1,6 +1,6 @@
 # Edith
 
-Editor PDF berbasis web: unggah PDF, edit teks aslinya (rich text per kata, Cari & Ganti), tambah teks, bentuk (termasuk poligon, garis bersambung dan awan; garis putus-putus, opasitas dan rotasi), gambar, gambar bebas, whiteout, redaksi, stabilo/garis bawah/coret dan catatan (anotasi PDF asli), tanda tangan (dengan pustaka di browser), stamp (34 preset Indonesia/Inggris), centang/silang, link, isi form (opsional diratakan), kelola halaman (putar, duplikat, pindah, hapus, sisip halaman kosong, impor PDF lain yang teks dan form-nya juga bisa diedit), crop, salin/tempel/ratakan objek dan panel Anotasi, lalu unduh.
+Editor PDF berbasis web: unggah PDF, edit teks aslinya (paragraf dipisah per sel tabel, butir dan baris formulir; font asli PDF dipakai ulang, termasuk subset CJK tanpa cmap; rich text per kata, Cari & Ganti), tambah teks, bentuk (termasuk poligon, garis bersambung dan awan; garis putus-putus, opasitas dan rotasi), gambar, gambar bebas, whiteout, redaksi, stabilo/garis bawah/coret (anotasi PDF asli), tanda tangan (dengan pustaka di browser), stamp (34 preset Indonesia/Inggris), centang/silang, isi form (opsional diratakan), kelola halaman (putar, duplikat, pindah, hapus, sisip halaman kosong, impor PDF lain yang teks dan form-nya juga bisa diedit), crop, salin/tempel/ratakan objek dan panel Anotasi, lalu unduh.
 
 ## Struktur
 
@@ -26,7 +26,7 @@ Prasyarat: Node 22+, uv.
 
     npm run test:api
     npm test -w apps/web
-    npm run e2e -w apps/web
+    E2E_WEB_PORT=3000 E2E_API_PORT=8000 npm run e2e -w apps/web   # port bawaan; pakai port lain bila 3000/8000 sudah dipakai
 
 Fixture yang dihasilkan dari kode API (jalankan ulang setelah mengubah ekstraksi atau fixture-nya):
 
@@ -34,6 +34,11 @@ Fixture yang dihasilkan dari kode API (jalankan ulang setelah mengubah ekstraksi
     cd apps/api && uv run python -m scripts.e2e_text_pdf   # apps/web/e2e/fixtures/text.pdf
     cd apps/api && uv run python -m scripts.e2e_annots_pdf # apps/web/e2e/fixtures/annots.pdf
     cd apps/api && uv run python -m scripts.e2e_pages_pdf  # apps/web/e2e/fixtures/pages.pdf + import.pdf
+    cd apps/api && uv run python -m scripts.e2e_form_pdf   # apps/web/e2e/fixtures/form-ko.pdf
+
+Melihat pembagian paragraf sebuah PDF (kotak + id per paragraf, PNG per halaman):
+
+    cd apps/api && uv run python -m scripts.paragraph_overlay file.pdf /tmp/overlay
 
 Setelah mengubah `apps/api/edith/ops.py`:
```

Modify `apps/web/src/components/editor/text/textEdit.ts`:

```diff
diff --git a/apps/web/src/components/editor/text/textEdit.ts b/apps/web/src/components/editor/text/textEdit.ts
index eb5a2c8..ba83733 100644
--- a/apps/web/src/components/editor/text/textEdit.ts
+++ b/apps/web/src/components/editor/text/textEdit.ts
@@ -189,7 +189,7 @@ export function commitEditing(paragraphs: Run[][]): Promise<void> {
   // Fast path: every font (after the whole fallback chain) already loaded → land synchronously.
   const ready = resolveLoadedRuns(draft.paragraphs, fonts, (f) => fontStore.peek(f));
   if (ready) {
-    land(e, relayout({ ...draft, paragraphs: ready }, (f) => fontStore.get(f)));
+    land(e, keepBaseline(e, relayout({ ...draft, paragraphs: ready }, (f) => fontStore.get(f))));
     return Promise.resolve();
   }
   const p: Promise<void> = (async () => {
@@ -201,12 +201,20 @@ export function commitEditing(paragraphs: Run[][]): Promise<void> {
       textEditStore.getState().start({ ...e, box: draft }); // keep the text editable instead of losing it
       return;
     }
-    land(e, relayout({ ...draft, paragraphs: runs }, (f) => fontStore.get(f)));
+    land(e, keepBaseline(e, relayout({ ...draft, paragraphs: runs }, (f) => fontStore.get(f))));
   })().finally(() => { if (pendingCommit === p) pendingCommit = null; });
   pendingCommit = p;
   return p;
 }
 
+/** An original paragraph keeps its first baseline where the session's box had it: a fallback font with a taller
+ *  ascent in the first line (CJK fallbacks are) would otherwise push the whole paragraph down. */
+function keepBaseline(e: Editing, box: TextBox): TextBox {
+  const before = e.box.layout[0]?.baseline, after = box.layout[0]?.baseline;
+  if (e.kind !== "text.edit" || before === undefined || after === undefined) return box;
+  return { ...box, rect: { ...box.rect, y: e.box.rect.y + before - after } };
+}
+
 function land(e: Editing, box: TextBox): void {
   const st = editorStore.getState();
   const op = (e.kind === "text.edit"
```

Modify `apps/web/src/lib/api.ts`:

```diff
diff --git a/apps/web/src/lib/api.ts b/apps/web/src/lib/api.ts
index 2f3a1ef..2a8ba01 100644
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -16,9 +16,11 @@ export class ApiError extends Error {
 
 /** One original line of a paragraph; `start`/`end` index the paragraph's joined run text (end excludes trailing spaces). */
 export interface ParagraphLine { rect: Rect; baseline: number; size: number; start: number; end: number }
+/** `maxWidth` (single-line paragraphs, M5): how wide the paragraph may grow when edited, from its left edge — up to
+ *  the next cell border or text on its line. */
 export interface Paragraph {
   id: string; rect: Rect; lines: ParagraphLine[]; runs: Run[];
-  align: "left" | "center" | "right" | "justify"; lineHeight: number; editable: boolean;
+  align: "left" | "center" | "right" | "justify"; lineHeight: number; editable: boolean; maxWidth?: number;
 }
 /** `doc`: set by the client on fonts of an imported PDF (see `fontId`). */
 export interface DocFont {
```

Modify `apps/web/src/lib/paragraphs.ts`:

```diff
diff --git a/apps/web/src/lib/paragraphs.ts b/apps/web/src/lib/paragraphs.ts
index 406aca2..3ed2d0f 100644
--- a/apps/web/src/lib/paragraphs.ts
+++ b/apps/web/src/lib/paragraphs.ts
@@ -77,7 +77,9 @@ export function paragraphBox(
   p: Paragraph, metricsFor: MetricsFor,
   edit?: (paragraphs: Run[][], toBox: (offset: number) => number) => Run[][],
 ): TextBox {
-  const width = paragraphWidth(p, metricsFor);
+  // A left-aligned single line (a form label, a table cell) may grow into the room the API measured beside it.
+  const room = p.lines.length === 1 && p.align === "left" && p.maxWidth ? p.maxWidth + WIDTH_SLACK : 0;
+  const width = Math.max(paragraphWidth(p, metricsFor), room);
   const breaks = hardBreaks(p, width, metricsFor);
   const paragraphs = paragraphRuns(p, breaks);
   const box = relayout({
```

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q` → 425 passed; `npm test -w apps/web` → 324 passed; tsc, eslint, `npm run build -w apps/web` clean. E2E on your ports: `E2E_WEB_PORT=… E2E_API_PORT=… npm run e2e -w apps/web` → 13 passed; with `-- --repeat-each=3` → 39 passed (the spike's result).

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add README.md apps/web/e2e/form-ko.spec.ts apps/web/e2e/text.spec.ts apps/web/src/components/editor/text/textEdit.test.ts apps/web/src/components/editor/text/textEdit.ts apps/web/src/lib/api.ts apps/web/src/lib/paragraphs.test.ts apps/web/src/lib/paragraphs.ts
git commit -m "feat(web): single-line paragraphs grow into their room; keep the first baseline under taller fallbacks; Korean form E2E" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
