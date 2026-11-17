"""edith/paper.py: pages onto another paper, whole or by their content, inside margins."""
import pymupdf
import pytest
from fastapi.testclient import TestClient

from edith import paper
from edith.main import create_app
from edith.settings import Settings

F4 = (215 * paper.MM, 330 * paper.MM)


def f4_pdf(pages: int = 2, rotate: int = 0) -> pymupdf.Document:
    """F4 pages with a block of text from (100, 120) to about (460, 300); the last page landscape when asked."""
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=F4[0], height=F4[1])
        for k in range(8):
            page.insert_text((100, 130 + k * 22), f"Baris {k + 1} halaman {i + 1} " + "isi " * 12, fontsize=11)
        if rotate:
            page.set_rotation(rotate)
    return pymupdf.open("pdf", doc.tobytes())


def words(doc: pymupdf.Document, i: int = 0):
    return doc[i].get_text("words")


def test_content_box_is_where_the_ink_is():
    box = paper.content_box(f4_pdf(1)[0])
    assert 92 < box.x0 < 102 and 115 < box.y0 < 125 and box.y1 < 300
    assert paper.content_box(pymupdf.open().new_page()) is None


def test_whole_page_scaled_onto_a4_keeps_text_as_text():
    out = pymupdf.open("pdf", paper.resize(f4_pdf(), "a4", "page", "none"))
    assert out.page_count == 2
    assert (round(out[0].rect.width), round(out[0].rect.height)) == (595, 842)
    assert words(out)[0][4] == "Baris"
    # Scaled by the height (330 → 297 mm): 0.9, centred across.
    x0 = words(out)[0][0]
    assert abs(x0 - (100 * 0.9 + (595.28 - F4[0] * 0.9) / 2)) < 3


def test_content_laid_inside_thesis_margins_from_the_top():
    out = pymupdf.open("pdf", paper.resize(f4_pdf(), "a4", "content", "thesis"))
    first = words(out)[0]
    assert first[1] >= 4 * paper.CM - 3  # top margin 4 cm
    assert first[0] >= 4 * paper.CM - 3  # left margin 4 cm
    right = max(w[2] for w in words(out))
    assert right <= 595.28 - 3 * paper.CM + 3


def test_one_scale_for_the_whole_document_and_landscape_kept():
    doc = f4_pdf(2)
    doc[1].insert_text((100, 900), "kaki halaman jauh di bawah", fontsize=11)  # the fuller page sets the scale
    out = pymupdf.open("pdf", paper.resize(doc, "a4", "content", "normal"))
    h0 = words(out, 0)[0][3] - words(out, 0)[0][1]
    h1 = words(out, 1)[0][3] - words(out, 1)[0][1]
    assert abs(h0 - h1) < 0.2
    wide = pymupdf.open()
    wide.new_page(width=F4[1], height=F4[0]).insert_text((100, 100), "lebar", fontsize=11)
    out = pymupdf.open("pdf", paper.resize(pymupdf.open("pdf", wide.tobytes()), "a4", "page", "none"))
    assert out[0].rect.width > out[0].rect.height


def test_a_rotated_page_comes_out_upright():
    out = pymupdf.open("pdf", paper.resize(f4_pdf(1, rotate=90), "a4", "content", "narrow"))
    assert out[0].rect.width > out[0].rect.height  # shown landscape, as it was
    line = out[0].get_text("dict")["blocks"][0]["lines"][0]
    assert line["dir"] == (0.0, 1.0)  # the text runs down the page, as a viewer shows the rotated original
    box, before = paper.content_box(out[0]), paper.content_box(f4_pdf(1, rotate=90)[0])
    assert abs(box.height - before.height) < 2 and abs(box.width - before.width) < 2  # at its own size (scale 1)


@pytest.mark.parametrize("field,value", [("paper", "a3"), ("fit", "stretch"), ("margins", "huge")])
def test_bad_options(tmp_path, field, value):
    with TestClient(create_app(Settings(data_dir=tmp_path / "data"))) as c:
        r = c.post("/tools/paper-size", files=[("files", ("a.pdf", f4_pdf(1).tobytes()))], data={field: value})
        assert r.status_code == 400


def test_route_names_the_file_after_the_paper(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path / "data"))) as c:
        r = c.post("/tools/paper-size", files=[("files", ("surat.pdf", f4_pdf(1).tobytes()))],
                   data={"paper": "a4", "fit": "content", "margins": "thesis"})
        assert r.status_code == 200, r.text
        assert "surat-a4.pdf" in r.headers["content-disposition"]
