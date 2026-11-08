# Task 15: Imported PDFs: text edits, original fonts and form values at export

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 14 leaves, new files are complete.

**Goal:** Owner decision 1 (API side): `text.edit` works on imported pages (paragraphs from that PDF), original fonts name their PDF (`OriginalFont.doc`), and `form.set` may target an imported PDF's field by its own name (`FormSet.doc`) — applied to that PDF *before* `insert_pdf`, so PyMuPDF's renaming of colliding names (`"name [xref]"`) does not matter.

**Files:**
- Modify: `apps/api/edith/bake/__init__.py`
- Modify: `apps/api/edith/bake/pages.py`
- Modify: `apps/api/edith/bake/source.py`
- Modify: `apps/api/edith/bake/text.py`
- Modify: `apps/api/edith/ops.py`
- Modify: `apps/api/tests/test_bake_imports.py`
- Modify: `apps/api/tests/test_ops.py`
- Regenerate: `packages/ops/schema.json`
- Regenerate: `packages/ops/src/types.ts`

**Interfaces:**
- Consumes: Task 4 `load_source`, `_insert_imports`; M2 `SourcePages`, `run_font`.
- Produces:
- `ops.DocId`; `OriginalFont.doc: DocId | None`; `FormSet.doc: DocId | None`; at most one `form.set` per `(doc, fieldName)`.
- `SourcePages(main_id, source, page_src: pageKey → (doc, index) | None, load)`; `.paragraph(pageKey, id)`; `.font(ref, doc=None)`; an expired import raises `DocExpired(doc_id=…)`, an unknown one makes the paragraph unknown (`invalid_op`).
- `bake()` memoizes `load_source` (each import read once); `build_pages(doc, layout, layout_index, ctx, import_forms)`; main-document `form.set` ops (doc none or the edited id) are filled after the page rebuild as before.
- TS (generated): `OriginalFont.doc?`, `FormSet.doc?`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/test_bake_imports.py`:

```diff
--- a/apps/api/tests/test_bake_imports.py
+++ b/apps/api/tests/test_bake_imports.py
@@ -3,12 +3,12 @@ import pytest
 
 from edith.bake import bake
 from edith.bake.context import BakeContext
-from edith.errors import DocExpired, DocNotFound, InvalidOp
+from edith.errors import BakeFailed, DocExpired, DocNotFound, InvalidOp
 from edith.fonts import FontRegistry
 from edith.forms import extract_fields
 from edith.ops import ExportRequest
 from edith.settings import Settings
-from tests.pdfs import make_pdf
+from tests.pdfs import make_fonts_pdf, make_pdf
 
 MAIN, IMP = "M" * 22, "I" * 22
 
@@ -101,15 +101,71 @@ def test_link_to_a_duplicated_page_goes_to_the_duplicate():
     assert [ln["page"] for ln in saved[0].get_links()] == [2]
 
 
-def test_text_edit_on_an_imported_page_is_invalid():
-    ctx = ctx_with({IMP: make_pdf(pages=1)})
-    box = {"rect": {"x": 72, "y": 60, "w": 100, "h": 14}, "lineHeight": 14, "paragraphs": [[]], "layout": []}
+ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}
+
+
+def edit(page_key: str, paragraph: str, text: str, font=ARIMO, op_id: str = "e") -> dict:
+    box = {"rect": {"x": 72, "y": 57, "w": 200, "h": 17}, "lineHeight": 16.8,
+           "paragraphs": [[{"text": text, "font": font, "size": 14, "color": "#111111"}]],
+           "layout": [{"baseline": 15, "segments": [{"x": 0, "text": text, "runIndex": 0}]}]}
+    return {"id": op_id, "type": "text.edit", "pageKey": page_key, "paragraphId": paragraph, "box": box}
+
+
+def test_text_edit_on_imported_pages():
+    ctx = ctx_with({IMP: make_pdf(pages=2)})
+    out = bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 1), page("u-b", IMP, 1)),
+                                      edit("u-a", "g0", "Diganti")), ctx)
+    assert texts(out) == ["Page 0", "Diganti", "Page 1"]  # only the edited copy; the main page is untouched
+
+
+def test_text_edit_of_an_unknown_paragraph_on_an_imported_page_is_invalid():
     with pytest.raises(InvalidOp) as e:
