# Task 16: Imported PDFs on the web: original text, markup, Find & Replace

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 15 leaves, new files are complete.

**Goal:** Owner decision 1 (web text side): the text store loads `/text` of every imported PDF too (paragraphs keyed by `srcKey(doc, index)`, fonts by `fontId`, original FontRefs tagged with `doc`); the chars store keys pages by `srcKey`; the font store fetches original fonts from the right document; the main-document-only checks of Task 7 are lifted — so editing paragraphs, Penanda markup, Find & Replace and the scanned-page hint work on imported pages.

**Files:**
- Modify: `apps/web/src/components/editor/Editor.tsx`
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`
- Modify: `apps/web/src/components/editor/PropertiesBar.tsx`
- Modify: `apps/web/src/components/editor/find/replace.test.ts`
- Modify: `apps/web/src/components/editor/marks/markupTool.ts`
- Modify: `apps/web/src/components/editor/pages/ManagePagesModal.tsx`
- Modify: `apps/web/src/components/editor/pages/importPdf.ts`
- Modify: `apps/web/src/components/editor/text/textEdit.test.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/fonts.test.ts`
- Modify: `apps/web/src/lib/fonts.ts`
- Modify: `apps/web/src/lib/paragraphs.ts`
- Modify: `apps/web/src/lib/richtext.test.ts`
- Modify: `apps/web/src/lib/richtext.ts`
- Create: `apps/web/src/lib/sources.ts`
- Modify: `apps/web/src/lib/targets.test.ts`
- Modify: `apps/web/src/lib/targets.ts`
- Modify: `apps/web/src/store/chars.test.ts`
- Modify: `apps/web/src/store/chars.ts`
- Modify: `apps/web/src/store/text.test.ts`
- Modify: `apps/web/src/store/text.ts`

**Interfaces:**
- Consumes: Task 15 `OriginalFont.doc`; Task 7/8 import flow (`importPdf`, `ManagePagesModal`, `resolveImports`).
- Produces:
- `lib/sources.ts`: `ParagraphPages`, `srcKey(doc, index)`.
- `lib/fonts.ts`: `fontId(f: OriginalFont)`; `fontKey` of an imported original = `orig-<doc>-<ref>`; `setOriginalSource((f: OriginalFont) => url)`.
- `DocFont.doc?`; `FontTable` keyed by `fontId`; `patchFont` only switches to variants of the same PDF.
- `textStore {status, docId, pages, fonts, imports, load, loadImport}`; `paragraphsOf(src, pages)` for every PDF.
- `charsStore {pages, load(docId, index), reset()}`; `charLines(srcKey | null)`.
- `buildTargets(doc, pages: ParagraphPages)`, `highlightRects(…, pages: ParagraphPages, …)`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/src/store/text.test.ts`:

```diff
--- a/apps/web/src/store/text.test.ts
+++ b/apps/web/src/store/text.test.ts
@@ -6,7 +6,7 @@ import { paragraphsOf, textStore } from "@/store/text";
 afterEach(() => {
   vi.unstubAllGlobals();
   vi.restoreAllMocks();
-  textStore.setState({ status: "idle", docId: null, pages: {}, fonts: {} });
+  textStore.setState({ status: "idle", docId: null, pages: {}, fonts: {}, imports: {} });
 });
 
 const para: Paragraph = { id: "g0", rect: { x: 0, y: 0, w: 10, h: 10 }, lines: [], runs: [], align: "left", lineHeight: 12, editable: true };
@@ -26,9 +26,24 @@ describe("textStore", () => {
     expect(textStore.getState()).toMatchObject({ status: "ready", docId: "D", fonts: { f5: font } });
     expect(paragraphsOf({ doc: "D", index: 0 })).toEqual([para]);
     expect(paragraphsOf({ blank: { width: 1, height: 1 } })).toEqual([]);
-    expect(paragraphsOf({ doc: "IMPORTED", index: 0 })).toEqual([]); // pages of imported PDFs: no original text
+    expect(paragraphsOf({ doc: "IMPORTED", index: 0 })).toEqual([]); // not loaded
     const url = source.mock.calls[0][0]!;
-    expect(url("f5")).toBe("http://localhost:8000/documents/D/fonts/f5");
+    expect(url({ kind: "original", ref: "f5" })).toBe("http://localhost:8000/documents/D/fonts/f5");
+    expect(url({ kind: "original", ref: "f5", doc: "I" })).toBe("http://localhost:8000/documents/I/fonts/f5");
+  });
+
+  it("adds an imported PDF's text with its fonts named after it", async () => {
+    const run = { text: "Impor", font: { kind: "original", ref: "f5" }, size: 12, color: "#000000" };
+    const imported = { doc_id: "I", pages: [{ index: 0, paragraphs: [{ ...para, runs: [run] }] }], fonts: [font] };
+    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/I/") ? imported : { doc_id: "D", pages: [{ index: 0, paragraphs: [para] }], fonts: [font] }), { status: 200 }));
+    vi.stubGlobal("fetch", fetchMock);
+    await textStore.getState().load("D");
+    await Promise.all([textStore.getState().loadImport("I"), textStore.getState().loadImport("I")]);
+    expect(fetchMock).toHaveBeenCalledTimes(2);
+    expect(paragraphsOf({ doc: "D", index: 0 })).toEqual([para]);
+    expect(paragraphsOf({ doc: "I", index: 0 })[0].runs[0].font).toEqual({ kind: "original", ref: "f5", doc: "I" });
+    expect(textStore.getState().fonts).toEqual({ f5: font, "I/f5": { ...font, doc: "I" } });
+    expect(textStore.getState().imports).toEqual({ I: "ready" });
   });
 
   it("marks a failed load as error", async () => {
```

