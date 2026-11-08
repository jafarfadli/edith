# Task 4: Bake pages of imported PDFs

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 3 leaves, new files are complete.

**Goal:** `pages.layout` may reference other uploaded documents (`src.doc` ≠ the edited one): they are appended whole once each with `insert_pdf` (annotations, links and form fields kept; colliding field names renamed by PyMuPDF), then selected/duplicated like main pages. Expired imports → 410 with `doc_id`.

**Files:**
- Modify: `apps/api/edith/bake/context.py`
- Modify: `apps/api/edith/bake/pages.py`
- Modify: `apps/api/edith/routes/export.py`
- Create: `apps/api/tests/test_bake_imports.py`
- Modify: `apps/api/tests/test_export.py`

**Interfaces:**
- Consumes: M1 `build_pages`; storage `source_path`.
- Produces:
- `BakeContext.load_source: Callable[[str], bytes] | None` (export/render routes pass `_read_source`).
- `build_pages` inserts imports before `detach_acroform` (an import may bring the first form). Unknown doc → `invalid_op` (op_index of the layout); `DocExpired(doc_id=…)` → 410 `{"error": {"code": "doc_expired", "doc_id": …}}`.
- `text.edit` on an imported page stays `invalid_op` (SourcePages only maps the main document).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_bake_imports.py`:

```python
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import DocExpired, DocNotFound, InvalidOp
from edith.fonts import FontRegistry
from edith.forms import extract_fields
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

MAIN, IMP = "M" * 22, "I" * 22


def form_pdf(name: str, value: str, label: str) -> bytes:
    """One page with text `label`, a text field `name` = `value`, a highlight and a URI link."""
    doc = pymupdf.open()
    page = doc.new_page(width=400, height=500)
    page.insert_text((72, 72), label, fontsize=12)
    w = pymupdf.Widget()
    w.field_type, w.field_name, w.rect, w.field_value = pymupdf.PDF_WIDGET_TYPE_TEXT, name, pymupdf.Rect(72, 100, 272, 120), value
    page.add_widget(w)
    page.add_highlight_annot(pymupdf.Rect(72, 60, 150, 76))
    page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 200, 150, 220), "uri": "https://example.com"})
    return doc.tobytes()


def ctx_with(sources: dict[str, bytes]) -> BakeContext:
    def load(doc_id: str) -> bytes:
        if doc_id not in sources:
            raise DocNotFound()
        if sources[doc_id] is None:
            raise DocExpired()
        return sources[doc_id]
    return BakeContext(doc_id=MAIN, asset_path=lambda a: a, fonts=FontRegistry(Settings().fonts_dir), load_source=load)


def ops(*items, **kw):
    return ExportRequest.model_validate({"ops": list(items), **kw}).ops


def layout(*pages) -> dict:
    return {"id": "L", "type": "pages.layout", "pages": list(pages)}


def page(key: str, doc: str, index: int, **kw) -> dict:
    return {"pageKey": key, "src": {"doc": doc, "index": index}, **kw}


def texts(doc) -> list[str]:
    return [" ".join(p.get_text().split()) for p in doc]


def test_imported_pages_interleave_with_the_main_document():
    ctx = ctx_with({IMP: make_pdf(pages=3, size=(300, 400), rotation=90)})
    out = bake(make_pdf(pages=2), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 2), page("o1", MAIN, 1), page("u-b", IMP, 0, rotate=90))), ctx)
    assert texts(out) == ["Page 0", "Page 2", "Page 1", "Page 0"]
    assert [p.rotation for p in out] == [0, 90, 0, 180]  # the imported page's own /Rotate plus the layout's
    assert (out[1].mediabox.width, out[1].mediabox.height) == (300, 400)


def test_content_ops_on_imported_and_duplicated_imported_pages():
    ctx = ctx_with({IMP: make_pdf(pages=1)})
    white = {"type": "whiteout.add", "rect": {"x": 60, "y": 50, "w": 120, "h": 30}}
    out = bake(make_pdf(pages=1), ops(
        layout(page("o0", MAIN, 0), page("u-a", IMP, 0), page("u-b", IMP, 0)),
        {"id": "w", "pageKey": "u-b", **white}), ctx)
    assert out.page_count == 3
    pix = out[2].get_pixmap(clip=pymupdf.Rect(75, 67, 76, 68))
    assert pix.pixel(0, 0) == (255, 255, 255)
    pix = out[1].get_pixmap(clip=pymupdf.Rect(75, 67, 76, 68))
    assert pix.pixel(0, 0) != (255, 255, 255)  # the other copy keeps its text