-        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)),
-                                    {"id": "e", "type": "text.edit", "pageKey": "u-a", "paragraphId": "g0", "box": box}), ctx)
+        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), edit("u-a", "g9", "x")),
+             ctx_with({IMP: make_pdf(pages=1)}))
     assert e.value.extra["op_index"] == 1
 
 
+def test_original_fonts_name_their_document():
+    imported = make_fonts_pdf()
+    src = pymupdf.open(stream=imported, filetype="pdf")
+    ref = next(f"f{f[0]}" for f in src[0].get_fonts(full=True) if "Arimo" in f[3])
+    font = {"kind": "original", "ref": ref, "doc": IMP}
+    out = bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), edit("u-a", "g2", "Arimo asli", font)),
+               ctx_with({IMP: imported}))
+    assert "Arimo asli" in out[1].get_text()
+    assert any("Arimo" in f[3] for f in out[1].get_fonts(full=True))
+    with pytest.raises(BakeFailed):  # the same ref without `doc` means the edited PDF, which has no such font
+        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), edit("u-a", "g2", "x", {**font, "doc": None})),
+             ctx_with({IMP: imported}))
+
+
+def test_expired_import_named_while_checking_text_edits():
+    with pytest.raises(DocExpired) as e:
+        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), edit("u-a", "g0", "x")), ctx_with({IMP: None}))
+    assert e.value.extra["doc_id"] == IMP
+
+
+def test_form_set_of_an_imported_field_survives_the_rename():
+    ctx = ctx_with({IMP: form_pdf("name", "IMPORTED", "Import")})
+    out = bake(form_pdf("name", "MAIN", "Main"), ops(
+        layout(page("o0", MAIN, 0), page("u-a", IMP, 0), page("u-b", IMP, 0)),
+        {"id": "f1", "type": "form.set", "fieldName": "name", "value": "Utama"},
+        {"id": "f2", "type": "form.set", "fieldName": "name", "value": "Impor", "doc": IMP}), ctx)
+    saved = pymupdf.open(stream=out.tobytes(), filetype="pdf")
+    fields = [(f["name"], f["value"], f["page"]) for f in extract_fields(saved)]
+    assert fields[0] == ("name", "Utama", 0)
+    assert [f[1:] for f in fields[1:]] == [("Impor", 1), ("Impor", 2)]  # both copies of the imported page
+    assert all(f[0].startswith("name [") for f in fields[1:])
+
+
+def test_form_set_of_an_imported_field_with_a_wrong_value_names_the_op():
+    with pytest.raises(BakeFailed) as e:
+        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)),
+                                    {"id": "f2", "type": "form.set", "fieldName": "name", "value": True, "doc": IMP}),
+             ctx_with({IMP: form_pdf("name", "x", "Import")}))
+    assert e.value.extra["op_id"] == "f2"
+
+
 def test_import_page_out_of_range_or_unknown_doc_is_invalid():
     for sources, pages in (({IMP: make_pdf(pages=1)}, [page("u-a", IMP, 1)]), ({}, [page("u-a", IMP, 0)])):
         with pytest.raises(InvalidOp) as e:
```

Modify `apps/api/tests/test_ops.py`:

```diff
--- a/apps/api/tests/test_ops.py
+++ b/apps/api/tests/test_ops.py
@@ -209,3 +209,15 @@ def test_layout_crop_needs_positive_size():
     for crop in ({"x": 0, "y": 0, "w": 0, "h": 10}, {"x": -1, "y": 0, "w": 10, "h": 10}):
         with pytest.raises(ValidationError):
             PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": [{**page, "crop": crop}]})
