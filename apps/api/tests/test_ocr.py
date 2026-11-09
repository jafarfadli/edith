"""M5d: OCR of text that is a picture (POST /documents/{id}/pages/{n}/ocr). Tests that run Tesseract skip when it is not
installed (with ind + eng); CI installs it and sets EDITH_REQUIRE_TESSERACT=1, which turns that skip into a failure."""
import os
import re
import stat
import time

import numpy as np
import pymupdf
import pytest

from edith import ocr
from edith.errors import OcrFailed, OcrTimeout
from edith.fonts import FontRegistry
from edith.settings import Settings
from tests.pdfs import (SCAN_BODY, SCAN_ROWS, SCAN_TABLE, SCAN_TABLE_RECT, SCAN_TITLE, make_raster_text_pdf,
                        make_scan_form_pdf, make_pdf, scan_form_words)
from tests.test_documents import upload

HAVE_TESSERACT = ocr.available()
needs_tesseract = pytest.mark.skipif(not HAVE_TESSERACT, reason="tesseract with ind+eng is not installed")
PARAGRAPH_KEYS = {"id", "rect", "lines", "runs", "align", "lineHeight", "editable"}


def registry() -> FontRegistry:
    return FontRegistry(Settings().fonts_dir)


def text(p: dict) -> str:
    return "".join(r["text"] for r in p["runs"])


def iou(a: pymupdf.Rect, b: pymupdf.Rect) -> float:
    inter = a & b
    if inter.is_empty:
        return 0.0
    i = inter.width * inter.height
    return i / (a.width * a.height + b.width * b.height - i)


def test_ci_has_tesseract():
    if os.environ.get("EDITH_REQUIRE_TESSERACT") == "1":
        assert HAVE_TESSERACT, "EDITH_REQUIRE_TESSERACT=1 but tesseract with ind+eng is not installed"


def test_tsv_words_keep_text_confidence_box_and_line():
    tsv = ("level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
           "1\t1\t0\t0\t0\t0\t0\t0\t100\t50\t-1\t\n"
           "5\t1\t2\t1\t3\t1\t10\t20\t30\t12\t96.5\tNama\n"
           "5\t1\t2\t1\t3\t2\t50\t20\t5\t12\t95\t \n"
           "5\t1\t2\t1\t3\t3\t60\t20\t0\t12\t90\tx\n")
    assert ocr.parse_tsv(tsv) == [ocr.Word("Nama", 96.5, (10, 20, 40, 32), (2, 1, 3))]


