# Task 7: Web page operations, imports registry, crop state, compaction

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 6 leaves, new files are complete.

**Goal:** Pure page operations (`lib/pages.ts`) used by the page menu and the Manage Pages modal; store actions for duplicate/import/crop/replace; imported pages get geometry from `info.imports`; drafts remember imports; original text and character data stay main-document-only; `compact()` sends crops and drops `form.set` of fields whose pages are gone (M3 backlog).

**Files:**
- Modify: `apps/web/src/components/editor/Header.tsx`
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`
- Modify: `apps/web/src/components/editor/PropertiesBar.tsx`
- Modify: `apps/web/src/components/editor/find/replace.test.ts`
- Modify: `apps/web/src/components/editor/forms/FormLayer.tsx`
- Modify: `apps/web/src/components/editor/marks/markupTool.ts`
- Modify: `apps/web/src/components/editor/text/textEdit.test.ts`
- Modify: `apps/web/src/lib/compact.test.ts`
- Modify: `apps/web/src/lib/compact.ts`
- Create: `apps/web/src/lib/pages.test.ts`
- Create: `apps/web/src/lib/pages.ts`
- Modify: `apps/web/src/lib/restore.test.ts`
- Modify: `apps/web/src/lib/restore.ts`
- Modify: `apps/web/src/store/editor.test.ts`
- Modify: `apps/web/src/store/editor.ts`
- Modify: `apps/web/src/store/text.test.ts`
- Modify: `apps/web/src/store/text.ts`

**Interfaces:**
- Consumes: Task 6 `CropBox`, `PageGeom.crop`.
- Produces:
- `lib/pages.ts`: `rotatePages, deletePages, duplicatePages(doc, keys, makeKey?, makeId?)` (copies the page's objects, text.edit included), `shiftPages(doc, keys, -1|1)`, `movePage`, `blankSizeLike(neighbor, info)` (neighbour's on-screen orientation and crop — M1 backlog fix), `insertPages`, `blankPage`, `importPages(doc, index, docId, count)`, `pageSize`, `clampCrop`, `setCrop(doc, keys, crop|null, info)`, `MIN_CROP = 10`.
- `DocInfo.imports?: Record<docId, StructurePage[]>`; `PageEntry.crop?: CropBox | null`; `EditorDoc.imports?: string[]`; `sourcePage(entry, info)`; `pageGeom` adds `crop`.
- Store: `duplicatePage(key) -> key|null`, `addImport(docId, pages)`, `insertImportAfter(key|null, docId) -> keys`, `setCrop(keys, crop|null)`, `replaceDoc(next)` (one undo step each).
- `compact(doc, info?)`; `restoreDraft` keeps imported doc ids; `resolveImports(doc, structure) -> {doc|null, imports, missing}`.
- `paragraphsOf()` returns [] for pages of other documents; markup chars, the scanned-page hint and `FormLayer` likewise check `src.doc === info.docId`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/pages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { blankSizeLike, clampCrop, deletePages, duplicatePages, importPages, movePage, rotatePages, setCrop, shiftPages } from "@/lib/pages";
import type { DocInfo, EditorDoc, PageEntry } from "@/store/editor";

const D = "D".repeat(22), I = "I".repeat(22);
const info: DocInfo = {
  docId: D, sha256: "s", fileName: "a.pdf",
  pages: [0, 1, 2].map((i) => ({ index: i, width: 595, height: 842, rotation: i === 2 ? 90 : 0, hasText: true })),
  imports: { [I]: [{ index: 0, width: 300, height: 400, rotation: 0, hasText: false }] },
};
const page = (i: number): PageEntry => ({ pageKey: `o${i}`, src: { doc: D, index: i }, rotate: 0 });
const white = (id: string, pageKey: string): ContentOp => ({ id, type: "whiteout.add", pageKey, rect: { x: 0, y: 0, w: 1, h: 1 } }) as ContentOp;
const doc = (): EditorDoc => ({ pages: [page(0), page(1), page(2)], objects: { a: white("a", "o0"), b: white("b", "o1") }, order: ["a", "b"] });
const keys = (d: EditorDoc) => d.pages.map((p) => p.pageKey);
const counter = (prefix: string) => { let n = 0; return () => `${prefix}${n++}`; };

describe("page operations", () => {
  it("rotates several pages; unknown keys change nothing", () => {
    const d = rotatePages(doc(), ["o0", "o2"], -90);
    expect(d.pages.map((p) => p.rotate)).toEqual([270, 0, 270]);
    const same = doc();
    expect(rotatePages(same, ["x"], 90)).toBe(same);
  });

  it("deletes pages but never the last one", () => {
    expect(keys(deletePages(doc(), ["o0", "o2"]))).toEqual(["o1"]);
    const d = doc();
    expect(deletePages(d, ["o0", "o1", "o2"])).toBe(d);
  });

  it("duplicates pages with their objects right after each original", () => {
    const d = duplicatePages(doc(), ["o0", "o1"], counter("u-k"), counter("id"));
    expect(keys(d)).toEqual(["o0", "u-k0", "o1", "u-k1", "o2"]);
    expect(d.pages[1].src).toEqual({ doc: D, index: 0 });
    expect(d.objects.id0).toEqual({ ...white("a", "o0"), id: "id0", pageKey: "u-k0" });
    expect(d.objects.id1).toMatchObject({ pageKey: "u-k1" });
    expect(d.order).toEqual(["a", "b", "id0", "id1"]);
  });

  it("shifts a selection as a block", () => {
    expect(keys(shiftPages(doc(), ["o1", "o2"], -1))).toEqual(["o1", "o2", "o0"]);
    expect(keys(shiftPages(doc(), ["o0", "o1"], 1))).toEqual(["o2", "o0", "o1"]);
    const d = doc();
    expect(shiftPages(d, ["o0"], -1)).toBe(d);
    expect(keys(movePage(doc(), "o2", 0))).toEqual(["o2", "o0", "o1"]);
  });

  it("sizes blank pages like their neighbor on screen", () => {
    expect(blankSizeLike(page(0), info)).toEqual({ width: 595, height: 842 });
    expect(blankSizeLike(page(2), info)).toEqual({ width: 842, height: 595 }); // source /Rotate 90
    expect(blankSizeLike({ ...page(0), rotate: 270 }, info)).toEqual({ width: 842, height: 595 });
    expect(blankSizeLike({ ...page(0), crop: { x: 0, y: 0, w: 100, h: 200 } }, info)).toEqual({ width: 100, height: 200 });
    expect(blankSizeLike({ pageKey: "u", src: { doc: I, index: 0 }, rotate: 0 }, info)).toEqual({ width: 300, height: 400 });
    expect(blankSizeLike(undefined, info)).toEqual({ width: 595, height: 842 });
  });

  it("inserts imported pages and remembers the import", () => {
    const d = importPages(doc(), 1, I, 2, counter("u-i"));
    expect(keys(d)).toEqual(["o0", "u-i0", "u-i1", "o1", "o2"]);
    expect(d.pages[2].src).toEqual({ doc: I, index: 1 });
    expect(d.imports).toEqual([I]);
    expect(importPages(d, 0, I, 1, counter("u-j")).imports).toEqual([I]);
  });

  it("clamps crops to the page", () => {
    expect(clampCrop({ x: -5, y: 10, w: 100, h: 900 }, { width: 595, height: 842 })).toEqual({ x: 0, y: 10, w: 95, h: 832 });
    expect(clampCrop({ x: 590, y: 0, w: 100, h: 100 }, { width: 595, height: 842 })).toBeNull(); // 5 pt left
  });

  it("crops pages and removes crops", () => {
    const crop = { x: 10, y: 10, w: 400, h: 500 };
    const d = setCrop(doc(), ["o0", "o1"], crop, info);
    expect(d.pages.map((p) => p.crop ?? null)).toEqual([crop, crop, null]);
    const imported = setCrop({ ...doc(), pages: [{ pageKey: "u", src: { doc: I, index: 0 }, rotate: 0 }] }, ["u"], crop, info);
    expect(imported.pages[0].crop).toEqual({ x: 10, y: 10, w: 290, h: 390 });
    const cleared = setCrop(d, ["o0"], null, info);
    expect(cleared.pages[0]).not.toHaveProperty("crop");
    expect(cleared.pages[1].crop).toEqual(crop);
    const same = doc();
    expect(setCrop(same, ["o0"], null, info)).toBe(same);
  });
});
```

