# Task 6: Web model: tools, styles, form values, compaction, object geometry, strings

The client-side data model for M3, no UI yet: new tools and their default colors, AcroForm values in the undoable document (`EditorDoc.forms`, sent as `form.set` ops), links dropped with their target page, draft restore of form values, bounds/move/resize for annotations, and every M3 UI string.

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/compact.test.ts`
- Modify: `apps/web/src/lib/compact.ts`
- Modify: `apps/web/src/lib/objects.test.ts`
- Modify: `apps/web/src/lib/objects.ts`
- Modify: `apps/web/src/lib/restore.test.ts`
- Modify: `apps/web/src/lib/restore.ts`
- Modify: `apps/web/src/lib/strings.ts`
- Modify: `apps/web/src/store/editor.test.ts`
- Modify: `apps/web/src/store/editor.ts`

**Interfaces:**
- Consumes: Task 1 TS types; Task 4 structure `fields`; Task 5 chars route; M2 store (`commit` with coalescing), `compact`, `restoreDraft`, `objects.ts`.
- Produces:
  - `lib/api.ts`: `FormField` (Task 4 JSON), `Structure.fields`, `getChars(docId, index): Promise<CharLine[]>`, `CharLine` (Task 8 moves its definition to `lib/markup.ts` and re-exports it).
  - `store/editor.ts`: `FormValue = string | boolean`; `EditorDoc.forms?: Record<string, FormValue>`; `MarkupTool = "highlight"|"underline"|"strike"`; `Tool` adds `MarkupTool | "check" | "cross" | "note" | "link"`; `ToolStyle.markup: Record<MarkupTool, string>`, `symbolColor`, `noteColor`; exported `DEFAULT_STYLE` (highlight `#ffeb3b`, underline/strike `#e11d48`, symbol `#1d4ed8`, note `#facc15`); `DocInfo.fields?: FormField[]`; `setFormValue(name, value, opts?: {coalesce?})` (no-op when unchanged).
  - `lib/compact.ts`: drops `link.add` whose `{pageKey}` target is not in the document; appends `{id: "form-<i>", type: "form.set", fieldName, value}` per `doc.forms` entry after the content.
  - `lib/restore.ts`: `forms` restored when a plain object of string/boolean values, else `{}`.
  - `lib/objects.ts`: `NOTE_SIZE = 16`, `SYMBOL_SIZE = 20`; `isMarkup(op)` (annot.add except note), `isResizable(op)` (false for annot.add); `opBounds` of annot.add (quads union / 16 × 16 note); `moveOp` moves a note's point and leaves markup alone; `resizeOp` leaves annot.add alone; `symbolAt(kind, at, style, pageKey, id, page)`; `noteAt(at, style, pageKey, id, page)` (content `""`).
  - `lib/strings.ts`: `t.text.overflow`, `t.text.unsupported` (= "beberapa karakter tidak didukung font ini"), `t.annot.*`, `t.link.*`, `t.stamp.*`, `t.signature.*` (incl. `colors` by hex), `t.form.*`.

- [ ] **Step 1: Write the failing tests**

`objects.test.ts` now builds its style from `DEFAULT_STYLE` (ToolStyle gained required fields).

