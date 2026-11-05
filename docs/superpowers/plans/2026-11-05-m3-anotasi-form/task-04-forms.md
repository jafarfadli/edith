# Task 4: Forms: fields in the structure, form.set, flatten, AcroForm kept through the page rebuild

`GET /documents/{id}/structure` gains `fields[]` (one entry per widget). The bake fills `form.set` values on every widget of a field (all pages, duplicates included) and, with `flatten_forms`, turns widgets into page content with `Document.bake(annots=False, widgets=True)` — highlights, notes and links stay annotations.

**Bug found by the M3 spike (fixed here):** PyMuPDF 2.1 `Document.select()` — which `build_pages` always calls — drops `/AcroForm` from the catalog. Since M1 every export lost its form (widgets left orphaned, `is_form_pdf` false). `build_pages` now keeps the AcroForm dictionary aside and re-attaches it with `/Fields` rebuilt from the widgets still on the pages. A second issue: `fullcopy_page()` (duplicated pages) copies widgets with their `/Parent` but the parent's `/Kids` does not list the copy, and PyMuPDF then refuses `widget.update()` ("Widget is not listed in its /Parent/Kids array") — `reattach_acroform` adopts such copies.

**Files:**
- Modify: `apps/api/edith/bake/__init__.py`
- Modify: `apps/api/edith/bake/pages.py`
- Modify: `apps/api/edith/extract.py`
- Create: `apps/api/edith/forms.py`
- Modify: `apps/api/edith/routes/export.py`
- Modify: `apps/api/tests/pdfs.py`
- Create: `apps/api/tests/test_forms.py`

**Interfaces:**
- Consumes: Task 1 `FormSet`, `ExportRequest.flatten_forms` (exists since M1); M1 `build_pages`, `extract_structure`, export route; Task 3 `annot.add`/`link.add` (flatten test).
- Produces:
  - `edith.forms`: `FIELD_TYPES` (PyMuPDF widget type → `"text"|"checkbox"|"radio"|"combo"|"list"|"button"|"signature"`); `page_fields(page) -> list[dict]`, `extract_fields(doc) -> list[dict]` with entries `{name, type, value: str, onState: str|None, options: list[str]|None, page: int (source index), rect: {x,y,w,h} (unrotated CropBox pt), readOnly, multiline, fontSize (0 = auto)}`; `FieldValueError(op, message)` (`.op_id`); `fill_forms(doc, ops: list[FormSet])` (checkbox ← bool, radio ← on-state name, text/combo/list ← str; unknown names ignored); `detach_acroform(doc) -> int | None`; `reattach_acroform(doc, xref)`.
  - `bake(source, ops, ctx, flatten_forms=False)`; `form.set` failures → `BakeFailed(op_id=…)`.
  - Structure JSON: `{doc_id, sha256, page_count, pages, fields}`.
  - `tests.pdfs.make_form_pdf()`: page 0 text `nama` (72,100,272,120; fontSize 11), multiline `catatan`, checkbox `setuju` (on-state `Yes`), radio `warna` (`Merah`, `Biru`), combo `kota`, list `hari`, button `kirim`; page 1 text `hal2`.

- [ ] **Step 1: Write the failing tests**

`make_form_pdf` renames the radio on-states: PyMuPDF creates every radio button with the on-state name "False" (and `/V False` on the parent), which real PDFs never have.

