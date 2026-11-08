import math

import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import AssetNotFound
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22
ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}


@pytest.fixture
def ctx(tmp_path) -> BakeContext:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20), False)
    pix.set_rect(pix.irect, (255, 0, 0))
    pix.save(tmp_path / "red.png")

    def asset_path(asset_id: str):
        p = tmp_path / f"{asset_id}.png"
        if not p.exists():
            raise AssetNotFound()
        return p
    return BakeContext(doc_id=DOC, asset_path=asset_path, fonts=FontRegistry(Settings().fonts_dir))


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def blue_rect(**kw) -> dict:
    return {"id": "s", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": R(100, 100, 200, 100),
            "stroke": "#000000", "fill": "#0000ff", "width": 0, **kw}


def pixel(page, x, y):
    return page.get_pixmap(clip=pymupdf.Rect(x, y, x + 1, y + 1)).pixel(0, 0)


def fills(page):
    return [d for d in page.get_drawings() if d.get("fill") == (0.0, 0.0, 1.0)]


def unwrapped_pdf() -> bytes:
    """A page whose content leaves a translation in effect (no q/Q around it), as many real PDFs do."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    xref = doc.get_new_xref()
    doc.update_object(xref, "<<>>")
    doc.update_stream(xref, b"1 0 0 1 10 10 cm 0 1 0 rg 0 0 5 5 re f")
    doc.xref_set_key(page.xref, "Contents", f"{xref} 0 R")
    return doc.tobytes()


@pytest.mark.parametrize("source", [make_pdf(pages=1), make_pdf(pages=1, crop=(50, 40, 545, 800)), unwrapped_pdf()],
                         ids=["plain", "cropped", "unwrapped"])
def test_rotation_turns_clockwise_around_rect_center(ctx, source):
    out = bake(source, ops(blue_rect(rotation=90)), ctx)
    (d,) = fills(out[0])
    assert tuple(d["rect"]) == pytest.approx((150, 50, 250, 250), abs=0.01)


def test_rotation_30_degrees_moves_corners_clockwise(ctx):
    out = bake(make_pdf(pages=1), ops(blue_rect(rotation=30)), ctx)
    (d,) = fills(out[0])
    # The top-left corner (100,100) turned 30° clockwise around (200,150).
    a = math.radians(30)
    x = 200 + (-100) * math.cos(a) - (-50) * math.sin(a)
    y = 150 + (-100) * math.sin(a) + (-50) * math.cos(a)
    corners = [p for item in d["items"] for p in item[1:] if isinstance(p, pymupdf.Point)]
    assert any(abs(p.x - x) < 0.01 and abs(p.y - y) < 0.01 for p in corners)


def test_opacity_blends_with_the_page(ctx):
    out = bake(make_pdf(pages=1), ops(blue_rect(opacity=0.5)), ctx)
    assert pixel(out[0], 200, 150) == (127, 127, 255) or pixel(out[0], 200, 150) == (128, 128, 255)
    (d,) = fills(out[0])
    assert d["fill_opacity"] == pytest.approx(0.5)


def test_opaque_unrotated_ops_are_not_wrapped(ctx):
    src = make_pdf(pages=1)
    before = pymupdf.open(stream=src, filetype="pdf")[0].get_contents()
    out = bake(src, ops(blue_rect()), ctx)
    assert len(out[0].get_contents()) == len(before) + 1  # the shape's own stream, nothing merged


def test_rotated_image(ctx):
    image = {"id": "i", "type": "image.add", "pageKey": "o0", "rect": R(100, 300, 200, 100), "assetId": "red", "rotation": 90}
    out = bake(make_pdf(pages=1), ops(image), ctx)
    (info,) = out[0].get_image_info()
    assert tuple(info["bbox"]) == pytest.approx((150, 250, 250, 450), abs=0.01)
    assert pixel(out[0], 200, 260) == (255, 0, 0) and pixel(out[0], 120, 350) == (255, 255, 255)


def test_translucent_ink_has_alpha(ctx):
    ink = {"id": "k", "type": "ink.add", "pageKey": "o0", "paths": [[[100, 500], [300, 500]]], "color": "#0000ff", "width": 10, "opacity": 0.25}
    out = bake(make_pdf(pages=1), ops(ink), ctx)
    (d,) = [d for d in out[0].get_drawings() if d.get("color") == (0.0, 0.0, 1.0)]
    assert d["stroke_opacity"] == pytest.approx(0.25)


def test_rotated_text_box_reads_vertically(ctx):
    box = {"rect": R(100, 600, 100, 14), "align": "left", "lineHeight": 14,
           "paragraphs": [[{"text": "Turned", "font": ARIMO, "size": 12, "color": "#111111"}]],
           "layout": [{"baseline": 11, "segments": [{"x": 0, "text": "Turned", "runIndex": 0}]}]}
    out = bake(make_pdf(pages=1), ops({"id": "t", "type": "text.add", "pageKey": "o0", "box": box, "rotation": 90}), ctx)
    line = next(ln for b in out[0].get_text("dict")["blocks"] for ln in b.get("lines", [])
                if "Turned" in "".join(s["text"] for s in ln["spans"]))
    assert line["dir"] == pytest.approx((0, 1), abs=1e-6)  # left-to-right becomes top-to-bottom
    assert 140 < line["bbox"][0] < 160  # turned around the box centre (150, 607)


def test_rotated_translucent_stamp(ctx):
    stamp = {"id": "st", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 700, 140, 40), "preset": "approved",
             "color": "#15803d", "rotation": -20, "opacity": 0.6}
    out = bake(make_pdf(pages=1), ops(stamp), ctx)
    assert "APPROVED" in out[0].get_text()
    border = [d for d in out[0].get_drawings() if d.get("color") and d["color"][1] > 0.4]
    assert border and all(d["stroke_opacity"] == pytest.approx(0.6) for d in border)