Modify `apps/web/src/lib/compact.test.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/compact.test.ts
+++ b/apps/web/src/lib/compact.test.ts
@@ -34,3 +34,30 @@ describe("failedOpId", () => {
     expect(failedOpId("network", { op_index: 1 }, sent)).toBeUndefined();
   });
 });
+
+describe("compact (M3)", () => {
+  const pages = [
+    { pageKey: "o0", src: { doc: "D", index: 0 }, rotate: 0 as const },
+    { pageKey: "o2", src: { doc: "D", index: 2 }, rotate: 0 as const },
+  ];
+  const link = (id: string, target: { url: string } | { pageKey: string }): ContentOp =>
+    ({ id, type: "link.add", pageKey: "o0", rect: { x: 0, y: 0, w: 10, h: 10 }, target }) as ContentOp;
+
+  it("drops links to pages that are gone", () => {
+    const doc: EditorDoc = {
+      pages,
+      objects: { a: link("a", { pageKey: "o2" }), b: link("b", { pageKey: "o1" }), c: link("c", { url: "https://a.b" }) },
+      order: ["a", "b", "c"],
+    };
+    expect(compact(doc).slice(1).map((o) => o.id)).toEqual(["a", "c"]);
+  });
+
+  it("sends form values as form.set ops after the content", () => {
+    const doc: EditorDoc = { pages, objects: { w: op("w", "o0") }, order: ["w"], forms: { nama: "Budi", setuju: true } };
+    expect(compact(doc).slice(1)).toEqual([
+      op("w", "o0"),
+      { id: "form-0", type: "form.set", fieldName: "nama", value: "Budi" },
+      { id: "form-1", type: "form.set", fieldName: "setuju", value: true },
+    ]);
+  });
+});
```

Modify `apps/web/src/lib/objects.test.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/objects.test.ts
+++ b/apps/web/src/lib/objects.test.ts
@@ -1,9 +1,9 @@
 import { describe, expect, it } from "vitest";
 import type { ContentOp } from "@edith/ops";
-import { arrowHead, clampToPage, createFromDrag, inkWidth, isTextOp, MIN_INK_WIDTH, moveOp, normalizeRect, opBounds, resizeOp } from "@/lib/objects";
-import type { ToolStyle } from "@/store/editor";
+import { arrowHead, clampToPage, createFromDrag, inkWidth, isMarkup, isResizable, isTextOp, MIN_INK_WIDTH, moveOp, normalizeRect, NOTE_SIZE, noteAt, opBounds, resizeOp, SYMBOL_SIZE, symbolAt } from "@/lib/objects";
+import { DEFAULT_STYLE, type ToolStyle } from "@/store/editor";
 
-const style: ToolStyle = { stroke: "#ff0000", fill: "#00ff00", width: 3, color: "#111111", fontFamily: "Arimo", fontSize: 14, bold: false, italic: false, align: "left" };
+const style: ToolStyle = { ...DEFAULT_STYLE, stroke: "#ff0000", fill: "#00ff00", width: 3, color: "#111111" };
 
 describe("objects", () => {
   it("normalizes rects from any drag direction", () => {
@@ -77,3 +77,30 @@ describe("text.edit ops", () => {
     expect(opBounds(resizeOp(op, { x: 0, y: 20, w: 50, h: 99 }))).toEqual({ x: 0, y: 20, w: 50, h: 30 }); // width only
   });
 });
+
+describe("objects (M3)", () => {
+  const page = { width: 595, height: 842 };
+  const hl = { id: "h", type: "annot.add", pageKey: "o0", kind: "highlight", color: "#ffeb3b",
+    quads: [{ x: 72, y: 90, w: 100, h: 14 }, { x: 72, y: 104, w: 40, h: 14 }] } as ContentOp;
+
+  it("markup bounds cover every quad; markup never moves or resizes", () => {
+    expect(opBounds(hl)).toEqual({ x: 72, y: 90, w: 100, h: 28 });
+    expect(moveOp(hl, 5, 5)).toBe(hl);
+    expect(resizeOp(hl, { x: 0, y: 0, w: 1, h: 1 })).toBe(hl);
+    expect(isMarkup(hl)).toBe(true);
+    expect(isResizable(hl)).toBe(false);
+  });
+
+  it("places notes and symbols on the page", () => {
+    const note = noteAt([590, 10], style, "o0", "n", page);
+    expect(note).toEqual({ id: "n", type: "annot.add", pageKey: "o0", kind: "note", point: [595 - NOTE_SIZE, 10], color: style.noteColor, content: "" });
+    expect(opBounds(note)).toEqual({ x: 579, y: 10, w: 16, h: 16 });
+    expect((moveOp(note, 1, 2) as { point: number[] }).point).toEqual([580, 12]);
+    expect(isMarkup(note)).toBe(false);
+    expect(isResizable(note)).toBe(false);
+    const check = symbolAt("check", [100, 5], style, "o0", "c", page);
+    expect(check).toEqual({ id: "c", type: "symbol.add", pageKey: "o0", kind: "check", rect: { x: 90, y: 0, w: SYMBOL_SIZE, h: SYMBOL_SIZE }, color: style.symbolColor });
+    expect(isResizable(check)).toBe(true);
+    expect((resizeOp(check, { x: 1, y: 2, w: 30, h: 30 }) as { rect: unknown }).rect).toEqual({ x: 1, y: 2, w: 30, h: 30 });
+  });
+});
```