Modify `apps/web/src/store/chars.test.ts`:

```diff
--- a/apps/web/src/store/chars.test.ts
+++ b/apps/web/src/store/chars.test.ts
@@ -4,7 +4,7 @@ import { charLines, charsStore } from "@/store/chars";
 afterEach(() => {
   vi.unstubAllGlobals();
   vi.restoreAllMocks();
-  charsStore.setState({ docId: null, pages: {} });
+  charsStore.getState().reset();
 });
 
 const lines = [{ text: "Hi", boxes: [[72, 78], [78, 81]], baseline: 100, size: 12 }];
@@ -17,20 +17,22 @@ describe("charsStore", () => {
     await charsStore.getState().load("D", 2);
     expect(fetchMock).toHaveBeenCalledTimes(1);
     expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/documents/D/pages/2/chars", undefined);
-    expect(charLines(2)).toEqual(lines);
-    expect(charLines(0)).toEqual([]);
+    expect(charLines("D:2")).toEqual(lines);
+    expect(charLines("D:0")).toEqual([]);
     expect(charLines(null)).toEqual([]);
   });
 
-  it("retries after an error and forgets another document's pages", async () => {
+  it("keeps pages of several documents apart, retries after an error, forgets on reset", async () => {
     vi.spyOn(console, "warn").mockImplementation(() => {});
     vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
     await charsStore.getState().load("D", 0);
-    expect(charsStore.getState().pages[0]).toBe("error");
+    expect(charsStore.getState().pages["D:0"]).toBe("error");
     vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ lines }), { status: 200 })));
     await charsStore.getState().load("D", 0);
-    expect(charLines(0)).toEqual(lines);
-    await charsStore.getState().load("E", 1);
-    expect(charsStore.getState().pages[0]).toBeUndefined();
+    await charsStore.getState().load("I", 0);
+    expect(charLines("D:0")).toEqual(lines);
+    expect(charLines("I:0")).toEqual(lines);
+    charsStore.getState().reset();
+    expect(charLines("D:0")).toEqual([]);
   });
 });
```

Modify `apps/web/src/lib/richtext.test.ts`:

```diff
--- a/apps/web/src/lib/richtext.test.ts
+++ b/apps/web/src/lib/richtext.test.ts
@@ -1,6 +1,7 @@
 import { describe, expect, it } from "vitest";
 import type { Run } from "@edith/ops";
 import type { DocFont } from "@/lib/api";
+import { fontKey } from "@/lib/fonts";
 import { applyPatch, attrsOf, docToRuns, fontStyle, patchFont, runCss, runOf, runsToDoc } from "@/lib/richtext";
 
 const arimo = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
@@ -70,3 +71,18 @@ describe("rich text model", () => {
     expect(css).toContain("background-color:#ffff00");
   });
 });
+
+describe("fonts of imported PDFs", () => {
+  const info = (ref: string, doc: string | undefined, bold: boolean) => ({
+    ref, doc, name: "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold, italic: false,
+    substitute: { kind: "bundled" as const, family: "Carlito", bold, italic: false },
+  });
+  const fonts = { f1: info("f1", undefined, false), f2: info("f2", undefined, true), "I/f1": info("f1", "I", false), "I/f9": info("f9", "I", true) };
+
+  it("resolve by document and switch to a variant of the same PDF", () => {
+    expect(fontStyle({ kind: "original", ref: "f1", doc: "I" }, fonts).original).toBe("I/f1");
+    expect(patchFont({ kind: "original", ref: "f1", doc: "I" }, { bold: true }, fonts)).toEqual({ kind: "original", ref: "f9", doc: "I" });
+    expect(patchFont({ kind: "original", ref: "f1" }, { bold: true }, fonts)).toEqual({ kind: "original", ref: "f2" });
+    expect(fontKey({ kind: "original", ref: "f1", doc: "I" })).toBe("orig-I-f1");
+  });
+});
```

Modify `apps/web/src/lib/targets.test.ts`:

```diff
--- a/apps/web/src/lib/targets.test.ts
+++ b/apps/web/src/lib/targets.test.ts
@@ -26,7 +26,7 @@ const doc: EditorDoc = {
   },
   order: ["e", "t", "u"],
 };
-const pages = { 0: [para("g0", 100, "asli lama"), para("g1", 300, "tergantikan lama")] };
+const pages = { "D:0": [para("g0", 100, "asli lama"), para("g1", 300, "tergantikan lama")] };
 
 describe("search targets", () => {
   it("lists unedited paragraphs and text ops by page and position", () => {
```

Modify `apps/web/src/lib/fonts.test.ts`:

```diff
--- a/apps/web/src/lib/fonts.test.ts
+++ b/apps/web/src/lib/fonts.test.ts
@@ -99,7 +99,7 @@ describe("FontRef support", () => {
     const store = new FontStore("/fonts");
     const orig = { kind: "original" as const, ref: "f9" };
     await expect(store.load(orig)).rejects.toThrow("no source for original font f9");
-    store.setOriginalSource((ref) => `/api/fonts/${ref}`);
+    store.setOriginalSource((f) => `/api/fonts/${f.ref}`);
     const m = await store.load(orig);
     expect(fetchMock).toHaveBeenCalledWith("/api/fonts/f9");
     expect(store.peek(orig)).toBe(m);
@@ -112,7 +112,7 @@ describe("FontRef support", () => {
   it("rejects bytes fontkit cannot parse", async () => {
     vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })));
     const store = new FontStore("/fonts");
-    store.setOriginalSource((ref) => `/api/fonts/${ref}`);
+    store.setOriginalSource((f) => `/api/fonts/${f.ref}`);
     await expect(store.load({ kind: "original", ref: "f1" })).rejects.toThrow();
   });
 });
```

Modify `apps/web/src/components/editor/find/replace.test.ts`:

```diff
--- a/apps/web/src/components/editor/find/replace.test.ts
+++ b/apps/web/src/components/editor/find/replace.test.ts
@@ -25,7 +25,7 @@ const box = (text: string) => ({ rect: { x: 72, y: 300, w: 200, h: 14 }, align:
 
 beforeEach(() => {
   editorStore.getState().init(info);
-  textStore.setState({ status: "ready", docId: info.docId, pages: { 0: [para] }, fonts: {} });
+  textStore.setState({ status: "ready", docId: info.docId, pages: { [`${info.docId}:0`]: [para] }, fonts: {} });
   vi.spyOn(fontStore, "load").mockResolvedValue(arimo);
   vi.spyOn(fontStore, "peek").mockReturnValue(arimo);
   vi.spyOn(fontStore, "get").mockReturnValue(arimo);
```

Modify `apps/web/src/components/editor/text/textEdit.test.ts`:

```diff
--- a/apps/web/src/components/editor/text/textEdit.test.ts
+++ b/apps/web/src/components/editor/text/textEdit.test.ts
@@ -260,7 +260,7 @@ describe("markup over an edited paragraph", () => {
   const note = { id: "n", type: "annot.add", pageKey: "o0", kind: "note", point: [90, 95], color: "#facc15", content: "x" } as ContentOp;
 
   beforeEach(() => {
-    textStore.setState({ docId: info.docId, pages: { 0: [g3] } });
+    textStore.setState({ docId: info.docId, pages: { [`${info.docId}:0`]: [g3] } });
     fontsLoaded = true;
     const st = editorStore.getState();
     // On line 1, on line 2, on the next paragraph below (baseline 128), on another page; and a note.
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: `@/lib/sources` not found; `loadImport`/`reset` missing

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Editor.tsx`:

```diff
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -17,6 +17,7 @@ import { createDebounced } from "@/lib/autosave";
 import { boxFonts } from "@/lib/textbox";
 import { editorStore, pageGeom, useEditor, type EditorDoc } from "@/store/editor";
 import { pdfStore } from "@/store/pdfs";
+import { charsStore } from "@/store/chars";
 import { textStore } from "@/store/text";
 import { FormLayer } from "./forms/FormLayer";
 import { Header } from "./Header";
@@ -72,6 +73,8 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
       if (resolved?.missing) setNotice({ kind: "error", text: t.pages.importGone });
       else if (draft) setNotice({ kind: "info", text: t.editor.restored });
       void textStore.getState().load(docId); // original paragraphs + fonts, in the background
+      for (const id of Object.keys(resolved?.imports ?? {})) void textStore.getState().loadImport(id);
+      charsStore.getState().reset();
       // Preload fonts of restored text boxes (in parallel with the PDF; TextNode also loads on demand).
       const texts = Object.values(editorStore.getState().doc.objects).filter(isTextOp);
       void Promise.all(texts.flatMap((o) => boxFonts(o.box)).map((f) => fontStore.load(f))).catch((e) => console.warn("font preload failed", e));
```

Modify `apps/web/src/components/editor/PageOverlay.tsx`:

```diff
--- a/apps/web/src/components/editor/PageOverlay.tsx
+++ b/apps/web/src/components/editor/PageOverlay.tsx
@@ -78,9 +78,9 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
   const selection = useEditor((s) => s.selection);
   const tool = useEditor((s) => s.tool);
   const docId = useEditor((s) => s.info?.docId ?? "");
-  const srcIndex = useEditor((s) => {
+  const src = useEditor((s) => {
     const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
-    return entry && "doc" in entry.src && entry.src.doc === s.info?.docId ? entry.src.index : null; // main document only
+    return entry && "doc" in entry.src ? entry.src : null;
   });
   // renderText reads the editing id at render time (the edited op is hidden), so re-render when it changes.
   useStore(textEditStore, (s) => s.editing?.id);
@@ -107,8 +107,8 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
 
   // Text markup needs the page's character boxes.
   useEffect(() => {
-    if (MARKUP_TOOLS.has(tool) && docId && srcIndex !== null) void charsStore.getState().load(docId, srcIndex);
-  }, [tool, docId, srcIndex]);
+    if (MARKUP_TOOLS.has(tool) && src) void charsStore.getState().load(src.doc, src.index);
+  }, [tool, src]);
 
   /** Page-relative pointer position (clamped to the page); `evt` updates it from an event outside Konva. */
   const pos = (evt?: PointerEvent): Pt => {
```

