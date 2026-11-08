# Task 17: Imported PDFs on the web: form fields

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 16 leaves, new files are complete.

**Goal:** Owner decision 1 (web form side): an imported PDF's fields (from its own `/structure`) get inputs on its pages; their values live in `EditorDoc.importForms[doc][name]` (undoable, autosaved, restored) and go out as `form.set` with `doc`; the flatten toggle also shows for imported forms.

**Files:**
- Modify: `apps/web/src/components/editor/Editor.tsx`
- Modify: `apps/web/src/components/editor/Header.tsx`
- Modify: `apps/web/src/components/editor/forms/FormLayer.tsx`
- Modify: `apps/web/src/components/editor/pages/ManagePagesModal.tsx`
- Modify: `apps/web/src/components/editor/pages/importPdf.ts`
- Modify: `apps/web/src/lib/compact.test.ts`
- Modify: `apps/web/src/lib/compact.ts`
- Modify: `apps/web/src/lib/restore.test.ts`
- Modify: `apps/web/src/lib/restore.ts`
- Modify: `apps/web/src/store/editor.test.ts`
- Modify: `apps/web/src/store/editor.ts`

**Interfaces:**
- Consumes: Task 15 `FormSet.doc`; Task 7 `compact`, `restoreDraft`, `resolveImports`.
- Produces:
- `DocInfo.importFields?: Record<doc, FormField[]>`; `addImport(docId, pages, fields?)`; `EditorDoc.importForms?`; `setFormValue(name, value, opts?, doc?)`.
- `compact()` emits imported values as `{type: "form.set", fieldName, value, doc}` while one of that field's pages is left; `resolveImports(doc, structure: id → {pages, fields?})` also returns `fields`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/src/lib/restore.test.ts`:

```diff
--- a/apps/web/src/lib/restore.test.ts
+++ b/apps/web/src/lib/restore.test.ts
@@ -64,8 +64,10 @@ describe("restoreDraft with imported PDFs", () => {
   it("loads the imports' page sizes and drops pages of imports that are gone", async () => {
     const r = restoreDraft(draft, "NEW", 1)!;
     const sizes = [{ index: 0, width: 300, height: 400, rotation: 0, hasText: true }];
-    const ok = await resolveImports(r, async () => sizes);
+    const field = { name: "nama", page: 0 } as never;
+    const ok = await resolveImports(r, async () => ({ pages: sizes, fields: [field] }));
     expect(ok.imports).toEqual({ [I]: sizes });
+    expect(ok.fields).toEqual({ [I]: [field] });
     expect(ok.doc!.pages.map((p) => p.pageKey)).toEqual(["o0", "u-i0"]); // index 1 no longer exists
     expect(ok.missing).toBe(true);
     const gone = await resolveImports(r, async () => { throw new Error("410"); });
@@ -75,3 +77,14 @@ describe("restoreDraft with imported PDFs", () => {
     expect(onlyImported.doc).toBeNull();
   });
 });
+
+describe("restoreDraft keeps imported field values", () => {
+  it("validates them per imported PDF", () => {
+    const I = "I".repeat(22);
+    const draft = {
+      pages: [{ pageKey: "u-i0", src: { doc: I, index: 0 }, rotate: 0 as const }], objects: {}, order: [], imports: [I],
+      importForms: { [I]: { nama: "Budi", rusak: 3 }, OTHER: { x: "y" } },
+    };
+    expect(restoreDraft(draft as never, "NEW", 1)!.importForms).toEqual({ [I]: { nama: "Budi" } });
+  });
+});
```

Modify `apps/web/src/lib/compact.test.ts`:

```diff
--- a/apps/web/src/lib/compact.test.ts
+++ b/apps/web/src/lib/compact.test.ts
@@ -81,3 +81,17 @@ describe("compact (M4)", () => {
     expect(compact(doc).length).toBe(4); // without info every value is sent
   });
 });
+
+describe("compact: imported fields", () => {
+  it("sends their values with the doc they belong to, only while one of their pages is left", () => {
+    const D = "D".repeat(22), I = "I".repeat(22);
+    const doc: EditorDoc = {
+      pages: [{ pageKey: "u-i0", src: { doc: I, index: 0 }, rotate: 0 }], objects: {}, order: [],
+      importForms: { [I]: { nama: "Budi", hilang: "x" } },
+    };
+    const importFields = { [I]: [{ name: "nama", page: 0 }, { name: "hilang", page: 1 }] as never[] };
+    expect(compact(doc, { docId: D, fields: [], importFields }).slice(1)).toEqual([
+      { id: "form-import-0", type: "form.set", fieldName: "nama", value: "Budi", doc: I },
+    ]);
+  });
+});
```

