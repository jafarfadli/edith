import pymupdf
import pytest

from edith.paragraphs import extract_paragraphs
from tests.pdfs import FONT_FILES, FORM_EN, FORM_JA, FORM_KO, LOREM, make_edit_pdf, make_form_table_pdf, make_paragraphs_pdf


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
        "Paragraf A baris satu yang cukup panjang baris dua lanjutan paragraf A yang berakhir di baris tiga A.",
        LOREM,
        "Paragraf C1 baris pertama yang panjang sekali akhir C1.",            # split from C2 by its indent
        "Paragraf C2 dimulai dengan indentasi baris pertama lalu berlanjut.",
        "Judul Besar",                                                        # split by the size change
        "Isi di bawah judul.",
        "Baris tengah pertama yang lebar lebih pendek namun tetap seimbang",
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
        "Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A yang", "berakhir di baris tiga A."]
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
        w = pymupdf.get_text_length("Biru lalu ", fontname="helv", fontsize=12)
        pg.insert_text((72, 100), "Biru lalu ", fontname="helv", fontsize=12, color=(0, 0, 1))
        pg.insert_text((72 + w, 100), "Merah", fontname="helv", fontsize=12, color=(1, 0, 0))
        pg.insert_text((72, 114.4), "biru", fontname="helv", fontsize=12, color=(0, 0, 1))
    p = paragraphs(page_with(draw))[0]
    assert [(r["text"], r["color"]) for r in p["runs"]] == [("Biru lalu ", "#0000ff"), ("Merah ", "#ff0000"), ("biru", "#0000ff")]
    assert [(ln["start"], ln["end"]) for ln in p["lines"]] == [(0, 15), (16, 20)]


def test_line_ending_in_space_excludes_it_from_end():
    def draw(pg):
        pg.insert_text((72, 100), "satu dua ", fontname="helv", fontsize=12)
        pg.insert_text((72, 114.4), "tiga", fontname="helv", fontsize=12)
    p = paragraphs(page_with(draw))[0]
    assert text(p) == "satu dua tiga"
    assert [(ln["start"], ln["end"]) for ln in p["lines"]] == [(0, 8), (9, 13)]


def test_paragraphs_version_is_pinned():
    from edith.paragraphs import PARAGRAPHS_VERSION
    assert PARAGRAPHS_VERSION == 2  # shared with apps/web/src/lib/paragraphs.ts; bump both when ids can change


def test_form_table_segments_like_a_form():
    assert [text(p) for p in paragraphs(make_form_table_pdf())] == [
        "<How to fill out this form>",                    # ended early: a hard break
        "• Fill out this form completely and correctly.",  # every bullet starts an item …
        "• Write in block letters either in English or Korean.",
        "• Check all that apply.",
        "1.1 Full name in English (as shown in passport)",  # … a cell border keeps neighbours on one baseline apart
        "1.2 Sex",
        "Family Name",                                     # below the field rule, same text block
        "Long-term stay over 90 days      [   ]",          # checkbox rows are laid out with spaces
        "Short-term stay below 90 days    [   ]",
        FORM_EN,                                           # wrapped text in a cell stays one paragraph
        "SECTION TWO: GENERAL CONDITIONS OF THE APPLICATION",  # bold heading, though as wide as a full line
        "Body text right below the heading.",
        FORM_JA,                                           # wrapped by character, joined without spaces
        "短い行。",
        FORM_JA[:12],
        FORM_KO,                                           # Korean wraps at spaces
        "짧은 줄.",
        FORM_KO[:12],
    ]


@pytest.mark.parametrize("rotation", [0, 90])
@pytest.mark.parametrize("rule", [True, False])
def test_vertical_rule_keeps_cells_on_one_baseline_apart(rotation, rule):
    def draw(pg):
        w = pymupdf.get_text_length("Left cell text", fontname="helv", fontsize=10)
        pg.insert_text((100, 100), "Left cell text", fontname="helv", fontsize=10)
        if rule:
            pg.draw_line((100 + w + 5, 80), (100 + w + 5, 120))
        pg.insert_text((100 + w + 10, 100), "Right cell", fontname="helv", fontsize=10)
        pg.set_rotation(rotation)
    got = [text(p) for p in paragraphs(page_with(draw))]
    assert got == (["Left cell text", "Right cell"] if rule else ["Left cell text Right cell"])


def test_underline_does_not_split_but_a_rule_between_lines_does():
    def draw(pg):
        for i, t in enumerate(["Sebuah paragraf dengan garis bawah", "pada baris pertamanya saja."]):
            pg.insert_text((72, 100 + 14 * i), t, fontname="helv", fontsize=11)
        pg.draw_line((72, 101.5), (200, 101.5), width=0.6)  # underline: 1.5 pt below the baseline
        for i, t in enumerate(["Label di atas garis isian formulir", "Isian di bawah garis."]):
            pg.insert_text((72, 200 + 14 * i), t, fontname="helv", fontsize=11)
        pg.draw_line((60, 205), (400, 205), width=0.5)  # a field rule between the lines
    assert [text(p) for p in paragraphs(page_with(draw))] == [
        "Sebuah paragraf dengan garis bawah pada baris pertamanya saja.",
        "Label di atas garis isian formulir", "Isian di bawah garis."]


