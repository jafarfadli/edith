import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import InvalidOp
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf, unrotated

DOC = "D" * 22


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: a, fonts=FontRegistry(Settings().fonts_dir))


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def layout(*pages) -> dict:
    return {"id": "L", "type": "pages.layout", "pages": list(pages)}


def page(key: str, index: int, crop=None, rotate=0) -> dict:
    out = {"pageKey": key, "src": {"doc": DOC, "index": index}, "rotate": rotate}
    if crop:
        out["crop"] = dict(zip("xywh", crop))
    return out


def word(p: pymupdf.Page, text: str):
    return next(w for w in p.get_text("words") if w[4] == text)


def reopened(out) -> pymupdf.Document:
    return pymupdf.open(stream=out.tobytes(), filetype="pdf")


@pytest.mark.parametrize("source_crop", [None, (50, 40, 545, 800)], ids=["mediabox", "cropbox-offset"])
def test_crop_keeps_content_in_place(ctx, source_crop):
    rect = {"x": 100, "y": 150, "w": 50, "h": 20}
    out = reopened(bake(make_pdf(pages=1, crop=source_crop), ops(
        layout(page("o0", 0, crop=(60, 40, 200, 300))),
        {"id": "w", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": rect, "stroke": "#ff0000", "width": 1},
        {"id": "l", "type": "link.add", "pageKey": "o0", "rect": rect, "target": {"url": "https://a.b"}}), ctx))
    p = out[0]
    assert (p.rect.width, p.rect.height) == (200, 300)
    before = word(bake(make_pdf(pages=1, crop=source_crop), [], ctx)[0], "Page")
    assert word(p, "Page")[:2] == pytest.approx((before[0] - 60, before[1] - 40), abs=0.01)
    (d,) = [d for d in p.get_drawings() if d.get("color") == (1.0, 0.0, 0.0)]
    assert tuple(d["rect"]) == pytest.approx((40, 110, 90, 130), abs=0.6)  # content moved by the crop origin only
    assert tuple(p.get_links()[0]["from"]) == pytest.approx((40, 110, 90, 130), abs=0.01)


def test_crop_then_rotate(ctx):
    out = reopened(bake(make_pdf(pages=1), ops(layout(page("o0", 0, crop=(60, 40, 200, 300), rotate=90))), ctx))
    p = out[0]
    assert p.rotation == 90 and (p.rect.width, p.rect.height) == (300, 200)
    q = unrotated(out)
    assert round(word(q, "Page")[0]) == 12


def test_duplicates_crop_independently(ctx):
    out = reopened(bake(make_pdf(pages=1), ops(layout(page("o0", 0, crop=(0, 0, 100, 100)), page("u-d", 0))), ctx))
    assert [(p.rect.width, p.rect.height) for p in out] == [(100, 100), (595, 842)]


def test_crop_past_the_page_is_invalid(ctx):
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", 0, crop=(500, 0, 200, 100)))), ctx)
    assert e.value.extra["op_index"] == 0


def test_crop_overshoot_within_slack_is_clamped(ctx):
    out = bake(make_pdf(pages=1), ops(layout(page("o0", 0, crop=(495, 742, 100.005, 100.005)))), ctx)
    assert (out[0].rect.width, out[0].rect.height) == pytest.approx((100, 100))


def test_crop_on_blank_page(ctx):
    blank = {"pageKey": "u-b", "src": {"blank": {"width": 300, "height": 300}}, "crop": {"x": 10, "y": 10, "w": 100, "h": 50}}
    out = bake(make_pdf(pages=1), ops(layout(page("o0", 0), blank)), ctx)
    assert (out[1].rect.width, out[1].rect.height) == (100, 50)


@pytest.mark.parametrize("x,y,w,h", [(float("inf"), 0, 100, 100), (0, float("inf"), 100, 100),
                                    (0, 0, float("inf"), 100), (0, 0, 100, float("inf"))])
def test_crop_non_finite_is_invalid(ctx, x, y, w, h):
    crop = {"x": x, "y": y, "w": w, "h": h}
    entry = {"pageKey": "o0", "src": {"doc": DOC, "index": 0}, "rotate": 0}
    try:
        req = ops(layout({**entry, "crop": crop}))
    except Exception:  # rejected by the schema: also a clean 422, never a 500
        return
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), req, ctx)
    assert e.value.extra["op_index"] == 0


def annotated_pdf(xfa: bool = False) -> bytes:
    """A4 page: a note, a highlight, a link and a text field inside (100–200) and outside (450–550) the
    crop (60, 40, 300, 300); a second highlight straddles the crop's right edge (340–380)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    for y, name in ((100, "inside"), (450, "outside")):
        page.add_text_annot((100, y), name)
        page.add_highlight_annot(pymupdf.Rect(100, y + 20, 180, y + 34))
        page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(100, y + 40, 180, y + 54), "uri": f"https://{name}.example"})
        w = pymupdf.Widget()
        w.field_type, w.field_name, w.rect = pymupdf.PDF_WIDGET_TYPE_TEXT, name, pymupdf.Rect(100, y + 60, 250, y + 76)
        page.add_widget(w)
    page.add_highlight_annot(pymupdf.Rect(340, 120, 380, 134))
    if xfa:
        stream = doc.get_new_xref()
        doc.update_object(stream, "<<>>")
        doc.update_stream(stream, b"<xdp:xdp/>")
        doc.xref_set_key(doc.pdf_catalog(), "AcroForm/XFA", f"{stream} 0 R")
    return doc.tobytes()


def test_crop_removes_what_it_hides_entirely(ctx):
    out = reopened(bake(annotated_pdf(), ops(layout(page("o0", 0, crop=(60, 40, 300, 300)))), ctx))
    p = out[0]
    assert sorted(a.type[1] for a in p.annots()) == ["Highlight", "Highlight", "Text"]  # inside + straddling
    assert [ln["uri"] for ln in p.get_links()] == ["https://inside.example"]
    assert [w.field_name for w in p.widgets()] == ["inside"]
    assert out.is_form_pdf


def test_uncropped_pages_keep_everything(ctx):
    out = reopened(bake(annotated_pdf(), ops(layout(page("o0", 0), page("u-d", 0, crop=(60, 40, 300, 300)))), ctx))
    assert len(list(out[0].widgets())) == 2 and len(out[0].get_links()) == 2
    assert len(list(out[1].widgets())) == 1


def test_crop_that_removes_widgets_drops_xfa(ctx):
    def xfa(data: bytes) -> str:
        d = pymupdf.open(stream=data, filetype="pdf")
        return d.xref_get_key(d.pdf_catalog(), "AcroForm/XFA")[0]
    src = annotated_pdf(xfa=True)
    assert xfa(src) == "xref"
    assert xfa(bake(src, ops(layout(page("o0", 0, crop=(60, 40, 300, 300)))), ctx).tobytes()) == "null"
    assert xfa(bake(src, ops(layout(page("o0", 0, crop=(60, 40, 500, 700)))), ctx).tobytes()) == "xref"  # nothing removed