Modify `apps/web/src/store/editor.test.ts`:

```diff
--- a/apps/web/src/store/editor.test.ts
+++ b/apps/web/src/store/editor.test.ts
@@ -239,3 +239,19 @@ describe("page actions (M4)", () => {
     expect(s().doc.pages[0].crop).toBeUndefined();
   });
 });
+
+describe("imported form fields", () => {
+  it("keep their values apart from the edited PDF's, with undo", () => {
+    const I = "I".repeat(22);
+    s().addImport(I, [{ index: 0, width: 300, height: 400, rotation: 0, hasText: true }], [{ name: "nama" } as never]);
+    expect(s().info!.importFields).toEqual({ [I]: [{ name: "nama" }] });
+    s().setFormValue("nama", "Utama");
+    s().setFormValue("nama", "Impor", undefined, I);
+    expect(s().doc.forms).toEqual({ nama: "Utama" });
+    expect(s().doc.importForms).toEqual({ [I]: { nama: "Impor" } });
+    s().setFormValue("nama", "Main", undefined, info.docId); // the edited PDF's own id = no doc
+    expect(s().doc.forms).toEqual({ nama: "Main" });
+    s().undo(); s().undo();
+    expect(s().doc.importForms?.[I]).toBeUndefined();
+  });
+});
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: `importForms` / `fields` missing

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Editor.tsx`:

```diff
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -65,10 +65,10 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
       if (cancelled) return;
       let draft = restoreDraft(loadDraft(st.sha256), docId, st.page_count);
       // Pages of imported PDFs need those documents' page sizes; imports that expired lose their pages.
-      const resolved = draft?.imports?.length ? await resolveImports(draft, async (id) => (await getStructure(id)).pages) : null;
+      const resolved = draft?.imports?.length ? await resolveImports(draft, (id) => getStructure(id)) : null;
       if (cancelled) return;
       if (resolved) draft = resolved.doc;
-      editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages, fields: st.fields, imports: resolved?.imports }, draft);
+      editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages, fields: st.fields, imports: resolved?.imports, importFields: resolved?.fields }, draft);
       initialDoc.current = editorStore.getState().doc;
       if (resolved?.missing) setNotice({ kind: "error", text: t.pages.importGone });
       else if (draft) setNotice({ kind: "info", text: t.editor.restored });
```

Modify `apps/web/src/components/editor/Header.tsx`:

```diff
--- a/apps/web/src/components/editor/Header.tsx
+++ b/apps/web/src/components/editor/Header.tsx
@@ -15,7 +15,7 @@ export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; t
   const [name, setName] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
   const [flatten, setFlatten] = useState(false);
-  const hasForm = useEditor((s) => (s.info?.fields?.length ?? 0) > 0);
+  const hasForm = useEditor((s) => (s.info?.fields?.length ?? 0) > 0 || Object.values(s.info?.importFields ?? {}).some((f) => f.length > 0));
   const fileName = name ?? info?.fileName ?? "document.pdf";
 
   async function download() {
```

Modify `apps/web/src/components/editor/forms/FormLayer.tsx`:

```diff
--- a/apps/web/src/components/editor/forms/FormLayer.tsx
+++ b/apps/web/src/components/editor/forms/FormLayer.tsx
@@ -13,16 +13,18 @@ const FIELD_BG = "#eef4ff";
  *  field while typing). Inputs take the pointer only with the select tool, so other tools draw over fields. */
 export function FormLayer({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
   const src = useEditor((s) => s.doc.pages.find((p) => p.pageKey === pageKey)?.src);
-  const fields = useEditor((s) => s.info?.fields ?? NONE);
-  const forms = useEditor((s) => s.doc.forms);
+  // Fields and values of the page's own PDF: the edited one, or an imported one (named as in that PDF).
+  const main = useEditor((s) => !!src && "doc" in src && src.doc === s.info?.docId);
+  const fields = useEditor((s) => (!src || !("doc" in src) ? NONE : main ? s.info?.fields : s.info?.importFields?.[src.doc]) ?? NONE);
+  const forms = useEditor((s) => (!src || !("doc" in src) ? undefined : main ? s.doc.forms : s.doc.importForms?.[src.doc]));
   const tool = useEditor((s) => s.tool);
-  const docId = useEditor((s) => s.info?.docId);
-  if (!src || !("doc" in src) || src.doc !== docId) return null; // fields of imported PDFs are not editable (yet)
+  if (!src || !("doc" in src)) return null;
+  const doc = main ? undefined : src.doc;
   const mine = fields.filter((f) => f.page === src.index && isEditable(f));
   if (!mine.length) return null;
 
   const set = (f: FormField, value: string | boolean) =>
-    editorStore.getState().setFormValue(f.name, value, f.type === "text" ? { coalesce: `form:${f.name}` } : undefined);
+    editorStore.getState().setFormValue(f.name, value, f.type === "text" ? { coalesce: `form:${f.name}` } : undefined, doc);
 
   return (
     <div className="absolute inset-0" style={{ pointerEvents: "none", zIndex: 5 }} data-testid="form-layer">
```