Modify `apps/web/src/components/editor/PropertiesBar.tsx`:

```diff
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -7,7 +7,8 @@ import type { Dash } from "@/lib/geometry";
 import { hasOpacity, inkWidth, isMarkup, isTextOp, MARKUP_TOOLS, opacityOf, POLY_TOOLS } from "@/lib/objects";
 import { t } from "@/lib/strings";
 import { useChars } from "@/store/chars";
-import { editorStore, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
+import { editorStore, sourcePage, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
+import { srcKey } from "@/lib/sources";
 import type { LinkTarget } from "@/lib/links";
 import { STAMP_COLORS } from "@/lib/stamps";
 import { ColorField } from "./ColorField";
@@ -55,12 +56,12 @@ export function PropertiesBar() {
   // The text tool on a page without text (a scan): say why there is nothing to edit.
   const scanned = useEditor((st) => {
     const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
-    return tool === "text" && !!entry && "doc" in entry.src && entry.src.doc === st.info?.docId && st.info?.pages[entry.src.index]?.hasText === false;
+    return tool === "text" && !!entry && !!st.info && sourcePage(entry, st.info)?.hasText === false;
   });
   // The markup tools on a page without original text (or only rotated text): nothing to mark.
   const currentSrc = useEditor((st) => {
     const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
-    return entry && "doc" in entry.src && entry.src.doc === st.info?.docId ? entry.src.index : -1;
+    return entry && "doc" in entry.src ? srcKey(entry.src.doc, entry.src.index) : "";
   });
   const currentLines = useChars((cs) => cs.pages[currentSrc]);
   const noText = MARKUP_TOOLS.has(tool) && Array.isArray(currentLines) && currentLines.length === 0;
```

Modify `apps/web/src/components/editor/marks/markupTool.ts`:

```diff
--- a/apps/web/src/components/editor/marks/markupTool.ts
+++ b/apps/web/src/components/editor/marks/markupTool.ts
@@ -2,6 +2,7 @@ import type { AnnotAdd, TextEdit } from "@edith/ops";
 import { caretAt, markupQuads, usableLines, type CharLine } from "@/lib/markup";
 import { maskRects } from "@/lib/paragraphs";
 import { editorStore, type MarkupTool } from "@/store/editor";
+import { srcKey } from "@/lib/sources";
 import { charLines } from "@/store/chars";
 import { paragraphsOf } from "@/store/text";
 
@@ -11,11 +12,11 @@ type Pt = [number, number];
 export function markLines(pageKey: string): CharLine[] {
   const s = editorStore.getState();
   const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
-  if (!entry || !("doc" in entry.src) || entry.src.doc !== s.info?.docId) return []; // imported pages: no character data
+  if (!entry || !("doc" in entry.src)) return [];
   const edited = new Set(Object.values(s.doc.objects)
     .filter((op): op is TextEdit => op.type === "text.edit" && op.pageKey === pageKey).map((op) => op.paragraphId));
   const hidden = paragraphsOf(entry.src).filter((p) => edited.has(p.id)).flatMap(maskRects);
-  return usableLines(charLines(entry.src.index), hidden);
+  return usableLines(charLines(srcKey(entry.src.doc, entry.src.index)), hidden);
 }
 
 /** True when a press at `at` lands on markable text. */
```

Modify `apps/web/src/components/editor/pages/ManagePagesModal.tsx`:

```diff
--- a/apps/web/src/components/editor/pages/ManagePagesModal.tsx
+++ b/apps/web/src/components/editor/pages/ManagePagesModal.tsx
@@ -8,6 +8,7 @@ import { ApiError, getStructure, uploadDocument } from "@/lib/api";
 import * as P from "@/lib/pages";
 import { errorMessage, t } from "@/lib/strings";
 import { editorStore, pageGeom, useEditor, type EditorDoc, type PageEntry } from "@/store/editor";
+import { textStore } from "@/store/text";
 import { Thumbnail } from "../Thumbnail";
 import { pickPdf } from "./importPdf";
 
@@ -72,6 +73,7 @@ export function ManagePagesModal({ onClose }: { onClose: () => void }) {
       const up = await uploadDocument(file, file.name);
       const st = await getStructure(up.doc_id);
       editorStore.getState().addImport(up.doc_id, st.pages); // the registry, not the document: Batal leaves no pages
+      void textStore.getState().loadImport(up.doc_id);
       setDraft((d) => P.importPages(d, P.insertIndex(d, selected), up.doc_id, st.pages.length));
     } catch (e) {
       setError(errorMessage(e instanceof ApiError ? e.code : "generic"));
```

Modify `apps/web/src/components/editor/pages/importPdf.ts`:

```diff
--- a/apps/web/src/components/editor/pages/importPdf.ts
+++ b/apps/web/src/components/editor/pages/importPdf.ts
@@ -2,6 +2,7 @@ import { ApiError, getStructure, uploadDocument } from "@/lib/api";
 import { noticeStore } from "@/lib/notices";
 import { errorMessage, t } from "@/lib/strings";
 import { editorStore } from "@/store/editor";
+import { textStore } from "@/store/text";
 
 /** Uploads `file` as another document and inserts all its pages after `afterKey` (null: before the first page)
  *  as one undo step. Returns the new pages' keys (none on failure; a notice says why). */
@@ -11,6 +12,7 @@ export async function importPdf(file: File, afterKey: string | null): Promise<st
     const st = await getStructure(up.doc_id);
     const s = editorStore.getState();
     s.addImport(up.doc_id, st.pages);
+    void textStore.getState().loadImport(up.doc_id); // its paragraphs and fonts, for editing and Find
     const keys = s.insertImportAfter(afterKey, up.doc_id);
     noticeStore.getState().show({ kind: "info", text: t.pages.imported(keys.length) });
     return keys;
```

Modify `apps/web/src/lib/api.ts`:

```diff
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -17,7 +17,9 @@ export interface Paragraph {
   id: string; rect: Rect; lines: ParagraphLine[]; runs: Run[];
   align: "left" | "center" | "right" | "justify"; lineHeight: number; editable: boolean;
 }
+/** `doc`: set by the client on fonts of an imported PDF (see `fontId`). */
 export interface DocFont {
+  doc?: string;
   ref: string; name: string; embedded: boolean; format: string | null; reusable: boolean;
   family: string; bold: boolean; italic: boolean; substitute: BundledFont;
 }
```

Modify `apps/web/src/lib/fonts.ts`:

```diff
--- a/apps/web/src/lib/fonts.ts
+++ b/apps/web/src/lib/fonts.ts
@@ -63,6 +63,12 @@ export function isOriginal(f: FontRef): f is OriginalFont {
   return f.kind === "original";
 }
 
+/** Key of an embedded font in the font table: its ref, prefixed by the imported PDF it comes from (refs are
+ *  xref numbers, unique only per document). */
+export function fontId(f: OriginalFont): string {
+  return f.doc ? `${f.doc}/${f.ref}` : f.ref;
+}
+
 function style(f: BundledFont): Style {
   if (f.bold && f.italic) return "bolditalic";
   if (f.bold) return "bold";
@@ -84,7 +90,7 @@ export function pickFile(files: Partial<Record<Style, string>>, wanted: Style):
 }
 
 export function fontKey(f: FontRef): string {
-  if (isOriginal(f)) return `orig-${f.ref}`;
+  if (isOriginal(f)) return f.doc ? `orig-${f.doc}-${f.ref}` : `orig-${f.ref}`;
   const s = style(f);
   return `${f.family}-${s === "bolditalic" ? "bold-italic" : s}`;
 }
@@ -99,12 +105,12 @@ export class FontStore {
   private manifest?: Promise<Manifest>;
   private loaded = new Map<string, FontMetrics>();
   private pending = new Map<string, Promise<FontMetrics>>();
-  private originalUrl: ((ref: string) => string) | null = null;
+  private originalUrl: ((f: OriginalFont) => string) | null = null;
 
   constructor(private baseUrl = "/fonts") {}
 
-  /** Where original (embedded) fonts of the open document come from; forgets the previous document's. */
-  setOriginalSource(url: ((ref: string) => string) | null): void {
+  /** Where original (embedded) fonts of the open document and its imports come from; forgets the previous document's. */
+  setOriginalSource(url: ((f: OriginalFont) => string) | null): void {
     this.originalUrl = url;
     for (const key of [...this.loaded.keys(), ...this.pending.keys()]) {
       if (key.startsWith("orig-")) { this.loaded.delete(key); this.pending.delete(key); }
@@ -131,7 +137,7 @@ export class FontStore {
   private async url(f: FontRef): Promise<string> {
     if (isOriginal(f)) {
       if (!this.originalUrl) throw new Error(`no source for original font ${f.ref}`);
-      return this.originalUrl(f.ref);
+      return this.originalUrl(f);
     }
     const fam = (await this.getManifest()).families[f.family];
     if (!fam) throw new Error(`unknown font family ${f.family}`);
```

Modify `apps/web/src/lib/paragraphs.ts`:

```diff
--- a/apps/web/src/lib/paragraphs.ts
+++ b/apps/web/src/lib/paragraphs.ts
@@ -1,6 +1,6 @@
 import type { BundledFont, FontRef, Rect, Run, TextBox } from "@edith/ops";
 import type { DocFont, Paragraph } from "@/lib/api";
-import { covers, fontStore, isOriginal, textWidth, type FontMetrics } from "@/lib/fonts";
+import { covers, fontId, fontStore, isOriginal, textWidth, type FontMetrics } from "@/lib/fonts";
 import { normalizeRuns, runsText, sliceRuns } from "@/lib/runs";
 import { boxFonts, relayout } from "@/lib/textbox";
 
@@ -91,7 +91,7 @@ export function paragraphBox(
 }
 
 export function substituteOf(f: FontRef, fonts: FontTable): BundledFont {
-  return isOriginal(f) ? fonts[f.ref]?.substitute ?? ARIMO : f;
+  return isOriginal(f) ? fonts[fontId(f)]?.substitute ?? ARIMO : f;
 }
 
 /** One step of font fallback: a run whose original font is not loaded or lacks a glyph of its text
```