Modify `apps/api/tests/pdfs.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/tests/pdfs.py
+++ b/apps/api/tests/pdfs.py
@@ -128,3 +128,40 @@ def make_layout_pdf() -> bytes:
     for i, text in enumerate(["Jl. Merdeka Barat No. 17, Jakarta", "Pusat", "Indonesia"]):  # an address: hard breaks
         page.insert_text((360, 80 + i * 13), text, fontname="helv", fontsize=11)
     return doc.tobytes(garbage=3, deflate=True)
+
+
+def _widget(page: pymupdf.Page, kind: int, name: str, rect: tuple, **attrs) -> None:
+    w = pymupdf.Widget()
+    w.field_type, w.field_name, w.rect = kind, name, pymupdf.Rect(rect)
+    for key, value in attrs.items():
+        setattr(w, key, value)
+    page.add_widget(w)
+
+
+def make_form_pdf() -> bytes:
+    """AcroForm fixture. Page 0: text `nama`, multiline text `catatan`, checkbox `setuju` (on-state
+    `Yes`), radio group `warna` (`Merah`, `Biru`), combo `kota`, list `hari`, push button `kirim`.
+    Page 1: text `hal2`. PyMuPDF names every radio on-state "False", so the fixture renames them."""
+    doc = pymupdf.open()
+    page = doc.new_page(width=595, height=842)
+    page.insert_text((72, 90), "Formulir", fontname="helv", fontsize=12)
+    _widget(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "nama", (72, 100, 272, 120), field_value="", text_fontsize=11)
+    _widget(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "catatan", (300, 100, 500, 160), field_value="",
+            field_flags=pymupdf.PDF_TX_FIELD_IS_MULTILINE)
+    _widget(page, pymupdf.PDF_WIDGET_TYPE_CHECKBOX, "setuju", (72, 140, 86, 154), field_value=False)
+    for i in range(2):
+        _widget(page, pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON, "warna", (72 + 30 * i, 170, 86 + 30 * i, 184), field_value=False)
+    _widget(page, pymupdf.PDF_WIDGET_TYPE_COMBOBOX, "kota", (72, 200, 222, 220),
+            choice_values=["Jakarta", "Bandung", "Surabaya"], field_value="Jakarta")
+    _widget(page, pymupdf.PDF_WIDGET_TYPE_LISTBOX, "hari", (72, 230, 222, 280), choice_values=["Senin", "Selasa"],
+            field_value="Senin")
+    _widget(page, pymupdf.PDF_WIDGET_TYPE_BUTTON, "kirim", (300, 200, 360, 220), button_caption="Kirim")
+    radios = [w for w in page.widgets() if w.field_name == "warna"]
+    for w, state in zip(radios, ("Merah", "Biru")):
+        off, on = doc.xref_get_key(w.xref, "AP/N/Off")[1], doc.xref_get_key(w.xref, "AP/N/False")[1]
+        doc.xref_set_key(w.xref, "AP/N", f"<</Off {off}/{state} {on}>>")
+        doc.xref_set_key(w.xref, "AS", "/Off")
+    doc.xref_set_key(int(doc.xref_get_key(radios[0].xref, "Parent")[1].split()[0]), "V", "/Off")
+    page2 = doc.new_page(width=595, height=842)
+    _widget(page2, pymupdf.PDF_WIDGET_TYPE_TEXT, "hal2", (72, 72, 272, 92), field_value="")
+    return doc.tobytes(garbage=3, deflate=True)
```