def test_imported_form_fields_annotations_and_links_survive_with_distinct_names():
    ctx = ctx_with({IMP: form_pdf("name", "IMPORTED", "Import")})
    out = bake(form_pdf("name", "MAIN", "Main"), ops(
        layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), {"id": "f", "type": "form.set", "fieldName": "name", "value": "Budi"}), ctx)
    saved = pymupdf.open(stream=out.tobytes(), filetype="pdf")
    fields = [(f["name"], f["value"], f["page"]) for f in extract_fields(saved)]
    assert fields[0] == ("name", "Budi", 0)
    assert fields[1][0].startswith("name [") and fields[1][1:] == ("IMPORTED", 1)  # renamed: form.set does not reach it
    assert [a.type[1] for a in saved[1].annots()] == ["Highlight"]
    assert [ln["uri"] for ln in saved[1].get_links()] == ["https://example.com"]


def test_import_brings_a_form_into_a_document_without_one():
    ctx = ctx_with({IMP: form_pdf("ok", "yes", "Import")})
    out = bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0), page("u-b", IMP, 0))), ctx)
    saved = pymupdf.open(stream=out.tobytes(), filetype="pdf")
    assert saved.is_form_pdf
    assert [(f["name"], f["page"]) for f in extract_fields(saved)] == [("ok", 1), ("ok", 2)]


def test_link_to_a_duplicated_page_goes_to_the_duplicate():
    ctx = ctx_with({})
    link = {"id": "l", "type": "link.add", "pageKey": "o0", "rect": {"x": 72, "y": 300, "w": 100, "h": 20}, "target": {"pageKey": "u-dup"}}
    out = bake(make_pdf(pages=2), ops(layout(page("o0", MAIN, 0), page("o1", MAIN, 1), page("u-dup", MAIN, 0)), link), ctx)
    saved = pymupdf.open(stream=out.tobytes(), filetype="pdf")
    assert [ln["page"] for ln in saved[0].get_links()] == [2]


def test_text_edit_on_an_imported_page_is_invalid():
    ctx = ctx_with({IMP: make_pdf(pages=1)})
    box = {"rect": {"x": 72, "y": 60, "w": 100, "h": 14}, "lineHeight": 14, "paragraphs": [[]], "layout": []}
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)),
                                    {"id": "e", "type": "text.edit", "pageKey": "u-a", "paragraphId": "g0", "box": box}), ctx)
    assert e.value.extra["op_index"] == 1


def test_import_page_out_of_range_or_unknown_doc_is_invalid():
    for sources, pages in (({IMP: make_pdf(pages=1)}, [page("u-a", IMP, 1)]), ({}, [page("u-a", IMP, 0)])):
        with pytest.raises(InvalidOp) as e:
            bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), *pages)), ctx_with(sources))
        assert e.value.extra["op_index"] == 0


def test_expired_import_names_the_document():
    with pytest.raises(DocExpired) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0))), ctx_with({IMP: None}))
    assert e.value.extra["doc_id"] == IMP
```

Modify `apps/api/tests/test_export.py`:

```diff
--- a/apps/api/tests/test_export.py
+++ b/apps/api/tests/test_export.py
@@ -132,3 +132,31 @@ def test_export_text_edit(client):
     assert "Diganti" in text and "diedit" not in text and "tetangga" in text
     r = client.post(f"/documents/{doc_id}/export", json={"ops": [{**edit, "paragraphId": "g9"}]})
     assert r.status_code == 422 and r.json()["error"] == {"code": "invalid_op", "message": "no paragraph g9 on o0", "op_index": 0}
+
+
+def test_export_with_imported_document(client):
+    doc_id = new_doc(client, pages=1)
+    imported = new_doc(client, pages=2, size=(300, 400))
+    layout = {"id": "L", "type": "pages.layout", "pages": [
+        {"pageKey": "o0", "src": {"doc": doc_id, "index": 0}},
+        {"pageKey": "u-i1", "src": {"doc": imported, "index": 1}},
+    ]}
+    r = client.post(f"/documents/{doc_id}/export", json={"ops": [layout]})
+    assert r.status_code == 200, r.text
+    out = pymupdf.open(stream=r.content, filetype="pdf")
+    assert [p.get_text().strip() for p in out] == ["Page 0", "Page 1"]
+    assert out[1].rect.width == 300
+    r = client.post(f"/documents/{doc_id}/render-page", json={"pageKey": "u-i1", "ops": [layout]})
+    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
+
+
+def test_export_with_expired_import(client):
+    doc_id = new_doc(client, pages=1)
+    imported = new_doc(client, pages=1)
+    storage = client.app.state.storage
+    storage._expire(imported)
+    layout = {"id": "L", "type": "pages.layout", "pages": [
+        {"pageKey": "o0", "src": {"doc": doc_id, "index": 0}}, {"pageKey": "u-i", "src": {"doc": imported, "index": 0}}]}
+    r = client.post(f"/documents/{doc_id}/export", json={"ops": [layout]})
+    assert r.status_code == 410
+    assert r.json()["error"]["code"] == "doc_expired" and r.json()["error"]["doc_id"] == imported
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_bake_imports.py tests/test_export.py`
Expected: FAIL: `TypeError: BakeContext.__init__() got an unexpected keyword argument 'load_source'`

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/context.py`:

```diff
--- a/apps/api/edith/bake/context.py
+++ b/apps/api/edith/bake/context.py
@@ -15,3 +15,5 @@ class BakeContext:
     fonts: FontRegistry
     source: "SourcePages | None" = None  # set by bake() for the duration of one bake
     page_index: dict[str, int] | None = None  # pageKey → output page index, set by bake() (links)
+    # Bytes of another uploaded document (an imported PDF) by doc id; raises DocExpired / DocNotFound.
+    load_source: Callable[[str], bytes] | None = None
```

Modify `apps/api/edith/bake/pages.py`:

```diff
--- a/apps/api/edith/bake/pages.py
+++ b/apps/api/edith/bake/pages.py
@@ -1,24 +1,53 @@
 import pymupdf
 
 from edith.bake.context import BakeContext
-from edith.errors import InvalidOp
+from edith.errors import DocExpired, DocNotFound, InvalidOp
 from edith.forms import detach_acroform, reattach_acroform, widget_xrefs
 from edith.ops import DocSrc, PagesLayout
 
 
+def _insert_imports(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
+                    ctx: BakeContext) -> dict[str, tuple[int, int]]:
+    """Appends every other document the layout uses (imported PDFs), whole and once each; returns doc id →
+    (index of its first page in `doc`, its page count). insert_pdf() copies annotations, links and form fields; a field whose
+    name the document already has is renamed ("name [xref]"), so it stays a separate field."""
+    spans: dict[str, tuple[int, int]] = {}
+    for entry in layout.pages:
+        if not isinstance(entry.src, DocSrc) or entry.src.doc == ctx.doc_id or entry.src.doc in spans:
+            continue
+        doc_id = entry.src.doc
+        if ctx.load_source is None:
+            raise InvalidOp(f"bad page source for {entry.pageKey}", op_index=layout_index)
+        try:
+            data = ctx.load_source(doc_id)
+        except DocNotFound:
+            raise InvalidOp(f"unknown document {doc_id} for {entry.pageKey}", op_index=layout_index) from None
+        except DocExpired:
+            raise DocExpired(f"imported document {doc_id} expired", doc_id=doc_id) from None
+        src = pymupdf.open(stream=data, filetype="pdf")
+        try:
+            spans[doc_id] = (doc.page_count, src.page_count)
+            doc.insert_pdf(src)
+        finally:
+            src.close()
+    return spans
+
+
 def build_pages(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
                 ctx: BakeContext) -> tuple[dict[str, int], list[int]]:
     source_count = doc.page_count
-    acroform = detach_acroform(doc)
+    spans = {ctx.doc_id: (0, source_count), **_insert_imports(doc, layout, layout_index, ctx)}
+    acroform = detach_acroform(doc)  # after the imports: one may have brought the document's first form
     copies: dict[int, int] = {}  # widget made by fullcopy_page -> the widget it was copied from
     seen: set[int] = set()
     selection: list[int] = []
     base_rotation: list[int] = []
     for entry in layout.pages:
         if isinstance(entry.src, DocSrc):
-            if entry.src.doc != ctx.doc_id or entry.src.index >= source_count:
+            first, count = spans.get(entry.src.doc, (0, 0))
+            if entry.src.index >= count:
                 raise InvalidOp(f"bad page source for {entry.pageKey}", op_index=layout_index)
-            idx = entry.src.index
+            idx = first + entry.src.index
             base_rotation.append(doc[idx].rotation)
             if idx in seen:
                 original = widget_xrefs(doc[idx])
```

Modify `apps/api/edith/routes/export.py`:

```diff
--- a/apps/api/edith/routes/export.py
+++ b/apps/api/edith/routes/export.py
@@ -42,6 +42,7 @@ def _ctx(request: Request, doc_id: str) -> BakeContext:
         doc_id=doc_id,
         asset_path=lambda asset_id: storage.asset_path(doc_id, asset_id),
         fonts=request.app.state.fonts,
+        load_source=lambda other: _read_source(request, other),  # imported PDFs (pages.layout src.doc)
     )
```


- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q`
Expected: 346 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/bake/context.py apps/api/edith/bake/pages.py apps/api/edith/routes/export.py apps/api/tests/test_bake_imports.py apps/api/tests/test_export.py
git commit -m "feat(api): export pages imported from other PDFs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
