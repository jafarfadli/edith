# Task 7: E2E ports from the environment; hide the Catatan and Link tools

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** (a) `playwright.config.ts` takes its ports from `E2E_WEB_PORT` / `E2E_API_PORT` (defaults 3000 / 8000), so an E2E run on the owner's Mac mini (where the deployed Edith answers on :3000/:8000 and Playwright would silently *reuse* it) can use its own servers. (b) Owner decision 3: the sticky-note (Catatan) and Link tools leave the UI entirely — toolbar buttons, the Ctrl/Cmd+K shortcut, the link popover, the note/link controls of the properties bar. Everything underneath stays: `annot.add` (note) / `link.add` in the schema, the bake and its API tests, the web data model, rendering, compaction and export. A note or link restored from an older draft still renders, exports, is listed in the Anotasi panel (its labels stay) and can be selected, moved and deleted; it just has no properties any more.

**Files:**
- Modify: `apps/web/playwright.config.ts`
- Modify: `apps/web/src/components/editor/Toolbar.tsx` (drop the two tool buttons)
- Modify: `apps/web/src/components/editor/useShortcuts.ts` (drop Ctrl/Cmd+K and the link-popover close on Escape)
- Modify: `apps/web/src/components/editor/Editor.tsx` (LinkPopover no longer mounted)
- Modify: `apps/web/src/components/editor/PropertiesBar.tsx` (no note colour/content, no link target fields)
- Modify: `apps/web/src/components/editor/marks/LinkPopover.tsx` (comment only: kept, not mounted)
- Modify: `apps/web/src/lib/strings.ts` (drop `annot.note`, `annot.noteContent`, `annot.link`, now unused)
- Modify: `apps/web/e2e/annots.spec.ts`, `apps/web/e2e/pages.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `E2E_WEB_PORT` / `E2E_API_PORT` for every later E2E run (all task commands below use them). `Tool` keeps `"note" | "link"` (PageOverlay still handles them) so the tools can come back by re-adding two buttons; `LinkPopover.tsx`, `LinkTargetFields.tsx`, `linkStore.ts`, `noteAt()` and `style.noteColor` stay unused-but-kept. `t.link.*` stays (used by the kept files); `t.objectKinds.note/link` stay (Anotasi panel labels for restored objects).

Machine etiquette for every E2E run in this plan: never let Playwright reuse a server you did not start. On the owner's machine run `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web` (any free 19000–19999 ports); in CI the defaults are fine.

- [ ] **Step 1: Adapt the E2E tests first (they fail on the current UI)**

`annots.spec.ts` no longer creates a note or a link; it asserts the two buttons are gone and keeps every PDF assertion for the highlight, signatures, stamps and form fields. `pages.spec.ts` used two sticky notes to check that the crop removes annotations lying entirely outside it; it now puts a highlight on page 2 inside the crop and checks it survives (the "removed outside the crop" half stays covered by `apps/api/tests/test_bake_crop_scrub.py`).

```diff
diff --git a/apps/web/e2e/annots.spec.ts b/apps/web/e2e/annots.spec.ts
index 467e6b7..8b77102 100644
--- a/apps/web/e2e/annots.spec.ts
+++ b/apps/web/e2e/annots.spec.ts
@@ -18,7 +18,7 @@ async function download(page: Page, name: string): Promise<string> {
   return file;
 }
 