Modify `apps/web/src/lib/restore.test.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/restore.test.ts
+++ b/apps/web/src/lib/restore.test.ts
@@ -32,3 +32,14 @@ describe("restoreDraft", () => {
     expect(bad([{ pageKey: "u-b", src: { blank: { width: "1", height: 1 } }, rotate: 0 }])).toBeNull();
   });
 });
+
+describe("restoreDraft forms", () => {
+  const pages = [{ pageKey: "o0", src: { doc: "OLD", index: 0 }, rotate: 0 as const }];
+  it("keeps string/boolean form values and drops anything else", () => {
+    const draft = { pages, objects: {}, order: [], forms: { nama: "Budi", setuju: true, bad: 3 } } as never;
+    expect(restoreDraft(draft, "NEW", 1)!.forms).toEqual({ nama: "Budi", setuju: true });
+  });
+  it("gives M1/M2 drafts an empty form", () => {
+    expect(restoreDraft({ pages, objects: {}, order: [] }, "NEW", 1)!.forms).toEqual({});
+  });
+});
```

Modify `apps/web/src/store/editor.test.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/store/editor.test.ts
+++ b/apps/web/src/store/editor.test.ts
@@ -183,4 +183,21 @@ describe("history coalescing and batches", () => {
     expect(textEditFor(s().doc, "o1", "g2")?.id).toBe("e");
     expect(textEditFor(s().doc, "o0", "g2")).toBeUndefined();
   });
+
+  it("sets form values with undo, coalescing typing into one step", () => {
+    let t = 0;
+    const st = createEditorStore(() => t);
+    st.getState().init(info);
+    st.getState().setFormValue("nama", "B", { coalesce: "form:nama" });
+    t = 300; st.getState().setFormValue("nama", "Bu", { coalesce: "form:nama" });
+    t = 600; st.getState().setFormValue("setuju", true);
+    expect(st.getState().doc.forms).toEqual({ nama: "Bu", setuju: true });
+    st.getState().undo();
+    expect(st.getState().doc.forms).toEqual({ nama: "Bu" });
+    st.getState().undo();
+    expect(st.getState().doc.forms).toBeUndefined();
+    const before = st.getState().past.length;
+    st.getState().redo(); st.getState().setFormValue("nama", "Bu"); // same value: no new step
+    expect(st.getState().past.length).toBe(before + 1);
+  });
 });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/web && npx vitest run src/lib/compact.test.ts src/lib/restore.test.ts src/lib/objects.test.ts src/store/editor.test.ts`
Expected: `Tests  7 failed | 35 passed (42)` — e.g. `setFormValue is not a function`, `isMarkup is not a function`, form values not restored.

- [ ] **Step 3: Implement**