Modify `apps/web/src/lib/compact.test.ts`:

```diff
--- a/apps/web/src/lib/compact.test.ts
+++ b/apps/web/src/lib/compact.test.ts
@@ -61,3 +61,23 @@ describe("compact (M3)", () => {
     ]);
   });
 });
+
+describe("compact (M4)", () => {
+  const D = "D".repeat(22);
+  it("sends crops only when set and drops values of fields whose pages are gone", () => {
+    const doc: EditorDoc = {
+      pages: [{ pageKey: "o0", src: { doc: D, index: 0 }, rotate: 0, crop: { x: 1, y: 2, w: 30, h: 40 } }, { pageKey: "o2", src: { doc: D, index: 2 }, rotate: 0, crop: null }],
+      objects: {}, order: [], forms: { kept: "a", gone: "b", both: true },
+    };
+    const fields = [
+      { name: "kept", page: 0 }, { name: "gone", page: 1 }, { name: "both", page: 1 }, { name: "both", page: 2 },
+    ] as never[];
+    const ops = compact(doc, { docId: D, fields });
+    expect((ops[0] as { pages: unknown[] }).pages).toEqual([
+      { pageKey: "o0", src: { doc: D, index: 0 }, rotate: 0, crop: { x: 1, y: 2, w: 30, h: 40 } },
+      { pageKey: "o2", src: { doc: D, index: 2 }, rotate: 0 },
+    ]);
+    expect(ops.slice(1).map((o) => (o as { fieldName: string }).fieldName)).toEqual(["kept", "both"]);
+    expect(compact(doc).length).toBe(4); // without info every value is sent
+  });
+});
```

Modify `apps/web/src/lib/restore.test.ts`:

```diff
--- a/apps/web/src/lib/restore.test.ts
+++ b/apps/web/src/lib/restore.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from "vitest";
-import { restoreDraft } from "@/lib/restore";
+import { resolveImports, restoreDraft } from "@/lib/restore";
 
 describe("restoreDraft", () => {
   const draft = {
@@ -43,3 +43,35 @@ describe("restoreDraft forms", () => {
     expect(restoreDraft({ pages, objects: {}, order: [] }, "NEW", 1)!.forms).toEqual({});
   });
 });
+
+describe("restoreDraft with imported PDFs", () => {
+  const I = "I".repeat(22);
+  const draft = {
+    pages: [
+      { pageKey: "o0", src: { doc: "OLD", index: 0 }, rotate: 0 as const },
+      { pageKey: "u-i0", src: { doc: I, index: 0 }, rotate: 0 as const },
+      { pageKey: "u-i1", src: { doc: I, index: 1 }, rotate: 0 as const },
+    ],
+    objects: {}, order: [], imports: [I],
+  };
+
+  it("keeps the doc id of imported pages", () => {
+    const r = restoreDraft(draft, "NEW", 1)!;
+    expect(r.pages.map((p) => ("doc" in p.src ? p.src.doc : null))).toEqual(["NEW", I, I]);
+    expect(r.imports).toEqual([I]);
+  });
+
+  it("loads the imports' page sizes and drops pages of imports that are gone", async () => {
+    const r = restoreDraft(draft, "NEW", 1)!;
+    const sizes = [{ index: 0, width: 300, height: 400, rotation: 0, hasText: true }];
+    const ok = await resolveImports(r, async () => sizes);
+    expect(ok.imports).toEqual({ [I]: sizes });
+    expect(ok.doc!.pages.map((p) => p.pageKey)).toEqual(["o0", "u-i0"]); // index 1 no longer exists
+    expect(ok.missing).toBe(true);
+    const gone = await resolveImports(r, async () => { throw new Error("410"); });
+    expect(gone.doc!.pages.map((p) => p.pageKey)).toEqual(["o0"]);
+    expect(gone.imports).toEqual({});
+    const onlyImported = await resolveImports({ ...r, pages: r.pages.slice(1) }, async () => { throw new Error("410"); });
+    expect(onlyImported.doc).toBeNull();
+  });
+});
```

Modify `apps/web/src/store/editor.test.ts`:

```diff
--- a/apps/web/src/store/editor.test.ts
+++ b/apps/web/src/store/editor.test.ts
@@ -56,7 +56,8 @@ describe("editor store", () => {
     s().movePage("o2", 0);
     expect(s().doc.pages.map((p) => p.pageKey)).toEqual(["o2", "o0", "o1"]);
     const k = s().insertBlankAfter("o2");
-    expect(s().doc.pages[1]).toEqual({ pageKey: k, src: { blank: { width: 595, height: 842 } }, rotate: 0 });
+    // o2's source is rotated 90°: the blank page takes the shape it shows on screen (landscape).
+    expect(s().doc.pages[1]).toEqual({ pageKey: k, src: { blank: { width: 842, height: 595 } }, rotate: 0 });
     const first = s().insertBlankAfter(null);
     expect(s().doc.pages[0].pageKey).toBe(first);
     s().deletePage("o0");
@@ -201,3 +202,40 @@ describe("history coalescing and batches", () => {
     expect(st.getState().past.length).toBe(before + 1);
   });
 });
+
+describe("page actions (M4)", () => {
+  const I = "I".repeat(22);
+  it("duplicates a page with its objects as one undo step", () => {
+    s().addObject(white("a", "o1"));
+    const k = s().duplicatePage("o1")!;
+    expect(s().doc.pages.map((p) => p.pageKey)).toEqual(["o0", "o1", k, "o2"]);
+    expect(Object.values(s().doc.objects).filter((o) => o.pageKey === k)).toHaveLength(1);
+    s().undo();
+    expect(s().doc.pages).toHaveLength(3);
+    expect(Object.keys(s().doc.objects)).toEqual(["a"]);
+  });
+
+  it("imports pages of another PDF and gives them their own geometry", () => {
+    expect(s().insertImportAfter("o0", I)).toEqual([]); // unknown until registered
+    s().addImport(I, [{ index: 0, width: 300, height: 400, rotation: 90, hasText: false }]);
+    const [k] = s().insertImportAfter("o0", I);
+    expect(s().doc.pages[1]).toEqual({ pageKey: k, src: { doc: I, index: 0 }, rotate: 0 });
+    expect(pageGeom(s().doc.pages[1], s().info!)).toEqual({ width: 300, height: 400, rotation: 90 });
+    s().undo();
+    expect(s().info!.imports![I]).toHaveLength(1); // the registry is not undone
+  });
+
+  it("crops and replaces the document as single undo steps", () => {
+    s().setCrop(["o0"], { x: 10, y: 20, w: 100, h: 200 });
+    expect(pageGeom(s().doc.pages[0], info).crop).toEqual({ x: 10, y: 20, w: 100, h: 200 });
+    const next = { ...s().doc, pages: s().doc.pages.slice(1) };
+    s().select(null);
+    s().replaceDoc(next);
+    expect(s().doc.pages.map((p) => p.pageKey)).toEqual(["o1", "o2"]);
+    expect(s().currentPage).toBe("o1");
+    s().undo();
+    expect(s().doc.pages).toHaveLength(3);
+    s().undo();
+    expect(s().doc.pages[0].crop).toBeUndefined();
+  });
+});
```

Modify `apps/web/src/store/text.test.ts`:

```diff
--- a/apps/web/src/store/text.test.ts
+++ b/apps/web/src/store/text.test.ts
@@ -26,6 +26,7 @@ describe("textStore", () => {
     expect(textStore.getState()).toMatchObject({ status: "ready", docId: "D", fonts: { f5: font } });
     expect(paragraphsOf({ doc: "D", index: 0 })).toEqual([para]);
     expect(paragraphsOf({ blank: { width: 1, height: 1 } })).toEqual([]);
+    expect(paragraphsOf({ doc: "IMPORTED", index: 0 })).toEqual([]); // pages of imported PDFs: no original text
     const url = source.mock.calls[0][0]!;
     expect(url("f5")).toBe("http://localhost:8000/documents/D/fonts/f5");
   });
```

Modify `apps/web/src/components/editor/find/replace.test.ts`:

```diff
--- a/apps/web/src/components/editor/find/replace.test.ts
+++ b/apps/web/src/components/editor/find/replace.test.ts
@@ -25,7 +25,7 @@ const box = (text: string) => ({ rect: { x: 72, y: 300, w: 200, h: 14 }, align:
 
 beforeEach(() => {
   editorStore.getState().init(info);
-  textStore.setState({ status: "ready", pages: { 0: [para] }, fonts: {} });
+  textStore.setState({ status: "ready", docId: info.docId, pages: { 0: [para] }, fonts: {} });
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
-    textStore.setState({ pages: { 0: [g3] } });
+    textStore.setState({ docId: info.docId, pages: { 0: [g3] } });
     fontsLoaded = true;
     const st = editorStore.getState();
     // On line 1, on line 2, on the next paragraph below (baseline 128), on another page; and a note.
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: `@/lib/pages` not found; store actions missing

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Header.tsx`:

```diff
--- a/apps/web/src/components/editor/Header.tsx
+++ b/apps/web/src/components/editor/Header.tsx
@@ -27,7 +27,7 @@ export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; t
       await whenTextCommitted(); // a text box whose fonts were still loading must be in the document first
       s = editorStore.getState();
       if (!s.info) return;
-      sent = compact(s.doc);
+      sent = compact(s.doc, s.info);
       const blob = await exportPdf(s.info.docId, { ops: sent, flatten_forms: hasForm && flatten, filename: fileName });
       downloadBlob(blob, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
     } catch (e) {
```

Modify `apps/web/src/components/editor/PageOverlay.tsx`:

```diff
--- a/apps/web/src/components/editor/PageOverlay.tsx
+++ b/apps/web/src/components/editor/PageOverlay.tsx
@@ -47,7 +47,7 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
   const docId = useEditor((s) => s.info?.docId ?? "");
   const srcIndex = useEditor((s) => {
     const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
-    return entry && "doc" in entry.src ? entry.src.index : null;
+    return entry && "doc" in entry.src && entry.src.doc === s.info?.docId ? entry.src.index : null; // main document only
   });
   // renderText reads the editing id at render time (the edited op is hidden), so re-render when it changes.
   useStore(textEditStore, (s) => s.editing?.id);
```

Modify `apps/web/src/components/editor/PropertiesBar.tsx`:

```diff
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -52,12 +52,12 @@ export function PropertiesBar() {
   // The text tool on a page without text (a scan): say why there is nothing to edit.
   const scanned = useEditor((st) => {
     const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
-    return tool === "text" && !!entry && "doc" in entry.src && st.info?.pages[entry.src.index]?.hasText === false;
+    return tool === "text" && !!entry && "doc" in entry.src && entry.src.doc === st.info?.docId && st.info?.pages[entry.src.index]?.hasText === false;
   });
   // The markup tools on a page without original text (or only rotated text): nothing to mark.
   const currentSrc = useEditor((st) => {
     const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
-    return entry && "doc" in entry.src ? entry.src.index : -1;
+    return entry && "doc" in entry.src && entry.src.doc === st.info?.docId ? entry.src.index : -1;
   });
   const currentLines = useChars((cs) => cs.pages[currentSrc]);
   const noText = MARKUP_TOOLS.has(tool) && Array.isArray(currentLines) && currentLines.length === 0;
```

Modify `apps/web/src/components/editor/forms/FormLayer.tsx`:

```diff
--- a/apps/web/src/components/editor/forms/FormLayer.tsx
+++ b/apps/web/src/components/editor/forms/FormLayer.tsx
@@ -16,7 +16,8 @@ export function FormLayer({ pageKey, geom, scale }: { pageKey: string; geom: Pag
   const fields = useEditor((s) => s.info?.fields ?? NONE);
   const forms = useEditor((s) => s.doc.forms);
   const tool = useEditor((s) => s.tool);
-  if (!src || !("doc" in src)) return null;
+  const docId = useEditor((s) => s.info?.docId);
+  if (!src || !("doc" in src) || src.doc !== docId) return null; // fields of imported PDFs are not editable (yet)
   const mine = fields.filter((f) => f.page === src.index && isEditable(f));
   if (!mine.length) return null;
```

Modify `apps/web/src/components/editor/marks/markupTool.ts`:

```diff
--- a/apps/web/src/components/editor/marks/markupTool.ts
+++ b/apps/web/src/components/editor/marks/markupTool.ts
@@ -11,7 +11,7 @@ type Pt = [number, number];
 export function markLines(pageKey: string): CharLine[] {
   const s = editorStore.getState();
   const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
-  if (!entry || !("doc" in entry.src)) return [];
+  if (!entry || !("doc" in entry.src) || entry.src.doc !== s.info?.docId) return []; // imported pages: no character data
   const edited = new Set(Object.values(s.doc.objects)
     .filter((op): op is TextEdit => op.type === "text.edit" && op.pageKey === pageKey).map((op) => op.paragraphId));
   const hidden = paragraphsOf(entry.src).filter((p) => edited.has(p.id)).flatMap(maskRects);
```

Modify `apps/web/src/lib/compact.ts`:

```diff
--- a/apps/web/src/lib/compact.ts
+++ b/apps/web/src/lib/compact.ts
@@ -1,16 +1,27 @@
 import type { ContentOp, Op } from "@edith/ops";
-import type { EditorDoc } from "@/store/editor";
+import type { DocInfo, EditorDoc } from "@/store/editor";
 
 /** False for a link to a page that is no longer in the document (it goes with the page). */
 function targetKept(op: ContentOp, keys: ReadonlySet<string>): boolean {
   return op.type !== "link.add" || !("pageKey" in op.target) || keys.has(op.target.pageKey);
 }
 
-export function compact(doc: EditorDoc): Op[] {
+/** Names of the main document's fields that still have a widget on one of the pages. */
+function keptFields(doc: EditorDoc, info: Pick<DocInfo, "docId" | "fields">): Set<string> {
+  const shown = new Set(doc.pages.flatMap((p) => ("doc" in p.src && p.src.doc === info.docId ? [p.src.index] : [])));
+  return new Set((info.fields ?? []).filter((f) => shown.has(f.page)).map((f) => f.name));
+}
+
+/** The ops sent to the API. With `info`, values of form fields whose pages were all deleted are dropped. */
+export function compact(doc: EditorDoc, info?: Pick<DocInfo, "docId" | "fields">): Op[] {
   const keys = new Set(doc.pages.map((p) => p.pageKey));
-  const layout = { id: "layout", type: "pages.layout", pages: doc.pages } as Op;
+  const pages = doc.pages.map(({ crop, ...p }) => (crop ? { ...p, crop } : p)); // no `crop: null` on the wire
+  const layout = { id: "layout", type: "pages.layout", pages } as Op;
   const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey) && targetKept(op, keys));
-  const forms = Object.entries(doc.forms ?? {}).map(([fieldName, value], i) => ({ id: `form-${i}`, type: "form.set", fieldName, value }) as Op);
+  const fields = info ? keptFields(doc, info) : null;
+  const forms = Object.entries(doc.forms ?? {})
+    .filter(([name]) => !fields || fields.has(name))
+    .map(([fieldName, value], i) => ({ id: `form-${i}`, type: "form.set", fieldName, value }) as Op);
   return [layout, ...content, ...forms];
 }
```

Create `apps/web/src/lib/pages.ts`:

```ts
import type { ContentOp } from "@edith/ops";
import { normRotation, type CropBox } from "@/lib/coords";
import { newId } from "@/lib/id";
import type { DocInfo, EditorDoc, PageEntry } from "@/store/editor";

/** Page operations on the undoable document, shared by the page menu and the Manage Pages modal.
 *  Pure: each returns a new document (or the same one when nothing changes). */

export const MIN_CROP = 10; // pt: smaller crops are ignored

const keySet = (keys: readonly string[]) => new Set(keys);

export function rotatePages(doc: EditorDoc, keys: readonly string[], delta: 90 | -90): EditorDoc {
  const ks = keySet(keys);
  if (!doc.pages.some((p) => ks.has(p.pageKey))) return doc;
  return { ...doc, pages: doc.pages.map((p) => (ks.has(p.pageKey) ? { ...p, rotate: normRotation(p.rotate + delta) } : p)) };
}

/** Removes the pages (their objects stay in the document until compaction; undo brings both back). A document
 *  keeps at least one page. */
export function deletePages(doc: EditorDoc, keys: readonly string[]): EditorDoc {
  const ks = keySet(keys);
  const pages = doc.pages.filter((p) => !ks.has(p.pageKey));
  return pages.length === doc.pages.length || pages.length === 0 ? doc : { ...doc, pages };
}

/** Puts a copy of every page right after it, with a new pageKey and copies of all its objects (spec:
 *  duplicating a page copies its ops). Links on the copy keep their targets. */
export function duplicatePages(doc: EditorDoc, keys: readonly string[], makeKey = () => newId("u"), makeId = () => newId()): EditorDoc {
  const ks = keySet(keys);
  if (!doc.pages.some((p) => ks.has(p.pageKey))) return doc;
  const pages: PageEntry[] = [];
  const objects = { ...doc.objects };
  const order = [...doc.order];
  for (const p of doc.pages) {
    pages.push(p);
    if (!ks.has(p.pageKey)) continue;
    const pageKey = makeKey();
    pages.push({ ...p, pageKey });
    for (const id of doc.order) {
      const op = doc.objects[id];
      if (op?.pageKey !== p.pageKey) continue;
      const copy = { ...structuredClone(op), id: makeId(), pageKey } as ContentOp;
      objects[copy.id] = copy;
      order.push(copy.id);
    }
  }
  return { ...doc, pages, objects, order };
}

/** Moves each selected page one place left (-1) or right (+1); a selected page next to another selected one
 *  that cannot move stays (the selection moves as a block). */
export function shiftPages(doc: EditorDoc, keys: readonly string[], dir: -1 | 1): EditorDoc {
  const ks = keySet(keys);
  const pages = [...doc.pages];
  let changed = false;
  const idx = pages.map((_, i) => i);
  for (const i of dir < 0 ? idx : idx.reverse()) {
    const j = i + dir;
    if (j < 0 || j >= pages.length || !ks.has(pages[i].pageKey) || ks.has(pages[j].pageKey)) continue;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    changed = true;
  }
  return changed ? { ...doc, pages } : doc;
}

export function movePage(doc: EditorDoc, key: string, toIndex: number): EditorDoc {
  const from = doc.pages.findIndex((p) => p.pageKey === key);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(toIndex, doc.pages.length - 1));
  if (to === from) return doc;
  const pages = [...doc.pages];
  const [entry] = pages.splice(from, 1);
  pages.splice(to, 0, entry);
  return { ...doc, pages };
}

/** Size of a new blank page next to `neighbor`: as the neighbor looks (rotation and crop included), so the
 *  blank page shows in the same orientation; A4 without a neighbor. */
export function blankSizeLike(neighbor: PageEntry | undefined, info: DocInfo | null): { width: number; height: number } {
  if (!neighbor || !info) return { width: 595, height: 842 };
  const src = neighbor.src;
  let w: number, h: number, rot: number;
  if ("blank" in src) {
    ({ width: w, height: h } = src.blank);
    rot = neighbor.rotate;
  } else {
    const p = (src.doc === info.docId ? info.pages : info.imports?.[src.doc])?.[src.index];
    if (!p) return { width: 595, height: 842 };
    w = p.width; h = p.height; rot = p.rotation + neighbor.rotate;
  }
  if (neighbor.crop) { w = neighbor.crop.w; h = neighbor.crop.h; }
  return normRotation(rot) % 180 ? { width: h, height: w } : { width: w, height: h };
}

/** Inserts `entries` at position `index` (0 = before the first page). */
export function insertPages(doc: EditorDoc, index: number, entries: PageEntry[]): EditorDoc {
  const pages = [...doc.pages];
  pages.splice(Math.max(0, Math.min(index, pages.length)), 0, ...entries);
  return { ...doc, pages };
}

export function blankPage(size: { width: number; height: number }, pageKey = newId("u")): PageEntry {
  return { pageKey, src: { blank: { width: size.width, height: size.height } }, rotate: 0 };
}

/** The pages of an imported PDF, in order, with new keys; `doc.imports` records the document so a restored
 *  draft can tell its pages from the main document's. */
export function importPages(doc: EditorDoc, index: number, docId: string, count: number, makeKey = () => newId("u")): EditorDoc {
  const entries: PageEntry[] = Array.from({ length: count }, (_, i) => ({ pageKey: makeKey(), src: { doc: docId, index: i }, rotate: 0 }));
  const next = insertPages(doc, index, entries);
  const imports = doc.imports?.includes(docId) ? doc.imports : [...(doc.imports ?? []), docId];
  return { ...next, imports };
}

/** The unrotated size of a page (its source's CropBox, or the blank size). */
export function pageSize(entry: PageEntry, info: DocInfo): { width: number; height: number } | null {
  if ("blank" in entry.src) return entry.src.blank;
  const p = (entry.src.doc === info.docId ? info.pages : info.imports?.[entry.src.doc])?.[entry.src.index];
  return p ? { width: p.width, height: p.height } : null;
}

/** `crop` clamped to a page of `size`; null when what is left is smaller than MIN_CROP. */
export function clampCrop(crop: CropBox, size: { width: number; height: number }): CropBox | null {
  const x = Math.max(0, crop.x), y = Math.max(0, crop.y);
  const w = Math.min(crop.x + crop.w, size.width) - x, h = Math.min(crop.y + crop.h, size.height) - y;
  if (w < MIN_CROP || h < MIN_CROP) return null;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(x), y: r(y), w: Math.floor(w * 100) / 100, h: Math.floor(h * 100) / 100 };
}

/** Sets (or with null removes) the crop of the pages; a crop that does not fit a page is clamped to it, and
 *  pages it misses keep theirs. */
export function setCrop(doc: EditorDoc, keys: readonly string[], crop: CropBox | null, info: DocInfo): EditorDoc {
  const ks = keySet(keys);
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (!ks.has(p.pageKey)) return p;
    if (crop === null) {
      if (!p.crop) return p;
      changed = true;
      const { crop: _drop, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    }
    const size = pageSize(p, info);
    const c = size ? clampCrop(crop, size) : null;
    if (!c) return p;
    changed = true;
    return { ...p, crop: c };
  });
  return changed ? { ...doc, pages } : doc;
}
```