-test("highlight, note, signature, stamp, link and form, then download", async ({ page }) => {
+test("highlight, signature, stamp and form, then download", async ({ page }) => {
   await page.goto("/");
   await page.evaluate(() => localStorage.clear()); // no autosave draft or signature library from an earlier run of this fixture
   await page.getByTestId("file-input").setInputFiles(ANNOTS_PDF);
@@ -37,10 +37,9 @@ test("highlight, note, signature, stamp, link and form, then download", async ({
   await page.mouse.move(box.x + x1 - 1, box.y + 76, { steps: 3 });
   await page.mouse.up();
 
-  // Sticky note with text.
-  await page.getByRole("button", { name: "Catatan", exact: true }).click();
-  await page.mouse.click(box.x + 400, box.y + 200);
-  await page.getByRole("textbox", { name: "Isi catatan" }).fill("Periksa pasal ini");
+  // Sticky notes and links have no tool since M5 (hidden, the bake still supports them).
+  await expect(page.getByRole("button", { name: "Catatan", exact: true })).toHaveCount(0);
+  await expect(page.getByRole("button", { name: "Link", exact: true })).toHaveCount(0);
 
   // Typed signature (saved to the library), then the same signature again from the library.
   await page.getByRole("button", { name: "Tanda Tangan", exact: true }).click();
@@ -65,24 +64,11 @@ test("highlight, note, signature, stamp, link and form, then download", async ({
   await picker.getByRole("button", { name: "APPROVED", exact: true }).click();
   await expect(picker).toHaveCount(0);
 
-  // A link to page 2.
-  await page.getByRole("button", { name: "Link", exact: true }).click();
-  await page.mouse.move(box.x + 72, box.y + 300);
-  await page.mouse.down();
-  await page.mouse.move(box.x + 140, box.y + 310, { steps: 3 });
-  await page.mouse.move(box.x + 200, box.y + 320, { steps: 3 });
-  await page.mouse.up();
-  const popover = page.getByTestId("link-popover");
-  await popover.getByRole("radio", { name: "Ke halaman" }).click();
-  await popover.getByRole("combobox", { name: "Halaman tujuan" }).selectOption({ label: "Halaman 2" });
-  await popover.getByRole("button", { name: "Simpan link" }).click();
-  await expect(popover).toHaveCount(0);
-
   // Fill the form.
   await page.getByRole("textbox", { name: "nama", exact: true }).fill("Budi Santoso");
   await page.getByRole("checkbox", { name: "setuju" }).check();
 
-  // Download with the form kept: native annotations, link, signatures, stamp and field values.
+  // Download with the form kept: the highlight, signatures, stamps and field values.
   const kept = pdfReport(await download(page, "annots.pdf"));
   const p1 = kept.pages[0];
   const hl = p1.annots.find((a) => a.type === "Highlight")!;
@@ -92,14 +78,9 @@ test("highlight, note, signature, stamp, link and form, then download", async ({
   expect(Math.abs(Math.max(...xs) - x1)).toBeLessThanOrEqual(1);
   expect(Math.min(...ys)).toBeCloseTo(80 - 0.9 * 12, 1);
   expect(Math.max(...ys)).toBeCloseTo(80 + 0.25 * 12, 1);
-  const note = p1.annots.find((a) => a.type === "Text")!;
-  expect(note.content).toBe("Periksa pasal ini");
-  expect(note.author).toBe(""); // /T stays empty
-  expect(hl.author).toBe("");
-  expect(note.rect.map(Math.round)).toEqual([400, 200, 416, 216]);
-  const [link] = p1.links;
-  expect([link.kind, link.page]).toEqual([1, 1]); // LINK_GOTO → page 2
-  expect(link.from.map(Math.round)).toEqual([72, 300, 200, 320]);
+  expect(hl.author).toBe(""); // /T stays empty
+  expect(p1.annots.map((a) => a.type)).toEqual(["Highlight"]);
+  expect(p1.links).toEqual([]);
   expect(p1.images).toBe(2); // the typed signature and the same one again from the library
   expect(p1.text).toContain("DISETUJUI");
   expect(p1.text).toContain("APPROVED");
@@ -112,6 +93,5 @@ test("highlight, note, signature, stamp, link and form, then download", async ({
   expect(flat.isForm).toBe(false);
   expect(flat.pages[0].widgets).toEqual([]);
   expect(flat.pages[0].text).toContain("Budi Santoso");
-  expect(flat.pages[0].annots.map((a) => a.type)).toEqual(expect.arrayContaining(["Highlight", "Text"]));
-  expect(flat.pages[0].links).toHaveLength(1);
+  expect(flat.pages[0].annots.map((a) => a.type)).toEqual(["Highlight"]);
 });
```

```diff
diff --git a/apps/web/e2e/pages.spec.ts b/apps/web/e2e/pages.spec.ts
index e6d889a..aeefdd4 100644
--- a/apps/web/e2e/pages.spec.ts
+++ b/apps/web/e2e/pages.spec.ts
@@ -141,16 +141,17 @@ test("manage pages, import, crop, shapes, copy/paste, align and the annotations
   await page.getByTestId("mini-bar").getByRole("button", { name: "Lainnya" }).click();
   await page.getByRole("menuitem", { name: "Ratakan ke kiri halaman" }).click();
 
-  // Two sticky notes on page 2: one entirely inside the coming crop, one entirely in the 5 % margin the crop hides.
+  // A highlight on page 2 ("Halaman" of "Halaman satu", baseline 72), inside the coming crop: it stays in the export.
+  // (Sticky notes have no tool since M5, so annotations entirely outside a crop are covered by the API tests only.)
   box = await pageBox(page, 1);
-  await page.getByRole("button", { name: "Catatan", exact: true }).click();
-  await page.mouse.click(box.x + 300, box.y + 500);
-  await page.getByRole("textbox", { name: "Isi catatan" }).fill("dalam crop");
-  await page.getByRole("button", { name: "Catatan", exact: true }).click();
-  await page.mouse.click(box.x + 8, box.y + 8);
-  await page.getByRole("textbox", { name: "Isi catatan" }).fill("luar crop");
+  await page.getByRole("button", { name: "Penanda", exact: true }).click();
+  await page.mouse.move(box.x + 73, box.y + 67);
+  await page.mouse.down();
+  await page.mouse.move(box.x + 100, box.y + 67, { steps: 3 });
+  await page.mouse.move(box.x + 125, box.y + 67, { steps: 3 });
+  await page.mouse.up();
   await page.getByRole("button", { name: "Pilih", exact: true }).click();
-  await expect(items).toHaveCount(9);
+  await expect(items).toHaveCount(8);
 
   // Crop page 2 (the default crop: 5 % in from every edge).
   await page.getByRole("button", { name: "Crop", exact: true }).click();
@@ -178,7 +179,7 @@ test("manage pages, import, crop, shapes, copy/paste, align and the annotations
   await expect(items.filter({ hasText: "Centang" })).toHaveCount(1);
   expect(pdfShapes(await download("before.pdf"))[0].drawings.filter(isBlue).length).toBeGreaterThan(0);
   await page.getByRole("button", { name: "Hapus Centang" }).click();
-  await expect(items).toHaveCount(8);
+  await expect(items).toHaveCount(7);
   await expect(items.filter({ hasText: "Centang" })).toHaveCount(0);
 
   const file = await download("pages.pdf");
@@ -221,8 +222,8 @@ test("manage pages, import, crop, shapes, copy/paste, align and the annotations
   expect(hy1).toBeLessThanOrEqual(wb[3] + 1);
   expect(hy0).toBeLessThan(200); // above the baseline (y = 200) ...
   expect(hy1).toBeGreaterThan(200); // ... and below it
-  // Crop scrub: the note entirely outside the crop is gone from the export, the one inside stays.
-  expect(report.pages[1].annots.map((a) => [a.type, a.content])).toEqual([["Text", "dalam crop"]]);
+  // The highlight inside the crop stays.
+  expect(report.pages[1].annots.map((a) => a.type)).toEqual(["Highlight"]);
   expect(report.pages[0].widgets).toEqual([{ name: "nama", value: "Utama Budi" }]);
   expect(report.pages[1].widgets).toEqual([{ name: "nama", value: "Utama Budi" }]);
   expect(report.pages[3].widgets).toHaveLength(1);
```

- [ ] **Step 2: Ports from the environment, then run the E2E to see it fail**

```ts
import { defineConfig, devices } from "@playwright/test";

// Ports come from the environment so a run never reuses servers that belong to something else on the machine
// (playwright reuses whatever already answers on these ports).
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8000);
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: WEB_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    {
      command: `uv run uvicorn edith.main:app --port ${API_PORT}`, cwd: "../api", url: `${API_URL}/health`, reuseExistingServer: true, timeout: 60_000,
      env: { EDITH_CORS_ORIGINS: JSON.stringify([WEB_URL]) },
    },
    { command: `npm run dev -- --port ${WEB_PORT}`, url: WEB_URL, reuseExistingServer: true, timeout: 120_000, env: { NEXT_PUBLIC_API_URL: API_URL } },
  ],
});
```

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web -- annots.spec.ts`
Expected: FAIL — `expect(getByRole('button', { name: 'Catatan', exact: true })).toHaveCount(0)` received 1.

- [ ] **Step 3: Remove the two tools from the UI**

```diff
diff --git a/apps/web/src/components/editor/Toolbar.tsx b/apps/web/src/components/editor/Toolbar.tsx
index 9e01032..22cd3ac 100644
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -91,8 +91,6 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
         <span aria-hidden>✍</span><span className="hidden lg:inline">{t.annot.signature}</span>
       </button>
       {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onNotice={onNotice} />}
-      <ToolButton tool="note" label={t.annot.note} icon="🗒" active={tool} />
-      <ToolButton tool="link" label={t.annot.link} icon="🔗" active={tool} />
       <div className="flex-1" />
       <button aria-label={t.pages.manage} title={t.pages.manage} onClick={() => setPagesOpen(true)} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
         <span aria-hidden>▦</span><span className="hidden lg:inline">{t.pages.manage}</span>
```

```diff
diff --git a/apps/web/src/components/editor/useShortcuts.ts b/apps/web/src/components/editor/useShortcuts.ts
index 0a9cab6..623175d 100644
--- a/apps/web/src/components/editor/useShortcuts.ts
+++ b/apps/web/src/components/editor/useShortcuts.ts
@@ -3,7 +3,6 @@
 import { useEffect } from "react";
 import { editorStore } from "@/store/editor";
 import { openFind } from "./find/findStore";
-import { linkStore } from "./marks/linkStore";
 import { copySelection, duplicateSelection, pasteClipboard } from "./objects/clipboard";
 import { afterTextCommitted, textEditStore } from "./text/textEdit";
 
@@ -41,12 +40,11 @@ export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
       const k = e.key.toLowerCase();
       if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().undo()); }
       else if ((mod && k === "z" && e.shiftKey) || (e.ctrlKey && k === "y")) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().redo()); }
-      else if (mod && k === "k" && !e.shiftKey && !e.altKey) { e.preventDefault(); s.setTool("link"); }
       else if (mod && k === "c" && !e.shiftKey && !e.altKey) { if (copySelection()) e.preventDefault(); } // else: the browser's copy
       else if (mod && k === "v" && !e.shiftKey && !e.altKey) { if (pasteClipboard()) e.preventDefault(); }
       else if (mod && k === "d" && !e.shiftKey && !e.altKey) { e.preventDefault(); duplicateSelection(); } // not the bookmark dialog
       else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) { e.preventDefault(); s.deleteObject(s.selection); }
-      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); linkStore.getState().close(); }
+      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); }
     }
     window.addEventListener("keydown", onKey);
     return () => window.removeEventListener("keydown", onKey);
```

```diff
diff --git a/apps/web/src/components/editor/Editor.tsx b/apps/web/src/components/editor/Editor.tsx
index a511b30..aa46592 100644
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -36,7 +36,6 @@ const PageOverlay = dynamic(async () => {
   return import("./PageOverlay");
 }, { ssr: false });
 const TextEditor = dynamic(() => import("./text/TextEditor").then((m) => m.TextEditor), { ssr: false });
-const LinkPopover = dynamic(() => import("./marks/LinkPopover").then((m) => m.LinkPopover), { ssr: false });
 const CropOverlay = dynamic(() => import("./pages/CropOverlay"), { ssr: false });
 const FindBar = dynamic(() => import("./find/FindBar").then((m) => m.FindBar), { ssr: false });
 
@@ -178,7 +177,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
           }}
           onPointerUp={() => { drag.current = null; }}
         >
-          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><LinkPopover {...a} /><SelectionMiniBar {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
+          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><SelectionMiniBar {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
         </main>
       </div>
       <FindBar />
```

```diff
diff --git a/apps/web/src/components/editor/PropertiesBar.tsx b/apps/web/src/components/editor/PropertiesBar.tsx
index 3278e49..5fac883 100644
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -1,7 +1,6 @@
 "use client";
 
 import type { ContentOp } from "@edith/ops";
-import { useEffect, useRef } from "react";
 import { useStore } from "zustand";
 import type { Dash } from "@/lib/geometry";
 import { hasOpacity, inkWidth, isMarkup, isTextOp, MARKUP_TOOLS, opacityOf, POLY_TOOLS } from "@/lib/objects";
@@ -9,16 +8,15 @@ import { t } from "@/lib/strings";
 import { useChars } from "@/store/chars";
 import { editorStore, sourcePage, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
 import { srcKey } from "@/lib/sources";
-import type { LinkTarget } from "@/lib/links";
 import { STAMP_COLORS } from "@/lib/stamps";
 import { ColorField } from "./ColorField";
-import { LinkTargetFields } from "./marks/LinkTargetFields";
-import { linkStore } from "./marks/linkStore";
 import { textEditStore } from "./text/textEdit";
 
 export const textPropsSlot: { render?: () => React.ReactNode } = {};
 
-type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | "symbol" | "note" | "link" | "stamp" | null;
+// Sticky notes and links (annot.add note, link.add) have no tool since M5: one restored from an older draft can
+// still be selected, moved and deleted, but has no properties here.
+type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | "symbol" | "stamp" | null;
 
 function kindOf(op: ContentOp | undefined, tool: string): Kind {
   if (op) {
@@ -28,14 +26,11 @@ function kindOf(op: ContentOp | undefined, tool: string): Kind {
     if (isTextOp(op)) return "text";
     if (isMarkup(op)) return "markup";
     if (op.type === "symbol.add") return "symbol";
-    if (op.type === "annot.add") return "note";
-    if (op.type === "link.add") return "link";
     if (op.type === "stamp.add") return "stamp";
     return null;
   }
   if (MARKUP_TOOLS.has(tool)) return "markup";
   if (tool === "check" || tool === "cross") return "symbol";
-  if (tool === "note") return "note";
   if (tool === "rect" || tool === "ellipse" || tool === "polygon" || tool === "cloud") return "shape";
   if (tool === "line" || tool === "arrow" || tool === "polyline") return "line";
   if (tool === "ink") return "ink";
@@ -65,16 +60,6 @@ export function PropertiesBar() {
   });
   const currentLines = useChars((cs) => cs.pages[currentSrc]);
   const noText = MARKUP_TOOLS.has(tool) && Array.isArray(currentLines) && currentLines.length === 0;
-  const noteField = useRef<HTMLTextAreaElement>(null);
-  const focusNote = useStore(linkStore, (st) => st.focusNote);
-  // Only a note just created takes focus; selecting an existing note must leave Delete/Backspace to the editor.
-  useEffect(() => {
-    if (!focusNote || focusNote !== selection || !noteField.current) return;
-    // Past the pointerdown that created the note: its mousedown default action would blur the field again.
-    const el = noteField.current;
-    linkStore.getState().setFocusNote(null);
-    requestAnimationFrame(() => setTimeout(() => el.focus(), 0)); // not cancelled: clearing the flag re-runs this effect
-  }, [focusNote, selection]);
   const o = op as (ContentOp & Record<string, unknown>) | undefined;
   const s = editorStore.getState();
 
@@ -83,7 +68,6 @@ export function PropertiesBar() {
     if (o) s.updateObject(o.id, { color: v } as Partial<ContentOp>, { coalesce: `props:${o.id}` });
     else if (MARKUP_TOOLS.has(tool)) s.setStyle({ markup: { ...style.markup, [tool]: v } });
     else if (kind === "symbol") s.setStyle({ symbolColor: v });
-    else if (kind === "note") s.setStyle({ noteColor: v });
   }
 
   const stroke = (o?.type === "ink.add" ? (o.color as string) : (o?.stroke as string | undefined)) ?? style.stroke;
@@ -170,17 +154,6 @@ export function PropertiesBar() {
       )}
       {kind === "markup" && noText && <span className="text-xs text-muted">{t.annot.noText}</span>}
       {kind === "symbol" && <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.symbolColor} onChange={setColor} />}
-      {kind === "note" && <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.noteColor} onChange={setColor} />}
-      {kind === "note" && o && (
-        <textarea key={o.id} aria-label={t.annot.noteContent} placeholder={t.annot.noteContent} ref={noteField} rows={1}
-          value={(o.content as string | null | undefined) ?? ""}
-          onChange={(e) => s.updateObject(o.id, { content: e.target.value } as Partial<ContentOp>, { coalesce: `note:${o.id}` })}
-          className="h-8 w-80 resize-none rounded border border-line px-1.5 py-1 text-ink" />
-      )}
-      {kind === "link" && o && (
-        <LinkTargetFields key={o.id} target={o.target as LinkTarget}
-          onChange={(target) => { if (target) s.updateObject(o.id, { target } as Partial<ContentOp>, { coalesce: `link:${o.id}` }); }} />
-      )}
       {kind === "stamp" && o && (
         <div role="radiogroup" aria-label={t.editor.color} className="flex items-center gap-1">
           {STAMP_COLORS.map((c) => (
```

```diff
diff --git a/apps/web/src/components/editor/marks/LinkPopover.tsx b/apps/web/src/components/editor/marks/LinkPopover.tsx
index 54d40a9..1eea05d 100644
--- a/apps/web/src/components/editor/marks/LinkPopover.tsx
+++ b/apps/web/src/components/editor/marks/LinkPopover.tsx
@@ -1,5 +1,8 @@
 "use client";
 
+// Not mounted since M5: the Link tool is hidden (owner decision). Kept with LinkTargetFields and linkStore so the
+// tool can come back; link.add objects from older drafts still render, export and can be deleted.
+
 import { useEffect, useState } from "react";
 import { useStore } from "zustand";
 import type { LinkAdd } from "@edith/ops";
```

```diff
diff --git a/apps/web/src/lib/strings.ts b/apps/web/src/lib/strings.ts
index 3b41a5c..658772c 100644
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -85,7 +85,7 @@ export const t = {
   },
   annot: {
     markup: "Penanda", highlight: "Stabilo", underline: "Garis bawah", strike: "Coret",
-    check: "Centang", cross: "Silang", note: "Catatan", noteContent: "Isi catatan", link: "Link",
+    check: "Centang", cross: "Silang",
     signature: "Tanda Tangan", stamp: "Stamp", uploadImage: "Unggah gambar",
     noText: "Tidak ada teks asli yang bisa ditandai di halaman ini",
   },
```

- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run build -w apps/web`
Expected: web 293 passed (no unit test changes), tsc and eslint clean, build OK.

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web`
Expected: 9 passed.

API untouched: `cd apps/api && uv run pytest -q` still passes (its note/link bake tests included).

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json; rm -f apps/web/AGENTS.md
git add apps/web/playwright.config.ts apps/web/e2e/annots.spec.ts apps/web/e2e/pages.spec.ts \
  apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/useShortcuts.ts \
  apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/PropertiesBar.tsx \
  apps/web/src/components/editor/marks/LinkPopover.tsx apps/web/src/lib/strings.ts
git commit -m "feat(web): hide the sticky-note and link tools; E2E ports from the environment" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
