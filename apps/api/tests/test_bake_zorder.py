"""Stacking order (z-order) of a page's objects: the web sends them in its `doc.order`, lowest first. Within the
"draw" stage (whiteout, shapes, ink, text, images, signatures, stamps, symbols) the bake draws them in exactly that
order; redactions are applied before every drawn object, native annotations (highlight …) and links come after them
whatever their position (the stages of bake(); apps/web/src/lib/zorder.ts mirrors them)."""
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22
RED, BLUE = (255, 0, 0), (0, 0, 255)


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda _: None, fonts=FontRegistry(Settings().fonts_dir))


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def rect(op_id, color, r=R(100, 100, 100, 100), **extra):
    return {"id": op_id, "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": r,
            "stroke": color, "fill": color, "width": 0, **extra}


def pixel(page, x, y):
    return page.get_pixmap(clip=pymupdf.Rect(x, y, x + 1, y + 1)).pixel(0, 0)


# (150, 150) is inside both rects; (120, 120) only in the first, (220, 220) only in the second.
OVERLAP, ONLY_A, ONLY_B = (150, 150), (120, 120), (220, 220)
A, B = rect("a", "#ff0000"), rect("b", "#0000ff", R(140, 140, 100, 100))


@pytest.mark.parametrize("order, top", [((A, B), BLUE), ((B, A), RED)])
def test_overlapping_shapes_are_drawn_in_the_given_order(ctx, order, top):
    page = bake(make_pdf(pages=1, text=False), ops(*order), ctx)[0]
    assert pixel(page, *OVERLAP) == top
    assert pixel(page, *ONLY_A) == RED and pixel(page, *ONLY_B) == BLUE


def test_rotated_and_translucent_objects_keep_their_place(ctx):
    """Rotation/opacity wrap an object's content stream (draw_transformed): the wrapped stream stays in place."""
    under = rect("a", "#ff0000", rotation=10)
    over = rect("b", "#0000ff", R(140, 140, 100, 100))
    page = bake(make_pdf(pages=1, text=False), ops(under, over), ctx)[0]
    assert pixel(page, *OVERLAP) == BLUE
    page = bake(make_pdf(pages=1, text=False), ops(over, under), ctx)[0]
    assert pixel(page, *OVERLAP) == RED


@pytest.mark.parametrize("whiteout_last", [True, False])
def test_whiteout_covers_only_what_is_below_it(ctx, whiteout_last):
    w = {"id": "w", "type": "whiteout.add", "pageKey": "o0", "rect": R(130, 130, 40, 40)}
    order = (A, w) if whiteout_last else (w, A)
    page = bake(make_pdf(pages=1, text=False), ops(*order), ctx)[0]
    assert pixel(page, *OVERLAP) == ((255, 255, 255) if whiteout_last else RED)


def test_text_is_stacked_with_the_shapes(ctx):
    text = {"id": "t", "type": "text.add", "pageKey": "o0", "box": {
        "rect": R(100, 100, 200, 40), "align": "left", "lineHeight": 1.2,
        "paragraphs": [[{"text": "MMMM", "font": {"kind": "bundled", "family": "Arimo", "bold": True, "italic": False},
                         "size": 36, "color": "#0000ff"}]],
        "layout": [{"baseline": 32, "segments": [{"runIndex": 0, "text": "MMMM", "x": 0}]}]}}
    cover = rect("c", "#ff0000", R(100, 100, 200, 40))
    over = bake(make_pdf(pages=1, text=False), ops(cover, text), ctx)[0]
    under = bake(make_pdf(pages=1, text=False), ops(text, cover), ctx)[0]
    assert "MMMM" in over.get_text() and "MMMM" in under.get_text()
    blue = lambda page: sum(1 for x in range(100, 300, 2) for y in range(100, 140, 2) if pixel(page, x, y) == BLUE)  # noqa: E731
    assert blue(over) > 20
    assert blue(under) == 0  # the red rect drawn after the text hides it


def test_cross_stage_highlight_stays_above_drawn_objects(ctx):
    """A highlight is a native annotation: viewers draw it over the page content, so a shape after it in the order
    is still under it (the web stacks markup over drawn objects too and offers no move across that line)."""
    hl = {"id": "h", "type": "annot.add", "pageKey": "o0", "kind": "highlight", "quads": [R(100, 100, 100, 100)], "color": "#ffff00"}
    page = bake(make_pdf(pages=1, text=False), ops(hl, rect("a", "#0000ff")), ctx)[0]
    assert [a.type[1] for a in page.annots()] == ["Highlight"]
    assert pixel(page, *ONLY_A) == (0, 0, 0)  # yellow multiplied over blue: the highlight is on top


def test_cross_stage_redaction_is_under_later_drawn_objects(ctx):
    """Redactions are applied before anything is drawn: a shape before a redaction in the order is still drawn
    over the redaction's fill, and a redaction never removes the edit's own objects."""
    red = {"id": "r", "type": "redact.add", "pageKey": "o0", "rect": R(100, 100, 100, 100), "fill": "black"}
    page = bake(make_pdf(pages=1, text=False), ops(rect("a", "#0000ff", R(140, 140, 20, 20)), red), ctx)[0]
    assert pixel(page, *OVERLAP) == BLUE
    assert pixel(page, *ONLY_A) == (0, 0, 0)


def test_export_draws_overlapping_shapes_in_the_requested_order(client):
    doc_id = client.post("/documents", files={"file": ("a.pdf", make_pdf(pages=1, text=False), "application/pdf")}).json()["doc_id"]
    for order, top in (((A, B), BLUE), ((B, A), RED)):
        r = client.post(f"/documents/{doc_id}/export", json={"ops": list(order)})
        assert r.status_code == 200, r.text
        page = pymupdf.open(stream=r.content, filetype="pdf")[0]
        assert pixel(page, *OVERLAP) == top