Modify `apps/web/src/lib/restore.ts`:

```diff
--- a/apps/web/src/lib/restore.ts
+++ b/apps/web/src/lib/restore.ts
@@ -1,4 +1,4 @@
-import type { EditorDoc } from "@/store/editor";
+import type { EditorDoc, StructurePage } from "@/store/editor";
 
 const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
 
@@ -16,17 +16,43 @@ function validForms(forms: unknown): Record<string, string | boolean> {
   return Object.fromEntries(Object.entries(forms).filter(([, v]) => typeof v === "string" || typeof v === "boolean"));
 }
 
+/** Doc ids of imported PDFs recorded in a draft (M4+; none before). */
+function validImports(imports: unknown): string[] {
+  return Array.isArray(imports) ? imports.filter((v): v is string => typeof v === "string") : [];
+}
+
+/** A stored draft for the re-opened document `docId`: pages of the main document get the new doc id (a
+ *  re-upload of the same file has a new one); pages of imported PDFs keep theirs (see resolveImports). */
 export function restoreDraft(draft: EditorDoc | null, docId: string, pageCount: number): EditorDoc | null {
   if (!draft || !Array.isArray(draft.pages) || draft.pages.length === 0) return null;
+  const imports = validImports(draft.imports);
   const pages = [];
   for (const p of draft.pages) {
     if (typeof p !== "object" || p === null || !validSrc(p.src)) return null;
-    if ("doc" in p.src) {
+    if ("doc" in p.src && imports.includes(p.src.doc)) {
+      pages.push(p);
+    } else if ("doc" in p.src) {
       if (p.src.index >= pageCount) return null;
       pages.push({ ...p, src: { doc: docId, index: p.src.index } });
     } else {
       pages.push(p);
     }
   }
-  return { ...draft, pages, forms: validForms(draft.forms) };
+  return { ...draft, pages, forms: validForms(draft.forms), imports };
+}
+
+/** Page sizes of the imported PDFs a restored draft uses. Pages of imports that are gone (expired) or whose
+ *  index no longer exists are dropped; `missing` says whether any were; `doc` is null when no page is left. */
+export async function resolveImports(
+  doc: EditorDoc,
+  structure: (docId: string) => Promise<StructurePage[]>,
+): Promise<{ doc: EditorDoc | null; imports: Record<string, StructurePage[]>; missing: boolean }> {
+  const used = [...new Set(doc.pages.flatMap((p) => ("doc" in p.src && doc.imports?.includes(p.src.doc) ? [p.src.doc] : [])))];
+  const imports: Record<string, StructurePage[]> = {};
+  await Promise.all(used.map(async (id) => {
+    try { imports[id] = await structure(id); } catch { /* expired or unknown: its pages go */ }
+  }));
+  const pages = doc.pages.filter((p) => !("doc" in p.src) || !doc.imports?.includes(p.src.doc) || p.src.index < (imports[p.src.doc]?.length ?? 0));
+  const missing = pages.length !== doc.pages.length;
+  return { doc: !pages.length ? null : missing ? { ...doc, pages } : doc, imports, missing };
 }
```