+
+
+def test_form_set_and_original_fonts_may_name_a_document():
+    ok = [{"id": "a", "type": "form.set", "fieldName": "n", "value": "x"},
+          {"id": "b", "type": "form.set", "fieldName": "n", "value": "y", "doc": "IMPORTED"}]
+    ExportRequest.model_validate({"ops": ok})
+    with pytest.raises(ValidationError):
+        ExportRequest.model_validate({"ops": [*ok, {"id": "c", "type": "form.set", "fieldName": "n", "value": "z", "doc": "IMPORTED"}]})
+    run = {"text": "x", "size": 10, "color": "#000000"}
+    assert Run.model_validate({**run, "font": {"kind": "original", "ref": "f3", "doc": "IMPORTED"}}).font.doc == "IMPORTED"
+    with pytest.raises(ValidationError):
+        Run.model_validate({**run, "font": {"kind": "original", "ref": "f3", "doc": "../x"}})
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_bake_imports.py tests/test_ops.py`
Expected: FAIL: `doc` rejected by `extra=forbid`; text.edit on imported pages invalid

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/__init__.py`:

```diff
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -41,6 +41,16 @@ def _run(handler, page, op, ctx) -> None:
         raise BakeFailed(str(exc), op_id=op.id) from exc
 
 
+def _memo(load):
+    cache: dict[str, bytes] = {}
+
+    def cached(doc_id: str) -> bytes:
+        if doc_id not in cache:
+            cache[doc_id] = load(doc_id)
+        return cache[doc_id]
+    return cached
+
+
 CROP_SLACK = 0.01  # pt: a crop this far past the page edge is clamped, not rejected
 
 
@@ -80,12 +90,19 @@ def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False
         if layout is None:
             layout = _default_layout(doc.page_count, ctx.doc_id)
 
-        pages_src = SourcePages(source, {
-            p.pageKey: (p.src.index if isinstance(p.src, DocSrc) and p.src.doc == ctx.doc_id
-                        and p.src.index < doc.page_count else None)
-            for p in layout.pages
-        })
+        # Each imported PDF is read once, by SourcePages (text.edit, original fonts) and build_pages alike.
+        if ctx.load_source is not None:
+            ctx = replace(ctx, load_source=_memo(ctx.load_source))
+        pages_src = SourcePages(ctx.doc_id, source, {
+            p.pageKey: (p.src.doc, p.src.index) if isinstance(p.src, DocSrc) else None for p in layout.pages
+        }, ctx.load_source)
         ctx = replace(ctx, source=pages_src)
+        forms = [op for op in ops if op.type == "form.set"]
+        main_forms = [op for op in forms if op.doc in (None, ctx.doc_id)]
+        import_forms: dict[str, list] = defaultdict(list)
+        for op in forms:
+            if op.doc not in (None, ctx.doc_id):
+                import_forms[op.doc].append(op)
 
         keys = {p.pageKey for p in layout.pages}
         content = [(i, op) for i, op in enumerate(ops) if op.type not in ("pages.layout", "form.set")]
@@ -99,7 +116,7 @@ def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False
             if op.type == "link.add" and isinstance(op.target, PageTarget) and op.target.pageKey not in keys:
                 raise InvalidOp(f"link to unknown pageKey {op.target.pageKey}", op_index=i)
 
-        key_to_index, base_rotation = build_pages(doc, layout, layout_index, ctx)
+        key_to_index, base_rotation = build_pages(doc, layout, layout_index, ctx, import_forms)
         ctx = replace(ctx, page_index=key_to_index)
         crops = [_crop_rect(doc[i], entry.crop, layout_index) if entry.crop else None for i, entry in enumerate(layout.pages)]
 
@@ -131,7 +148,7 @@ def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False
                     if PHASE[op.type] == phase and not (phase != "draw" and under_redaction(op, boxes)):
                         _run(HANDLERS[op.type], page, op, ctx)
 
-        _fill(doc, [op for op in ops if op.type == "form.set"], flatten_forms, widgets_removed)
+        _fill(doc, main_forms, flatten_forms, widgets_removed)
 
         # Crop and rotation last: neither moves the content (spec: Urutan bake 7). Annotations, links and
         # widgets the crop hides entirely go (owner decision); a removed widget makes the XFA stale.
```