Modify `apps/web/src/components/editor/pages/ManagePagesModal.tsx`:

```diff
--- a/apps/web/src/components/editor/pages/ManagePagesModal.tsx
+++ b/apps/web/src/components/editor/pages/ManagePagesModal.tsx
@@ -72,7 +72,7 @@ export function ManagePagesModal({ onClose }: { onClose: () => void }) {
     try {
       const up = await uploadDocument(file, file.name);
       const st = await getStructure(up.doc_id);
-      editorStore.getState().addImport(up.doc_id, st.pages); // the registry, not the document: Batal leaves no pages
+      editorStore.getState().addImport(up.doc_id, st.pages, st.fields); // the registry, not the document: Batal leaves no pages
       void textStore.getState().loadImport(up.doc_id);
       setDraft((d) => P.importPages(d, P.insertIndex(d, selected), up.doc_id, st.pages.length));
     } catch (e) {
```

Modify `apps/web/src/components/editor/pages/importPdf.ts`:

```diff
--- a/apps/web/src/components/editor/pages/importPdf.ts
+++ b/apps/web/src/components/editor/pages/importPdf.ts
@@ -11,7 +11,7 @@ export async function importPdf(file: File, afterKey: string | null): Promise<st
     const up = await uploadDocument(file, file.name);
     const st = await getStructure(up.doc_id);
     const s = editorStore.getState();
-    s.addImport(up.doc_id, st.pages);
+    s.addImport(up.doc_id, st.pages, st.fields);
     void textStore.getState().loadImport(up.doc_id); // its paragraphs and fonts, for editing and Find
     const keys = s.insertImportAfter(afterKey, up.doc_id);
     noticeStore.getState().show({ kind: "info", text: t.pages.imported(keys.length) });
```

Modify `apps/web/src/lib/compact.ts`:

```diff
--- a/apps/web/src/lib/compact.ts
+++ b/apps/web/src/lib/compact.ts
@@ -1,4 +1,5 @@
 import type { ContentOp, Op } from "@edith/ops";
+import type { FormField } from "@/lib/api";
 import type { DocInfo, EditorDoc } from "@/store/editor";
 
 /** False for a link to a page that is no longer in the document (it goes with the page). */
@@ -6,23 +7,28 @@ function targetKept(op: ContentOp, keys: ReadonlySet<string>): boolean {
   return op.type !== "link.add" || !("pageKey" in op.target) || keys.has(op.target.pageKey);
 }
 
-/** Names of the main document's fields that still have a widget on one of the pages. */
-function keptFields(doc: EditorDoc, info: Pick<DocInfo, "docId" | "fields">): Set<string> {
-  const shown = new Set(doc.pages.flatMap((p) => ("doc" in p.src && p.src.doc === info.docId ? [p.src.index] : [])));
-  return new Set((info.fields ?? []).filter((f) => shown.has(f.page)).map((f) => f.name));
+/** Names of the fields of document `docId` (`fields`) that still have a widget on one of the pages. */
+function keptFields(doc: EditorDoc, docId: string, fields: FormField[]): Set<string> {
+  const shown = new Set(doc.pages.flatMap((p) => ("doc" in p.src && p.src.doc === docId ? [p.src.index] : [])));
+  return new Set(fields.filter((f) => shown.has(f.page)).map((f) => f.name));
 }
 
-/** The ops sent to the API. With `info`, values of form fields whose pages were all deleted are dropped. */
-export function compact(doc: EditorDoc, info?: Pick<DocInfo, "docId" | "fields">): Op[] {
+/** The ops sent to the API. With `info`, values of form fields whose pages were all deleted are dropped;
+ *  values of imported PDFs' fields go as form.set with `doc`. */
+export function compact(doc: EditorDoc, info?: Pick<DocInfo, "docId" | "fields" | "importFields">): Op[] {
   const keys = new Set(doc.pages.map((p) => p.pageKey));
   const pages = doc.pages.map(({ crop, ...p }) => (crop ? { ...p, crop } : p)); // no `crop: null` on the wire
   const layout = { id: "layout", type: "pages.layout", pages } as Op;
   const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey) && targetKept(op, keys));
-  const fields = info ? keptFields(doc, info) : null;
+  const fields = info ? keptFields(doc, info.docId, info.fields ?? []) : null;
   const forms = Object.entries(doc.forms ?? {})
     .filter(([name]) => !fields || fields.has(name))
     .map(([fieldName, value], i) => ({ id: `form-${i}`, type: "form.set", fieldName, value }) as Op);
-  return [layout, ...content, ...forms];
+  const imported = Object.entries(doc.importForms ?? {}).flatMap(([d, values]) => {
+    const kept = info ? keptFields(doc, d, info.importFields?.[d] ?? []) : null;
+    return Object.entries(values).filter(([name]) => !kept || kept.has(name)).map(([fieldName, value]) => ({ fieldName, value, doc: d }));
+  }).map((f, i) => ({ id: `form-import-${i}`, type: "form.set", ...f }) as Op);
+  return [layout, ...content, ...forms, ...imported];
 }
 
 /** The id of the op an export error points at: `op_id` (bake_failed) or `op_index` into the sent ops (invalid_op). */
```