Modify `apps/web/src/store/editor.ts`:

```diff
--- a/apps/web/src/store/editor.ts
+++ b/apps/web/src/store/editor.ts
@@ -2,17 +2,20 @@ import { createStore, type StoreApi } from "zustand/vanilla";
 import { useStore } from "zustand";
 import type { ContentOp, TextEdit } from "@edith/ops";
 import type { FormField } from "@/lib/api";
-import { normRotation, type PageGeom, type Rotation } from "@/lib/coords";
+import { normRotation, type CropBox, type PageGeom, type Rotation } from "@/lib/coords";
 import type { Dash } from "@/lib/geometry";
-import { newId } from "@/lib/id";
+import * as P from "@/lib/pages";
 
 export interface StructurePage { index: number; width: number; height: number; rotation: number; hasText: boolean }
-export interface DocInfo { docId: string; sha256: string; fileName: string; pages: StructurePage[]; fields?: FormField[] }
+/** `imports`: page sizes of the other PDFs imported into this one, by doc id (not undoable: a registry). */
+export interface DocInfo { docId: string; sha256: string; fileName: string; pages: StructurePage[]; fields?: FormField[]; imports?: Record<string, StructurePage[]> }
 export type PageSrc = { doc: string; index: number } | { blank: { width: number; height: number } };
-export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation }
+/** `crop`: the visible part of the page (page coordinates), applied last at export. */
+export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation; crop?: CropBox | null }
 export type FormValue = string | boolean;
-/** `forms`: AcroForm values the user set, by field name (sent as form.set ops); absent in M1/M2 drafts. */
-export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue> }
+/** `forms`: AcroForm values the user set, by field name (sent as form.set ops); absent in M1/M2 drafts.
+ *  `imports`: doc ids of imported PDFs whose pages the document has (had); absent before M4. */
+export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue>; imports?: string[] }
 export type MarkupTool = "highlight" | "underline" | "strike";
 export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan"
   | MarkupTool | "check" | "cross" | "note" | "link" | "polygon" | "polyline" | "cloud";
@@ -42,6 +45,16 @@ export interface EditorState {
   deletePage(pageKey: string): void;
   insertBlankAfter(pageKey: string | null): string;
   movePage(pageKey: string, toIndex: number): void;
+  /** Copies the page (and its objects) right after it; returns the copy's key. */
+  duplicatePage(pageKey: string): string | null;
+  /** Registers the page sizes of an imported PDF (before its pages are inserted). */
+  addImport(docId: string, pages: StructurePage[]): void;
+  /** Inserts all pages of imported PDF `docId` after `pageKey` (null: at the start); returns their keys. */
+  insertImportAfter(pageKey: string | null, docId: string): string[];
+  /** Crops the pages (null removes the crop) as one undo step. */
+  setCrop(pageKeys: string[], crop: CropBox | null): void;
+  /** Replaces the whole document as one undo step (the Manage Pages modal's Simpan). */
+  replaceDoc(next: EditorDoc): void;
   undo(): void; redo(): void;
   select(id: string | null): void; setTool(t: Tool): void; setZoom(z: number): void;
   setStyle(p: Partial<ToolStyle>): void; setCurrentPage(k: string | null): void;
@@ -58,16 +71,17 @@ export const DEFAULT_STYLE: ToolStyle = {
   dash: "solid", opacity: 1,
 };
 
-export function pageGeom(entry: PageEntry, info: DocInfo): PageGeom {
-  if ("blank" in entry.src) return { ...entry.src.blank, rotation: normRotation(entry.rotate) };
-  const p = info.pages[entry.src.index];
-  return { width: p.width, height: p.height, rotation: normRotation(p.rotation + entry.rotate) };
+/** Structure of a page's source: the main document's or an imported PDF's page (undefined while unknown). */
+export function sourcePage(entry: PageEntry, info: DocInfo): StructurePage | undefined {
+  if ("blank" in entry.src) return undefined;
+  return (entry.src.doc === info.docId ? info.pages : info.imports?.[entry.src.doc])?.[entry.src.index];
 }
 
-function sizeOf(entry: PageEntry | undefined, info: DocInfo | null) {
-  if (!entry || !info) return A4;
-  const g = pageGeom(entry, info);
-  return { width: g.width, height: g.height };
+export function pageGeom(entry: PageEntry, info: DocInfo): PageGeom {
+  const crop = entry.crop ? { crop: entry.crop } : {};
+  if ("blank" in entry.src) return { ...entry.src.blank, rotation: normRotation(entry.rotate), ...crop };
+  const p = sourcePage(entry, info) ?? { width: A4.width, height: A4.height, rotation: 0 };
+  return { width: p.width, height: p.height, rotation: normRotation(p.rotation + entry.rotate), ...crop };
 }
 
 /** Fields of `s` that must change so selection/currentPage stay valid for `doc`. */
@@ -109,8 +123,6 @@ export function createEditorStore(now: () => number = Date.now): StoreApi<Editor
       }
       last = coalesce !== undefined ? { key: coalesce, at: t } : null;
     };
-    const mapPage = (key: string, fn: (p: PageEntry) => PageEntry) =>
-      commit((d) => ({ ...d, pages: d.pages.map((p) => (p.pageKey === key ? fn(p) : p)) }));
 
     return {
       info: null, doc: EMPTY, past: [], future: [],
@@ -174,38 +186,55 @@ export function createEditorStore(now: () => number = Date.now): StoreApi<Editor
       },
 
       rotatePage(key, delta) {
-        mapPage(key, (p) => ({ ...p, rotate: normRotation(p.rotate + delta) }));
+        commit((d) => P.rotatePages(d, [key], delta));
       },
 
       deletePage(key) {
-        commit((d) => (d.pages.length <= 1 ? d : { ...d, pages: d.pages.filter((p) => p.pageKey !== key) }));
+        commit((d) => P.deletePages(d, [key]));
         set(reconcile(get().doc, get()));
       },
 
       insertBlankAfter(key) {
-        const pageKey = newId("u");
+        const entry = P.blankPage({ width: 0, height: 0 });
         commit((d) => {
           const idx = key === null ? -1 : d.pages.findIndex((p) => p.pageKey === key);
-          const neighbor = d.pages[Math.max(idx, 0)];
-          const entry: PageEntry = { pageKey, src: { blank: sizeOf(neighbor, get().info) }, rotate: 0 };
-          const pages = [...d.pages];
-          pages.splice(idx + 1, 0, entry);
-          return { ...d, pages };
+          const size = P.blankSizeLike(d.pages[Math.max(idx, 0)], get().info);
+          return P.insertPages(d, idx + 1, [{ ...entry, src: { blank: size } }]);
         });
-        return pageKey;
+        return entry.pageKey;
       },
 
       movePage(key, toIndex) {
-        commit((d) => {
-          const from = d.pages.findIndex((p) => p.pageKey === key);
-          if (from < 0) return d;
-          const to = Math.max(0, Math.min(toIndex, d.pages.length - 1));
-          if (to === from) return d;
-          const pages = [...d.pages];
-          const [entry] = pages.splice(from, 1);
-          pages.splice(to, 0, entry);
-          return { ...d, pages };
-        });
+        commit((d) => P.movePage(d, key, toIndex));
+      },
+
+      duplicatePage(key) {
+        const before = new Set(get().doc.pages.map((p) => p.pageKey));
+        commit((d) => P.duplicatePages(d, [key]));
+        return get().doc.pages.find((p) => !before.has(p.pageKey))?.pageKey ?? null;
+      },
+
+      addImport(docId, pages) {
+        const info = get().info;
+        if (info) set({ info: { ...info, imports: { ...info.imports, [docId]: pages } } });
+      },
+
+      insertImportAfter(key, docId) {
+        const count = get().info?.imports?.[docId]?.length ?? 0;
+        if (!count) return [];
+        const before = new Set(get().doc.pages.map((p) => p.pageKey));
+        commit((d) => P.importPages(d, key === null ? 0 : d.pages.findIndex((p) => p.pageKey === key) + 1, docId, count));
+        return get().doc.pages.filter((p) => !before.has(p.pageKey)).map((p) => p.pageKey);
+      },
+
+      setCrop(keys, crop) {
+        const info = get().info;
+        if (info) commit((d) => P.setCrop(d, keys, crop, info));
+      },
+
+      replaceDoc(next) {
+        commit(() => next);
+        set(reconcile(get().doc, get()));
       },
 
       undo() {
```