Modify `apps/api/edith/bake/pages.py`:

```diff
--- a/apps/api/edith/bake/pages.py
+++ b/apps/api/edith/bake/pages.py
@@ -1,16 +1,17 @@
 import pymupdf
 
 from edith.bake.context import BakeContext
-from edith.errors import DocExpired, DocNotFound, InvalidOp
-from edith.forms import detach_acroform, reattach_acroform, widget_xrefs
+from edith.errors import BakeFailed, DocExpired, DocNotFound, InvalidOp
+from edith.forms import FieldValueError, detach_acroform, drop_xfa, fill_forms, reattach_acroform, widget_xrefs
 from edith.ops import DocSrc, PagesLayout
 
 
 def _insert_imports(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
-                    ctx: BakeContext) -> dict[str, tuple[int, int]]:
+                    ctx: BakeContext, forms: dict[str, list] | None = None) -> dict[str, tuple[int, int]]:
     """Appends every other document the layout uses (imported PDFs), whole and once each; returns doc id →
     (index of its first page in `doc`, its page count). insert_pdf() copies annotations, links and form fields; a field whose
-    name the document already has is renamed ("name [xref]"), so it stays a separate field."""
+    name the document already has is renamed ("name [xref]"), so it stays a separate field — which is why the
+    import's own form.set ops (`forms[doc id]`, by its own field names) are applied before inserting it."""
     spans: dict[str, tuple[int, int]] = {}
     for entry in layout.pages:
         if not isinstance(entry.src, DocSrc) or entry.src.doc == ctx.doc_id or entry.src.doc in spans:
@@ -26,6 +27,12 @@ def _insert_imports(doc: pymupdf.Document, layout: PagesLayout, layout_index: in
             raise DocExpired(f"imported document {doc_id} expired", doc_id=doc_id) from None
         src = pymupdf.open(stream=data, filetype="pdf")
         try:
+            if forms and forms.get(doc_id):
+                drop_xfa(src)
+                try:
+                    fill_forms(src, forms[doc_id])
+                except FieldValueError as exc:
+                    raise BakeFailed(str(exc), op_id=exc.op_id) from exc
             spans[doc_id] = (doc.page_count, src.page_count)
             doc.insert_pdf(src)
         finally:
@@ -34,9 +41,9 @@ def _insert_imports(doc: pymupdf.Document, layout: PagesLayout, layout_index: in
 
 
 def build_pages(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
-                ctx: BakeContext) -> tuple[dict[str, int], list[int]]:
+                ctx: BakeContext, import_forms: dict[str, list] | None = None) -> tuple[dict[str, int], list[int]]:
     source_count = doc.page_count
-    spans = {ctx.doc_id: (0, source_count), **_insert_imports(doc, layout, layout_index, ctx)}
+    spans = {ctx.doc_id: (0, source_count), **_insert_imports(doc, layout, layout_index, ctx, import_forms)}
     acroform = detach_acroform(doc)  # after the imports: one may have brought the document's first form
     copies: dict[int, int] = {}  # widget made by fullcopy_page -> the widget it was copied from
     seen: set[int] = set()
```

Modify `apps/api/edith/bake/source.py`:

```diff
--- a/apps/api/edith/bake/source.py
+++ b/apps/api/edith/bake/source.py
@@ -1,38 +1,68 @@
+from collections.abc import Callable
+
 import pymupdf
 
 from edith.doc_fonts import load_font
+from edith.errors import DocExpired, DocNotFound
 from edith.paragraphs import extract_paragraphs
 
 
 class SourcePages:
-    """Read-only view of the uploaded PDF, for ops that refer to its original content: paragraphs
-    (`text.edit`) and embedded fonts (`FontRef` kind "original"). Paragraph ids come from the same
-    extraction GET /documents/{id}/text uses, run on the untouched source file."""
+    """Read-only views of the uploaded PDFs a layout uses — the edited one and imported ones — for ops that
+    refer to their original content: paragraphs (`text.edit`) and embedded fonts (`FontRef` kind "original",
+    whose `doc` names an imported PDF; none = the edited one). Paragraph ids come from the same extraction
+    GET /documents/{id}/text uses, run on the untouched source file."""
+
+    def __init__(self, main_id: str, source: bytes, page_src: dict[str, tuple[str, int] | None],
+                 load: Callable[[str], bytes] | None = None):
+        self._main = main_id
+        self._docs: dict[str, pymupdf.Document | None] = {main_id: pymupdf.open(stream=source, filetype="pdf")}
+        self._load = load
+        self._page_src = page_src  # pageKey → (doc id, source page index); None for blank pages
+        self._paragraphs: dict[tuple[str, int], dict[str, dict]] = {}
+        self._fonts: dict[tuple[str, str], pymupdf.Font] = {}
 
-    def __init__(self, source: bytes, page_src: dict[str, int | None]):
-        self._doc = pymupdf.open(stream=source, filetype="pdf")
-        self._page_src = page_src  # pageKey → source page index (None for blank pages)
-        self._paragraphs: dict[int, dict[str, dict]] = {}
-        self._fonts: dict[str, pymupdf.Font] = {}
+    def _doc(self, doc_id: str) -> pymupdf.Document | None:
+        """The document, opened on first use; None when it is unknown. An expired one raises DocExpired naming it."""
+        if doc_id not in self._docs:
+            doc = None
+            if self._load is not None:
+                try:
+                    doc = pymupdf.open(stream=self._load(doc_id), filetype="pdf")
+                except DocNotFound:
+                    doc = None
+                except DocExpired:
+                    raise DocExpired(f"imported document {doc_id} expired", doc_id=doc_id) from None
+            self._docs[doc_id] = doc
+        return self._docs[doc_id]
 
     def paragraph(self, page_key: str, paragraph_id: str) -> dict | None:
-        index = self._page_src.get(page_key)
-        if index is None:
+        src = self._page_src.get(page_key)
+        if src is None:
+            return None
+        doc = self._doc(src[0])
+        if doc is None or src[1] >= doc.page_count:
             return None
-        if index not in self._paragraphs:
-            self._paragraphs[index] = {p["id"]: p for p in extract_paragraphs(self._doc[index])}
-        return self._paragraphs[index].get(paragraph_id)
+        if src not in self._paragraphs:
+            self._paragraphs[src] = {p["id"]: p for p in extract_paragraphs(doc[src[1]])}
+        return self._paragraphs[src].get(paragraph_id)
 
-    def font(self, ref: str) -> pymupdf.Font:
-        if ref not in self._fonts:
-            font = load_font(self._doc, int(ref[1:])) if self._is_font(int(ref[1:])) else None
+    def font(self, ref: str, doc_id: str | None = None) -> pymupdf.Font:
+        key = (doc_id or self._main, ref)
+        if key not in self._fonts:
+            doc = self._doc(key[0])
+            xref = int(ref[1:])
+            font = load_font(doc, xref) if doc is not None and self._is_font(doc, xref) else None
             if font is None:
-                raise ValueError(f"font {ref} is not a reusable font of this document")
-            self._fonts[ref] = font
-        return self._fonts[ref]
+                raise ValueError(f"font {ref} is not a reusable font of document {key[0]}")
+            self._fonts[key] = font
+        return self._fonts[key]
 
-    def _is_font(self, xref: int) -> bool:
-        return any(entry[0] == xref for page in self._doc for entry in page.get_fonts(full=True))
+    @staticmethod
+    def _is_font(doc: pymupdf.Document, xref: int) -> bool:
+        return any(entry[0] == xref for page in doc for entry in page.get_fonts(full=True))
 
     def close(self) -> None:
-        self._doc.close()
+        for doc in self._docs.values():
+            if doc is not None:
+                doc.close()
```