Modify `apps/web/src/lib/restore.ts`:

```diff
--- a/apps/web/src/lib/restore.ts
+++ b/apps/web/src/lib/restore.ts
@@ -1,3 +1,4 @@
+import type { FormField } from "@/lib/api";
 import type { EditorDoc, StructurePage } from "@/store/editor";
 
 const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
@@ -38,21 +39,28 @@ export function restoreDraft(draft: EditorDoc | null, docId: string, pageCount:
       pages.push(p);
     }
   }
-  return { ...draft, pages, forms: validForms(draft.forms), imports };
+  const importForms = Object.fromEntries(imports.map((id) => [id, validForms(draft.importForms?.[id])]));
+  return { ...draft, pages, forms: validForms(draft.forms), imports, importForms };
 }
 
-/** Page sizes of the imported PDFs a restored draft uses. Pages of imports that are gone (expired) or whose
- *  index no longer exists are dropped; `missing` says whether any were; `doc` is null when no page is left. */
+/** Page sizes and form fields of the imported PDFs a restored draft uses. Pages of imports that are gone
+ *  (expired) or whose index no longer exists are dropped; `missing` says whether any were; `doc` is null when
+ *  no page is left. */
 export async function resolveImports(
   doc: EditorDoc,
-  structure: (docId: string) => Promise<StructurePage[]>,
-): Promise<{ doc: EditorDoc | null; imports: Record<string, StructurePage[]>; missing: boolean }> {
+  structure: (docId: string) => Promise<{ pages: StructurePage[]; fields?: FormField[] }>,
+): Promise<{ doc: EditorDoc | null; imports: Record<string, StructurePage[]>; fields: Record<string, FormField[]>; missing: boolean }> {
   const used = [...new Set(doc.pages.flatMap((p) => ("doc" in p.src && doc.imports?.includes(p.src.doc) ? [p.src.doc] : [])))];
   const imports: Record<string, StructurePage[]> = {};
+  const fields: Record<string, FormField[]> = {};
   await Promise.all(used.map(async (id) => {
-    try { imports[id] = await structure(id); } catch { /* expired or unknown: its pages go */ }
+    try {
+      const st = await structure(id);
+      imports[id] = st.pages;
+      fields[id] = st.fields ?? [];
+    } catch { /* expired or unknown: its pages go */ }
   }));
   const pages = doc.pages.filter((p) => !("doc" in p.src) || !doc.imports?.includes(p.src.doc) || p.src.index < (imports[p.src.doc]?.length ?? 0));
   const missing = pages.length !== doc.pages.length;
-  return { doc: !pages.length ? null : missing ? { ...doc, pages } : doc, imports, missing };
+  return { doc: !pages.length ? null : missing ? { ...doc, pages } : doc, imports, fields, missing };
 }
```

Modify `apps/web/src/store/editor.ts`:

