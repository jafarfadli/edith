"""OCR of any picture, not only the ones that look like a paragraph of print: POST .../ocr with a `rect` reads that part
of the page (a picture the user picked, an area dragged on it). Text the page already has editable — visible text, a
hidden paragraph whose print was measured — is never read twice."""
import pymupdf
import pytest

from edith import ocr
from edith.routes.ocr import _tidy, _unknown_only
from tests.pdfs import KOP_ADDRESS, KOP_BODY, MAYBE_DARK, MAYBE_LINE, make_kop_pdf, make_maybe_text_pdf
from tests.test_documents import upload
from tests.test_ocr import needs_tesseract


def R(r: dict) -> pymupdf.Rect:
    return pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])


def area(rect) -> dict:
    x0, y0, x1, y1 = rect
    return {"rect": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}}


def text(p: dict) -> str:
    return "".join(r["text"] for r in p["runs"])


@pytest.mark.parametrize("rect", [{"x": 0, "y": 0, "w": 0, "h": 10}, {"x": 700, "y": 0, "w": 50, "h": 50},
                                  {"x": 10, "y": 10, "w": 2, "h": 50}, {"x": 1e308, "y": 0, "w": 1e308, "h": 10},
                                  {"x": 0, "y": -2e5, "w": 50, "h": 50}, {"x": 0, "y": 0, "w": 50, "h": 1e6}])
def test_an_area_outside_the_page_or_too_small_is_refused(client, monkeypatch, rect):
    monkeypatch.setattr(ocr, "available", lambda configured=None: True)
    doc = upload(client, make_maybe_text_pdf()).json()["doc_id"]
    r = client.post(f"/documents/{doc}/pages/0/ocr", json={"rect": rect})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_no_body_reads_the_pictures_of_print_as_before(client, monkeypatch):
    seen = []
    monkeypatch.setattr(ocr, "available", lambda configured=None: True)
    monkeypatch.setattr(ocr, "tesseract_cmd", lambda configured=None: "tesseract")
    monkeypatch.setattr(ocr, "ocr_page", lambda page, reg, cmd, timeout, area: seen.append(area) or {
        "quality": "none", "angle": 0, "dpi": 300, "regions": [], "paragraphs": []})
    doc = upload(client, make_maybe_text_pdf()).json()["doc_id"]
    assert client.post(f"/documents/{doc}/pages/0/ocr").json()["quality"] == "none"
    text_, (x0, y0, x1, y1) = MAYBE_LINE
    client.post(f"/documents/{doc}/pages/0/ocr", json=area((x0, y0, x1, y1)))
    assert seen == [None, pymupdf.Rect(x0, y0, x1, y1)]


def ocr_paragraph(cover: pymupdf.Rect) -> dict:
    c = {"x": cover.x0, "y": cover.y0, "w": cover.width, "h": cover.height}
    return {"id": "ocr0", "cover": c, "covers": [c], "runs": [{"text": "x"}]}


def test_ocr_paragraphs_over_text_the_page_has_are_left_out():
    known = [pymupdf.Rect(100, 100, 106, 110)]  # a visible character
    assert _unknown_only([ocr_paragraph(pymupdf.Rect(90, 95, 200, 115))], known) == []
    assert _unknown_only([ocr_paragraph(pymupdf.Rect(110, 95, 200, 115))], known) != []
    hidden_line = pymupdf.Rect(140, 30, 460, 50)  # a measured hidden line's cover
    assert _unknown_only([ocr_paragraph(pymupdf.Rect(141, 31, 400, 49))], [hidden_line]) == []
    assert _unknown_only([ocr_paragraph(pymupdf.Rect(141, 49.5, 400, 60))], [hidden_line]) != []


@needs_tesseract
def test_a_single_pictured_line_is_read_when_asked(client):
    doc = upload(client, make_maybe_text_pdf()).json()["doc_id"]
    line, rect = MAYBE_LINE
    r = client.post(f"/documents/{doc}/pages/0/ocr", json=area(rect)).json()
    assert r["quality"] == "ok", r
    (p,) = r["paragraphs"]
    assert "Contoh Raya" in text(p) and "Jakarta" in text(p)
    assert all(pymupdf.Rect(*rect).contains(R(c)) for c in p["covers"])
    assert r["regions"] == [{"x": rect[0], "y": rect[1], "w": rect[2] - rect[0], "h": rect[3] - rect[1]}]


@needs_tesseract
def test_light_print_on_a_dark_picture_is_read_when_asked(client):
    doc = upload(client, make_maybe_text_pdf()).json()["doc_id"]
    lines, rect = MAYBE_DARK
    r = client.post(f"/documents/{doc}/pages/0/ocr", json=area(rect)).json()
    assert r["quality"] == "ok", r
    read = " ".join(text(p) for p in r["paragraphs"])
    assert "PEMERINTAH" in read and "KOMUNIKASI" in read


@needs_tesseract
def test_an_area_over_visible_and_hidden_text_reads_only_the_rest(client):
    """Over the kop: its lines are hidden paragraphs (measured), the body line is visible text, the address a picture
    alone: only the address comes back."""
    doc = upload(client, make_kop_pdf()).json()["doc_id"]
    r = client.post(f"/documents/{doc}/pages/0/ocr", json=area((130, 25, 560, 170))).json()
    read = [text(p) for p in r["paragraphs"]]
    assert any("Contoh Raya" in t for t in read), read
    assert not any("KEMENTERIAN" in t or "SEKRETARIAT" in t or "BIRO" in t for t in read), read
    assert not any(KOP_BODY[:10] in t for t in read), read
    address = pymupdf.Rect(*KOP_ADDRESS[2])
    assert all(address.contains(R(c)) for p in r["paragraphs"] for c in p["covers"])


def test_stray_marks_are_no_paragraph():
    mark = {"runs": [{"text": "|"}]}
    word, digit = {"runs": [{"text": "RI"}]}, {"runs": [{"text": " 7 "}]}
    colon, unsure = {"runs": [{"text": ":"}], "confidence": 0.92}, {"runs": [{"text": "°"}], "confidence": 0.3}
    assert _tidy([mark, word, digit, {"runs": [{"text": "–"}]}, colon, unsure]) == [word, digit, colon]


@needs_tesseract
def test_an_area_of_text_already_editable_says_so(client):
    """Over the kop's measured hidden lines only: what OCR reads there is known, and the answer says so."""
    doc = upload(client, make_kop_pdf()).json()["doc_id"]
    r = client.post(f"/documents/{doc}/pages/0/ocr", json=area((138, 28, 522, 90))).json()
    assert r["paragraphs"] == [] and r["quality"] == "known", r