Create `apps/api/tests/test_forms.py`:
```python
import pymupdf
import pytest

from tests.pdfs import make_form_pdf, make_pdf
from tests.test_documents import upload


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


@pytest.fixture
def doc_id(client) -> str:
    return upload(client, make_form_pdf()).json()["doc_id"]


def export(client, doc_id: str, ops: list, flatten: bool = False) -> pymupdf.Document:
    r = client.post(f"/documents/{doc_id}/export", json={"ops": ops, "flatten_forms": flatten})
    assert r.status_code == 200, r.text
    return pymupdf.open(stream=r.content, filetype="pdf")


def values(doc: pymupdf.Document) -> dict[str, list]:
    out: dict[str, list] = {}
    for page in doc:
        for w in page.widgets():
            out.setdefault(w.field_name, []).append(w.field_value)
    return out


def form_set(op_id: str, name: str, value) -> dict:
    return {"id": op_id, "type": "form.set", "fieldName": name, "value": value}


def layout(doc_id: str, *indexes: int) -> dict:
    keys = {}
    pages = []
    for i in indexes:
        key = f"o{i}" if i not in keys else f"u-dup{i}"
        keys[i] = key
        pages.append({"pageKey": key, "src": {"doc": doc_id, "index": i}})
    return {"id": "L", "type": "pages.layout", "pages": pages}


def test_structure_lists_fields(client, doc_id):
    fields = client.get(f"/documents/{doc_id}/structure").json()["fields"]
    assert [(f["name"], f["type"], f["page"]) for f in fields] == [
        ("nama", "text", 0), ("catatan", "text", 0), ("setuju", "checkbox", 0), ("warna", "radio", 0), ("warna", "radio", 0),
        ("kota", "combo", 0), ("hari", "list", 0), ("kirim", "button", 0), ("hal2", "text", 1)]
    by = {(f["name"], f["onState"]): f for f in fields}
    assert by[("nama", None)] | {"rect": None} == {
        "name": "nama", "type": "text", "value": "", "onState": None, "options": None, "page": 0, "rect": None,
        "readOnly": False, "multiline": False, "fontSize": 11}
    assert by[("nama", None)]["rect"] == R(72, 100, 200, 20)
    assert by[("catatan", None)]["multiline"] is True
    assert by[("setuju", "Yes")]["value"] == "Off"
    assert {f["onState"] for f in fields if f["name"] == "warna"} == {"Merah", "Biru"}
    assert by[("kota", None)]["options"] == ["Jakarta", "Bandung", "Surabaya"] and by[("kota", None)]["value"] == "Jakarta"


def test_structure_of_pdf_without_form(client):
    doc_id = upload(client, make_pdf(pages=1)).json()["doc_id"]
    assert client.get(f"/documents/{doc_id}/structure").json()["fields"] == []


def test_fill_every_kind(client, doc_id):
    out = export(client, doc_id, [
        form_set("a", "nama", "Budi Santoso"), form_set("b", "catatan", "baris 1\nbaris 2"), form_set("c", "setuju", True),
        form_set("d", "warna", "Biru"), form_set("e", "kota", "Bandung"), form_set("f", "hari", "Selasa"),
        form_set("g", "hal2", "di halaman dua")])
    v = values(out)
    assert v["nama"] == ["Budi Santoso"] and v["catatan"] == ["baris 1\nbaris 2"] and v["setuju"] == ["Yes"]
    assert v["warna"] == ["Off", "Biru"] and v["kota"] == ["Bandung"] and v["hari"] == ["Selasa"]
    assert v["hal2"] == ["di halaman dua"]
    assert out.is_form_pdf


def test_radio_switches_and_checkbox_unchecks(client, doc_id):
    first = export(client, doc_id, [form_set("a", "warna", "Merah"), form_set("b", "setuju", False)])
    assert values(first)["warna"] == ["Merah", "Off"] and values(first)["setuju"] == ["Off"]


def test_form_survives_reorder_and_page_delete(client, doc_id):
    """Document.select() drops /AcroForm (PyMuPDF 2.1): the bake puts it back with the remaining fields."""
    out = export(client, doc_id, [layout(doc_id, 1, 0), form_set("a", "nama", "X")])
    assert out.is_form_pdf and values(out)["nama"] == ["X"]
    assert [w.field_name for w in out[0].widgets()] == ["hal2"]
    only = export(client, doc_id, [layout(doc_id, 1), form_set("a", "nama", "gone")])  # nama's page was deleted: ignored
    assert only.is_form_pdf and list(values(only)) == ["hal2"]
    kind, fields = only.xref_get_key(int(only.xref_get_key(only.pdf_catalog(), "AcroForm")[1].split()[0]), "Fields")
    assert kind == "array" and len(fields.strip("[]").split()) == 3  # one field: "x 0 R"


def test_export_without_form_ops_keeps_the_form(client, doc_id):
    out = export(client, doc_id, [])
    assert out.is_form_pdf and len(values(out)) == 8


def test_duplicated_page_shows_the_value_on_both_copies(client, doc_id):
    out = export(client, doc_id, [layout(doc_id, 0, 0), form_set("a", "nama", "Dua kali")])
    assert values(out)["nama"] == ["Dua kali", "Dua kali"]
    flat = export(client, doc_id, [layout(doc_id, 0, 0), form_set("a", "nama", "Dua kali")], flatten=True)
    assert all("Dua kali" in page.get_text() for page in flat)  # both appearances were regenerated


def test_flatten_turns_fields_into_content_and_keeps_other_annotations(client, doc_id):
    out = export(client, doc_id, [
        form_set("a", "nama", "Budi Santoso"), form_set("c", "setuju", True),
        {"id": "h", "type": "annot.add", "pageKey": "o0", "kind": "highlight", "quads": [R(72, 79.2, 60, 13.8)], "color": "#ffeb3b"},
        {"id": "l", "type": "link.add", "pageKey": "o0", "rect": R(72, 300, 100, 20), "target": {"pageKey": "o1"}},
    ], flatten=True)
    assert not out.is_form_pdf and values(out) == {}
    assert "Budi Santoso" in out[0].get_text()
    assert [a.type[1] for a in out[0].annots()] == ["Highlight"]
    assert out[0].get_links()[0]["page"] == 1


def test_wrong_value_kind_is_bake_failed(client, doc_id):
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [form_set("bad", "setuju", "ya")]})
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "bake_failed" and r.json()["error"]["op_id"] == "bad"
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest tests/test_forms.py -q`
Expected: `8 failed, 1 passed` — `KeyError: 'fields'` and `bake_failed` ("no handler for form.set"); `test_wrong_value_kind_is_bake_failed` already passes because Task 1 rejects form.set with its op id.

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/__init__.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -8,6 +8,7 @@ from edith.bake.pages import build_pages
 from edith.bake.registry import HANDLERS, PHASE, TEXT_REDACTIONS
 from edith.bake.source import SourcePages
 from edith.errors import BakeFailed, EdithError, InvalidOp
