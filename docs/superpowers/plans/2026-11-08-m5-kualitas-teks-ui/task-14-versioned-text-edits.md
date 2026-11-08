# Task 14: Versioned text edits: the web sends and stamps the segmentation version, the API refuses others, stale draft edits are dropped

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Finish what Task 3 started. The web sends `paragraphs_version: PARAGRAPHS_VERSION` (2) with every export and page render (inside `exportPdf`/`renderPage`, so callers don't change), stamps saved drafts with it, and on restore drops `text.edit` ops of a draft with another (or no = M1–M4) stamp, telling the user once (`t.editor.textEditsDropped`, an error notice that stays). The API refuses `text.edit` ops whose request carries another version (409 `text_outdated` with `op_index`; a tab opened before the update gets `t.errors.text_outdated`: reload). Requests without text edits are accepted with any version. The web fixture `text.json` is regenerated with the new segmentation: the address of `make_layout_pdf` now arrives as two paragraphs, so its two M2 tests are rewritten (the hard-break mapping is tested on a synthetic paragraph).

**Files:**
- Modify: `apps/api/edith/errors.py`
- Modify: `apps/api/edith/routes/export.py`
- Modify: `apps/api/tests/test_export.py`
- Modify: `apps/web/src/components/editor/Editor.tsx`
- Modify: `apps/web/src/lib/api.test.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/draft.test.ts`
- Modify: `apps/web/src/lib/draft.ts`
- Modify: `apps/web/src/lib/fixtures/text.json` (generated — see Step 3)
- Modify: `apps/web/src/lib/paragraphs.test.ts`
- Modify: `apps/web/src/lib/restore.test.ts`
- Modify: `apps/web/src/lib/restore.ts`
- Modify: `apps/web/src/lib/strings.ts`
- Modify: `apps/web/src/store/editor.ts`

**Interfaces:**
- Consumes: Task 3 (`PARAGRAPHS_VERSION`, `paragraphs_version` fields, `paragraphsVersion` in /text); Task 8's `exportPdf` (timeout signal, kept).
- Produces: `PARAGRAPHS_VERSION` and `TextData.paragraphsVersion?` in `lib/api.ts`; `EditorDoc.paragraphsVersion?` (stored drafts only); `dropStaleTextEdits(doc) -> { doc, dropped }` in `lib/restore.ts`; `edith.errors.TextOutdated` (409 `text_outdated`); strings `t.editor.textEditsDropped`, `t.errors.text_outdated`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/test_export.py`:

```diff
diff --git a/apps/api/tests/test_export.py b/apps/api/tests/test_export.py
index 4d3d509..deba6f7 100644
--- a/apps/api/tests/test_export.py
+++ b/apps/api/tests/test_export.py
@@ -194,3 +194,21 @@ def test_export_with_a_cjk_fallback_font_stays_small(tmp_path):
     out = pymupdf.open(stream=r.content, filetype="pdf")
     assert "한국어 텍스트" in out[0].get_text()
     assert len(r.content) < 100_000  # the fallback file is 4 MB
+
+
+@pytest.mark.parametrize("version", [None, 1, 3])
+def test_text_edits_of_another_segmentation_version_are_refused(client, version):
+    """Ids g0, g1, … are positions in one segmentation: a draft or tab from before an update would edit
+    the wrong paragraph."""
+    from tests.pdfs import make_edit_pdf
+    doc_id = client.post("/documents", files={"file": ("e.pdf", make_edit_pdf(), "application/pdf")}).json()["doc_id"]
+    run = {"text": "Diganti", "font": {"kind": "bundled", "family": "Arimo"}, "size": 12, "color": "#000000"}
+    edit = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0", "box": {
+        "rect": R(72, 88, 300, 16), "lineHeight": 12, "paragraphs": [[run]],
+        "layout": [{"baseline": 12, "segments": [{"x": 0, "text": "Diganti", "runIndex": 0}]}]}}
+    body = {"ops": [edit]} if version is None else {"ops": [edit], "paragraphs_version": version}
+    for path in ("export", "render-page"):
+        r = client.post(f"/documents/{doc_id}/{path}", json={**body, **({"pageKey": "o0"} if path == "render-page" else {})})
+        assert r.status_code == 409 and r.json()["error"]["code"] == "text_outdated"
+        assert r.json()["error"]["op_index"] == 0
+    assert client.post(f"/documents/{doc_id}/export", json={"ops": []}).status_code == 200  # no text.edit: any version
```

Modify `apps/web/src/lib/api.test.ts`:

```diff
diff --git a/apps/web/src/lib/api.test.ts b/apps/web/src/lib/api.test.ts
index 2d2d4c4..818548d 100644
--- a/apps/web/src/lib/api.test.ts
+++ b/apps/web/src/lib/api.test.ts
@@ -1,5 +1,5 @@
 import { afterEach, describe, expect, it, vi } from "vitest";
