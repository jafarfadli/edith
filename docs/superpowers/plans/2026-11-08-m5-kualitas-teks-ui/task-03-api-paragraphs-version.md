# Task 3: Paragraph segmentation version in GET /text and in export requests

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Paragraph ids are positions (`g0`, `g1`, …) in one segmentation, and Task 2 changed it: an M4 draft's `text.edit` for `g5` would now replace a different paragraph. This task versions the segmentation: `PARAGRAPHS_VERSION = 2` in `edith/paragraphs.py`, returned by GET /documents/{id}/text as `paragraphsVersion`, and an optional `paragraphs_version` on `ExportRequest`/`RenderPageRequest` (None = a client from before M5 = version 1). The API only accepts the field here; Task 14 makes the web send it and the API refuse `text.edit` ops of another version (doing that now would break every export of the M4 web until Task 14).

**Files:**
- Modify: `apps/api/edith/ops.py`
- Modify: `apps/api/edith/paragraphs.py`
- Modify: `apps/api/edith/routes/text.py`
- Modify: `apps/api/tests/test_export.py`
- Modify: `apps/api/tests/test_paragraphs.py`
- Modify: `apps/api/tests/test_text.py`
- Modify: `packages/ops/schema.json` (generated — see Step 3)
- Modify: `packages/ops/src/types.ts` (generated — see Step 3)

**Interfaces:**
- Consumes: Task 2's segmentation.
- Produces: `edith.paragraphs.PARAGRAPHS_VERSION = 2` (shared contract with `PARAGRAPHS_VERSION` in `apps/web/src/lib/api.ts`, Task 14); `/text` → `{doc_id, paragraphsVersion, pages, fonts}`; `ExportRequest.paragraphs_version: int | None`, `RenderPageRequest.paragraphs_version: int | None`; `@edith/ops` types gain `paragraphs_version?: number | null`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/test_export.py`:

```diff
diff --git a/apps/api/tests/test_export.py b/apps/api/tests/test_export.py
index cc436d8..9efe6b2 100644
--- a/apps/api/tests/test_export.py
+++ b/apps/api/tests/test_export.py
@@ -126,11 +126,11 @@ def test_export_text_edit(client):
     edit = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0", "box": {
         "rect": R(72, 88, 300, 16), "lineHeight": 12, "paragraphs": [[run]],
         "layout": [{"baseline": 12, "segments": [{"x": 0, "text": "Diganti", "runIndex": 0}]}]}}
-    r = client.post(f"/documents/{doc_id}/export", json={"ops": [edit]})
+    r = client.post(f"/documents/{doc_id}/export", json={"ops": [edit], "paragraphs_version": 2})
     assert r.status_code == 200, r.text
     text = pymupdf.open(stream=r.content, filetype="pdf")[0].get_text()
     assert "Diganti" in text and "diedit" not in text and "tetangga" in text
-    r = client.post(f"/documents/{doc_id}/export", json={"ops": [{**edit, "paragraphId": "g9"}]})
+    r = client.post(f"/documents/{doc_id}/export", json={"ops": [{**edit, "paragraphId": "g9"}], "paragraphs_version": 2})
     assert r.status_code == 422 and r.json()["error"] == {"code": "invalid_op", "message": "no paragraph g9 on o0", "op_index": 0}
```

Modify `apps/api/tests/test_paragraphs.py`:

```diff
diff --git a/apps/api/tests/test_paragraphs.py b/apps/api/tests/test_paragraphs.py
index 8fd8cd0..a6050d7 100644
--- a/apps/api/tests/test_paragraphs.py
+++ b/apps/api/tests/test_paragraphs.py
@@ -113,6 +113,11 @@ def test_line_ending_in_space_excludes_it_from_end():
     assert [(ln["start"], ln["end"]) for ln in p["lines"]] == [(0, 8), (9, 13)]
 
 
