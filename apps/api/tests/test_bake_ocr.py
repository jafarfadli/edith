"""M5d: text.ocr_edit — a paragraph OCR read in a picture, rewritten: the old picture of it is covered with its
background colour (never anything outside the cover), under every drawn object, and the new text is drawn once. The op
is self-contained: the bake never runs OCR."""
import numpy as np
import pymupdf
import pytest
from pydantic import ValidationError

from edith import ocr
from edith.bake import bake
from edith.bake.context import BakeContext
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import SCAN_BODY_TOP, make_scan_form_pdf, scan_form_words
from tests.test_documents import upload

DOC = "D" * 22
PAPER = (0.97, 0.96, 0.92)
PAPER_HEX = "#f7f5eb"
NEW = "Teks baru hasil OCR yang diedit."
DPI = 100


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=FontRegistry(Settings().fonts_dir))


@pytest.fixture(scope="module")
def scan() -> bytes:
    return make_scan_form_pdf(paper=PAPER)


def body_cover() -> pymupdf.Rect:
    """The ink of the form's body paragraph (its three lines), padded 1.5 pt, as POST .../ocr reports it."""
    ink = pymupdf.Rect()
    for _t, box in scan_form_words():
        if SCAN_BODY_TOP - 12 < box.y1 < SCAN_BODY_TOP + 40:
            ink |= box
    return pymupdf.Rect(ink.x0 - 1.5, ink.y0 - 1.5, ink.x1 + 1.5, ink.y1 + 1.5)


def R(r: pymupdf.Rect) -> dict:
    return {"x": r.x0, "y": r.y0, "w": r.width, "h": r.height}


def ocr_edit(cover: pymupdf.Rect, text: str = NEW, op_id: str = "e", pid: str = "ocr12", colour: str = PAPER_HEX) -> dict:
    return {"id": op_id, "type": "text.ocr_edit", "pageKey": "o0", "paragraphId": pid, "cover": R(cover),
            "coverColor": colour,
            "box": {"rect": {"x": cover.x0 + 1.5, "y": SCAN_BODY_TOP - 10, "w": cover.width - 3, "h": 14},
                    "align": "left", "lineHeight": 15,
                    "paragraphs": [[{"text": text, "font": {"kind": "bundled", "family": "Tinos"}, "size": 11,
                                     "color": "#000000"}]],
                    "layout": [{"baseline": 10, "segments": [{"x": 0, "text": text, "runIndex": 0}]}]}}


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def pixels(data_or_doc) -> np.ndarray:
    doc = data_or_doc if isinstance(data_or_doc, pymupdf.Document) else pymupdf.open(stream=data_or_doc, filetype="pdf")
    pix = doc[0].get_pixmap(dpi=DPI, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(int)


def px(r: pymupdf.Rect, grow: int = 0) -> tuple[slice, slice]:
    s = DPI / 72
    return (slice(max(int(r.y0 * s) - grow, 0), int(np.ceil(r.y1 * s)) + grow),
            slice(max(int(r.x0 * s) - grow, 0), int(np.ceil(r.x1 * s)) + grow))


def test_cover_paints_only_its_rect_and_the_new_text_is_drawn_once(scan, ctx):
    cover = body_cover()
    before = pixels(scan)
    out = bake(scan, ops(ocr_edit(cover)), ctx)
    after = pixels(out)
    # Outside the cover (1 px of anti-aliasing aside) the picture is untouched.
    changed = np.any(before != after, axis=2)
    ys, xs = px(cover, grow=1)
    outside = changed.copy()
    outside[ys, xs] = False
    assert not outside.any()
    # Inside, the old lines under the new one are gone: only the cover's colour where the 2nd and 3rd lines were.
    below = pymupdf.Rect(cover.x0 + 1, SCAN_BODY_TOP + 6, cover.x1 - 1, cover.y1 - 1)
    region = after[px(below)]
    assert np.abs(region - np.array([247, 245, 235])).max() <= 2
    # The new text, once; the page had none.
    assert pymupdf.open(stream=scan, filetype="pdf")[0].get_text().strip() == ""
    assert out[0].get_text().count(NEW) == 1


def test_the_picture_itself_is_left_as_it_was(scan, ctx):
    src = pymupdf.open(stream=scan, filetype="pdf")
    (xref, *_), = src[0].get_images(full=True)
    out = pymupdf.open(stream=bake(scan, ops(ocr_edit(body_cover())), ctx).tobytes(garbage=3, deflate=True),
                       filetype="pdf")
    (out_xref, *_), = out[0].get_images(full=True)
    assert out.xref_stream_raw(out_xref) == src.xref_stream_raw(xref)


def test_cover_lies_under_every_drawn_object(scan, ctx):
    """Like a text.edit's removed glyphs: a shape below the edit in the stacking order still shows over the cover."""
    cover = body_cover()
    shape = {"id": "s", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": R(pymupdf.Rect(300, 318, 340, 330)),
             "stroke": "#ff0000", "fill": "#ff0000", "width": 0}
    after = pixels(bake(scan, ops(shape, ocr_edit(cover)), ctx))
    s = DPI / 72
    assert tuple(after[int(324 * s), int(320 * s)]) == (255, 0, 0)


def test_a_redaction_keeps_its_look_over_a_cover(scan, ctx):
    cover = body_cover()
    redact = {"id": "r", "type": "redact.add", "pageKey": "o0", "rect": R(pymupdf.Rect(80, 318, 120, 334)), "fill": "black"}
    after = pixels(bake(scan, ops(redact, ocr_edit(cover)), ctx))
    s = DPI / 72
    assert tuple(after[int(326 * s), int(100 * s)]) == (0, 0, 0)


def test_cover_outside_the_page_is_clipped(scan, ctx):
    big = pymupdf.Rect(-50, 800, 700, 900)
    out = bake(scan, ops(ocr_edit(big, text="x")), ctx)
    (fill,) = [d for d in out[0].get_drawings() if d.get("fill")]
    assert fill["rect"] == pymupdf.Rect(0, 800, 595, 842)


def test_ocr_edits_are_validated():
    cover = body_cover()
    with pytest.raises(ValidationError):  # one edit per page and OCR paragraph
        ops(ocr_edit(cover, op_id="a"), ocr_edit(cover, op_id="b"))
    with pytest.raises(ValidationError):  # not an original paragraph's id
        ops(ocr_edit(cover, pid="g3"))
    bad = ocr_edit(cover)
    bad["cover"]["w"] = float("inf")
    with pytest.raises(ValidationError):
        ops(bad)
    bad = ocr_edit(cover, colour="white")
    with pytest.raises(ValidationError):
        ops(bad)
    assert len(ops(ocr_edit(cover, op_id="a"), ocr_edit(cover, op_id="b", pid="ocr13"))) == 2


def test_export_needs_no_ocr_and_no_paragraph_version(client, scan, monkeypatch):
    """A draft's OCR edit exports without OCR running again (the op carries its cover and box) and with any
    paragraphs_version (OCR ids are not original paragraph ids)."""
    def no_ocr(*a, **k):
        raise AssertionError("the export ran OCR")
    monkeypatch.setattr(ocr, "run_tesseract", no_ocr)
    doc = upload(client, scan).json()["doc_id"]
    r = client.post(f"/documents/{doc}/export", json={"ops": [ocr_edit(body_cover())], "paragraphs_version": 1})
    assert r.status_code == 200, r.text
    assert pymupdf.open(stream=r.content, filetype="pdf")[0].get_text().count(NEW) == 1
