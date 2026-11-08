import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import AssetNotFound, InvalidOp
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22


@pytest.fixture
def ctx() -> BakeContext:
    def asset_path(asset_id: str):
        raise AssetNotFound()
    return BakeContext(doc_id=DOC, asset_path=asset_path, fonts=FontRegistry(Settings().fonts_dir))


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def layout(*pages):
    return {"id": "L", "type": "pages.layout", "pages": [
        {"pageKey": key, "src": {"doc": DOC, "index": index}, "rotate": rotate} for key, index, rotate in pages]}


def markup(kind, quads, color="#ffeb3b", page_key="o0", op_id="m"):
    return {"id": op_id, "type": "annot.add", "pageKey": page_key, "kind": kind, "quads": quads, "color": color}


def reload(doc: pymupdf.Document) -> pymupdf.Document:
    return pymupdf.open(stream=doc.tobytes(), filetype="pdf")


def annots_of(page: pymupdf.Page) -> list[dict]:
    """Annotation facts, read while the page is alive (an Annot outlives its page only unbound)."""
    return [{"type": a.type[1], "vertices": [v for pt in a.vertices or [] for v in pt], "stroke": a.colors["stroke"], "rect": tuple(a.rect),
             "content": a.info["content"], "blendmode": a.blendmode} for a in page.annots()]


def corners(r: dict) -> list[float]:
    """QuadPoints in the order PyMuPDF reports them: top-left, top-right, bottom-left, bottom-right."""
    x0, y0, x1, y1 = r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]
    return [x0, y0, x1, y0, x0, y1, x1, y1]


def unrotated_doc(doc: pymupdf.Document) -> pymupdf.Document:
    """A saved and reopened copy without /Rotate on any page (Page.get_links() keeps the rotation the
    page was loaded with, so tests.pdfs.unrotated() is not enough for links)."""
    copy = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    for page in copy:
        page.set_rotation(0)
    return reload(copy)


def test_text_markup_kinds_quads_and_colors(ctx):
    q1, q2 = R(72, 61.2, 40, 13.8), R(72, 81.2, 25, 13.8)
    out = reload(bake(make_pdf(pages=1), ops(
        markup("highlight", [q1, q2], "#ffeb3b", op_id="h"),
        markup("underline", [q1], "#e11d48", op_id="u"),
        markup("strike", [q2], "#1d4ed8", op_id="s")), ctx))
    annots = {a["type"]: a for a in annots_of(out[0])}
    assert set(annots) == {"Highlight", "Underline", "StrikeOut"}
    hl = annots["Highlight"]
    assert hl["vertices"] == pytest.approx(corners(q1) + corners(q2), abs=0.01)
    assert hl["stroke"] == pytest.approx([1, 0xEB / 255, 0x3B / 255], abs=0.01)
    assert hl["blendmode"] == "Multiply"  # MuPDF's default: text under a highlight stays dark
    assert annots["Underline"]["stroke"] == pytest.approx([0xE1 / 255, 0x1D / 255, 0x48 / 255], abs=0.01)
    assert annots["StrikeOut"]["vertices"] == pytest.approx(corners(q2), abs=0.01)


def test_sticky_note(ctx):
    out = reload(bake(make_pdf(pages=1), ops({"id": "n", "type": "annot.add", "pageKey": "o0", "kind": "note",
                                               "point": [300, 400], "color": "#facc15", "content": "Periksa lagi"}), ctx))
    [note] = [a for a in annots_of(out[0]) if a["type"] != "Popup"]
    assert note["type"] == "Text" and note["content"] == "Periksa lagi"
    assert note["rect"] == pytest.approx((300, 400, 316, 416))
    assert note["stroke"] == pytest.approx([0xFA / 255, 0xCC / 255, 0x15 / 255], abs=0.01)


def test_annotations_cover_drawn_content(ctx):
    """Annotations come after every drawn op, whatever the op order (spec: Urutan bake 4 → 5)."""
    out = bake(make_pdf(pages=1, text=False), ops(
        markup("highlight", [R(100, 100, 50, 20)], "#ffeb3b"),
        {"id": "w", "type": "whiteout.add", "pageKey": "o0", "rect": R(90, 90, 80, 40)}), ctx)
    pix = out[0].get_pixmap(clip=pymupdf.Rect(120, 110, 121, 111))
    assert pix.pixel(0, 0) == (255, 235, 59)  # yellow over the white box