+from edith.forms import FieldValueError, fill_forms
 from edith.ops import DocSrc, LayoutPage, PageTarget, PagesLayout
 
 # Handler modules register themselves on import (later tasks add more, e.g. text):
@@ -36,7 +37,16 @@ def _run(handler, page, op, ctx) -> None:
         raise BakeFailed(str(exc), op_id=op.id) from exc
 
 
-def bake(source: bytes, ops: list, ctx: BakeContext) -> pymupdf.Document:
+def _fill(doc: pymupdf.Document, forms: list, flatten: bool) -> None:
+    try:
+        fill_forms(doc, forms)
+    except FieldValueError as exc:
+        raise BakeFailed(str(exc), op_id=exc.op_id) from exc
+    if flatten:
+        doc.bake(annots=False, widgets=True)  # widgets become page content; other annotations stay
+
+
+def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False) -> pymupdf.Document:
     doc = pymupdf.open(stream=source, filetype="pdf")
     pages_src = None
     try:
@@ -56,9 +66,6 @@ def bake(source: bytes, ops: list, ctx: BakeContext) -> pymupdf.Document:
 
         keys = {p.pageKey for p in layout.pages}
         content = [(i, op) for i, op in enumerate(ops) if op.type not in ("pages.layout", "form.set")]
-        for op in ops:
-            if op.type == "form.set":
-                raise BakeFailed("no handler for form.set", op_id=op.id)  # Task 4 fills forms
         for i, op in content:
             if op.pageKey not in keys:
                 raise InvalidOp(f"unknown pageKey {op.pageKey}", op_index=i)
@@ -92,6 +99,8 @@ def bake(source: bytes, ops: list, ctx: BakeContext) -> pymupdf.Document:
                     if PHASE[op.type] == phase:
                         _run(HANDLERS[op.type], page, op, ctx)
 
+        _fill(doc, [op for op in ops if op.type == "form.set"], flatten_forms)
+
         for i, entry in enumerate(layout.pages):
             doc[i].set_rotation((base_rotation[i] + entry.rotate) % 360)
         return doc
```

Modify `apps/api/edith/bake/pages.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/bake/pages.py
+++ b/apps/api/edith/bake/pages.py
@@ -2,12 +2,14 @@ import pymupdf
 
 from edith.bake.context import BakeContext
 from edith.errors import InvalidOp
+from edith.forms import detach_acroform, reattach_acroform
 from edith.ops import DocSrc, PagesLayout
 
 
 def build_pages(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
                 ctx: BakeContext) -> tuple[dict[str, int], list[int]]:
     source_count = doc.page_count
+    acroform = detach_acroform(doc)
     seen: set[int] = set()
     selection: list[int] = []
     base_rotation: list[int] = []