def test_hard_break_after_a_line_that_ended_early():
    """An address: each line ended before the widest one with room for the next line's first word. (The widest
    line itself can't end early, so a block whose first line is the longest keeps its second line.)"""
    lines = ["Jl. Merdeka 17", "Gambir", "Jakarta Pusat, DKI Jakarta 10110"]

    def draw(pg):
        for i, t in enumerate(lines):
            pg.insert_text((72, 100 + 13 * i), t, fontname="helv", fontsize=11)
    assert [text(p) for p in paragraphs(page_with(draw))] == lines


def test_list_item_continues_only_past_its_bullet():
    def draw(pg):
        pg.insert_font(fontname="AR", fontfile=str(FONT_FILES / "Arimo-Regular.ttf"))
        rows = [(72, "• Butir pertama yang cukup panjang sehingga"), (80, "berlanjut ke baris kedua."),
                (72, "• Butir kedua yang juga cukup panjang hingga"), (72, "tidak menggantung di bawah butir.")]
        for i, (x, t) in enumerate(rows):
            pg.insert_text((x, 100 + 13 * i), t, fontname="AR", fontsize=11)
    assert [text(p) for p in paragraphs(page_with(draw))] == [
        "• Butir pertama yang cukup panjang sehingga berlanjut ke baris kedua.",
        "• Butir kedua yang juga cukup panjang hingga", "tidak menggantung di bawah butir."]


def test_first_word_of_cjk_is_one_character():
    from edith.paragraphs import _first_word

    def chars(text: str, w: float = 10.0) -> list[dict]:
        return [{"c": c, "bbox": (i * w, 0, (i + 1) * w, 10)} for i, c in enumerate(text)]
    assert _first_word(chars("  word next")) == 40      # spaces skipped, up to the next space
    assert _first_word(chars("日本語")) == 10            # Han / kana: one character …
    assert _first_word(chars("本、次")) == 20            # … plus punctuation right after it
    assert _first_word(chars("한국어 단어")) == 30        # Hangul: a word (eojeol)
    assert _first_word(chars("   ")) == 0


def test_inline_bold_phrase_or_link_does_not_split_prose():
    """A wrapped line that is mostly a bold phrase / link is still prose; a whole bold heading is not."""
    def draw(pg):
        pg.insert_font(fontname="AR", fontfile=str(FONT_FILES / "Arimo-Regular.ttf"))
        pg.insert_font(fontname="AB", fontfile=str(FONT_FILES / "Arimo-Bold.ttf"))
        plain, bold = "AR", "AB"
        pg.insert_text((72, 100), "Teks biasa pada baris pertama yang cukup panjang", fontname=plain, fontsize=11)
        pg.insert_text((72, 113), "kedua masih biasa dan terus berlanjut ke bawah", fontname=plain, fontsize=11)
        w = pymupdf.Font(fontfile=str(FONT_FILES / "Arimo-Regular.ttf")).text_length("sedikit ", fontsize=11)
        pg.insert_text((72, 126), "sedikit ", fontname=plain, fontsize=11)
        pg.insert_text((72 + w, 126), "frasa tebal yang memenuhi sebagian baris", fontname=bold, fontsize=11,
                       color=(0, 0, 1))
        pg.insert_text((72, 139), "lalu kembali biasa sampai akhir kalimat ini.", fontname=plain, fontsize=11)
    ps = paragraphs(page_with(draw))
    assert len(ps) == 1


def test_uniform_bold_heading_still_splits_from_body():
    def draw(pg):
        pg.insert_font(fontname="AR", fontfile=str(FONT_FILES / "Arimo-Regular.ttf"))
        pg.insert_font(fontname="AB", fontfile=str(FONT_FILES / "Arimo-Bold.ttf"))
        pg.insert_text((72, 100), "Judul Bagian", fontname="AB", fontsize=11)
        pg.insert_text((72, 113), "Isi bagian dimulai di sini dan berlanjut", fontname="AR", fontsize=11)
        pg.insert_text((72, 126), "ke baris berikutnya sampai selesai.", fontname="AR", fontsize=11)
    assert [text(p) for p in paragraphs(page_with(draw))] == [
        "Judul Bagian", "Isi bagian dimulai di sini dan berlanjut ke baris berikutnya sampai selesai."]


def test_korean_form_fixture_segments_cell_by_cell():
    from tests.pdfs import KO_LABEL, make_korean_form_pdf
    assert [text(p) for p in paragraphs(make_korean_form_pdf())] == [
        "<신청서 작성방법>", "※ 신청서는 한글 또는 영문으로 작성합니다.", "※ 해당 칸에 표시를 하시기 바랍니다.",
        KO_LABEL, "1.2 성별 Sex", "성 Family Name", "남성 Male      [   ]", "여성 Female    [   ]"]


def test_single_lines_get_room_up_to_the_next_rule_or_text():
    from tests.pdfs import make_korean_form_pdf
    ps = {text(p): p for p in paragraphs(make_korean_form_pdf())}
    assert ps["1.1 성명 Full name in English"]["maxWidth"] == pytest.approx(300 - 2 - ps["1.1 성명 Full name in English"]["rect"]["x"], abs=0.01)  # cell border
    left = min(p["rect"]["x"] for p in ps.values())  # 56
    assert ps["1.2 성별 Sex"]["maxWidth"] == pytest.approx(595 - left - 2 - 306, abs=0.01)  # margin before the table side (545)
    assert ps["<신청서 작성방법>"]["maxWidth"] == pytest.approx(595 - left - 2 - left, abs=0.01)  # mirrored left margin
    wrapped = paragraphs(make_paragraphs_pdf())[0]
    assert len(wrapped["lines"]) == 3 and "maxWidth" not in wrapped  # wrapped text keeps its measure