Modify `apps/web/src/store/text.ts`:

```diff
--- a/apps/web/src/store/text.ts
+++ b/apps/web/src/store/text.ts
@@ -39,7 +39,7 @@ export function useText<T>(selector: (s: TextState) => T): T {
 
 const NONE: Paragraph[] = [];
 
-/** Original paragraphs of a page source (none for blank pages or before loading). */
+/** Original paragraphs of a page source (none for blank pages, pages of imported PDFs or before loading). */
 export function paragraphsOf(src: PageSrc, pages: Record<number, Paragraph[]> = textStore.getState().pages): Paragraph[] {
-  return "doc" in src ? pages[src.index] ?? NONE : NONE;
+  return "doc" in src && src.doc === textStore.getState().docId ? pages[src.index] ?? NONE : NONE;
 }
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 257 passed; tsc/eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/Header.tsx apps/web/src/components/editor/PageOverlay.tsx apps/web/src/components/editor/PropertiesBar.tsx apps/web/src/components/editor/find/replace.test.ts apps/web/src/components/editor/forms/FormLayer.tsx apps/web/src/components/editor/marks/markupTool.ts apps/web/src/components/editor/text/textEdit.test.ts apps/web/src/lib/compact.test.ts apps/web/src/lib/compact.ts apps/web/src/lib/pages.test.ts apps/web/src/lib/pages.ts apps/web/src/lib/restore.test.ts apps/web/src/lib/restore.ts apps/web/src/store/editor.test.ts apps/web/src/store/editor.ts apps/web/src/store/text.test.ts apps/web/src/store/text.ts
git commit -m "feat(web): page operations, imported-page registry and crop state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