Modify `apps/web/src/lib/api.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -22,8 +22,22 @@ export interface DocFont {
 }
 export interface TextData { doc_id: string; pages: { index: number; paragraphs: Paragraph[] }[]; fonts: DocFont[] }
 
+/** One AcroForm widget (GET /documents/{id}/structure). Radio buttons of a group share `name`. */
+export interface FormField {
+  name: string; type: "text" | "checkbox" | "radio" | "combo" | "list" | "button" | "signature";
+  /** Text/choice value; checkbox/radio: the widget's state name ("Off" when not chosen). */
+  value: string;
+  /** Checkbox/radio: the state name of this widget when it is on. */
+  onState: string | null;
+  options: string[] | null; page: number; rect: Rect; readOnly: boolean; multiline: boolean;
+  /** 0 = auto. */
+  fontSize: number;
+}
+/** One horizontal line of original text: `boxes[i]` = `[x0, x1]` of the i-th code point of `text`. */
+export interface CharLine { text: string; boxes: [number, number][]; baseline: number; size: number }
+
 export interface UploadResult { doc_id: string; sha256: string; page_count: number }
-export interface Structure { doc_id: string; sha256: string; page_count: number; pages: StructurePage[] }
+export interface Structure { doc_id: string; sha256: string; page_count: number; pages: StructurePage[]; fields: FormField[] }
 
 async function request(path: string, init?: RequestInit): Promise<Response> {
   let res: Response;
@@ -56,6 +70,10 @@ export async function getText(docId: string): Promise<TextData> {
   return (await request(`/documents/${docId}/text`)).json();
 }
 
+export async function getChars(docId: string, index: number): Promise<CharLine[]> {
+  return ((await (await request(`/documents/${docId}/pages/${index}/chars`)).json()) as { lines: CharLine[] }).lines;
+}
+
 export function fontFileUrl(docId: string, ref: string): string {
   return `${API_URL}/documents/${docId}/fonts/${ref}`;
 }
```

Modify `apps/web/src/lib/compact.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/compact.ts
+++ b/apps/web/src/lib/compact.ts
@@ -1,11 +1,17 @@
-import type { Op } from "@edith/ops";
+import type { ContentOp, Op } from "@edith/ops";
 import type { EditorDoc } from "@/store/editor";
 
+/** False for a link to a page that is no longer in the document (it goes with the page). */
+function targetKept(op: ContentOp, keys: ReadonlySet<string>): boolean {
+  return op.type !== "link.add" || !("pageKey" in op.target) || keys.has(op.target.pageKey);
+}
+
 export function compact(doc: EditorDoc): Op[] {
   const keys = new Set(doc.pages.map((p) => p.pageKey));
   const layout = { id: "layout", type: "pages.layout", pages: doc.pages } as Op;
-  const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey));
-  return [layout, ...content];
+  const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey) && targetKept(op, keys));
+  const forms = Object.entries(doc.forms ?? {}).map(([fieldName, value], i) => ({ id: `form-${i}`, type: "form.set", fieldName, value }) as Op);
+  return [layout, ...content, ...forms];
 }
 
 /** The id of the op an export error points at: `op_id` (bake_failed) or `op_index` into the sent ops (invalid_op). */
```