Modify `apps/web/src/lib/richtext.ts`:

```diff
--- a/apps/web/src/lib/richtext.ts
+++ b/apps/web/src/lib/richtext.ts
@@ -1,8 +1,9 @@
 import type { FontRef, Run } from "@edith/ops";
 import type { DocFont } from "@/lib/api";
-import { cssFamily, isOriginal } from "@/lib/fonts";
+import { cssFamily, fontId, isOriginal } from "@/lib/fonts";
 import { normalizeRuns } from "@/lib/runs";
 
+/** Embedded fonts by `fontId`. */
 export type FontTable = Record<string, DocFont>;
 
 /** Character style of a run — the attributes of the rich editor's `run` mark. */
@@ -27,11 +28,11 @@ export function runOf(text: string, a: RunAttrs): Run {
   };
 }
 
-/** Family/bold/italic a font shows as in the properties bar; `original` is the ref of an embedded font. */
+/** Family/bold/italic a font shows as in the properties bar; `original` is the `fontId` of an embedded font. */
 export function fontStyle(f: FontRef, fonts: FontTable): { family: string; bold: boolean; italic: boolean; original: string | null } {
   if (isOriginal(f)) {
-    const info = fonts[f.ref];
-    return { family: info?.substitute.family ?? "Arimo", bold: info?.bold ?? false, italic: info?.italic ?? false, original: f.ref };
+    const info = fonts[fontId(f)];
+    return { family: info?.substitute.family ?? "Arimo", bold: info?.bold ?? false, italic: info?.italic ?? false, original: fontId(f) };
   }
   return { family: f.family, bold: f.bold ?? false, italic: f.italic ?? false, original: null };
 }
@@ -44,9 +45,10 @@ export function patchFont(f: FontRef, patch: StylePatch, fonts: FontTable): Font
   const bold = patch.bold ?? cur.bold;
   const italic = patch.italic ?? cur.italic;
   if (isOriginal(f) && patch.family === undefined) {
-    const info = fonts[f.ref];
-    const variant = info && Object.values(fonts).find((x) => x.reusable && x.family === info.family && x.bold === bold && x.italic === italic);
-    if (variant) return { kind: "original", ref: variant.ref };
+    const info = fonts[fontId(f)];
+    // A variant from the same PDF only.
+    const variant = info && Object.values(fonts).find((x) => x.reusable && x.doc === info.doc && x.family === info.family && x.bold === bold && x.italic === italic);
+    if (variant) return variant.doc ? { kind: "original", ref: variant.ref, doc: variant.doc } : { kind: "original", ref: variant.ref };
   }
   return { kind: "bundled", family: patch.family ?? cur.family, bold, italic };
 }
```

Create `apps/web/src/lib/sources.ts`:

```ts
import type { Paragraph } from "@/lib/api";

/** Original paragraphs by source page — `srcKey(doc, index)` — of the edited PDF and every imported one. */
export type ParagraphPages = Record<string, Paragraph[]>;

export function srcKey(doc: string, index: number): string {
  return `${doc}:${index}`;
}
```

Modify `apps/web/src/lib/targets.ts`:

```diff
--- a/apps/web/src/lib/targets.ts
+++ b/apps/web/src/lib/targets.ts
@@ -4,6 +4,7 @@ import { charOffsets, textWidth, type FontMetrics } from "@/lib/fonts";
 import { isTextOp } from "@/lib/objects";
 import { measureRange, substituteOf, type FontTable } from "@/lib/paragraphs";
 import { matchSegments, type Match, type SearchTarget } from "@/lib/search";
+import { srcKey, type ParagraphPages } from "@/lib/sources";
 import type { EditorDoc } from "@/store/editor";
 
 type Peek = (f: Run["font"]) => FontMetrics | null;
@@ -14,14 +15,14 @@ export const opKey = (id: string) => `op:${id}`;
 export const paraKey = (pageKey: string, id: string) => `para:${pageKey}:${id}`;
 
 /** Everything Find searches, in page order then reading order (top to bottom, left to right). */
-export function buildTargets(doc: EditorDoc, pages: Record<number, Paragraph[]>): SearchTarget[] {
+export function buildTargets(doc: EditorDoc, pages: ParagraphPages): SearchTarget[] {
   const out: SearchTarget[] = [];
   for (const entry of doc.pages) {
     const ops = doc.order.map((id) => doc.objects[id]).filter((op): op is TextAdd | TextEdit => isTextOp(op) && op.pageKey === entry.pageKey);
     const edited = new Set(ops.filter((op): op is TextEdit => op.type === "text.edit").map((op) => op.paragraphId));
     const items: { x: number; y: number; target: SearchTarget }[] = [];
     if ("doc" in entry.src) {
-      for (const p of pages[entry.src.index] ?? []) {
+      for (const p of pages[srcKey(entry.src.doc, entry.src.index)] ?? []) {
         if (p.editable && !edited.has(p.id)) items.push({ x: p.rect.x, y: p.rect.y, target: { key: paraKey(entry.pageKey, p.id), pageKey: entry.pageKey, paragraphs: [p.runs] } });
       }
     }
@@ -33,14 +34,14 @@ export function buildTargets(doc: EditorDoc, pages: Record<number, Paragraph[]>)
 }
 
 /** Page rectangles to highlight for `m`; empty when the fonts to measure it are not loaded. */
-export function highlightRects(m: Match, doc: EditorDoc, pages: Record<number, Paragraph[]>, fonts: FontTable, peek: Peek): Rect[] {
+export function highlightRects(m: Match, doc: EditorDoc, pages: ParagraphPages, fonts: FontTable, peek: Peek): Rect[] {
   if (m.key.startsWith("op:")) {
     const op = doc.objects[m.key.slice(3)] as ContentOp | undefined;
     return isTextOp(op) ? boxRects(op.box, m, peek) : [];
   }
   const [, pageKey, id] = m.key.split(":");
   const entry = doc.pages.find((p) => p.pageKey === pageKey);
-  const p = entry && "doc" in entry.src ? pages[entry.src.index]?.find((x) => x.id === id) : undefined;
+  const p = entry && "doc" in entry.src ? pages[srcKey(entry.src.doc, entry.src.index)]?.find((x) => x.id === id) : undefined;
   return p ? paragraphRects(p, m, (f) => peek(f) ?? peek(substituteOf(f, fonts))) : [];
 }
```