def _script(tmp_path, body: str) -> str:
    path = tmp_path / "fake-tesseract"
    path.write_text("#!/bin/sh\n" + body + "\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return str(path)


def test_tesseract_is_killed_at_the_timeout(tmp_path):
    cmd = _script(tmp_path, "sleep 5")
    start = time.monotonic()
    with pytest.raises(OcrTimeout):
        ocr.run_tesseract(b"png", 300, 0.3, cmd)
    assert time.monotonic() - start < 3


def test_tesseract_failing_is_an_error(tmp_path):
    with pytest.raises(OcrFailed):
        ocr.run_tesseract(b"png", 300, 5, _script(tmp_path, "echo broken >&2; exit 3"))


def test_tesseract_gets_the_image_on_stdin_and_no_shell(tmp_path):
    """The command line is fixed (no shell): the image arrives on stdin, the TSV is read from stdout."""
    out = tmp_path / "args"
    cmd = _script(tmp_path, f'echo "$@" > {out}; cat > /dev/null; printf "level\\n5\\t1\\t1\\t1\\t1\\t1\\t1\\t2\\t3\\t4\\t90\\tok\\n"')
    assert [w.text for w in ocr.run_tesseract(b"png", 300, 5, cmd)] == ["ok"]
    assert out.read_text().split() == ["stdin", "stdout", "-l", "ind+eng", "--dpi", "300", "--psm", "3", "tsv"]


def test_touching_pictures_are_read_as_one():
    """A scan stored as strips: its lines on the seams must not be cut in two."""
    rects = [pymupdf.Rect(84, 173, 512, 345), pymupdf.Rect(84, 345, 512, 517), pymupdf.Rect(84, 517.5, 512, 689),
             pymupdf.Rect(84, 720, 300, 800)]
    assert ocr._merged(rects) == [pymupdf.Rect(84, 173, 512, 689), pymupdf.Rect(84, 720, 300, 800)]


def test_a_picture_is_rendered_coarser_to_stay_within_the_pixel_budget():
    a4 = [pymupdf.Rect(0, 0, 595, 842)]
    assert ocr._dpi(a4, ocr.MAX_PIXELS) == 300
    assert 150 <= ocr._dpi(a4, 5_000_000) < 300
    assert ocr._dpi(a4, 1_000_000) is None


def test_lines_drawn_in_a_picture_are_found():
    ink = np.zeros((200, 400), dtype=bool)
    ink[50:52, 20:380] = True      # a horizontal rule, 2 px thick
    ink[10:190, 300:303] = True    # a vertical one
    ink[100:140, 40:200] = True    # a dark block: not a line
    ink[160, 20:40] = True         # too short
    h, v = ocr._rules(ink, min_len=100, max_thick=6)
    assert [(at, lo, hi, t) for at, lo, hi, t in h] == [(51.0, 20, 380, 2)]
    assert [(at, lo, hi, t) for at, lo, hi, t in v] == [(301.5, 10, 190, 3)]


def test_finding_lines_stays_linear_on_a_picture_full_of_long_runs():
    """A ruled or dark picture: thousands of long runs must not be matched against every group found so far."""
    ink = np.zeros((3000, 2400), dtype=bool)
    ink[::2, 100:2300] = True  # a long run on every other row: 1500 separate one-row lines
    start = time.monotonic()
    h, v = ocr._rules(ink, min_len=100, max_thick=12)
    assert len(h) == 1500 and v == []
    assert time.monotonic() - start < 2


def test_a_cover_never_takes_another_paragraphs_letters():
    ink = pymupdf.Rect(72, 300, 300, 310)
    cover = pymupdf.Rect(70, 298, 302, 312)
    above = pymupdf.Rect(72, 290, 200, 299)   # descenders of a line set tight above
    beside = pymupdf.Rect(301, 300, 340, 310)  # a word close to its right
    far = pymupdf.Rect(72, 400, 200, 410)
    assert ocr._clear_of(cover, ink, [above, beside, far], 0.24) == pymupdf.Rect(70, 299.24, 300.76, 312)


def _region(grey: np.ndarray, rgb: np.ndarray | None = None) -> ocr._Region:
    rgb = rgb if rgb is not None else np.repeat(grey[:, :, None], 3, axis=2)
    region = ocr._Region(rect=pymupdf.Rect(0, 0, grey.shape[1] * 72 / 300, grey.shape[0] * 72 / 300), dpi=300,
                         rgb=rgb, grey=grey, threshold=128.0, mid=128.0)
    return region


def test_background_is_the_paper_around_the_ink_and_says_when_it_is_not_plain():
    grey = np.full((100, 200), 235, dtype=np.uint8)
    rgb = np.zeros((100, 200, 3), dtype=np.uint8)
    rgb[:] = (240, 233, 220)
    grey[40:60, 20:180:6] = 20  # strokes
    rgb[40:60, 20:180:6] = (20, 20, 20)
    region = _region(grey, rgb)
    colour, plain = ocr._background(pymupdf.Rect(0, 0, 48, 24), region)
    assert colour == "#f0e9dc" and plain
    gradient = np.tile(np.linspace(140, 250, 200).astype(np.uint8), (100, 1))
    colour, plain = ocr._background(pymupdf.Rect(0, 0, 48, 24), _region(gradient))
    assert not plain


def test_a_checkbox_read_as_a_letter_is_told_from_a_letter():
    grey = np.full((60, 60), 255, dtype=np.uint8)
    grey[10:12, 10:40] = grey[38:40, 10:40] = 0
    grey[10:40, 10:12] = grey[10:40, 38:40] = 0
    assert ocr._checkbox(ocr.Word("O", 60, (10, 10, 40, 40), (1, 1, 1)), _region(grey))
    letter = np.full((60, 60), 255, dtype=np.uint8)
    letter[10:40, 10:13] = letter[10:40, 37:40] = letter[37:40, 10:40] = 0  # a "U": no top
    assert not ocr._checkbox(ocr.Word("U", 60, (10, 10, 40, 40), (1, 1, 1)), _region(letter))


def test_a_dot_leader_read_as_letters_is_told_from_a_word():
    grey = np.full((40, 300), 255, dtype=np.uint8)
    for x in range(10, 290, 12):
        grey[30:34, x:x + 4] = 0  # dots on the baseline
    assert ocr._leader(ocr.Word("Aam ain", 20, (5, 5, 295, 35), (1, 1, 1)), _region(grey), usual=30)
    word = np.full((40, 300), 255, dtype=np.uint8)
    for x in range(10, 290, 20):
        word[10:34, x:x + 4] = 0  # tall strokes
    assert not ocr._leader(ocr.Word("Nama", 90, (5, 5, 295, 35), (1, 1, 1)), _region(word), usual=30)


def test_a_rotated_page_is_not_read():
    page = pymupdf.open(stream=make_scan_form_pdf(), filetype="pdf")[0]
    page.set_rotation(90)
    assert ocr.ocr_page(page, registry(), "tesseract-not-called")["quality"] == "rotated"


def test_a_page_without_a_picture_of_print_reads_nothing():
    page = pymupdf.open(stream=make_pdf(1), filetype="pdf")[0]
    result = ocr.ocr_page(page, registry(), "tesseract-not-called")
    assert result["quality"] == "none" and result["paragraphs"] == []


def test_a_picture_too_large_even_at_the_lowest_resolution_is_refused():
    page = pymupdf.open(stream=make_scan_form_pdf(), filetype="pdf")[0]
    assert ocr.ocr_page(page, registry(), "tesseract-not-called", max_pixels=100_000)["quality"] == "too_large"


# --- the endpoint ------------------------------------------------------------------------------------------------------

def test_endpoint_without_tesseract_says_so(tmp_path):
    from fastapi.testclient import TestClient
    from edith.main import create_app
    with TestClient(create_app(Settings(data_dir=tmp_path / "d", tesseract_cmd=str(tmp_path / "none")))) as c:
        doc = upload(c, make_scan_form_pdf()).json()["doc_id"]
        r = c.post(f"/documents/{doc}/pages/0/ocr")
        assert r.status_code == 503 and r.json()["error"]["code"] == "ocr_unavailable"


def test_endpoint_unknown_page_and_document(client):
    doc = upload(client, make_scan_form_pdf()).json()["doc_id"]
    assert client.post(f"/documents/{doc}/pages/3/ocr").json()["error"]["code"] == "page_not_found"
    assert client.post("/documents/" + "x" * 22 + "/pages/0/ocr").status_code == 404


def test_one_ocr_at_a_time_per_document_and_a_bounded_number_per_server(client, monkeypatch):
    monkeypatch.setattr(ocr, "available", lambda configured=None: True)
    monkeypatch.setattr(ocr, "tesseract_cmd", lambda configured=None: "tesseract")
    doc = upload(client, make_scan_form_pdf()).json()["doc_id"]
    other = upload(client, make_raster_text_pdf()).json()["doc_id"]
    gate = client.app.state.ocr_gate
    gate.enter(doc)
    try:
        r = client.post(f"/documents/{doc}/pages/0/ocr")
        assert r.status_code == 429 and r.json()["error"]["code"] == "ocr_busy"
        gate.enter("third")  # the second (last) slot
        try:
            assert client.post(f"/documents/{other}/pages/0/ocr").status_code == 429
        finally:
            gate.leave("third")
    finally:
        gate.leave(doc)


@needs_tesseract
def test_endpoint_reads_a_scanned_form_into_paragraphs(client):
    doc = upload(client, make_scan_form_pdf()).json()["doc_id"]
    r = client.post(f"/documents/{doc}/pages/0/ocr")
    assert r.status_code == 200
    body = r.json()
    assert body["quality"] == "ok" and body["index"] == 0 and abs(body["angle"]) < 0.3
    ps = body["paragraphs"]
    assert [p["id"] for p in ps] == [f"ocr{i}" for i in range(len(ps))]
    for p in ps:
        assert PARAGRAPH_KEYS <= set(p) and p["ocr"] is True and p["editable"] is True and 0 <= p["confidence"] <= 1
        assert re.fullmatch(r"#[0-9a-f]{6}", p["coverColor"]) and p["coverUniform"] is True
        assert all(r["font"]["kind"] == "bundled" and r["font"]["family"] in ("Arimo", "Tinos") for r in p["runs"])
        c, rect = p["cover"], p["rect"]
        assert c["x"] <= rect["x"] + 0.5 and c["x"] + c["w"] >= rect["x"] + rect["w"] - 0.5  # covers the text …
        assert c["w"] <= rect["w"] + 6 and c["h"] <= rect["h"] + 6                           # … and little else
    texts = [text(p) for p in ps]
    assert texts[0] == SCAN_TITLE
    title = ps[0]["runs"][0]
    assert title["size"] == 14 and title["font"] == {"kind": "bundled", "family": "Tinos", "bold": True, "italic": False}
    assert " ".join(SCAN_BODY) in texts
    body_run = ps[texts.index(" ".join(SCAN_BODY))]["runs"][0]
    assert body_run["size"] == 11 and body_run["color"] == "#000000" and not body_run["font"]["bold"]
    assert all(label in texts for label, _ in SCAN_ROWS) and SCAN_ROWS[0][1] in texts
    # Table cells are paragraphs of their own, each with room up to its cell's border.
    no = ps[texts.index(SCAN_TABLE[1][0])]
    assert no["maxWidth"] < 112 - SCAN_TABLE_RECT[0]
    assert sum(p["confidence"] >= 0.75 for p in ps) >= len(ps) - 2


@needs_tesseract
@pytest.mark.parametrize("variant,least", [
    (dict(family="Tinos"), 0.88),
    (dict(family="Arimo"), 0.86),
    (dict(family="Tinos", angle=0.7, blur=True, noise=12, jpeg=75, paper=(0.97, 0.96, 0.92)), 0.86),
    (dict(family="Arimo", angle=-1.0, noise=18, jpeg=60, paper=(0.96, 0.94, 0.88), ink=(0.1, 0.12, 0.4)), 0.86),
    (dict(family="Tinos", dpi=200, blur=True, noise=10, jpeg=70), 0.86),
])
def test_word_accuracy_and_boxes_on_synthetic_scans(variant, least):
    """Measured (scripts/ocr_accuracy.py, Tesseract 5.5 with the standard ind/eng models): 93–95 % of the words exact,
    edges within 0.3–0.7 pt. The bounds leave room for other model builds (Debian's packages in CI)."""
    page = pymupdf.open(stream=make_scan_form_pdf(**variant), filetype="pdf")[0]
    words: list = []
    result = ocr.ocr_page(page, registry(), ocr.tesseract_cmd(), words_out=words)
    assert result["quality"] == "ok"
    truth = scan_form_words(variant.get("family", "Tinos"), variant.get("angle", 0.0))
    hits, errors = 0, []
    for t, box in truth:
        best = max(words, key=lambda w: iou(w[2], box))
        if iou(best[2], box) >= 0.3:
            hits += best[0] == t
            errors.append((abs(best[2].x0 - box.x0) + abs(best[2].x1 - box.x1)) / 2)
    assert hits / len(truth) >= least
    assert sum(errors) / len(errors) < 1.0
    sizes = sorted(r["size"] for p in result["paragraphs"] for r in p["runs"])
    assert sizes[len(sizes) // 2] == 11
    family = {r["font"]["family"] for p in result["paragraphs"] for r in p["runs"]}
    assert family == {variant.get("family", "Tinos")}


@needs_tesseract
def test_a_skewed_scan_is_reported_not_read():
    page = pymupdf.open(stream=make_scan_form_pdf(angle=3.0), filetype="pdf")[0]
    result = ocr.ocr_page(page, registry(), ocr.tesseract_cmd())
    assert result["quality"] == "skewed" and result["paragraphs"] == [] and 2.5 < result["angle"] < 3.5


@needs_tesseract
def test_coloured_paper_and_ink_are_sampled():
    page = pymupdf.open(stream=make_scan_form_pdf(paper=(0.96, 0.94, 0.88), ink=(0.1, 0.12, 0.4)), filetype="pdf")[0]
    ps = ocr.ocr_page(page, registry(), ocr.tesseract_cmd())["paragraphs"]

    def rgb(h):
        return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
    for p in ps:
        assert max(abs(a - b) for a, b in zip(rgb(p["coverColor"]), (245, 240, 224))) <= 4
        ink = rgb(p["runs"][0]["color"])
        assert ink[2] > ink[0] + 40 and max(ink) < 130  # dark blue
