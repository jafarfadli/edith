import pymupdf
import pytest

from tests.pdfs import make_paragraphs_pdf, make_pdf
from tests.test_documents import upload


def chars_of(client, data: bytes, index: int = 0):
    doc_id = upload(client, data).json()["doc_id"]
    return client.get(f"/documents/{doc_id}/pages/{index}/chars")


def test_lines_with_one_box_per_character(client):
    r = chars_of(client, make_pdf(pages=1))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["index"] == 0
    [line] = body["lines"]
    assert line["text"] == "Page 0" and len(line["boxes"]) == 6
    assert line["baseline"] == 72 and line["size"] == 14
    assert line["boxes"][0][0] == 72
    expected = 72 + pymupdf.get_text_length("Page 0", fontname="helv", fontsize=14)
    assert line["boxes"][-1][1] == pytest.approx(expected, abs=0.01)
    xs = [x for box in line["boxes"] for x in box]
    assert xs == sorted(xs)  # left to right, boxes touch


def test_rotated_text_is_left_out(client):
    lines = chars_of(client, make_paragraphs_pdf()).json()["lines"]
    texts = [line["text"] for line in lines]
    assert "Paragraf A baris satu yang cukup panjang" in texts
    assert not any("diputar" in t for t in texts)
    assert all(len(line["text"]) == len(line["boxes"]) for line in lines)


def test_rotated_page_uses_unrotated_coordinates(client):
    [line] = chars_of(client, make_pdf(pages=1, rotation=90)).json()["lines"]
    assert (line["boxes"][0][0], line["baseline"]) == (72, 72)


def test_unknown_page(client):
    r = chars_of(client, make_pdf(pages=1), index=3)
    assert r.status_code == 404 and r.json()["error"]["code"] == "page_not_found"