Modify `apps/api/edith/bake/text.py`:

```diff
--- a/apps/api/edith/bake/text.py
+++ b/apps/api/edith/bake/text.py
@@ -45,7 +45,7 @@ def run_font(run: Run, ctx) -> pymupdf.Font:
     if run.font.kind == "original":
         if ctx.source is None:
             raise ValueError("original fonts need the source document")
-        return ctx.source.font(run.font.ref)
+        return ctx.source.font(run.font.ref, run.font.doc)
     return ctx.fonts.font(run.font.family, run.font.bold, run.font.italic)
```

Modify `apps/api/edith/ops.py`:

```diff
--- a/apps/api/edith/ops.py
+++ b/apps/api/edith/ops.py
@@ -29,10 +29,15 @@ class BundledFont(Model):
     italic: bool = False
 
 
+DocId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
+
+
 class OriginalFont(Model):
-    """A font embedded in the uploaded PDF (`ref` from GET /documents/{id}/text), reused as is."""
+    """A font embedded in an uploaded PDF (`ref` from GET /documents/{id}/text), reused as is. `doc`: the
+    imported PDF it comes from (xref-based refs are only unique per document); none = the edited PDF."""
     kind: Literal["original"]
     ref: str = Field(pattern=r"^f\d+$")
+    doc: DocId | None = None
 
 
 FontRef = Union[BundledFont, OriginalFont]
@@ -248,11 +253,14 @@ class AnnotAdd(_Content):
 
 class FormSet(Model):
     """Value of AcroForm field `fieldName` (every widget of that name): text/combo/list -> the string,
-    checkbox -> bool, radio -> the on-state name of the chosen button (or "Off")."""
+    checkbox -> bool, radio -> the on-state name of the chosen button (or "Off"). `doc`: a field of that
+    imported PDF, named as in its own structure (the export may rename it when the name is taken); none =
+    the edited PDF."""
     id: OpId
     type: Literal["form.set"]
     fieldName: str = Field(min_length=1, max_length=500)
     value: str | bool
+    doc: DocId | None = None
 
 
 class DocSrc(Model):
@@ -316,9 +324,9 @@ def _check_ops(ops: list) -> None:
     edited = [(op.pageKey, op.paragraphId) for op in ops if op.type == "text.edit"]
     if len(edited) != len(set(edited)):
         raise ValueError("at most one text.edit per (pageKey, paragraphId)")
-    fields = [op.fieldName for op in ops if op.type == "form.set"]
+    fields = [(op.doc, op.fieldName) for op in ops if op.type == "form.set"]
     if len(fields) != len(set(fields)):
-        raise ValueError("at most one form.set per fieldName")
+        raise ValueError("at most one form.set per (doc, fieldName)")
 
 
 class ExportRequest(Model):
```

Then regenerate (never edit by hand): `cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops`.

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q && npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: API 362 passed; web 274 passed (new TS fields are optional)

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/bake/__init__.py apps/api/edith/bake/pages.py apps/api/edith/bake/source.py apps/api/edith/bake/text.py apps/api/edith/ops.py apps/api/tests/test_bake_imports.py apps/api/tests/test_ops.py packages/ops/schema.json packages/ops/src/types.ts
git commit -m "feat(api): edit text, reuse fonts and fill fields of imported PDFs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
