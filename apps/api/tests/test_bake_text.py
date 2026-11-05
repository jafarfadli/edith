import json
import math

import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.bake.tounicode import glyph_to_unicode, to_unicode_cmap
from edith.errors import BakeFailed
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_fonts_pdf, make_pdf, unrotated

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


CROP = (50, 60, 400, 700)


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_text_on_cropped_page_is_crop_relative(ctx, rotation):
    ops = text_op([run("Halo", size=20)], [{"baseline": 15, "segments": [{"x": 5, "text": "Halo", "runIndex": 0}]}])
    out = bake(make_pdf(pages=1, text=False, crop=CROP, rotation=rotation), ops, ctx)
    assert out[0].rotation == rotation
    _, origin, *_ = chars(unrotated(out))[0]
    assert origin == pytest.approx((105, 215), abs=0.01)


def test_text_on_page_with_offset_mediabox(ctx):
    src = pymupdf.open()
    page = src.new_page(width=595, height=842)
    page.set_mediabox(pymupdf.Rect(10, 20, 605, 862))
    page.set_cropbox(pymupdf.Rect(50, 60, 400, 700))
    ops = text_op([run("Halo", size=20)], [{"baseline": 15, "segments": [{"x": 5, "text": "Halo", "runIndex": 0}]}])
    out = bake(src.tobytes(), ops, ctx)
    _, origin, *_ = chars(unrotated(out))[0]
    assert origin == pytest.approx((105, 215), abs=0.01)


def _bundled_styles():
    manifest = json.loads((Settings().fonts_dir / "manifest.json").read_text())
    return [(family, style) for family, info in manifest["families"].items() for style in info["files"]]


@pytest.mark.parametrize(("family", "style"), _bundled_styles())
def test_bundled_text_round_trips_with_plain_spaces(ctx, family, style):
    """MuPDF's ToUnicode inverts the font's cmap and the last code point of a shared glyph wins, so
    Tinos spaces read back as U+00A0 and Arimo hyphens as U+00AD; the bake makes ASCII win."""
    text = "".join(chr(c) for c in range(0x20, 0x7F))
    r = run(text, family=family, bold="bold" in style, italic="italic" in style, size=8)
    ops = text_op([r], [{"baseline": 15, "segments": [{"x": 0, "text": text, "runIndex": 0}]}], x=10)
    out = pymupdf.open(stream=bake(make_pdf(pages=1, text=False), ops, ctx).tobytes(garbage=3), filetype="pdf")
    assert "".join(c[0] for c in chars(out[0])) == text
    assert out[0].get_text().strip("\n") == text


def test_to_unicode_cmap_prefers_ascii_and_encodes_utf16(fonts):
    tinos = fonts.font("Tinos", False, False)
    mapping = glyph_to_unicode(tinos)
    assert mapping[tinos.has_glyph(0x20)] == 0x20 and mapping[tinos.has_glyph(0x2D)] == 0x2D
    cmap = to_unicode_cmap({3: 0x20, 5: 0x1F600})
    assert b"<0003> <0020>" in cmap and b"<0005> <d83dde00>" in cmap  # surrogate pair beyond the BMP


def test_fonts_of_the_source_pdf_keep_their_to_unicode(ctx):
    data = make_fonts_pdf()
    src = pymupdf.open(stream=data, filetype="pdf")
    before = {x: src.xref_get_key(x, "ToUnicode") for x, *_ in src[0].get_fonts(full=True)}
    streams = {x: src.xref_stream(int(v.split()[0])) for x, (k, v) in before.items() if k == "xref"}
    out = bake(data, text_op([run("a b", family="Tinos")], [{"baseline": 15, "segments": [{"x": 0, "text": "a b", "runIndex": 0}]}], y=400), ctx)
    assert streams and all(out.xref_stream(int(before[x][1].split()[0])) == s for x, s in streams.items())
    assert "a b" in out[0].get_text()