Modify `apps/web/src/store/chars.ts`:

```diff
--- a/apps/web/src/store/chars.ts
+++ b/apps/web/src/store/chars.ts
@@ -2,22 +2,25 @@ import { createStore } from "zustand/vanilla";
 import { useStore } from "zustand";
 import { getChars } from "@/lib/api";
 import type { CharLine } from "@/lib/markup";
+import { srcKey } from "@/lib/sources";
 
-/** Character boxes of original pages (text markup), fetched per source page on first use. */
+/** Character boxes of original pages (text markup), fetched per source page — of the edited PDF or an
+ *  imported one, keyed by `srcKey(doc, index)` — on first use. */
 export interface CharsState {
-  docId: string | null;
-  /** Source page index → its lines; "loading" while fetched; "error" when it failed. */
-  pages: Record<number, CharLine[] | "loading" | "error">;
+  /** Source page → its lines; "loading" while fetched; "error" when it failed. */
+  pages: Record<string, CharLine[] | "loading" | "error">;
   load(docId: string, index: number): Promise<void>;
+  /** Forgets every page (another document was opened). */
+  reset(): void;
 }
 
 export const charsStore = createStore<CharsState>()((set, get) => ({
-  docId: null, pages: {},
+  pages: {},
   async load(docId, index) {
-    if (get().docId !== docId) set({ docId, pages: {} });
-    const cur = get().pages[index];
+    const key = srcKey(docId, index);
+    const cur = get().pages[key];
     if (cur !== undefined && cur !== "error") return;
-    set({ pages: { ...get().pages, [index]: "loading" } });
+    set({ pages: { ...get().pages, [key]: "loading" } });
     let result: CharLine[] | "error";
     try {
       result = await getChars(docId, index);
@@ -25,8 +28,9 @@ export const charsStore = createStore<CharsState>()((set, get) => ({
       console.warn("chars: load failed", e);
       result = "error";
     }
-    if (get().docId === docId) set({ pages: { ...get().pages, [index]: result } });
+    if (get().pages[key] === "loading") set({ pages: { ...get().pages, [key]: result } });
   },
+  reset: () => set({ pages: {} }),
 }));
 
 export function useChars<T>(selector: (s: CharsState) => T): T {
@@ -35,8 +39,8 @@ export function useChars<T>(selector: (s: CharsState) => T): T {
 
 const NONE: CharLine[] = [];
 
-/** Loaded lines of a source page (none while loading, after an error, or for blank pages). */
-export function charLines(index: number | null, pages: CharsState["pages"] = charsStore.getState().pages): CharLine[] {
-  const v = index === null ? undefined : pages[index];
+/** Loaded lines of a source page `srcKey(doc, index)` (none while loading, after an error, or for blank pages). */
+export function charLines(key: string | null, pages: CharsState["pages"] = charsStore.getState().pages): CharLine[] {
+  const v = key === null ? undefined : pages[key];
   return Array.isArray(v) ? v : NONE;
 }
```

Modify `apps/web/src/store/text.ts`:

```diff
--- a/apps/web/src/store/text.ts
+++ b/apps/web/src/store/text.ts
@@ -1,36 +1,69 @@
 import { createStore } from "zustand/vanilla";
 import { useStore } from "zustand";
-import { fontFileUrl, getText, type DocFont, type Paragraph } from "@/lib/api";
-import { fontStore } from "@/lib/fonts";
+import type { FontRef, Run } from "@edith/ops";
+import { fontFileUrl, getText, type DocFont, type Paragraph, type TextData } from "@/lib/api";
+import { fontId, fontStore, isOriginal } from "@/lib/fonts";
+import type { FontTable } from "@/lib/richtext";
+import { srcKey, type ParagraphPages } from "@/lib/sources";
 import type { PageSrc } from "@/store/editor";
 
-/** Original text of the open document (GET /documents/{id}/text), loaded once after the editor opens. */
+/** Original text of the open document and of every PDF imported into it (GET /documents/{id}/text), each
+ *  loaded once. Paragraphs are keyed by `srcKey(doc, index)`, fonts by `fontId` — runs of an imported PDF
+ *  name it in their original FontRefs (`doc`). `status` is the edited document's. */
 export interface TextState {
   status: "idle" | "loading" | "ready" | "error";
   docId: string | null;
-  pages: Record<number, Paragraph[]>;
-  fonts: Record<string, DocFont>;
+  pages: ParagraphPages;
+  fonts: FontTable;
+  /** Load status of imported PDFs' text. */
+  imports: Record<string, "loading" | "ready" | "error">;
   load(docId: string): Promise<void>;
+  loadImport(docId: string): Promise<void>;
+}
+
+/** `data` with every original font naming document `doc` (the imported PDF it was extracted from). */
+function tagged(data: TextData, doc: string | null): { pages: ParagraphPages; fonts: FontTable } {
+  const tag = (f: FontRef): FontRef => (doc && isOriginal(f) ? { ...f, doc } : f);
+  const run = (r: Run): Run => ({ ...r, font: tag(r.font) });
+  const pages: ParagraphPages = {};
+  for (const p of data.pages) pages[srcKey(doc ?? data.doc_id, p.index)] = p.paragraphs.map((g) => ({ ...g, runs: g.runs.map(run) }));
+  const fonts: FontTable = {};
+  for (const f of data.fonts) {
+    const font: DocFont = doc ? { ...f, doc } : f;
+    fonts[fontId({ kind: "original", ref: f.ref, doc })] = font;
+  }
+  return { pages, fonts };
 }
 
 export const textStore = createStore<TextState>()((set, get) => ({
-  status: "idle", docId: null, pages: {}, fonts: {},
+  status: "idle", docId: null, pages: {}, fonts: {}, imports: {},
   async load(docId) {
-    set({ status: "loading", docId, pages: {}, fonts: {} });
-    fontStore.setOriginalSource((ref) => fontFileUrl(docId, ref));
+    set({ status: "loading", docId, pages: {}, fonts: {}, imports: {} });
+    fontStore.setOriginalSource((f) => fontFileUrl(f.doc ?? docId, f.ref));
     try {
       const data = await getText(docId);
       if (get().docId !== docId) return;
-      set({
-        status: "ready",
-        pages: Object.fromEntries(data.pages.map((p) => [p.index, p.paragraphs])),
-        fonts: Object.fromEntries(data.fonts.map((f) => [f.ref, f])),
-      });
+      const t = tagged({ ...data, doc_id: docId }, null);
+      set({ status: "ready", pages: { ...get().pages, ...t.pages }, fonts: { ...get().fonts, ...t.fonts } });
     } catch (e) {
       console.warn("text extraction failed; original text cannot be edited", e);
       if (get().docId === docId) set({ status: "error" });
     }
   },
+  async loadImport(docId) {
+    const cur = get().imports[docId];
+    if (cur === "loading" || cur === "ready") return;
+    const main = get().docId;
+    set({ imports: { ...get().imports, [docId]: "loading" } });
+    try {
+      const t = tagged(await getText(docId), docId);
+      if (get().docId !== main) return;
+      set({ pages: { ...get().pages, ...t.pages }, fonts: { ...get().fonts, ...t.fonts }, imports: { ...get().imports, [docId]: "ready" } });
+    } catch (e) {
+      console.warn("text extraction of an imported PDF failed", docId, e);
+      if (get().docId === main) set({ imports: { ...get().imports, [docId]: "error" } });
+    }
+  },
 }));
 
 export function useText<T>(selector: (s: TextState) => T): T {
@@ -39,7 +72,7 @@ export function useText<T>(selector: (s: TextState) => T): T {
 
 const NONE: Paragraph[] = [];
 
-/** Original paragraphs of a page source (none for blank pages, pages of imported PDFs or before loading). */
-export function paragraphsOf(src: PageSrc, pages: Record<number, Paragraph[]> = textStore.getState().pages): Paragraph[] {
-  return "doc" in src && src.doc === textStore.getState().docId ? pages[src.index] ?? NONE : NONE;
+/** Original paragraphs of a page source (none for blank pages or before loading). */
+export function paragraphsOf(src: PageSrc, pages: ParagraphPages = textStore.getState().pages): Paragraph[] {
+  return "doc" in src ? pages[srcKey(src.doc, src.index)] ?? NONE : NONE;
 }
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 276 passed; tsc/eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/PageOverlay.tsx apps/web/src/components/editor/PropertiesBar.tsx apps/web/src/components/editor/find/replace.test.ts apps/web/src/components/editor/marks/markupTool.ts apps/web/src/components/editor/pages/ManagePagesModal.tsx apps/web/src/components/editor/pages/importPdf.ts apps/web/src/components/editor/text/textEdit.test.ts apps/web/src/lib/api.ts apps/web/src/lib/fonts.test.ts apps/web/src/lib/fonts.ts apps/web/src/lib/paragraphs.ts apps/web/src/lib/richtext.test.ts apps/web/src/lib/richtext.ts apps/web/src/lib/sources.ts apps/web/src/lib/targets.test.ts apps/web/src/lib/targets.ts apps/web/src/store/chars.test.ts apps/web/src/store/chars.ts apps/web/src/store/text.test.ts apps/web/src/store/text.ts
git commit -m "feat(web): edit, mark and search the text of imported PDFs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
