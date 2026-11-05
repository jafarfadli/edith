import json
import re

import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.bake.stamps import STAMP_COLORS, STAMP_LABELS, STAMP_PRESETS_FILE, border_width, stamp_layout
from edith.bake.symbols import symbol_paths
from edith.bake.text import quantized_width
from edith.errors import AssetNotFound
from edith.fonts import FontRegistry
from edith.ops import STAMP_PRESETS, ExportRequest, Rect
from edith.settings import Settings
from tests.pdfs import make_pdf, unrotated

DOC = "D" * 22


@pytest.fixture
def fonts() -> FontRegistry:
    return FontRegistry(Settings().fonts_dir)


@pytest.fixture
def ctx(tmp_path, fonts) -> BakeContext:
    def asset_path(asset_id: str):
        p = tmp_path / f"{asset_id}.png"
        if not p.exists():
            raise AssetNotFound()
        return p
    return BakeContext(doc_id=DOC, asset_path=asset_path, fonts=fonts)


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def pixel(page, x, y):
    return page.get_pixmap(clip=pymupdf.Rect(x, y, x + 1, y + 1)).pixel(0, 0)


def spans(page):
    return [s for b in page.get_text("dict")["blocks"] for line in b.get("lines", []) for s in line["spans"]]


def test_every_preset_has_a_label_and_colour():
    assert set(STAMP_LABELS) == set(STAMP_PRESETS) and set(STAMP_COLORS) == set(STAMP_PRESETS)
    assert all(label.strip() for label in STAMP_LABELS.values())
    assert all(re.fullmatch(r"#[0-9a-f]{6}", c) for c in STAMP_COLORS.values())


def test_indonesian_presets_mirror_the_english_ones():
    english, indonesian = STAMP_PRESETS[:17], STAMP_PRESETS[17:]
    assert len(indonesian) == 17
    for en, idn in zip(english, indonesian):
        assert STAMP_COLORS[en] == STAMP_COLORS[idn]
    assert STAMP_LABELS["disetujui"] == "DISETUJUI" and STAMP_LABELS["tanda-tangan-di-sini"] == "TANDA TANGAN DI SINI"
    assert STAMP_LABELS["final-id"] == "FINAL"


def test_preset_table_is_the_shared_json_file():
    """The web reads the same file (packages/ops/stamp-presets.json)."""
    table = json.loads(STAMP_PRESETS_FILE.read_text())
    assert [p["id"] for p in table] == list(STAMP_PRESETS)
    assert {p["id"]: p["label"] for p in table} == STAMP_LABELS
    assert {p["id"]: p["color"] for p in table} == STAMP_COLORS


def test_indonesian_preset_stamp_is_drawn(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 200, 200, 40), "preset": "tidak-disetujui", "color": "#b91c1c"}), ctx)
    [span] = spans(unrotated(out))
    assert span["text"] == "TIDAK DISETUJUI"


def test_stamp_layout_shared_numbers(fonts):
    """Same numbers as apps/web/src/lib/stamps.test.ts."""
    bold = fonts.font("Arimo", True, False)
    width = lambda t: quantized_width(bold, t, 1)  # noqa: E731
    [one] = stamp_layout(140, 40, ["APPROVED"], width)
    assert (one.size, round(one.x, 4), round(one.baseline, 4)) == (20.0, 13.93, 26.88)
    label, sub = stamp_layout(160, 54, ["DIPERIKSA", "05/11/2026 14:30"], width)
    assert (round(label.size, 4), round(label.x, 4), label.baseline) == (19.44, 27.1232, 27.0)
    assert (round(sub.size, 4), round(sub.x, 4), round(sub.baseline, 4)) == (10.8, 37.6856, 42.12)
    [narrow] = stamp_layout(120, 40, ["NOT FOR PUBLIC RELEASE"], width)  # shrunk to fit the width
    assert (round(narrow.size, 4), round(narrow.x, 4)) == (7.8897, 6.8)
    assert border_width(140, 40) == 2.0 and border_width(10, 4) == 0.5


