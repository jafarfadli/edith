import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import BakeFailed, DocExpired, DocNotFound, InvalidOp
from edith.fonts import FontRegistry
from edith.forms import extract_fields
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_fonts_pdf, make_pdf, make_xfa_form_pdf

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


ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}


def edit(page_key: str, paragraph: str, text: str, font=ARIMO, op_id: str = "e") -> dict:
    box = {"rect": {"x": 72, "y": 57, "w": 200, "h": 17}, "lineHeight": 16.8,
           "paragraphs": [[{"text": text, "font": font, "size": 14, "color": "#111111"}]],
           "layout": [{"baseline": 15, "segments": [{"x": 0, "text": text, "runIndex": 0}]}]}
    return {"id": op_id, "type": "text.edit", "pageKey": page_key, "paragraphId": paragraph, "box": box}


def test_text_edit_on_imported_pages():
    ctx = ctx_with({IMP: make_pdf(pages=2)})
    out = bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 1), page("u-b", IMP, 1)),
                                      edit("u-a", "g0", "Diganti")), ctx)
    assert texts(out) == ["Page 0", "Diganti", "Page 1"]  # only the edited copy; the main page is untouched


def test_text_edit_of_an_unknown_paragraph_on_an_imported_page_is_invalid():
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), edit("u-a", "g9", "x")),
             ctx_with({IMP: make_pdf(pages=1)}))
    assert e.value.extra["op_index"] == 1


def test_original_fonts_name_their_document():
    imported = make_fonts_pdf()
    src = pymupdf.open(stream=imported, filetype="pdf")
    ref = next(f"f{f[0]}" for f in src[0].get_fonts(full=True) if "Arimo" in f[3])
    font = {"kind": "original", "ref": ref, "doc": IMP}
    out = bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), edit("u-a", "g2", "Arimo asli", font)),
               ctx_with({IMP: imported}))
    assert "Arimo asli" in out[1].get_text()
    assert any("Arimo" in f[3] for f in out[1].get_fonts(full=True))
    with pytest.raises(BakeFailed):  # the same ref without `doc` means the edited PDF, which has no such font
        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), edit("u-a", "g2", "x", {**font, "doc": None})),
             ctx_with({IMP: imported}))


def test_expired_import_named_while_checking_text_edits():
    with pytest.raises(DocExpired) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)), edit("u-a", "g0", "x")), ctx_with({IMP: None}))
    assert e.value.extra["doc_id"] == IMP


def test_form_set_of_an_imported_field_survives_the_rename():
    ctx = ctx_with({IMP: form_pdf("name", "IMPORTED", "Import")})
    out = bake(form_pdf("name", "MAIN", "Main"), ops(
        layout(page("o0", MAIN, 0), page("u-a", IMP, 0), page("u-b", IMP, 0)),
        {"id": "f1", "type": "form.set", "fieldName": "name", "value": "Utama"},
        {"id": "f2", "type": "form.set", "fieldName": "name", "value": "Impor", "doc": IMP}), ctx)
    saved = pymupdf.open(stream=out.tobytes(), filetype="pdf")
    fields = [(f["name"], f["value"], f["page"]) for f in extract_fields(saved)]
    assert fields[0] == ("name", "Utama", 0)
    assert [f[1:] for f in fields[1:]] == [("Impor", 1), ("Impor", 2)]  # both copies of the imported page
    assert all(f[0].startswith("name [") for f in fields[1:])


def test_form_set_of_an_imported_field_with_a_wrong_value_names_the_op():
    with pytest.raises(BakeFailed) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)),
                                    {"id": "f2", "type": "form.set", "fieldName": "name", "value": True, "doc": IMP}),
             ctx_with({IMP: form_pdf("name", "x", "Import")}))
    assert e.value.extra["op_id"] == "f2"


def test_import_page_out_of_range_or_unknown_doc_is_invalid():
    for sources, pages in (({IMP: make_pdf(pages=1)}, [page("u-a", IMP, 1)]), ({}, [page("u-a", IMP, 0)])):
        with pytest.raises(InvalidOp) as e:
            bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), *pages)), ctx_with(sources))
        assert e.value.extra["op_index"] == 0


def test_expired_import_names_the_document():
    with pytest.raises(DocExpired) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0))), ctx_with({IMP: None}))
    assert e.value.extra["doc_id"] == IMP


def test_form_fill_of_an_import_failing_otherwise_is_a_bake_failure(monkeypatch):
    def broken(doc, forms):
        raise RuntimeError("boom")
    monkeypatch.setattr("edith.bake.pages.fill_forms", broken)
    with pytest.raises(BakeFailed) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", MAIN, 0), page("u-a", IMP, 0)),
                                    {"id": "f2", "type": "form.set", "fieldName": "name", "value": "x", "doc": IMP}),
             ctx_with({IMP: form_pdf("name", "x", "Import")}))
    assert f"imported document {IMP}" in e.value.message


def test_form_set_naming_the_edited_document_is_a_main_form_op():
    ctx = ctx_with({})
    out = bake(form_pdf("name", "MAIN", "Main"), ops(layout(page("o0", MAIN, 0)),
               {"id": "f1", "type": "form.set", "fieldName": "name", "value": "Utama", "doc": MAIN}), ctx)
    assert [(f["name"], f["value"]) for f in extract_fields(out)] == [("name", "Utama")]
    with pytest.raises(InvalidOp) as e:  # `doc` none and `doc` = the edited id are the same field
        bake(form_pdf("name", "MAIN", "Main"), ops(layout(page("o0", MAIN, 0)),
             {"id": "f1", "type": "form.set", "fieldName": "name", "value": "a"},
             {"id": "f2", "type": "form.set", "fieldName": "name", "value": "b", "doc": MAIN}), ctx)
    assert e.value.extra["op_index"] == 2


def test_filling_an_imported_form_drops_the_main_xfa():
    def xfa(doc) -> str:
        saved = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
        return saved.xref_get_key(saved.pdf_catalog(), "AcroForm/XFA")[0]
    main = make_xfa_form_pdf()
    ctx = ctx_with({IMP: form_pdf("name", "x", "Import")})
    pages = layout(page("o0", MAIN, 0), page("u-a", IMP, 0))
    assert xfa(bake(main, ops(pages), ctx)) != "null"  # untouched without a fill
    filled = {"id": "f2", "type": "form.set", "fieldName": "name", "value": "Impor", "doc": IMP}
    assert xfa(bake(main, ops(pages, filled), ctx)) == "null"