+def test_paragraphs_version_is_pinned():
+    from edith.paragraphs import PARAGRAPHS_VERSION
+    assert PARAGRAPHS_VERSION == 2  # shared with apps/web/src/lib/paragraphs.ts; bump both when ids can change
+
+
 def test_form_table_segments_like_a_form():
     assert [text(p) for p in paragraphs(make_form_table_pdf())] == [
         "<How to fill out this form>",                    # ended early: a hard break
```

Modify `apps/api/tests/test_text.py`:

```diff
diff --git a/apps/api/tests/test_text.py b/apps/api/tests/test_text.py
index 06ceeba..2def836 100644
--- a/apps/api/tests/test_text.py
+++ b/apps/api/tests/test_text.py
@@ -62,6 +62,7 @@ def test_paragraphs_per_page(client):
     page = body["pages"][0]
     assert page["index"] == 0
     assert [p["id"] for p in page["paragraphs"]] == [f"g{i}" for i in range(8)]
+    assert body["paragraphsVersion"] == 2
 
 
 def test_font_bytes(client):
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_paragraphs.py tests/test_text.py tests/test_export.py`

Expected: FAIL — no `PARAGRAPHS_VERSION`, no `paragraphsVersion` in /text, and `paragraphs_version` is an extra field (422). Spike output (last lines):

```
E       ImportError: cannot import name 'PARAGRAPHS_VERSION' from 'edith.paragraphs' (<repo>/apps/api/edith/paragraphs.py)
tests/test_paragraphs.py:117: ImportError
E       KeyError: 'paragraphsVersion'
tests/test_text.py:65: KeyError
E       AssertionError: {"error":{"code":"invalid_request","message":"body.paragraphs_version: Extra inputs are not permitted"}}
tests/test_export.py:130: AssertionError
FAILED tests/test_paragraphs.py::test_paragraphs_version_is_pinned - ImportEr...
FAILED tests/test_text.py::test_paragraphs_per_page - KeyError: 'paragraphsVe...
FAILED tests/test_export.py::test_export_text_edit - AssertionError: {"error"...
3 failed, 41 passed in 0.50s
```

- [ ] **Step 3: Implement**

Modify `apps/api/edith/ops.py`:

```diff
diff --git a/apps/api/edith/ops.py b/apps/api/edith/ops.py
index 53980ba..7e37df2 100644
--- a/apps/api/edith/ops.py
+++ b/apps/api/edith/ops.py
@@ -333,6 +333,8 @@ class ExportRequest(Model):
     ops: list[Op] = Field(max_length=MAX_OPS)
     flatten_forms: bool = False
     filename: str = Field(default="document.pdf", max_length=200)
+    # Paragraph segmentation the client's text.edit ids come from (GET /text paragraphsVersion); None = before M5 (1).
+    paragraphs_version: int | None = None
 
     @model_validator(mode="after")
     def _ops(self):
@@ -343,6 +345,7 @@ class ExportRequest(Model):
 class RenderPageRequest(Model):
     pageKey: PageKey
     ops: list[Op] = Field(max_length=MAX_OPS)
+    paragraphs_version: int | None = None  # as ExportRequest.paragraphs_version
 
     @model_validator(mode="after")
     def _ops(self):
```

Modify `apps/api/edith/paragraphs.py`:

```diff
diff --git a/apps/api/edith/paragraphs.py b/apps/api/edith/paragraphs.py
index b750d80..c0edc1f 100644
--- a/apps/api/edith/paragraphs.py
+++ b/apps/api/edith/paragraphs.py
@@ -8,6 +8,9 @@ import pymupdf
 
 from edith.rules import Rules, page_rules
 
+# Version of the segmentation: paragraph ids (g0, g1, …) of a page change when it does. Shared contract with
+# apps/web/src/lib/paragraphs.ts (drafts and exports carry it; 1 = M1–M4, 2 = rule/hard-break aware, M5).
+PARAGRAPHS_VERSION = 2
 # No TEXT_PRESERVE_LIGATURES: "ﬁ" comes out as "fi", which every font can draw.
 FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
 GAP_FACTOR = 1.5     # a gap larger than this × the block's usual line spacing starts a paragraph
```

Modify `apps/api/edith/routes/text.py`:

```diff
diff --git a/apps/api/edith/routes/text.py b/apps/api/edith/routes/text.py
index 43ce0d8..17bf19d 100644
--- a/apps/api/edith/routes/text.py
+++ b/apps/api/edith/routes/text.py
@@ -6,6 +6,7 @@ from edith.chars import page_chars
 from edith.doc_fonts import font_bytes
 from edith.errors import DocExpired, FontNotFound, PageNotFound
 from edith.extract import extract_text, open_pdf
+from edith.paragraphs import PARAGRAPHS_VERSION
 
 router = APIRouter()
 
@@ -24,7 +25,7 @@ def _open_source(request: Request, doc_id: str):
 def get_text(request: Request, doc_id: str) -> dict:
     doc = _open_source(request, doc_id)
     try:
-        return {"doc_id": doc_id, **extract_text(doc, request.app.state.fonts)}
+        return {"doc_id": doc_id, "paragraphsVersion": PARAGRAPHS_VERSION, **extract_text(doc, request.app.state.fonts)}
     finally:
         doc.close()
```

Regenerate the schema and the TypeScript types (never edit them by hand):

```bash
cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops
```

`packages/ops/src/types.ts` gains `paragraphs_version?: ParagraphsVersion` on `ExportRequest` and `RenderPageRequest`.

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q` → 385 passed. `npx tsc --noEmit -p apps/web` → clean. After committing: `npm run check -w packages/ops` → clean.

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add apps/api/edith/ops.py apps/api/edith/paragraphs.py apps/api/edith/routes/text.py apps/api/tests/test_export.py apps/api/tests/test_paragraphs.py apps/api/tests/test_text.py packages/ops/schema.json packages/ops/src/types.ts
git commit -m "feat(api): paragraph segmentation version in GET /text and in export requests" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
