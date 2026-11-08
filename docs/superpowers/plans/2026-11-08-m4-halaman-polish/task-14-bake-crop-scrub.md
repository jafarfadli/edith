# Task 14: Crop removes the annotations, links and widgets it hides

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 13 leaves, new files are complete.

**Goal:** Owner decision 4: before setting a page's CropBox, every annotation, link and form widget lying entirely outside the crop is deleted (ones the crop cuts through stay); when a widget goes, the XFA packet is dropped (as after a redaction scrub).

**Files:**
- Modify: `apps/api/edith/bake/__init__.py`
- Modify: `apps/api/edith/bake/scrub.py`
- Modify: `apps/api/tests/test_bake_crop.py`

**Interfaces:**
- Consumes: Task 5 crop; M3 `bake/scrub.py`, `forms.drop_xfa`.
- Produces:
- `scrub.scrub_outside(page, crop: pymupdf.Rect) -> int` (widgets removed), sharing `_scrub(page, doomed)` with `scrub_page`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/test_bake_crop.py`:

```diff
--- a/apps/api/tests/test_bake_crop.py
+++ b/apps/api/tests/test_bake_crop.py
@@ -84,3 +84,49 @@ def test_crop_on_blank_page(ctx):
     blank = {"pageKey": "u-b", "src": {"blank": {"width": 300, "height": 300}}, "crop": {"x": 10, "y": 10, "w": 100, "h": 50}}
     out = bake(make_pdf(pages=1), ops(layout(page("o0", 0), blank)), ctx)
     assert (out[1].rect.width, out[1].rect.height) == (100, 50)
+
+
+def annotated_pdf(xfa: bool = False) -> bytes:
+    """A4 page: a note, a highlight, a link and a text field inside (100–200) and outside (450–550) the
+    crop (60, 40, 300, 300); a second highlight straddles the crop's right edge (340–380)."""
+    doc = pymupdf.open()
+    page = doc.new_page(width=595, height=842)
+    for y, name in ((100, "inside"), (450, "outside")):
+        page.add_text_annot((100, y), name)
+        page.add_highlight_annot(pymupdf.Rect(100, y + 20, 180, y + 34))
+        page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(100, y + 40, 180, y + 54), "uri": f"https://{name}.example"})
+        w = pymupdf.Widget()
+        w.field_type, w.field_name, w.rect = pymupdf.PDF_WIDGET_TYPE_TEXT, name, pymupdf.Rect(100, y + 60, 250, y + 76)
+        page.add_widget(w)
+    page.add_highlight_annot(pymupdf.Rect(340, 120, 380, 134))
+    if xfa:
+        stream = doc.get_new_xref()
+        doc.update_object(stream, "<<>>")
+        doc.update_stream(stream, b"<xdp:xdp/>")
+        doc.xref_set_key(doc.pdf_catalog(), "AcroForm/XFA", f"{stream} 0 R")
+    return doc.tobytes()
+
+
+def test_crop_removes_what_it_hides_entirely(ctx):
+    out = reopened(bake(annotated_pdf(), ops(layout(page("o0", 0, crop=(60, 40, 300, 300)))), ctx))
+    p = out[0]
+    assert sorted(a.type[1] for a in p.annots()) == ["Highlight", "Highlight", "Text"]  # inside + straddling
+    assert [ln["uri"] for ln in p.get_links()] == ["https://inside.example"]
+    assert [w.field_name for w in p.widgets()] == ["inside"]
+    assert out.is_form_pdf
+
+
+def test_uncropped_pages_keep_everything(ctx):
+    out = reopened(bake(annotated_pdf(), ops(layout(page("o0", 0), page("u-d", 0, crop=(60, 40, 300, 300)))), ctx))
+    assert len(list(out[0].widgets())) == 2 and len(out[0].get_links()) == 2
+    assert len(list(out[1].widgets())) == 1
+
+
+def test_crop_that_removes_widgets_drops_xfa(ctx):
+    def xfa(data: bytes) -> str:
+        d = pymupdf.open(stream=data, filetype="pdf")
+        return d.xref_get_key(d.pdf_catalog(), "AcroForm/XFA")[0]
+    src = annotated_pdf(xfa=True)
+    assert xfa(src) == "xref"
+    assert xfa(bake(src, ops(layout(page("o0", 0, crop=(60, 40, 300, 300)))), ctx).tobytes()) == "null"
+    assert xfa(bake(src, ops(layout(page("o0", 0, crop=(60, 40, 500, 700)))), ctx).tobytes()) == "xref"  # nothing removed
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_bake_crop.py`
Expected: FAIL: `test_crop_removes_what_it_hides_entirely` (the outside note/highlight/link/widget are still there)

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/__init__.py`:

```diff
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -6,7 +6,7 @@ import pymupdf
 from edith.bake.context import BakeContext
 from edith.bake.pages import build_pages
 from edith.bake.registry import HANDLERS, PHASE, TEXT_REDACTIONS
-from edith.bake.scrub import scrub_page, under_redaction
+from edith.bake.scrub import scrub_outside, scrub_page, under_redaction
 from edith.bake.source import SourcePages
 from edith.bake.text import links_under_redactions, restore_links
 from edith.bake.transform import draw_transformed
@@ -133,12 +133,17 @@ def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False
 
         _fill(doc, [op for op in ops if op.type == "form.set"], flatten_forms, widgets_removed)
 
-        # Crop and rotation last: neither moves the content (spec: Urutan bake 7).
+        # Crop and rotation last: neither moves the content (spec: Urutan bake 7). Annotations, links and
+        # widgets the crop hides entirely go (owner decision); a removed widget makes the XFA stale.
+        cropped_widgets = 0
         for i, entry in enumerate(layout.pages):
             if crops[i] is not None:
+                cropped_widgets += scrub_outside(doc[i], crops[i])
                 cb = doc[i].cropbox  # MediaBox coordinates, top-left origin
                 doc[i].set_cropbox(crops[i] + (cb.x0, cb.y0, cb.x0, cb.y0))
             doc[i].set_rotation((base_rotation[i] + entry.rotate) % 360)
+        if cropped_widgets:
+            drop_xfa(doc)
         return doc
     except BaseException:
         doc.close()
```

Modify `apps/api/edith/bake/scrub.py`:

```diff
--- a/apps/api/edith/bake/scrub.py
+++ b/apps/api/edith/bake/scrub.py
@@ -18,6 +18,16 @@ def _hits(rect: pymupdf.Rect, boxes: list[pymupdf.Rect]) -> bool:
 def scrub_page(page: pymupdf.Page, boxes: list[pymupdf.Rect]) -> int:
     """Deletes every annotation, form widget and link of `page` that touches one of `boxes`; returns how
     many widgets went."""
+    return _scrub(page, lambda r: _hits(r, boxes))
+
+
+def scrub_outside(page: pymupdf.Page, crop: pymupdf.Rect) -> int:
+    """Deletes every annotation, form widget and link of `page` lying entirely outside `crop` (owner decision:
+    a crop removes what it hides; what it cuts through stays); returns how many widgets went."""
+    return _scrub(page, lambda r: not r.intersects(crop))
+
+
+def _scrub(page: pymupdf.Page, doomed) -> int:
     widgets = 0
     for xref, kind, *_ in page.annot_xrefs():
         if kind == pymupdf.PDF_ANNOT_POPUP:
@@ -27,7 +37,7 @@ def scrub_page(page: pymupdf.Page, boxes: list[pymupdf.Rect]) -> int:
         except Exception as exc:  # noqa: BLE001
             log.warning("cannot load annotation %s on page %s: %s", xref, page.number, exc)
             continue
-        if annot is None or not _hits(annot.rect, boxes):
+        if annot is None or not doomed(annot.rect):
             continue
         if kind == pymupdf.PDF_ANNOT_WIDGET:
             page.delete_widget(annot)
@@ -35,7 +45,7 @@ def scrub_page(page: pymupdf.Page, boxes: list[pymupdf.Rect]) -> int:
         else:
             page.delete_annot(annot)
     for link in page.get_links():
-        if _hits(link["from"], boxes):
+        if doomed(link["from"]):
             page.delete_link(link)
     return widgets
```


- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q`
Expected: 356 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/bake/__init__.py apps/api/edith/bake/scrub.py apps/api/tests/test_bake_crop.py
git commit -m "feat(api): remove what a crop hides entirely" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