@@ -28,6 +30,7 @@ def build_pages(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
             base_rotation.append(0)
         selection.append(idx)
     doc.select(selection)
+    reattach_acroform(doc, acroform)  # select() drops /AcroForm; the widgets stay on their pages
     # Ops are in unrotated-CropBox points: draw on unrotated pages, bake() re-applies the
     # rotation (base + layout) last.
     for page in doc:
```

Modify `apps/api/edith/extract.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/extract.py
+++ b/apps/api/edith/extract.py
@@ -3,6 +3,7 @@ import pymupdf
 from edith.doc_fonts import collect_fonts, fill_substitutes, name_key, span_fonts
 from edith.errors import PdfCorrupt, PdfEncrypted, TooLarge
 from edith.fonts import FontRegistry
+from edith.forms import extract_fields
 from edith.paragraphs import extract_paragraphs
 
 
@@ -40,7 +41,7 @@ def extract_structure(doc: pymupdf.Document) -> dict:
             "rotation": page.rotation,
             "hasText": bool(page.get_text("text").strip()),
         })
-    return {"page_count": doc.page_count, "pages": pages}
+    return {"page_count": doc.page_count, "pages": pages, "fields": extract_fields(doc)}
 
 
 def extract_text(doc: pymupdf.Document, registry: FontRegistry) -> dict:
```

Create `apps/api/edith/forms.py`:
```python
"""AcroForm fields: what the editor shows (structure), filling them (form.set) and keeping the form
intact through the page rebuild of the bake."""
import pymupdf

from edith.ops import FormSet

FIELD_TYPES = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text", pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio", pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "combo",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "list", pymupdf.PDF_WIDGET_TYPE_BUTTON: "button",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "signature",
}
READ_ONLY = 1  # PDF field flag bit 1


class FieldValueError(ValueError):
    def __init__(self, op: FormSet, message: str):
        super().__init__(message)
        self.op_id = op.id


def _num(v: float) -> float:
    return round(v, 2)


def _value(w: pymupdf.Widget) -> str:
    v = w.field_value
    if isinstance(v, list):  # multi-select list box: the editor edits one value
        v = v[0] if v else ""
    if isinstance(v, bool):
        return w.on_state() if v else "Off"
    return "" if v is None else str(v)


def page_fields(page: pymupdf.Page) -> list[dict]:
    """One entry per widget, in unrotated-CropBox points. Radio buttons of one group share `name`;
    each has its own `onState` (the group's value when it is the chosen one)."""
    out = []
    for w in page.widgets():
        kind = FIELD_TYPES.get(w.field_type)
        if kind is None:
            continue
        r = w.rect
        out.append({
            "name": w.field_name, "type": kind, "value": _value(w),
            "onState": w.on_state() if kind in ("checkbox", "radio") else None,
            "options": list(w.choice_values or []) if kind in ("combo", "list") else None,
            "page": page.number,
            "rect": {"x": _num(r.x0), "y": _num(r.y0), "w": _num(r.width), "h": _num(r.height)},
            "readOnly": bool(w.field_flags & READ_ONLY),
            "multiline": kind == "text" and bool(w.field_flags & pymupdf.PDF_TX_FIELD_IS_MULTILINE),
            "fontSize": _num(w.text_fontsize or 0),  # 0 = auto
        })
    return out


def extract_fields(doc: pymupdf.Document) -> list[dict]:
    return [f for page in doc for f in page_fields(page)]


