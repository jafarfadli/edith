import math

import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import BakeFailed
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22


@pytest.fixture
def fonts() -> FontRegistry:
    return FontRegistry(Settings().fonts_dir)


@pytest.fixture
def ctx(fonts) -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=fonts)


def run(text, family="Arimo", bold=False, italic=False, size=12, color="#000000"):
    return {"text": text, "font": {"kind": "bundled", "family": family, "bold": bold, "italic": italic}, "size": size, "color": color}


def text_op(runs, layout, x=100, y=200):
    return ExportRequest.model_validate({"ops": [{
        "id": "t", "type": "text.add", "pageKey": "o0",
        "box": {"rect": {"x": x, "y": y, "w": 300, "h": 50}, "align": "left", "lineHeight": 14.4,
                "paragraphs": [runs], "layout": layout},
    }]}).ops


def chars(page):
    out = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                for ch in span["chars"]:
                    out.append((ch["c"], ch["origin"], span["font"], span["color"], span["size"]))
    return out


def test_single_segment_position_font_color(ctx):
    ops = text_op([run("Halo", color="#ff0000", size=20)],
                  [{"baseline": 15, "segments": [{"x": 5, "text": "Halo", "runIndex": 0}]}])
    out = bake(make_pdf(pages=1, text=False), ops, ctx)
    cs = chars(out[0])
    assert "".join(c[0] for c in cs) == "Halo"
    c, origin, font, color, size = cs[0]
    assert origin == pytest.approx((105, 215), abs=0.01)
    assert "Arimo" in font
    assert color == 0xFF0000
    assert size == pytest.approx(20)


def test_no_kerning_advance_is_quantized_glyph_width(ctx, fonts):
    """Saved PDFs store widths in floor(1000/em) units; the web client measures the same way."""
    ops = text_op([run("AV", size=20)], [{"baseline": 15, "segments": [{"x": 0, "text": "AV", "runIndex": 0}]}])
    out = pymupdf.open(stream=bake(make_pdf(pages=1, text=False), ops, ctx).tobytes(), filetype="pdf")
    (_, a, *_), (_, v, *_) = chars(out[0])
    font = fonts.font("Arimo", False, False)
    quantized = math.floor(font.glyph_advance(ord("A")) * 1000) / 1000 * 20
    assert v[0] - a[0] == pytest.approx(quantized, abs=0.001)  # 13.32 for Arimo "A" (1366/2048 em)


def test_multi_run_multi_line(ctx):
    runs = [run("Tebal ", bold=True), run("miring", family="Tinos", italic=True, color="#0000ff")]
    layout = [
        {"baseline": 12, "segments": [{"x": 0, "text": "Tebal ", "runIndex": 0}]},
        {"baseline": 26.4, "segments": [{"x": 0, "text": "miring", "runIndex": 1}]},
    ]
    out = bake(make_pdf(pages=1, text=False), text_op(runs, layout), ctx)
    cs = chars(out[0])
    t = next(c for c in cs if c[0] == "T")
    m = next(c for c in cs if c[0] == "m")
    assert "Bold" in t[2] and "Arimo" in t[2]
    assert "Tinos" in m[2] and "Italic" in m[2] and m[3] == 0x0000FF
    assert m[1][1] == pytest.approx(200 + 26.4, abs=0.01)


def test_unknown_family_fails_with_op_id(ctx):
    ops = text_op([run("x", family="Nope")], [{"baseline": 10, "segments": [{"x": 0, "text": "x", "runIndex": 0}]}])
    with pytest.raises(BakeFailed) as e:
        bake(make_pdf(pages=1), ops, ctx)
    assert e.value.extra["op_id"] == "t"