Modify `apps/web/src/lib/objects.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/objects.ts
+++ b/apps/web/src/lib/objects.ts
@@ -1,4 +1,4 @@
-import type { ContentOp, Rect, TextAdd, TextEdit } from "@edith/ops";
+import type { AnnotAdd, ContentOp, Rect, SymbolAdd, TextAdd, TextEdit } from "@edith/ops";
 import type { ToolStyle } from "@/store/editor";
 
 export type Pt = [number, number];
@@ -31,10 +31,31 @@ export function isTextOp(op: ContentOp | undefined): op is TextAdd | TextEdit {
   return op?.type === "text.add" || op?.type === "text.edit";
 }
 
+/** Size of a sticky note's icon (MuPDF draws the Note icon 16 × 16 pt from the point). */
+export const NOTE_SIZE = 16;
+/** Default size of a check/cross symbol placed with a click. */
+export const SYMBOL_SIZE = 20;
+
+/** Highlight/underline/strike: attached to the text under it (cannot be moved or resized). */
+export function isMarkup(op: ContentOp | undefined): op is AnnotAdd {
+  return op?.type === "annot.add" && op.kind !== "note";
+}
+
+/** Objects without resize handles: text markup and sticky notes. */
+export function isResizable(op: ContentOp | undefined): boolean {
+  return !!op && op.type !== "annot.add";
+}
+
 export function opBounds(op: ContentOp): Rect {
   const o = op as Any;
   switch (op.type) {
     case "text.add": case "text.edit": return (o.box as { rect: Rect }).rect;
+    case "annot.add": {
+      if (op.kind === "note") return { x: op.point![0], y: op.point![1], w: NOTE_SIZE, h: NOTE_SIZE };
+      const qs = op.quads!;
+      const x = Math.min(...qs.map((q) => q.x)), y = Math.min(...qs.map((q) => q.y));
+      return { x, y, w: Math.max(...qs.map((q) => q.x + q.w)) - x, h: Math.max(...qs.map((q) => q.y + q.h)) - y };
+    }
     case "ink.add": return boundsOfPoints((o.paths as number[][][]).flat());
     case "shape.add": return o.points ? boundsOfPoints(o.points as number[][]) : (o.rect as Rect);
     default: return o.rect as Rect;
@@ -49,6 +70,7 @@ export function moveOp<T extends ContentOp>(op: T, dx: number, dy: number): T {
     case "text.add": case "text.edit": { const box = o.box as { rect: Rect }; return { ...op, box: { ...box, rect: mr(box.rect) } }; }
     case "ink.add": return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(mv)) };
     case "shape.add": return o.points ? { ...op, points: (o.points as number[][]).map(mv) } : { ...op, rect: mr(o.rect as Rect) };
+    case "annot.add": return o.point ? { ...op, point: mv(o.point as number[]) } : op; // markup stays on its text
     default: return { ...op, rect: mr(o.rect as Rect) };
   }
 }
@@ -62,10 +84,25 @@ export function resizeOp<T extends ContentOp>(op: T, to: Rect): T {
     case "text.add": case "text.edit": { const box = o.box as { rect: Rect }; return { ...op, box: { ...box, rect: { ...box.rect, x: to.x, y: to.y, w: to.w } } }; }
     case "ink.add": return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(sc)) };
     case "shape.add": return o.points ? { ...op, points: (o.points as number[][]).map(sc) } : { ...op, rect: to };
+    case "annot.add": return op;
     default: return { ...op, rect: to };
   }
 }
 
+/** A check/cross centred on `at`, kept on the page. */
+export function symbolAt(kind: SymbolAdd["kind"], [x, y]: Pt, style: ToolStyle, pageKey: string, id: string, page: { width: number; height: number }): SymbolAdd {
+  const s = SYMBOL_SIZE;
+  const rx = Math.min(Math.max(x - s / 2, 0), Math.max(page.width - s, 0));
+  const ry = Math.min(Math.max(y - s / 2, 0), Math.max(page.height - s, 0));
+  return { id, type: "symbol.add", pageKey, kind, rect: { x: rx, y: ry, w: s, h: s }, color: style.symbolColor };
+}
+
+/** An empty sticky note whose icon's top-left corner is `at` (kept on the page). */
+export function noteAt([x, y]: Pt, style: ToolStyle, pageKey: string, id: string, page: { width: number; height: number }): AnnotAdd {
+  const point: [number, number] = [Math.min(x, Math.max(page.width - NOTE_SIZE, 0)), Math.min(y, Math.max(page.height - NOTE_SIZE, 0))];
+  return { id, type: "annot.add", pageKey, kind: "note", point, color: style.noteColor, content: "" };
+}
+
 export function createFromDrag(tool: DragTool, a: Pt, b: Pt, style: ToolStyle, pageKey: string, id: string): ContentOp | null {
   const r = normalizeRect(a, b);
   if (tool === "line" || tool === "arrow") {
```