```diff
--- a/apps/web/src/store/editor.ts
+++ b/apps/web/src/store/editor.ts
@@ -7,15 +7,23 @@ import type { Dash } from "@/lib/geometry";
 import * as P from "@/lib/pages";
 
 export interface StructurePage { index: number; width: number; height: number; rotation: number; hasText: boolean }
-/** `imports`: page sizes of the other PDFs imported into this one, by doc id (not undoable: a registry). */
-export interface DocInfo { docId: string; sha256: string; fileName: string; pages: StructurePage[]; fields?: FormField[]; imports?: Record<string, StructurePage[]> }
+/** `imports`/`importFields`: page sizes and form fields of the other PDFs imported into this one, by doc id
+ *  (not undoable: a registry). Imported fields keep the names of their own PDF. */
+export interface DocInfo {
+  docId: string; sha256: string; fileName: string; pages: StructurePage[]; fields?: FormField[];
+  imports?: Record<string, StructurePage[]>; importFields?: Record<string, FormField[]>;
+}
 export type PageSrc = { doc: string; index: number } | { blank: { width: number; height: number } };
 /** `crop`: the visible part of the page (page coordinates), applied last at export. */
 export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation; crop?: CropBox | null }
 export type FormValue = string | boolean;
 /** `forms`: AcroForm values the user set, by field name (sent as form.set ops); absent in M1/M2 drafts.
- *  `imports`: doc ids of imported PDFs whose pages the document has (had); absent before M4. */
-export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue>; imports?: string[] }
+ *  `imports`: doc ids of imported PDFs whose pages the document has (had); absent before M4.
+ *  `importForms`: values of imported PDFs' fields, by doc id then field name (form.set with `doc`). */
+export interface EditorDoc {
+  pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue>;
+  imports?: string[]; importForms?: Record<string, Record<string, FormValue>>;
+}
 export type MarkupTool = "highlight" | "underline" | "strike";
 export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan"
   | MarkupTool | "check" | "cross" | "note" | "link" | "polygon" | "polyline" | "cloud";
@@ -40,7 +48,7 @@ export interface EditorState {
   putObjects(ops: ContentOp[], remove?: string[]): void;
   deleteObject(id: string): void;
   /** Sets AcroForm field `name` (every widget of that name); `coalesce` as in updateObject (typing). */
-  setFormValue(name: string, value: FormValue, opts?: { coalesce?: string }): void;
+  setFormValue(name: string, value: FormValue, opts?: { coalesce?: string }, doc?: string): void;
   rotatePage(pageKey: string, delta: 90 | -90): void;
   deletePage(pageKey: string): void;
   insertBlankAfter(pageKey: string | null): string;
@@ -48,7 +56,7 @@ export interface EditorState {
   /** Copies the page (and its objects) right after it; returns the copy's key. */
   duplicatePage(pageKey: string): string | null;
   /** Registers the page sizes of an imported PDF (before its pages are inserted). */
-  addImport(docId: string, pages: StructurePage[]): void;
+  addImport(docId: string, pages: StructurePage[], fields?: FormField[]): void;
   /** Inserts all pages of imported PDF `docId` after `pageKey` (null: at the start); returns their keys. */
   insertImportAfter(pageKey: string | null, docId: string): string[];
   /** Crops the pages (null removes the crop) as one undo step. */
@@ -181,7 +189,12 @@ export function createEditorStore(now: () => number = Date.now): StoreApi<Editor
         if (get().selection === id) set({ selection: null });
       },
 
-      setFormValue(name, value, opts) {
+      setFormValue(name, value, opts, doc) {
+        if (doc && doc !== get().info?.docId) { // a field of an imported PDF
+          commit((d) => (d.importForms?.[doc]?.[name] === value ? d
+            : { ...d, importForms: { ...d.importForms, [doc]: { ...d.importForms?.[doc], [name]: value } } }), opts?.coalesce ? `${doc}:${opts.coalesce}` : undefined);
+          return;
+        }
         commit((d) => (d.forms?.[name] === value ? d : { ...d, forms: { ...d.forms, [name]: value } }), opts?.coalesce);
       },
 
@@ -214,9 +227,9 @@ export function createEditorStore(now: () => number = Date.now): StoreApi<Editor
         return get().doc.pages.find((p) => !before.has(p.pageKey))?.pageKey ?? null;
       },
 
-      addImport(docId, pages) {
+      addImport(docId, pages, fields = []) {
         const info = get().info;
-        if (info) set({ info: { ...info, imports: { ...info.imports, [docId]: pages } } });
+        if (info) set({ info: { ...info, imports: { ...info.imports, [docId]: pages }, importFields: { ...info.importFields, [docId]: fields } } });
       },
 
       insertImportAfter(key, docId) {
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 279 passed; tsc/eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/Header.tsx apps/web/src/components/editor/forms/FormLayer.tsx apps/web/src/components/editor/pages/ManagePagesModal.tsx apps/web/src/components/editor/pages/importPdf.ts apps/web/src/lib/compact.test.ts apps/web/src/lib/compact.ts apps/web/src/lib/restore.test.ts apps/web/src/lib/restore.ts apps/web/src/store/editor.test.ts apps/web/src/store/editor.ts
git commit -m "feat(web): fill form fields of imported PDFs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
