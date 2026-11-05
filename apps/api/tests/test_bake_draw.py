import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import AssetNotFound, BakeFailed
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22


@pytest.fixture
def ctx(tmp_path) -> BakeContext:
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


def pixel(page, x, y):
    pix = page.get_pixmap(clip=pymupdf.Rect(x, y, x + 1, y + 1))
    return pix.pixel(0, 0)


def test_whiteout_covers_but_keeps_text(ctx):
    out = bake(make_pdf(pages=1), ops({"id": "w", "type": "whiteout.add", "pageKey": "o0", "rect": R(60, 50, 120, 30)}), ctx)
    assert pixel(out[0], 75, 68) == (255, 255, 255)
    assert "Page 0" in out[0].get_text()


def test_redact_removes_text_and_line_art(ctx):
    src = pymupdf.open(stream=make_pdf(pages=1), filetype="pdf")
    src[0].draw_line((60, 65), (200, 65), color=(0, 0, 1), width=2)
    out = bake(src.tobytes(), ops({"id": "r", "type": "redact.add", "pageKey": "o0", "rect": R(60, 50, 120, 30), "fill": "black"}), ctx)
    assert "Page 0" not in out[0].get_text()
    assert pixel(out[0], 75, 68) == (0, 0, 0)
    assert not [d for d in out[0].get_drawings() if d.get("color") == (0.0, 0.0, 1.0)]


def test_rect_and_ellipse(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "a", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": R(100, 100, 50, 40), "stroke": "#ff0000", "fill": "#00ff00", "width": 2},
        {"id": "b", "type": "shape.add", "pageKey": "o0", "kind": "ellipse", "rect": R(200, 100, 50, 40), "stroke": "#0000ff", "fill": None, "width": 1},
    ), ctx)
    drawings = out[0].get_drawings()
    rect = next(d for d in drawings if d["color"] == (1.0, 0.0, 0.0))
    assert rect["fill"] == (0.0, 1.0, 0.0)
    assert rect["rect"] == pymupdf.Rect(100, 100, 150, 140)
    ellipse = next(d for d in drawings if d["color"] == (0.0, 0.0, 1.0))
    assert ellipse["fill"] is None
    assert any(item[0] == "c" for item in ellipse["items"])


def test_line_and_arrow(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "l", "type": "shape.add", "pageKey": "o0", "kind": "line", "points": [[10, 10], [110, 10]], "stroke": "#000000", "width": 3},
        {"id": "a", "type": "shape.add", "pageKey": "o0", "kind": "arrow", "points": [[10, 50], [110, 50]], "stroke": "#ff0000", "width": 2},
    ), ctx)
    red = [d for d in out[0].get_drawings() if d.get("color") == (1.0, 0.0, 0.0) or d.get("fill") == (1.0, 0.0, 0.0)]
    assert len(red) >= 2  # shaft + filled head
    assert pixel(out[0], 108, 50) != (255, 255, 255)


def test_ink(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "i", "type": "ink.add", "pageKey": "o0", "paths": [[[10, 10], [50, 50], [90, 10]], [[200, 200]]], "color": "#00ff00", "width": 4},
    ), ctx)
    greens = [d for d in out[0].get_drawings() if d.get("color") == (0.0, 1.0, 0.0) or d.get("fill") == (0.0, 1.0, 0.0)]
    assert len(greens) == 2  # polyline + dot


def test_image(ctx, tmp_path):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 10, 10), 0)
    pix.set_rect(pix.irect, (255, 0, 0))
    (tmp_path / "img1.png").write_bytes(pix.tobytes("png"))
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "m", "type": "image.add", "pageKey": "o0", "rect": R(100, 100, 80, 40), "assetId": "img1"},
    ), ctx)
    xref = out[0].get_images()[0][0]
    assert out[0].get_image_rects(xref)[0] == pymupdf.Rect(100, 100, 180, 140)


def test_missing_asset(ctx):
    with pytest.raises(BakeFailed) as e:
        bake(make_pdf(pages=1), ops({"id": "m", "type": "image.add", "pageKey": "o0", "rect": R(0, 0, 10, 10), "assetId": "nope"}), ctx)
    assert e.value.extra["op_id"] == "m"