Modify `apps/web/src/lib/restore.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/restore.ts
+++ b/apps/web/src/lib/restore.ts
@@ -10,6 +10,12 @@ function validSrc(src: unknown): boolean {
   return typeof b === "object" && b !== null && isNum(b.width) && isNum(b.height);
 }
 
+/** Form values of a draft: a plain object of string/boolean values (M1/M2 drafts have none). */
+function validForms(forms: unknown): Record<string, string | boolean> {
+  if (typeof forms !== "object" || forms === null || Array.isArray(forms)) return {};
+  return Object.fromEntries(Object.entries(forms).filter(([, v]) => typeof v === "string" || typeof v === "boolean"));
+}
+
 export function restoreDraft(draft: EditorDoc | null, docId: string, pageCount: number): EditorDoc | null {
   if (!draft || !Array.isArray(draft.pages) || draft.pages.length === 0) return null;
   const pages = [];
@@ -22,5 +28,5 @@ export function restoreDraft(draft: EditorDoc | null, docId: string, pageCount:
       pages.push(p);
     }
   }
-  return { ...draft, pages };
+  return { ...draft, pages, forms: validForms(draft.forms) };
 }
```

Modify `apps/web/src/lib/strings.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -71,6 +71,63 @@ export const t = {
     originalFont: (name: string) => `${name} (asli)`,
     revert: "Kembalikan teks asli",
     scanned: "Halaman ini berupa gambar; OCR belum tersedia",
+    overflow: "Teks lebih panjang dari paragraf asli dan bisa menimpa teks di bawahnya",
+    unsupported: "beberapa karakter tidak didukung font ini",
+  },
+  annot: {
+    markup: "Penanda",
+    highlight: "Stabilo",
+    underline: "Garis bawah",
+    strike: "Coret",
+    check: "Centang",
+    cross: "Silang",
+    note: "Catatan",
+    noteContent: "Isi catatan",
+    link: "Link",
+    signature: "Tanda Tangan",
+    stamp: "Stamp",
+    uploadImage: "Unggah gambar",
+    noText: "Tidak ada teks asli yang bisa ditandai di halaman ini",
+  },
+  link: {
+    title: "Tambah link",
+    toUrl: "Ke URL",
+    toPage: "Ke halaman",
+    url: "Alamat web",
+    page: "Halaman tujuan",
+    pageN: (n: number) => `Halaman ${n}`,
+    save: "Simpan link",
+    cancel: "Batal",
+    invalidUrl: "Masukkan alamat web yang valid",
+  },
+  stamp: {
+    title: "Pilih stamp",
+    presets: "Standar",
+    custom: "Kustom",
+    text: "Teks stamp",
+    date: "Tanggal",
+    time: "Jam",
+    add: "Tambahkan stamp",
+  },
+  signature: {
+    title: "Tanda tangan",
+    draw: "Gambar",
+    type: "Ketik",
+    upload: "Unggah",
+    clear: "Bersihkan",
+    name: "Nama Anda",
+    font: "Gaya tulisan",
+    save: "Simpan tanda tangan",
+    saved: "Tanda tangan tersimpan",
+    use: "Pakai tanda tangan",
+    remove: "Hapus tanda tangan tersimpan",
+    add: "Tambahkan",
+    tooBig: "Tanda tangan ini terlalu besar untuk disimpan di browser",
+    colors: { "#111111": "Hitam", "#1d4ed8": "Biru", "#b91c1c": "Merah" } as Record<string, string>,
+  },
+  form: {
+    flatten: "Ratakan form",
+    flattenHint: "Isian form menjadi bagian halaman dan tidak bisa diubah lagi",
   },
   find: {
     open: "Cari",
```