@pytest.mark.parametrize("rotation", [0, 90, 270])
def test_markup_on_rotated_cropped_page_stays_on_its_text(ctx, rotation):
    q = R(72, 61.2, 40, 13.8)
    out = bake(make_pdf(pages=1, rotation=rotation, crop=(30, 40, 565, 800)), ops(markup("highlight", [q])), ctx)
    assert out[0].rotation == rotation
    [hl] = annots_of(unrotated_doc(out)[0])
    assert hl["vertices"] == pytest.approx(corners(q), abs=0.01)


def links(page: pymupdf.Page) -> list[dict]:
    return page.get_links()


def test_link_to_page_follows_the_layout(ctx):
    """Page targets resolve to output indexes: o2 is the first output page here."""
    out = reload(bake(make_pdf(pages=3), ops(
        layout(("o2", 2, 0), ("o0", 0, 0), ("o1", 1, 0)),
        {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"pageKey": "o2"}},
        {"id": "b", "type": "link.add", "pageKey": "o0", "rect": R(72, 130, 100, 20), "target": {"pageKey": "o1"}},
        {"id": "c", "type": "link.add", "pageKey": "o0", "rect": R(72, 160, 100, 20), "target": {"url": "https://example.com/a?b=1"}}), ctx))
    got = links(out[1])
    assert [(ln["kind"], ln.get("page"), ln.get("uri")) for ln in got] == [
        (pymupdf.LINK_GOTO, 0, None), (pymupdf.LINK_GOTO, 2, None), (pymupdf.LINK_URI, None, "https://example.com/a?b=1")]
    assert tuple(got[0]["from"]) == pytest.approx((72, 100, 172, 120))
    assert "Page 2" in out[0].get_text()


@pytest.mark.parametrize("rotation", [0, 90])
def test_link_on_rotated_cropped_page_is_crop_relative(ctx, rotation):
    out = bake(make_pdf(pages=2, rotation=rotation, crop=(30, 40, 565, 800)), ops(
        {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"pageKey": "o1"}}), ctx)
    [ln] = links(unrotated_doc(out)[0])
    assert tuple(ln["from"]) == pytest.approx((72, 100, 172, 120), abs=0.01)
    assert ln["page"] == 1


def test_link_rotates_with_its_page(ctx):
    out = reload(bake(make_pdf(pages=1), ops(
        layout(("o0", 0, 90)),
        {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"url": "https://a.b"}}), ctx))
    [ln] = links(out[0])  # rotated page coordinates: x = H − y
    assert tuple(ln["from"]) == pytest.approx((842 - 120, 72, 842 - 100, 172), abs=0.01)


def test_link_to_unknown_page_is_invalid(ctx):
    with pytest.raises(InvalidOp) as err:
        bake(make_pdf(pages=2), ops(
            layout(("o0", 0, 0)),
            {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"pageKey": "o1"}}), ctx)
    assert err.value.extra["op_index"] == 1


def _link_action(doc: pymupdf.Document) -> dict:
    [(xref, *_)] = doc[0].annot_xrefs()
    return {k: doc.xref_get_key(xref, f"A/{k}") for k in ("S", "URI", "JS")}


@pytest.mark.parametrize("url, stored", [
    ("https://a/)/S/JavaScript/JS(app.alert(1))/X(", "https://a/%29/S/JavaScript/JS%28app.alert%281%29%29/X%28"),
    ("https://a/b(c", "https://a/b%28c"),
    ("https://a/b\\c", "https://a/b%5Cc"),
    ("https://a/é", "https://a/%C3%A9"),
    ("https://a/%28x?q=1&r=2#f", "https://a/%28x?q=1&r=2#f"),
])
def test_link_uri_cannot_break_out_of_its_pdf_string(ctx, url, stored):
    """insert_link() writes the URI into a PDF literal string unescaped: `\\`, `(`, `)` and non-ASCII are
    percent-encoded first, so the action stays /S /URI and an unbalanced paren does not drop the link."""
    out = reload(bake(make_pdf(pages=1), ops(
        {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"url": url}}), ctx))
    action = _link_action(out)
    assert action["S"] == ("name", "/URI")
    assert action["JS"] == ("null", "null")
    assert action["URI"] == ("string", stored)
    assert [ln["uri"] for ln in links(out[0])] == [stored]