def test_preset_stamp_text_and_border(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 200, 140, 40), "preset": "approved", "color": "#15803d"}), ctx)
    page = unrotated(out)
    [span] = spans(page)
    assert span["text"] == "APPROVED" and "Arimo" in span["font"] and "Bold" in span["font"]
    assert span["size"] == pytest.approx(20, abs=0.01)
    assert span["origin"][0] == pytest.approx(113.93, abs=0.01) and span["origin"][1] == pytest.approx(226.88, abs=0.01)
    assert span["color"] == 0x15803D
    [border] = [d for d in page.get_drawings() if d.get("color")]
    assert border["width"] == pytest.approx(2.0)
    assert tuple(border["rect"]) == pytest.approx((101, 201, 239, 239), abs=0.01)


def test_custom_stamp_with_date_and_time(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 300, 160, 54),
         "custom": {"text": "DIPERIKSA", "date": "05/11/2026", "time": "14:30"}, "color": "#1d4ed8"}), ctx)
    texts = {s["text"]: s for s in spans(unrotated(out))}
    assert set(texts) == {"DIPERIKSA", "05/11/2026 14:30"}  # spaces read back as U+0020 (ToUnicode fix)
    assert texts["05/11/2026 14:30"]["origin"][1] == pytest.approx(342.12, abs=0.01)


@pytest.mark.parametrize("rotation", [0, 90])
def test_stamp_on_rotated_cropped_page_is_crop_relative(ctx, rotation):
    out = bake(make_pdf(pages=1, text=False, rotation=rotation, crop=(30, 40, 565, 800)), ops(
        {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 200, 140, 40), "preset": "void", "color": "#b91c1c"}), ctx)
    assert out[0].rotation == rotation
    [span] = spans(unrotated(out))
    assert span["origin"][1] == pytest.approx(226.88, abs=0.01)


def test_symbol_paths_shared_numbers():
    """Same numbers as apps/web/src/lib/symbols.test.ts."""
    paths, width = symbol_paths("check", Rect(x=10, y=20, w=50, h=40))
    assert paths == [[(16.0, 40.8), (30.0, 52.0), (54.0, 28.0)]] and width == pytest.approx(4.8)
    paths, _ = symbol_paths("cross", Rect(x=0, y=0, w=100, h=100))
    assert paths == [[(18.0, 18.0), (82.0, 82.0)], [(82.0, 18.0), (18.0, 82.0)]]


def test_check_and_cross_are_stroked_paths(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "c", "type": "symbol.add", "pageKey": "o0", "kind": "check", "rect": R(100, 100, 20, 20), "color": "#1d4ed8"},
        {"id": "x", "type": "symbol.add", "pageKey": "o0", "kind": "cross", "rect": R(200, 100, 20, 20), "color": "#b91c1c"}), ctx)
    drawings = unrotated(out).get_drawings()
    check = [d for d in drawings if d["color"] == pytest.approx((0x1D / 255, 0x4E / 255, 0xD8 / 255))]
    cross = [d for d in drawings if d["color"] == pytest.approx((0xB9 / 255, 0x1C / 255, 0x1C / 255))]
    assert len(check) == 1 and len(check[0]["items"]) == 2  # one polyline, two segments
    assert sum(len(d["items"]) for d in cross) == 2
    assert check[0]["width"] == pytest.approx(2.4)
    assert pixel(out[0], 108, 116)[2] > 150  # on the stroke near the check's bottom point: blue
    assert out[0].get_text() == ""  # vector art, no text


def test_signature_png_keeps_transparency(ctx, tmp_path):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 10), True)  # with alpha
    pix.set_rect(pymupdf.IRect(0, 0, 10, 10), (0, 0, 255, 255))  # left half opaque blue
    pix.set_rect(pymupdf.IRect(10, 0, 20, 10), (0, 0, 0, 0))  # right half fully transparent
    (tmp_path / "sig.png").write_bytes(pix.tobytes("png"))
    src = pymupdf.open(stream=make_pdf(pages=1, text=False), filetype="pdf")
    src[0].draw_rect(pymupdf.Rect(0, 0, 595, 842), color=None, fill=(1, 0, 0))  # red page
    out = bake(src.tobytes(), ops(
        {"id": "s", "type": "signature.add", "pageKey": "o0", "rect": R(100, 100, 200, 100), "assetId": "sig"}), ctx)
    assert pixel(out[0], 150, 150) == (0, 0, 255)  # opaque half
    assert pixel(out[0], 250, 150) == (255, 0, 0)  # transparent half shows the page
    assert len(out[0].get_images()) == 1