def fill_forms(doc: pymupdf.Document, ops: list[FormSet]) -> None:
    """Sets every widget named by a form.set op and regenerates its appearance. Names no page has any
    more (the page was deleted) are ignored. Raises FieldValueError on a value of the wrong kind."""
    wanted = {op.fieldName: op for op in ops}
    if not wanted:
        return
    for page in doc:
        widgets = [w for w in page.widgets() if w.field_name in wanted]
        # Radio buttons: switch the others off first, then the chosen one on.
        widgets.sort(key=lambda w: w.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON
                     and w.on_state() == wanted[w.field_name].value)
        for w in widgets:
            op = wanted[w.field_name]
            kind = FIELD_TYPES.get(w.field_type)
            if kind == "checkbox":
                if not isinstance(op.value, bool):
                    raise FieldValueError(op, f"field {op.fieldName!r} is a checkbox: value must be true/false")
                w.field_value = op.value
            elif kind == "radio":
                if not isinstance(op.value, str):
                    raise FieldValueError(op, f"field {op.fieldName!r} is a radio group: value must be an on-state name")
                w.field_value = w.on_state() == op.value
            elif kind in ("text", "combo", "list"):
                if not isinstance(op.value, str):
                    raise FieldValueError(op, f"field {op.fieldName!r} needs a text value")
                w.field_value = op.value
            else:
                continue  # buttons and signature fields have no value to set
            w.update()


def _adopt(doc: pymupdf.Document, xref: int) -> None:
    """Lists widget `xref` in its parent's /Kids: Document.fullcopy_page() copies a page's widgets with
    their /Parent, but the parent does not know the copy (and PyMuPDF refuses to update it)."""
    kind, value = doc.xref_get_key(xref, "Parent")
    if kind != "xref":
        return
    parent = int(value.split()[0])
    kind, kids = doc.xref_get_key(parent, "Kids")
    refs = kids.strip("[]").split() if kind == "array" else []
    listed = {int(refs[i]) for i in range(0, len(refs) - 2, 3)}
    if xref not in listed:
        doc.xref_set_key(parent, "Kids", "[" + " ".join(refs + [str(xref), "0", "R"]) + "]")


def _root_field(doc: pymupdf.Document, xref: int) -> int:
    while True:
        kind, value = doc.xref_get_key(xref, "Parent")
        if kind != "xref":
            return xref
        xref = int(value.split()[0])


def detach_acroform(doc: pymupdf.Document) -> int | None:
    """The xref of the document's AcroForm dictionary (made indirect when inline), before
    Document.select() — which drops /AcroForm from the catalog (PyMuPDF 2.1)."""
    kind, value = doc.xref_get_key(doc.pdf_catalog(), "AcroForm")
    if kind == "xref":
        return int(value.split()[0])
    if kind == "dict":
        xref = doc.get_new_xref()
        doc.update_object(xref, value)
        return xref
    return None


def reattach_acroform(doc: pymupdf.Document, xref: int | None) -> None:
    """Puts the AcroForm back with /Fields = the root fields of the widgets still on the pages."""
    if xref is None:
        return
    roots: list[int] = []
    for page in doc:
        for w in page.widgets():
            _adopt(doc, w.xref)
            root = _root_field(doc, w.xref)
            if root not in roots:
                roots.append(root)
    doc.xref_set_key(xref, "Fields", "[" + " ".join(f"{r} 0 R" for r in roots) + "]")
    doc.xref_set_key(doc.pdf_catalog(), "AcroForm", f"{xref} 0 R")
```

Modify `apps/api/edith/routes/export.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/routes/export.py
+++ b/apps/api/edith/routes/export.py
@@ -68,7 +68,7 @@ def _page_index(ops: list, page_key: str, page_count: int) -> int:
 @router.post("/documents/{doc_id}/export")
 def export(request: Request, doc_id: str, body: ExportRequest) -> Response:
     source = _read_source(request, doc_id)
-    doc = bake(source, body.ops, _ctx(request, doc_id))
+    doc = bake(source, body.ops, _ctx(request, doc_id), flatten_forms=body.flatten_forms)
     try:
         data = doc.tobytes(garbage=3, deflate=True)
     finally:
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/api && uv run pytest tests/test_forms.py -q`
Expected: `9 passed`.

- [ ] **Step 5: Full check**

Run: `cd apps/api && uv run pytest -q`
Expected: `291 passed`, no warnings summary.

- [ ] **Step 6: Commit**

```bash
git add apps/api/edith/bake/__init__.py apps/api/edith/bake/pages.py apps/api/edith/extract.py apps/api/edith/forms.py apps/api/edith/routes/export.py apps/api/tests/pdfs.py apps/api/tests/test_forms.py
git commit -m "feat(api): AcroForm fields in the structure, form.set and flatten; keep the form through page rebuilds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