-import { ApiError, exportPdf, getStructure, uploadDocument } from "@/lib/api";
+import { ApiError, exportPdf, getStructure, PARAGRAPHS_VERSION, renderPage, uploadDocument } from "@/lib/api";
 
 afterEach(() => vi.unstubAllGlobals());
 
@@ -56,4 +56,13 @@ describe("api client", () => {
     const blob = await exportPdf("x", { ops: [], flatten_forms: false, filename: "a.pdf" });
     expect(await blob.text()).toBe("%PDF-1.7");
   });
+
+  it("sends the paragraph segmentation version with exports and page renders", async () => {
+    expect(PARAGRAPHS_VERSION).toBe(2); // shared with apps/api/edith/paragraphs.py
+    const fn = mockFetch(200, "%PDF-1.7", "application/pdf");
+    await exportPdf("x", { ops: [] });
+    await renderPage("x", { pageKey: "o0", ops: [] });
+    const bodies = (fn.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));
+    expect(bodies).toEqual([{ paragraphs_version: 2, ops: [] }, { paragraphs_version: 2, pageKey: "o0", ops: [] }]);
+  });
 });
```

Modify `apps/web/src/lib/draft.test.ts`:

```diff
diff --git a/apps/web/src/lib/draft.test.ts b/apps/web/src/lib/draft.test.ts
index ba58d7c..2a12793 100644
--- a/apps/web/src/lib/draft.test.ts
+++ b/apps/web/src/lib/draft.test.ts
@@ -14,7 +14,7 @@ describe("draft", () => {
   it("round-trips and clears", () => {
     const doc = { pages: [], objects: {}, order: ["x"] };
     saveDraft("h", doc);
-    expect(loadDraft("h")).toEqual(doc);
+    expect(loadDraft("h")).toEqual({ ...doc, paragraphsVersion: 2 }); // stamped: see dropStaleTextEdits
     clearDraft("h");
     expect(loadDraft("h")).toBeNull();
   });
```

Modify `apps/web/src/lib/paragraphs.test.ts`:

```diff
diff --git a/apps/web/src/lib/paragraphs.test.ts b/apps/web/src/lib/paragraphs.test.ts
index 76a5b29..b68bcf4 100644
--- a/apps/web/src/lib/paragraphs.test.ts
+++ b/apps/web/src/lib/paragraphs.test.ts
@@ -35,10 +35,11 @@ describe("paragraphBox", () => {
     expect(box.rect.x).toBe(p.rect.x);
   });
 
-  it("splits hand-broken lines into logical paragraphs", () => {
-    const address = paragraphs.find((p) => p.runs[0].text.startsWith("Jl."))!;
-    const box = paragraphBox(address, bundled);
-    expect(box.paragraphs.map((ps) => ps.map((r) => r.text).join(""))).toEqual(["Jl. Merdeka Barat No. 17, Jakarta Pusat", "Indonesia"]);
+  it("gets hand-broken lines as paragraphs of their own from the API (segmentation version 2)", () => {
+    // "Jl. Merdeka Barat No. 17, Jakarta" / "Pusat" / "Indonesia": "Pusat" ended early, so "Indonesia" is a paragraph.
+    const texts = paragraphs.map((p) => runsText(p.runs));
+    expect(texts).toContain("Jl. Merdeka Barat No. 17, Jakarta Pusat");
+    expect(texts).toContain("Indonesia");
   });
 
   it("keeps wrapped lines in one logical paragraph", () => {
@@ -60,13 +61,16 @@ describe("paragraphBox", () => {
   });
 
   it("applies an edit to the logical paragraphs before layout", () => {
-    const address = paragraphs.find((p) => p.runs[0].text.startsWith("Jl."))!;
-    const raw = runsText(address.runs).indexOf("Indonesia");
-    const box = paragraphBox(address, bundled, (ps, toBox) => {
-      expect(toBox(raw)).toBe(runsText(ps[0]).length + 1); // start of the second logical paragraph
-      return [ps[0], [{ ...ps[1][0], text: "RI" }]];
+    // "ab-" / "cd" / "ef" again, in a box 10 units wide: three logical paragraphs.
+    const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
+    const line = (start: number, end: number, y: number) => ({ rect: { x: 0, y, w: 3, h: 1 }, baseline: y + 1, size: 1, start, end });
+    const p: Paragraph = { id: "g0", rect: { x: 0, y: 0, w: 10, h: 3 }, lines: [line(0, 3, 0), line(3, 5, 1), line(6, 8, 2)],
+      runs: [{ text: "ab-cd ef", font: { kind: "bundled", family: "Arimo" }, size: 1, color: "#000000" }], align: "left", lineHeight: 1, editable: true };
+    const box = paragraphBox(p, () => mono, (ps, toBox) => {
+      expect(toBox(6)).toBe(7); // "e": start of the third logical paragraph ("ab-\ncd\nef")
+      return [ps[0], ps[1], [{ ...ps[2][0], text: "RI" }]];
     });
-    expect(box.paragraphs.map((ps) => ps.map((r) => r.text).join(""))).toEqual(["Jl. Merdeka Barat No. 17, Jakarta Pusat", "RI"]);
+    expect(box.paragraphs.map((ps) => ps.map((r) => r.text).join(""))).toEqual(["ab-", "cd", "RI"]);
     expect(box.layout).toHaveLength(3);
   });
 });
```

Modify `apps/web/src/lib/restore.test.ts`:

```diff
diff --git a/apps/web/src/lib/restore.test.ts b/apps/web/src/lib/restore.test.ts
index 1f0b68e..b8b3054 100644
--- a/apps/web/src/lib/restore.test.ts
+++ b/apps/web/src/lib/restore.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import { ApiError } from "@/lib/api";
-import { resolveImports, restoreDraft } from "@/lib/restore";
+import { dropStaleTextEdits, resolveImports, restoreDraft } from "@/lib/restore";
 
 describe("restoreDraft", () => {
   const draft = {
@@ -97,3 +97,32 @@ describe("restoreDraft keeps imported field values", () => {
     expect(restoreDraft(draft as never, "NEW", 1)!.importForms).toEqual({ [I]: { nama: "Budi" } });
   });
 });
+
+describe("dropStaleTextEdits", () => {
+  const box = { rect: { x: 0, y: 0, w: 10, h: 10 }, lineHeight: 12, paragraphs: [], layout: [] };
+  const doc = {
+    pages: [{ pageKey: "o0", src: { doc: "D", index: 0 }, rotate: 0 as const }],
+    objects: {
+      e: { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g3", box },
+      w: { id: "w", type: "whiteout.add", pageKey: "o0", rect: { x: 0, y: 0, w: 5, h: 5 } },
+    },
+    order: ["e", "w"],
+  } as unknown as Parameters<typeof dropStaleTextEdits>[0];
+
+  it("drops text edits of drafts from another segmentation (unstamped = version 1) and keeps the rest", () => {
+    for (const stamp of [undefined, 1, 3]) {
+      const { doc: out, dropped } = dropStaleTextEdits({ ...doc, paragraphsVersion: stamp });
+      expect(dropped).toBe(1);
+      expect(out.order).toEqual(["w"]);
+      expect(Object.keys(out.objects)).toEqual(["w"]);
+      expect(out).not.toHaveProperty("paragraphsVersion");
+    }
+  });
+
+  it("keeps text edits of the current segmentation", () => {
+    const { doc: out, dropped } = dropStaleTextEdits({ ...doc, paragraphsVersion: 2 });
+    expect(dropped).toBe(0);
+    expect(out.order).toEqual(["e", "w"]);
+    expect(out).not.toHaveProperty("paragraphsVersion");
+  });
+});
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd apps/api && uv run pytest -q tests/test_export.py); npm test -w apps/web -- src/lib/api.test.ts src/lib/draft.test.ts src/lib/restore.test.ts`

Expected: FAIL — the API accepts stale versions; the web has no `PARAGRAPHS_VERSION`/`dropStaleTextEdits`. Spike output (last lines):

```
      Tests  4 failed | 17 passed (21)
 FAIL  src/lib/api.test.ts > api client > sends the paragraph segmentation version with exports and page renders
AssertionError: expected undefined to be 2 // Object.is equality
 FAIL  src/lib/draft.test.ts > draft > round-trips and clears
AssertionError: expected { pages: [], objects: {}, …(1) } to deeply equal { pages: [], objects: {}, …(2) }
 FAIL  src/lib/restore.test.ts > dropStaleTextEdits > drops text edits of drafts from another segmentation (unstamped = version 1) and keeps the rest
TypeError: (0 , dropStaleTextEdits) is not a function
 FAIL  src/lib/restore.test.ts > dropStaleTextEdits > keeps text edits of the current segmentation
npm error Lifecycle script `test` failed with error:
npm error command failed
```

- [ ] **Step 3: Implement**

Modify `apps/api/edith/errors.py`:

```diff
diff --git a/apps/api/edith/errors.py b/apps/api/edith/errors.py
index 9c75ce0..9cbcb08 100644
--- a/apps/api/edith/errors.py
+++ b/apps/api/edith/errors.py
@@ -58,6 +58,11 @@ class InvalidOp(EdithError):
     status, code = 422, "invalid_op"
 
 
+class TextOutdated(EdithError):
+    """text.edit ops name paragraphs of another segmentation version (a draft or tab from before an update)."""
+    status, code = 409, "text_outdated"
+
+
 class BakeFailed(EdithError):
     status, code = 500, "bake_failed"
```

Modify `apps/api/edith/routes/export.py`:

```diff
diff --git a/apps/api/edith/routes/export.py b/apps/api/edith/routes/export.py
index 9d5c4bd..b3a1874 100644
--- a/apps/api/edith/routes/export.py
+++ b/apps/api/edith/routes/export.py
@@ -7,8 +7,9 @@ from fastapi import APIRouter, Request, Response
 
 from edith.bake import bake
 from edith.bake.context import BakeContext
-from edith.errors import DocExpired, InvalidOp
+from edith.errors import DocExpired, InvalidOp, TextOutdated
 from edith.ops import ExportRequest, RenderPageRequest
+from edith.paragraphs import PARAGRAPHS_VERSION
 
 router = APIRouter()
 
@@ -66,8 +67,19 @@ def _page_index(ops: list, page_key: str, page_count: int) -> int:
     raise InvalidOp(f"unknown pageKey {page_key}")
 
 
+def _check_text_version(body: ExportRequest | RenderPageRequest) -> None:
+    """Paragraph ids are positions in one segmentation: ids of another version name other paragraphs."""
+    if (body.paragraphs_version or 1) == PARAGRAPHS_VERSION:
+        return
+    for i, op in enumerate(body.ops):
+        if op.type == "text.edit":
+            raise TextOutdated(f"paragraph ids of version {body.paragraphs_version or 1}, not {PARAGRAPHS_VERSION}",
+                               op_index=i)
+
+
 @router.post("/documents/{doc_id}/export")
 def export(request: Request, doc_id: str, body: ExportRequest) -> Response:
+    _check_text_version(body)
     source = _read_source(request, doc_id)
     doc = bake(source, body.ops, _ctx(request, doc_id), flatten_forms=body.flatten_forms, subset_fonts=True)
     try:
@@ -84,6 +96,7 @@ def export(request: Request, doc_id: str, body: ExportRequest) -> Response:
 
 @router.post("/documents/{doc_id}/render-page")
 def render_page(request: Request, doc_id: str, body: RenderPageRequest) -> Response:
+    _check_text_version(body)
     storage = request.app.state.storage
     source = _read_source(request, doc_id)
     index = _page_index(body.ops, body.pageKey, storage.meta(doc_id).page_count)
```

Modify `apps/web/src/components/editor/Editor.tsx`:

```diff
diff --git a/apps/web/src/components/editor/Editor.tsx b/apps/web/src/components/editor/Editor.tsx
index d13fc9b..b921be2 100644
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -11,7 +11,7 @@ import { loadDraft, saveDraft } from "@/lib/draft";
 import { noticeStore, type NoticeMsg } from "@/lib/notices";
 import { isTextOp, moveOp } from "@/lib/objects";
 import { destroyPdf, loadPdf } from "@/lib/pdf";
-import { resolveImports, restoreDraft } from "@/lib/restore";
+import { dropStaleTextEdits, resolveImports, restoreDraft } from "@/lib/restore";
 import { errorMessage, t } from "@/lib/strings";
 import { createDebounced } from "@/lib/autosave";
 import { boxFonts } from "@/lib/textbox";
@@ -64,6 +64,9 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
       }
       if (cancelled) return;
       let draft = restoreDraft(loadDraft(st.sha256), docId, st.page_count);
+      // Text edits from before a segmentation change name other paragraphs now: drop them (with a notice below).
+      const stale = draft ? dropStaleTextEdits(draft) : null;
+      if (stale) draft = stale.doc;
       // Pages of imported PDFs need those documents' page sizes; imports that expired lose their pages.
       let resolved;
       try {
@@ -78,6 +81,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
       editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages, fields: st.fields, imports: resolved?.imports, importFields: resolved?.fields }, draft);
       initialDoc.current = editorStore.getState().doc;
       if (resolved?.missing) setNotice({ kind: "error", text: t.pages.importGone });
+      else if (stale?.dropped) setNotice({ kind: "error", text: t.editor.textEditsDropped });
       else if (draft) setNotice({ kind: "info", text: t.editor.restored });
       void textStore.getState().load(docId); // original paragraphs + fonts, in the background
       for (const id of Object.keys(resolved?.imports ?? {})) void textStore.getState().loadImport(id);
```

Modify `apps/web/src/lib/api.ts`:

```diff
diff --git a/apps/web/src/lib/api.ts b/apps/web/src/lib/api.ts
index 74fbd88..2f3a1ef 100644
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -3,6 +3,9 @@ import type { CharLine } from "@/lib/markup";
 import type { StructurePage } from "@/store/editor";
 
 export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
+/** Paragraph segmentation the client's paragraph ids (g0, g1, …) come from: shared contract with PARAGRAPHS_VERSION in
+ *  apps/api/edith/paragraphs.py. Exports send it (the API refuses text.edit ops of another version) and drafts store it. */
+export const PARAGRAPHS_VERSION = 2;
 
 export class ApiError extends Error {
   constructor(public code: string, public status: number, public extra: Record<string, unknown> = {}) {
@@ -23,7 +26,11 @@ export interface DocFont {
   ref: string; name: string; embedded: boolean; format: string | null; reusable: boolean;
   family: string; bold: boolean; italic: boolean; substitute: BundledFont;
 }
-export interface TextData { doc_id: string; pages: { index: number; paragraphs: Paragraph[] }[]; fonts: DocFont[] }
+export interface TextData {
+  doc_id: string; pages: { index: number; paragraphs: Paragraph[] }[]; fonts: DocFont[];
+  /** Segmentation version (2 since M5); absent in fixtures built from extract_text directly. */
+  paragraphsVersion?: number;
+}
 
 /** One AcroForm widget (GET /documents/{id}/structure). Radio buttons of a group share `name`. */
 export interface FormField {
@@ -98,7 +105,7 @@ export function assetUrl(docId: string, assetId: string): string {
 export const EXPORT_TIMEOUT_MS = 120_000;
 
 export async function exportPdf(docId: string, body: ExportRequest): Promise<Blob> {
-  const res = await request(`/documents/${docId}/export`, { ...json(body), signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS) });
+  const res = await request(`/documents/${docId}/export`, { ...json({ paragraphs_version: PARAGRAPHS_VERSION, ...body }), signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS) });
   try {
     return await res.blob();
   } catch (e) {
@@ -107,5 +114,5 @@ export async function exportPdf(docId: string, body: ExportRequest): Promise<Blo
 }
 
 export async function renderPage(docId: string, body: RenderPageRequest): Promise<Blob> {
-  return (await request(`/documents/${docId}/render-page`, json(body))).blob();
+  return (await request(`/documents/${docId}/render-page`, json({ paragraphs_version: PARAGRAPHS_VERSION, ...body }))).blob();
 }
```

Modify `apps/web/src/lib/draft.ts`:

```diff
diff --git a/apps/web/src/lib/draft.ts b/apps/web/src/lib/draft.ts
index 7b90138..970102c 100644
--- a/apps/web/src/lib/draft.ts
+++ b/apps/web/src/lib/draft.ts
@@ -1,3 +1,4 @@
+import { PARAGRAPHS_VERSION } from "@/lib/api";
 import type { EditorDoc } from "@/store/editor";
 
 const key = (sha: string) => `edith:draft:${sha}`;
@@ -12,8 +13,9 @@ function isEditorDoc(v: unknown): v is EditorDoc {
   );
 }
 
+/** Stores `doc` stamped with the paragraph segmentation its text.edit ids belong to (see dropStaleTextEdits). */
 export function saveDraft(sha256: string, doc: EditorDoc): void {
-  try { localStorage.setItem(key(sha256), JSON.stringify(doc)); } catch { /* storage full or blocked */ }
+  try { localStorage.setItem(key(sha256), JSON.stringify({ ...doc, paragraphsVersion: PARAGRAPHS_VERSION })); } catch { /* storage full or blocked */ }
 }
 
 export function loadDraft(sha256: string): EditorDoc | null {
```

Modify `apps/web/src/lib/restore.ts`:

```diff
diff --git a/apps/web/src/lib/restore.ts b/apps/web/src/lib/restore.ts
index 5e3feb4..4499106 100644
--- a/apps/web/src/lib/restore.ts
+++ b/apps/web/src/lib/restore.ts
@@ -1,4 +1,4 @@
-import { ApiError, type FormField } from "@/lib/api";
+import { ApiError, PARAGRAPHS_VERSION, type FormField } from "@/lib/api";
 import type { EditorDoc, StructurePage } from "@/store/editor";
 
 const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
@@ -68,3 +68,17 @@ export async function resolveImports(
   const missing = pages.length !== doc.pages.length;
   return { doc: !pages.length ? null : missing ? { ...doc, pages } : doc, imports, fields, missing };
 }
+
+/** A restored draft without the text.edit ops of another paragraph segmentation (drafts from before M5 have none
+ *  stamped: version 1): their ids now name other paragraphs, so they would replace the wrong text. `dropped`
+ *  counts them (the editor tells the user). */
+export function dropStaleTextEdits(doc: EditorDoc): { doc: EditorDoc; dropped: number } {
+  const version = doc.paragraphsVersion ?? 1;
+  const stale = version === PARAGRAPHS_VERSION ? [] : doc.order.filter((id) => doc.objects[id]?.type === "text.edit");
+  const rest = { ...doc };
+  delete rest.paragraphsVersion; // a stamp of the stored draft, not part of the document
+  if (!stale.length) return { doc: rest, dropped: 0 };
+  const objects = { ...doc.objects };
+  for (const id of stale) delete objects[id];
+  return { doc: { ...rest, objects, order: doc.order.filter((id) => !stale.includes(id)) }, dropped: stale.length };
+}
```

Modify `apps/web/src/lib/strings.ts`:

```diff
diff --git a/apps/web/src/lib/strings.ts b/apps/web/src/lib/strings.ts
index f10e5f7..ca638ad 100644
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -63,6 +63,7 @@ export const t = {
     prevPage: "Halaman sebelumnya",
     nextPage: "Halaman berikutnya",
     restored: "Perubahan sebelumnya dipulihkan",
+    textEditsDropped: "Perubahan sebelumnya dipulihkan, kecuali suntingan teks asli: pembagian paragraf dokumen ini sudah diperbarui. Ulangi suntingan teks tersebut.",
     tools: "Alat",
     properties: "Properti",
     options: "pilihan",
@@ -209,6 +210,7 @@ export const t = {
     asset_not_found: "Gambar tidak ditemukan. Tambahkan ulang gambarnya.",
     invalid_op: "Ada perubahan yang tidak valid.",
     bake_failed: "Gagal menyimpan salah satu objek. Hapus objek yang disorot lalu coba lagi.",
+    text_outdated: "Edith diperbarui sejak halaman ini dibuka. Muat ulang halaman, lalu ulangi suntingan teks asli.",
     network: "Tidak dapat terhubung ke server. Periksa koneksi Anda.",
     timeout: "Server terlalu lama membuat PDF.",
     internal: "Server mengalami kesalahan saat membuat PDF.",
```

Modify `apps/web/src/store/editor.ts`:

```diff
diff --git a/apps/web/src/store/editor.ts b/apps/web/src/store/editor.ts
index 00d401d..51d98ae 100644
--- a/apps/web/src/store/editor.ts
+++ b/apps/web/src/store/editor.ts
@@ -19,10 +19,11 @@ export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation; cr
 export type FormValue = string | boolean;
 /** `forms`: AcroForm values the user set, by field name (sent as form.set ops); absent in M1/M2 drafts.
  *  `imports`: doc ids of imported PDFs whose pages the document has (had); absent before M4.
- *  `importForms`: values of imported PDFs' fields, by doc id then field name (form.set with `doc`). */
+ *  `importForms`: values of imported PDFs' fields, by doc id then field name (form.set with `doc`).
+ *  `paragraphsVersion`: only in stored drafts — the segmentation their text.edit paragraph ids come from (absent = 1). */
 export interface EditorDoc {
   pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue>;
-  imports?: string[]; importForms?: Record<string, Record<string, FormValue>>;
+  imports?: string[]; importForms?: Record<string, Record<string, FormValue>>; paragraphsVersion?: number;
 }
 export type MarkupTool = "highlight" | "underline" | "strike";
 export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan"
```

Regenerate the web text fixture with the new segmentation: `cd apps/api && uv run python -m scripts.text_fixture` (the address now arrives as two paragraphs; single lines carry `maxWidth`).

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q` → 425 passed. `npm test -w apps/web` → 319 passed; `npx tsc --noEmit -p apps/web`, `npm run lint -w apps/web` clean. E2E on your ports → 12 passed.

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add apps/api/edith/errors.py apps/api/edith/routes/export.py apps/api/tests/test_export.py apps/web/src/components/editor/Editor.tsx apps/web/src/lib/api.test.ts apps/web/src/lib/api.ts apps/web/src/lib/draft.test.ts apps/web/src/lib/draft.ts apps/web/src/lib/fixtures/text.json apps/web/src/lib/paragraphs.test.ts apps/web/src/lib/restore.test.ts apps/web/src/lib/restore.ts apps/web/src/lib/strings.ts apps/web/src/store/editor.ts
git commit -m "feat: paragraph segmentation version in exports and drafts; the API refuses text edits of another version, the editor drops them with a notice" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