Modify `apps/web/src/store/editor.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/store/editor.ts
+++ b/apps/web/src/store/editor.ts
@@ -1,19 +1,26 @@
 import { createStore, type StoreApi } from "zustand/vanilla";
 import { useStore } from "zustand";
 import type { ContentOp, TextEdit } from "@edith/ops";
+import type { FormField } from "@/lib/api";
 import { normRotation, type PageGeom, type Rotation } from "@/lib/coords";
 import { newId } from "@/lib/id";
 
 export interface StructurePage { index: number; width: number; height: number; rotation: number; hasText: boolean }
-export interface DocInfo { docId: string; sha256: string; fileName: string; pages: StructurePage[] }
+export interface DocInfo { docId: string; sha256: string; fileName: string; pages: StructurePage[]; fields?: FormField[] }
 export type PageSrc = { doc: string; index: number } | { blank: { width: number; height: number } };
 export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation }
-export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[] }
-export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan";
+export type FormValue = string | boolean;
+/** `forms`: AcroForm values the user set, by field name (sent as form.set ops); absent in M1/M2 drafts. */
+export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue> }
+export type MarkupTool = "highlight" | "underline" | "strike";
+export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan"
+  | MarkupTool | "check" | "cross" | "note" | "link";
 export interface ToolStyle {
   stroke: string; fill: string | null; width: number; color: string;
   fontFamily: string; fontSize: number; bold: boolean; italic: boolean;
   align: "left" | "center" | "right" | "justify";
+  /** Colors of new text markup, symbols and notes. */
+  markup: Record<MarkupTool, string>; symbolColor: string; noteColor: string;
 }
 
 export interface EditorState {
@@ -26,6 +33,8 @@ export interface EditorState {
   /** Adds or replaces several objects as one undo step (Replace All). */
   putObjects(ops: ContentOp[]): void;
   deleteObject(id: string): void;
+  /** Sets AcroForm field `name` (every widget of that name); `coalesce` as in updateObject (typing). */
+  setFormValue(name: string, value: FormValue, opts?: { coalesce?: string }): void;
   rotatePage(pageKey: string, delta: 90 | -90): void;
   deletePage(pageKey: string): void;
   insertBlankAfter(pageKey: string | null): string;
@@ -39,9 +48,10 @@ export const HISTORY_LIMIT = 100;
 export const COALESCE_MS = 1000;
 const A4 = { width: 595, height: 842 };
 const EMPTY: EditorDoc = { pages: [], objects: {}, order: [] };
-const DEFAULT_STYLE: ToolStyle = {
+export const DEFAULT_STYLE: ToolStyle = {
   stroke: "#e11d48", fill: null, width: 2, color: "#111111",
   fontFamily: "Arimo", fontSize: 14, bold: false, italic: false, align: "left",
+  markup: { highlight: "#ffeb3b", underline: "#e11d48", strike: "#e11d48" }, symbolColor: "#1d4ed8", noteColor: "#facc15",
 };
 
 export function pageGeom(entry: PageEntry, info: DocInfo): PageGeom {
@@ -148,6 +158,10 @@ export function createEditorStore(now: () => number = Date.now): StoreApi<Editor
         if (get().selection === id) set({ selection: null });
       },
 
+      setFormValue(name, value, opts) {
+        commit((d) => (d.forms?.[name] === value ? d : { ...d, forms: { ...d.forms, [name]: value } }), opts?.coalesce);
+      },
+
       rotatePage(key, delta) {
         mapPage(key, (p) => ({ ...p, rotate: normRotation(p.rotate + delta) }));
       },
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run src/lib/compact.test.ts src/lib/restore.test.ts src/lib/objects.test.ts src/store/editor.test.ts`
Expected: `Tests  42 passed (42)`.

- [ ] **Step 5: Full check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: `Tests  176 passed (176)`; tsc prints nothing; eslint reports no problems. API untouched (`cd apps/api && uv run pytest -q` still `295 passed`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/compact.test.ts apps/web/src/lib/compact.ts apps/web/src/lib/objects.test.ts apps/web/src/lib/objects.ts apps/web/src/lib/restore.test.ts apps/web/src/lib/restore.ts apps/web/src/lib/strings.ts apps/web/src/store/editor.test.ts apps/web/src/store/editor.ts
git commit -m "feat(web): M3 tools, form values, link compaction and annotation geometry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
