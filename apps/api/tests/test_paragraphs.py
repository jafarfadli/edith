import pymupdf
import pytest

from edith.paragraphs import extract_paragraphs
from tests.pdfs import LOREM, make_edit_pdf, make_paragraphs_pdf


def paragraphs(data: bytes, resolve=None) -> list[dict]:
    return extract_paragraphs(pymupdf.open(stream=data, filetype="pdf")[0], resolve)


def text(p: dict) -> str:
    return "".join(r["text"] for r in p["runs"])


def page_with(draw) -> bytes:
    doc = pymupdf.open()
    draw(doc.new_page(width=595, height=842))
    return doc.tobytes()


def test_boundaries_and_text():
    ps = paragraphs(make_paragraphs_pdf())
    assert [text(p) for p in ps] == [
        "Paragraf A baris satu yang cukup panjang baris dua lanjutan paragraf A baris tiga akhir A.",
        LOREM,
        "Paragraf C1 baris pertama yang panjang sekali akhir C1.",            # split from C2 by its indent
        "Paragraf C2 dimulai dengan indentasi baris pertama lalu berlanjut.",
        "Judul Besar",                                                        # split by the size change
        "Isi di bawah judul.",
        "Baris tengah pertama yang lebar lebih pendek tengah",
        "Teks diputar",
    ]
    assert [p["id"] for p in ps] == [f"g{i}" for i in range(8)]


def test_align_line_height_and_editable():
    ps = paragraphs(make_paragraphs_pdf())
    assert [p["align"] for p in ps] == ["left", "justify", "left", "left", "left", "left", "center", "left"]
    assert ps[0]["lineHeight"] == 14.4
    assert ps[4]["lineHeight"] == pytest.approx(21.6)  # single line: 1.2 × size
    assert [p["editable"] for p in ps] == [True] * 7 + [False]  # rotated text is shown, not edited


def test_lines_index_the_joined_text():
    p = paragraphs(make_paragraphs_pdf())[0]
    t = text(p)
    assert [t[ln["start"]:ln["end"]] for ln in p["lines"]] == [
        "Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A", "baris tiga akhir A."]
    assert [ln["baseline"] for ln in p["lines"]] == [100, 114.4, 128.8]
    assert p["lines"][0]["size"] == 12
    assert p["rect"]["x"] == 72 and p["lines"][0]["rect"]["x"] == 72


@pytest.mark.parametrize("align", [pymupdf.TEXT_ALIGN_CENTER, pymupdf.TEXT_ALIGN_RIGHT, pymupdf.TEXT_ALIGN_JUSTIFY])
def test_textbox_alignments_stay_one_paragraph(align):
    """MuPDF splits the last line of centered/right text and wide justified gaps into extra blocks."""
    data = page_with(lambda pg: pg.insert_textbox(pymupdf.Rect(300, 100, 500, 300), LOREM, fontname="helv",
                                                  fontsize=12, align=align))
    ps = paragraphs(data)
    assert len(ps) == 1 and text(ps[0]) == LOREM
    assert ps[0]["align"] == {pymupdf.TEXT_ALIGN_CENTER: "center", pymupdf.TEXT_ALIGN_RIGHT: "right",
                              pymupdf.TEXT_ALIGN_JUSTIFY: "justify"}[align]


def test_tight_leading_still_splits_on_indent():
    ps = paragraphs(make_edit_pdf())
    assert [text(p) for p in ps] == ["Paragraf yang diedit baris satu baris dua.",
                                     "Paragraf tetangga tetap utuh di sini sampai akhir."]
    assert ps[0]["lineHeight"] == 12


def test_runs_merge_same_style_and_split_on_color():
    def draw(pg):
        w = pymupdf.get_text_length("Merah ", fontname="helv", fontsize=12)
        pg.insert_text((72, 100), "Merah ", fontname="helv", fontsize=12, color=(1, 0, 0))
        pg.insert_text((72 + w, 100), "biru", fontname="helv", fontsize=12, color=(0, 0, 1))
    runs = paragraphs(page_with(draw), resolve=lambda span: {"kind": "bundled", "family": "Arimo"})[0]["runs"]
    assert [(r["text"], r["color"], r["size"]) for r in runs] == [("Merah ", "#ff0000", 12), ("biru", "#0000ff", 12)]
    assert runs[0]["font"] == {"kind": "bundled", "family": "Arimo"}


def test_clean_maps_nbsp_and_tab_to_space():
    from edith.paragraphs import _clean
    assert _clean("a\xa0b\tc") == "a b c"


def test_hyphenated_soft_break_joins_without_space():
    def draw(pg):
        pg.insert_text((72, 100), "sambung-", fontname="helv", fontsize=12)
        pg.insert_text((72, 114.4), "an teks", fontname="helv", fontsize=12)
    p = paragraphs(page_with(draw))[0]
    assert text(p) == "sambung-an teks"


def test_soft_break_space_lands_in_previous_run_when_styles_differ():
    def draw(pg):
        pg.insert_text((72, 100), "Merah", fontname="helv", fontsize=12, color=(1, 0, 0))
        pg.insert_text((72, 114.4), "biru", fontname="helv", fontsize=12, color=(0, 0, 1))
    p = paragraphs(page_with(draw))[0]
    assert [(r["text"], r["color"]) for r in p["runs"]] == [("Merah ", "#ff0000"), ("biru", "#0000ff")]
    assert [(ln["start"], ln["end"]) for ln in p["lines"]] == [(0, 5), (6, 10)]


def test_line_ending_in_space_excludes_it_from_end():
    def draw(pg):
        pg.insert_text((72, 100), "satu dua ", fontname="helv", fontsize=12)
        pg.insert_text((72, 114.4), "tiga", fontname="helv", fontsize=12)
    p = paragraphs(page_with(draw))[0]
    assert text(p) == "satu dua tiga"
    assert [(ln["start"], ln["end"]) for ln in p["lines"]] == [(0, 8), (9, 13)]
