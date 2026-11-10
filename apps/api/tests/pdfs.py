import io
import struct
from collections.abc import Callable
from pathlib import Path

import pymupdf


def make_pdf(pages: int = 2, text: bool = True, password: str | None = None,
             size: tuple[float, float] = (595, 842), rotation: int = 0,
             crop: tuple[float, float, float, float] | None = None) -> bytes:
    """`crop` is a CropBox in top-left MediaBox coordinates; text is placed crop-relative."""
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=size[0], height=size[1])
        if crop:
            page.set_cropbox(pymupdf.Rect(*crop))
        if text:
            page.insert_text((72, 72), f"Page {i}", fontsize=14)
        if rotation:
            page.set_rotation(rotation)
    if password:
        return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password)
    return doc.tobytes()


def unrotated(doc: pymupdf.Document, index: int = 0) -> pymupdf.Page:
    """A reloaded copy of a baked page with /Rotate removed: its coordinates are then the
    unrotated-CropBox-relative points the ops were expressed in."""
    copy = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    page = copy[index]
    page.set_rotation(0)
    return page


FONT_FILES = Path(__file__).resolve().parents[3] / "packages" / "fonts" / "files"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SUBSET_TTF = FIXTURES / "TinosSubset.ttf"  # fontTools subset of Tinos-Regular: keeps its cmap


def make_fonts_pdf() -> bytes:
    """One line per font kind: standard-14 (not embedded), embedded full TTF, embedded subset TTF
    with a cmap, embedded bare CFF."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Standard Helvetica line", fontname="helv", fontsize=12)
    page.insert_text((72, 140), "Standard Times line", fontname="tiro", fontsize=12)
    page.insert_font(fontname="FA", fontfile=str(FONT_FILES / "Arimo-Regular.ttf"))
    page.insert_text((72, 180), "Embedded Arimo line", fontname="FA", fontsize=12)
    page.insert_font(fontname="FS", fontfile=str(SUBSET_TTF))
    page.insert_text((72, 220), "Subset lorem ipsum", fontname="FS", fontsize=12)
    writer = pymupdf.TextWriter(page.rect)
    writer.append((72, 260), "Courier CFF line", font=pymupdf.Font("cour"), fontsize=12)
    writer.write_text(page)
    return doc.tobytes(garbage=3, deflate=True)


def make_pymupdf_subset_pdf() -> bytes:
    """An embedded TTF subset by PyMuPDF: it has no cmap, so it is reused through one rebuilt from its
    ToUnicode (edith.cid_fonts)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="FC", fontfile=str(FONT_FILES / "Cousine-Regular.ttf"))
    page.insert_text((72, 100), "Cousine subset", fontname="FC", fontsize=12)
    doc.subset_fonts()
    return doc.tobytes(garbage=3, deflate=True)


def rename_font(data: bytes, old: str, new: str) -> bytes:
    """Rename the BaseFont of the font called `old` (e.g. make a standard-14 Helvetica look like Calibri)."""
    doc = pymupdf.open(stream=data, filetype="pdf")
    for xref, *_rest in doc[0].get_fonts(full=True):
        if doc.xref_get_key(xref, "BaseFont")[1] == f"/{old}":
            doc.xref_set_key(xref, "BaseFont", f"/{new}")
    return doc.tobytes()


LOREM = ("Edith menyunting paragraf asli dengan rapi. Teks mengalir ulang di dalam kotak selebar tetap, "
         "dan gaya bisa diatur per kata tanpa merusak baris lain di halaman yang sama.")


def make_paragraphs_pdf() -> bytes:
    """Paragraph layouts for extraction tests (all standard-14 fonts):
    A left 3 lines (Helvetica 12/14.4) · B justified (Times 11) · C1/C2 split by a first-line indent ·
    D heading 18 pt + body 12 pt · E centered · F rotated 90°."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    for i, text in enumerate(["Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A yang", "berakhir di baris tiga A."]):
        page.insert_text((72, 100 + i * 14.4), text, fontname="helv", fontsize=12)
    # A's frame: the measure it was wrapped to (alone on a wide page, its short lines would have room for the next word).
    page.draw_rect(pymupdf.Rect(66, 84, 300, 136), color=(0.5, 0.5, 0.5), width=0.5)
    page.insert_textbox(pymupdf.Rect(72, 180, 372, 260), LOREM, fontname="tiro", fontsize=11,
                        align=pymupdf.TEXT_ALIGN_JUSTIFY)
    c = [(72, "Paragraf C1 baris pertama yang panjang sekali"), (72, "akhir C1."),
         (90, "Paragraf C2 dimulai dengan indentasi baris"), (72, "pertama lalu berlanjut.")]
    for i, (x, text) in enumerate(c):
        page.insert_text((x, 320 + i * 14.4), text, fontname="helv", fontsize=12)
    page.insert_text((72, 420), "Judul Besar", fontname="hebo", fontsize=18)
    page.insert_text((72, 440), "Isi di bawah judul.", fontname="helv", fontsize=12)
    for i, text in enumerate(["Baris tengah pertama yang lebar", "lebih pendek namun tetap", "seimbang"]):
        w = pymupdf.get_text_length(text, fontname="helv", fontsize=12)
        page.insert_text((297.5 - w / 2, 500 + i * 14.4), text, fontname="helv", fontsize=12)
    page.insert_text((500, 700), "Teks diputar", fontname="helv", fontsize=12, rotate=90)
    return doc.tobytes(garbage=3, deflate=True)


def make_edit_pdf() -> bytes:
    """Two Helvetica 12 pt paragraphs at a tight 12 pt leading (glyph boxes of neighbouring lines
    overlap), split by a first-line indent, over a red vertical line and a blue image:
    g0 = "Paragraf yang diedit baris satu" / "baris dua.", g1 = the two lines below it."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    lines = [(72, "Paragraf yang diedit baris satu"), (72, "baris dua."),
             (90, "Paragraf tetangga tetap utuh di sini"), (72, "sampai akhir.")]
    for i, (x, text) in enumerate(lines):
        page.insert_text((x, 100 + 12 * i), text, fontname="helv", fontsize=12)
    page.draw_line((80, 85), (80, 150), color=(1, 0, 0), width=1)
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
    pix.set_rect(pix.irect, (0, 0, 255))
    page.insert_image(pymupdf.Rect(300, 90, 340, 115), pixmap=pix)
    return doc.tobytes(garbage=3, deflate=True)


def make_layout_pdf() -> bytes:
    """Wrapped paragraphs (standard Helvetica/Times/Courier, every alignment) plus hand-broken lines."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    boxes = [("helv", pymupdf.TEXT_ALIGN_LEFT), ("tiro", pymupdf.TEXT_ALIGN_JUSTIFY), ("helv", pymupdf.TEXT_ALIGN_CENTER),
             ("cour", pymupdf.TEXT_ALIGN_LEFT), ("tiro", pymupdf.TEXT_ALIGN_RIGHT)]
    for i, (font, align) in enumerate(boxes):
        rest = page.insert_textbox(pymupdf.Rect(72, 60 + i * 140, 320, 190 + i * 140), LOREM, fontname=font,
                                   fontsize=10.5, align=align)
        assert rest >= 0, "text did not fit its box"
    for i, text in enumerate(["Jl. Merdeka Barat No. 17, Jakarta", "Pusat", "Indonesia"]):  # an address: hard breaks
        page.insert_text((360, 80 + i * 13), text, fontname="helv", fontsize=11)
    return doc.tobytes(garbage=3, deflate=True)


def _widget(page: pymupdf.Page, kind: int, name: str, rect: tuple, **attrs) -> None:
    w = pymupdf.Widget()
    w.field_type, w.field_name, w.rect = kind, name, pymupdf.Rect(rect)
    for key, value in attrs.items():
        setattr(w, key, value)
    page.add_widget(w)


def make_form_pdf() -> bytes:
    """AcroForm fixture. Page 0: text `nama`, multiline text `catatan`, checkbox `setuju` (on-state
    `Yes`), radio group `warna` (`Merah`, `Biru`), combo `kota`, list `hari`, push button `kirim`.
    Page 1: text `hal2`. PyMuPDF names every radio on-state "False", so the fixture renames them."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 90), "Formulir", fontname="helv", fontsize=12)
    _widget(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "nama", (72, 100, 272, 120), field_value="", text_fontsize=11)
    _widget(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "catatan", (300, 100, 500, 160), field_value="",
            field_flags=pymupdf.PDF_TX_FIELD_IS_MULTILINE)
    _widget(page, pymupdf.PDF_WIDGET_TYPE_CHECKBOX, "setuju", (72, 140, 86, 154), field_value=False)
    for i in range(2):
        _widget(page, pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON, "warna", (72 + 30 * i, 170, 86 + 30 * i, 184), field_value=False)
    _widget(page, pymupdf.PDF_WIDGET_TYPE_COMBOBOX, "kota", (72, 200, 222, 220),
            choice_values=["Jakarta", "Bandung", "Surabaya"], field_value="Jakarta")
    _widget(page, pymupdf.PDF_WIDGET_TYPE_LISTBOX, "hari", (72, 230, 222, 280), choice_values=["Senin", "Selasa"],
            field_value="Senin")
    _widget(page, pymupdf.PDF_WIDGET_TYPE_BUTTON, "kirim", (300, 200, 360, 220), button_caption="Kirim")
    radios = [w for w in page.widgets() if w.field_name == "warna"]
    for w, state in zip(radios, ("Merah", "Biru")):
        off, on = doc.xref_get_key(w.xref, "AP/N/Off")[1], doc.xref_get_key(w.xref, "AP/N/False")[1]
        doc.xref_set_key(w.xref, "AP/N", f"<</Off {off}/{state} {on}>>")
        doc.xref_set_key(w.xref, "AS", "/Off")
    doc.xref_set_key(int(doc.xref_get_key(radios[0].xref, "Parent")[1].split()[0]), "V", "/Off")
    page2 = doc.new_page(width=595, height=842)
    _widget(page2, pymupdf.PDF_WIDGET_TYPE_TEXT, "hal2", (72, 72, 272, 92), field_value="")
    return doc.tobytes(garbage=3, deflate=True)


def make_merged_form_pdf() -> bytes:
    """One page, one text widget whose field and widget dictionaries are merged (/T on the widget, no
    /Parent), an AcroForm with /DR, /DA and /NeedAppearances."""
    doc = pymupdf.open()
    doc.new_page(width=595, height=842)
    page_xref = doc.page_xref(0)
    font = doc.get_new_xref()
    doc.update_object(font, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>")
    widget = doc.get_new_xref()
    doc.update_object(widget, f"<</Type/Annot/Subtype/Widget/FT/Tx/T(nama)/V()/Rect[72 700 272 720]/P {page_xref} 0 R"
                              "/DA(/Helv 11 Tf 0 g)/F 4>>")
    doc.xref_set_key(page_xref, "Annots", f"[{widget} 0 R]")
    acro = doc.get_new_xref()
    doc.update_object(acro, f"<</Fields[{widget} 0 R]/NeedAppearances true/DA(/Helv 0 Tf 0 g)/DR<</Font<</Helv {font} 0 R>>>>>>")
    doc.xref_set_key(doc.pdf_catalog(), "AcroForm", f"{acro} 0 R")
    return doc.tobytes()


def make_cyclic_form_pdf() -> bytes:
    """A widget whose /Parent chain loops (MuPDF raises on it)."""
    doc = pymupdf.open()
    doc.new_page()
    page_xref = doc.page_xref(0)
    a, b = doc.get_new_xref(), doc.get_new_xref()
    doc.update_object(b, f"<</FT/Tx/T(b)/Parent {a} 0 R/Kids[{a} 0 R]>>")
    doc.update_object(a, f"<</Type/Annot/Subtype/Widget/FT/Tx/T(a)/Parent {b} 0 R/Rect[72 72 200 90]/P {page_xref} 0 R>>")
    doc.xref_set_key(page_xref, "Annots", f"[{a} 0 R]")
    acro = doc.get_new_xref()
    doc.update_object(acro, f"<</Fields[{b} 0 R]>>")
    doc.xref_set_key(doc.pdf_catalog(), "AcroForm", f"{acro} 0 R")
    return doc.tobytes()


def make_same_name_form_pdf() -> bytes:
    """Distinct merged source fields sharing a name: text `x` + checkbox `x`, and two text fields `y`
    ("alpha", and "beta" multiline)."""
    doc = pymupdf.open()
    doc.new_page(width=595, height=842)
    px = doc.page_xref(0)
    specs = [
        "/FT/Tx/T(x)/V(t)/Rect[72 700 272 720]",
        "/FT/Btn/T(x)/V/Off/AS/Off/Rect[72 650 86 664]",
        "/FT/Tx/T(y)/V(alpha)/Rect[72 600 272 620]",
        "/FT/Tx/Ff 4096/T(y)/V(beta)/Rect[72 540 272 580]",
    ]
    xrefs = []
    for spec in specs:
        x = doc.get_new_xref()
        doc.update_object(x, f"<</Type/Annot/Subtype/Widget/P {px} 0 R/F 4/DA(/Helv 11 Tf 0 g){spec}>>")
        xrefs.append(x)
    doc.xref_set_key(px, "Annots", "[" + " ".join(f"{x} 0 R" for x in xrefs) + "]")
    acro = doc.get_new_xref()
    doc.update_object(acro, "<</Fields[" + " ".join(f"{x} 0 R" for x in xrefs) + "]/DA(/Helv 0 Tf 0 g)>>")
    doc.xref_set_key(doc.pdf_catalog(), "AcroForm", f"{acro} 0 R")
    return doc.tobytes()


def make_cyclic_first_form_pdf() -> bytes:
    """Page with a cyclic-parent widget first and a healthy text widget `ok` second."""
    doc = pymupdf.open()
    page = doc.new_page()
    _widget(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "ok", (72, 120, 200, 140), field_value="v")
    ok = list(page.widgets())[0].xref
    page_xref = doc.page_xref(0)
    a, b = doc.get_new_xref(), doc.get_new_xref()
    doc.update_object(b, f"<</FT/Tx/T(b)/Parent {a} 0 R/Kids[{a} 0 R]>>")
    doc.update_object(a, f"<</Type/Annot/Subtype/Widget/FT/Tx/T(a)/Parent {b} 0 R/Rect[72 72 200 90]/P {page_xref} 0 R>>")
    doc.xref_set_key(page_xref, "Annots", f"[{a} 0 R {ok} 0 R]")
    return doc.tobytes()


def make_secrets_pdf() -> bytes:
    """Page 0: the text "Secret text here" with, over it (inside 60,80 – 220,112), a URI link, a highlight
    whose comment is "secret note", a sticky note "sticky secret" and a text field `f` = "SSN 123".
    Outside that area: a text field `keep` = "visible" and a sticky note "public note"."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Secret text here", fontname="helv", fontsize=12)
    page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 88, 180, 104), "uri": "https://old.example/x"})
    hl = page.add_highlight_annot(pymupdf.Rect(72, 88, 180, 104))
    hl.set_info(content="secret note")
    hl.update()
    page.add_text_annot((190, 90), "sticky secret")
    _widget(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "f", (72, 85, 200, 105), field_value="SSN 123")
    _widget(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "keep", (72, 400, 272, 420), field_value="visible")
    page.add_text_annot((400, 600), "public note")
    return doc.tobytes(garbage=3, deflate=True)


def make_xfa_form_pdf() -> bytes:
    """make_form_pdf() as an XFA hybrid: /AcroForm also has an /XFA packet (with a stale value for `nama`)."""
    doc = pymupdf.open(stream=make_form_pdf(), filetype="pdf")
    xfa = doc.get_new_xref()
    doc.update_object(xfa, "<<>>")
    doc.update_stream(xfa, b"<xfa:datasets><nama>stale</nama></xfa:datasets>")
    cat = doc.pdf_catalog()
    kind, value = doc.xref_get_key(cat, "AcroForm")
    acro = doc.get_new_xref()
    doc.update_object(acro, value)
    doc.xref_set_key(acro, "XFA", f"[(datasets) {xfa} 0 R]")
    doc.xref_set_key(cat, "AcroForm", f"{acro} 0 R")
    return doc.tobytes()


def _wrap(text: str, font: pymupdf.Font, size: float, width: float, by_char: bool) -> list[str]:
    """Greedy line breaks of `text` at `width`: at spaces, or after any character (`by_char`, CJK)."""
    lines, line = [], ""
    for piece in (list(text) if by_char else text.split(" ")):
        candidate = line + piece if by_char or not line else f"{line} {piece}"
        if line and font.text_length(candidate, size) > width:
            lines.append(line)
            line = piece
        else:
            line = candidate
    return lines + [line]


FORM_EN = "The applicant must write in block letters either in English or Korean and sign the form at the end."
FORM_JA = "これは日本語の段落です。行は文字単位で折り返され、単語の間に空白はありません。最後の行は短い。"
FORM_KO = "신청서상의 모든 질문에 대한 답변은 한글 또는 영문으로 기재해야 하며 사실에 근거하여 빠짐없이 작성해야 합니다."


def make_form_table_pdf() -> bytes:
    """A form page like Korean visa applications: an instruction list, a bordered table (labels on one baseline in
    two cells, a label above a field rule in one text block, checkbox rows, wrapped text in a cell), a bold heading,
    and paragraphs wrapped at 200 pt in Japanese (by character) and Korean (by word), each followed by a short line."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    cjk = pymupdf.Font("korea")
    page.insert_font(fontname="AR", fontfile=str(FONT_FILES / "Arimo-Regular.ttf"))
    for i, text in enumerate(["<How to fill out this form>", "• Fill out this form completely and correctly.",
                              "• Write in block letters either in English or Korean.", "• Check all that apply."]):
        page.insert_text((56, 80 + 12.5 * i), text, fontname="AR", fontsize=9)
    page.draw_rect(pymupdf.Rect(50, 200, 545, 330), color=(0, 0, 0), width=0.5)
    page.draw_line((300, 200), (300, 330), color=(0, 0, 0), width=0.5)
    page.draw_line((50, 220), (545, 220), color=(0, 0, 0), width=0.5)
    page.insert_text((103, 215), "1.1 Full name in English (as shown in passport)", fontname="helv", fontsize=9)
    page.insert_text((306, 215), "1.2 Sex", fontname="helv", fontsize=9)
    page.insert_text((56, 230), "Family Name", fontname="helv", fontsize=9)
    page.insert_text((306, 245), "Long-term stay over 90 days      [   ]", fontname="cour", fontsize=9)
    page.insert_text((306, 257), "Short-term stay below 90 days    [   ]", fontname="cour", fontsize=9)
    assert page.insert_textbox(pymupdf.Rect(56, 250, 294, 328), FORM_EN, fontname="helv", fontsize=9) >= 0
    page.insert_text((56, 360), "SECTION TWO: GENERAL CONDITIONS OF THE APPLICATION", fontname="hebo", fontsize=10)
    page.insert_text((56, 372), "Body text right below the heading.", fontname="helv", fontsize=10)
    for x, (text, by_char, font_name) in [(56, (FORM_JA, True, "japan")), (300, (FORM_KO, False, "korea"))]:
        lines = _wrap(text, cjk, 10, 200, by_char) + ["短い行。" if by_char else "짧은 줄.", text[:12]]
        for i, line in enumerate(lines):
            page.insert_text((x, 420 + 14 * i), line, fontname=font_name, fontsize=10)
    return doc.tobytes(garbage=3, deflate=True)


ROWS_TOC = ["Halaman Sampul", "Halaman Pengesahan", "Kata Pengantar"]


def make_rows_pdf() -> bytes:
    """Rows and cells that must not become one paragraph (Helvetica 11), in content-stream order:
    a label/value form (each value is followed by the next row's label), a table whose vertical borders are drawn
    row by row with 0.5 pt gaps ("NIM" above the next row's "1."), one text run crossing a column rule
    ("23/5/2026 Pengenalan"), a dot-leader row above the next label, and table-of-contents entries of similar
    length under a full-width justified paragraph (the text column)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    for y, label, value in [(100, "Nama", ": Dr. Budi Santoso, S.T."), (113.3, "Jabatan", ": Ketua Program Studi")]:
        page.insert_text((60, y), label, fontname="helv", fontsize=11)
        page.insert_text((190, y), value, fontname="helv", fontsize=11)
    for y0, y1 in [(160, 180.2), (180.7, 200.0)]:  # row by row: the borders leave a 0.5 pt gap at 180.2 … 180.7
        for x in (100, 130, 300):
            page.draw_line((x, y0), (x, y1), width=0.5)
    page.draw_line((100, 180.45), (300, 180.45), width=0.5)
    page.insert_text((240, 176), "NIM", fontname="helv", fontsize=11)
    page.insert_text((104, 194), "1.", fontname="helv", fontsize=11)
    page.insert_text((134, 194), "Budi", fontname="helv", fontsize=11)
    w = pymupdf.get_text_length("23/5/2026 ", fontname="helv", fontsize=11)
    page.draw_line((60 + w - 1.5, 230), (60 + w - 1.5, 280), width=0.5)  # the column rule inside the run's space
    page.draw_line((60 + w + 80, 230), (60 + w + 80, 280), width=0.5)    # the cell's right border: it wraps
    page.insert_text((60, 245), "23/5/2026 Pengenalan", fontname="helv", fontsize=11)
    page.insert_text((60 + w, 258), "organisasi", fontname="helv", fontsize=11)
    page.insert_text((60, 320), "Nama Mahasiswa : " + "." * 60, fontname="helv", fontsize=11)
    page.insert_text((60, 334), "NIM", fontname="helv", fontsize=11)
    assert page.insert_textbox(pymupdf.Rect(72, 370, 523, 450), LOREM + " " + LOREM, fontname="helv", fontsize=11,
                               align=pymupdf.TEXT_ALIGN_JUSTIFY) >= 0
    for i, entry in enumerate(ROWS_TOC):
        page.insert_text((90, 470 + 13.8 * i), entry, fontname="helv", fontsize=11)
    return doc.tobytes(garbage=3, deflate=True)


LIST_ITEMS = [  # (marker, wrapped text): the first item is tabbed, the second has a plain space after "2."
    ("1.", ["Pada saat saya mengajukan bantuan ini, saya masih berstatus aktif dan belum dinyatakan lulus",
            "pada sidang yudisium dan pelaksanaan kegiatan paling lambat satu bulan setelah dinyatakan lulus",
            "dalam sidang tersebut."]),
    ("2.", ["Akan mengikuti kegiatan tersebut dengan sungguh-sungguh sesuai dengan jadwal yang telah",
            "ditetapkan dan berusaha meraih hasil terbaik."]),
]


def make_lists_pdf() -> bytes:
    """Numbered items, tab stops and hanging indents (Helvetica 11, 13 pt leading): two numbered items whose
    continuation lines hang at the item's text, full width (item 1 has a tab after its marker, item 2 one space);
    a form row "Nama Mahasiswa⇥:⇥……" written as one text run with tab-wide spaces; table-of-contents rows whose
    number and title are separate runs a tab apart ("Bab I⇥Pendahuluan", "4.2⇥Rumusan Masalah"); a prose line
    with a colon and ordinary spaces."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    body = 90.0
    y = 100.0
    for i, (marker, lines) in enumerate(LIST_ITEMS):
        if i == 0:
            page.insert_text((72, y), marker, fontname="helv", fontsize=11)
            page.insert_text((body, y), lines[0], fontname="helv", fontsize=11)
        else:
            page.insert_text((72, y), f"{marker} {lines[0]}", fontname="helv", fontsize=11)
            body2 = 72 + pymupdf.get_text_length(f"{marker} ", fontname="helv", fontsize=11)
        for line in lines[1:]:
            y += 13
            page.insert_text((body if i == 0 else body2, y), line, fontname="helv", fontsize=11)
        y += 13
    row = "Nama Mahasiswa" + " " * 5 + ":" + " " * 4 + "." * 40
    page.insert_text((72, 200), row, fontname="helv", fontsize=11)
    for i, (num, title) in enumerate([("Bab I", "Pendahuluan"), ("4.2", "Rumusan Masalah")]):
        page.insert_text((72, 240 + 14 * i), num, fontname="helv", fontsize=11)
        page.insert_text((130, 240 + 14 * i), title, fontname="helv", fontsize=11)
    page.insert_text((72, 300), "Dokumen yang diperlukan adalah sebagai berikut: surat pengantar dan formulir.",
                     fontname="helv", fontsize=11)
    return doc.tobytes(garbage=3, deflate=True)


ALIGN_JUSTIFIED = ("Edith menyunting paragraf asli dengan rapi dan teks mengalir ulang di dalam kotak selebar "
                   "tetap sampai akhir.")


def make_align_pdf() -> bytes:
    """Geometry and alignment cases (Helvetica 11): a line indented with spaces and ending in spaces, a 2-line
    justified paragraph, a 2-line centred paragraph whose first line is shorter, a title centred on the page, a
    label centred in a table cell, and a date right-aligned at the right margin (the mirrored left one)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 80), "Body text starts at the left margin of this page.", fontname="helv", fontsize=11)
    page.insert_text((72, 100), " " * 20 + "Menyetujui,   ", fontname="helv", fontsize=11)
    assert page.insert_textbox(pymupdf.Rect(72, 112, 390, 150), ALIGN_JUSTIFIED, fontname="helv", fontsize=11,
                               align=pymupdf.TEXT_ALIGN_JUSTIFY) >= 0
    for i, text in enumerate(["Laporan Mingguan", "Kerja Praktek Semester Ganjil"]):
        w = pymupdf.get_text_length(text, fontname="helv", fontsize=11)
        page.insert_text((400 - w / 2, 180 + 13 * i), text, fontname="helv", fontsize=11)
    w = pymupdf.get_text_length("SURAT KETERANGAN", fontname="helv", fontsize=14)
    page.insert_text((297.5 - w / 2, 250), "SURAT KETERANGAN", fontname="helv", fontsize=14)
    page.draw_rect(pymupdf.Rect(100, 300, 220, 320), width=0.5)
    w = pymupdf.get_text_length("Tanggal", fontname="helv", fontsize=11)
    page.insert_text((160 - w / 2, 314), "Tanggal", fontname="helv", fontsize=11)
    w = pymupdf.get_text_length("Tanggal 23 April 2018", fontname="helv", fontsize=9)
    page.insert_text((523 - w, 400), "Tanggal 23 April 2018", fontname="helv", fontsize=9)
    return doc.tobytes(garbage=3, deflate=True)


TWIN_TEXTS = ("Halo dunia", "XYZ quiz")


def make_twin_subsets_pdf() -> bytes:
    """One page drawing two different subsets of Tinos that share the BaseFont name "Tinos-Regular" (as Word
    embeds TimesNewRomanPSMT twice): TWIN_TEXTS[0] in one (top), TWIN_TEXTS[1] in the other (below)."""
    out = pymupdf.open()
    page = out.new_page(width=595, height=842)
    for i, text in enumerate(TWIN_TEXTS):
        src = pymupdf.open()
        sp = src.new_page(width=595, height=100)
        sp.insert_font(fontname="TI", fontfile=str(FONT_FILES / "Tinos-Regular.ttf"))
        sp.insert_text((72, 50), text, fontname="TI", fontsize=12)
        src.subset_fonts()
        for xref, *_rest in sp.get_fonts(full=True):
            src.xref_set_key(xref, "BaseFont", f"/{'ABCDEF' if i == 0 else 'GHIJKL'}+Tinos-Regular")
        src = pymupdf.open(stream=src.tobytes(garbage=3), filetype="pdf")
        page.show_pdf_page(pymupdf.Rect(0, 100 * i, 595, 100 * (i + 1)), src, 0)
    return out.tobytes(garbage=3, deflate=True)


CID_TEXT = "신청서 작성 방법 Visa Form"


def _renamed(buf: bytes, family: str) -> bytes:
    """A copy of TrueType `buf` whose name table says `family` (two copies of one program stay two fonts)."""
    from fontTools.ttLib import TTFont
    font = TTFont(io.BytesIO(buf))
    for rec in font["name"].names:
        if rec.nameID in (1, 3, 4, 6, 16):
            rec.string = family.replace(" ", "") if rec.nameID in (3, 6) else family
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def make_cid_subset_pdf() -> bytes:
    """Text in cmap-less CID TrueType subsets, as MS Word and Hancom export them: Korean + Latin in a gothic font
    named "Dotum" (line 1), the same in "Batang" (line 2) and two characters in "Wingdings" (line 3). All three
    are Droid Sans Fallback (built into MuPDF) embedded by insert_font, then subset by PyMuPDF, which drops the
    cmap and keeps ToUnicode and CIDToGIDMap; the BaseFont names are set afterwards."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    droid = pymupdf.Font("korea").buffer
    for i, (tag, name, text) in enumerate([("DO", "Dotum", CID_TEXT), ("BA", "Batang", CID_TEXT), ("WI", "Wingdings", "èô")]):
        page.insert_font(fontname=tag, fontbuffer=_renamed(droid, name))  # short: MuPDF cuts span font names
        page.insert_text((72, 100 + 30 * i), text, fontname=tag, fontsize=12)
    doc.subset_fonts()
    for xref, _ext, _type, basefont, *_rest in page.get_fonts(full=True):
        name = next(n for n in ("Dotum", "Batang", "Wingdings") if n in basefont)
        doc.xref_set_key(xref, "BaseFont", f"/EDITHA+{name}")
    return doc.tobytes(garbage=3, deflate=True)


def fake_cjk_pack(root: Path, files: tuple[str, ...] = ("NotoSansKR-Regular.ttf", "NotoSerifKR-Regular.ttf")) -> Path:
    """A fonts dir at `root`: the real manifest and bundled files (symlinked) plus a fake CJK pack — the given pack
    files, each a copy of Droid Sans Fallback (built into MuPDF: Hangul, kana, Han). Tests don't need the real pack."""
    (root / "files" / "cjk").mkdir(parents=True)
    (root / "manifest.json").write_bytes((FONT_FILES.parent / "manifest.json").read_bytes())
    for f in FONT_FILES.glob("*.ttf"):
        (root / "files" / f.name).symlink_to(f)
    droid = pymupdf.Font("korea").buffer
    for name in files:
        (root / "files" / "cjk" / name).write_bytes(droid)
    return root


def make_dr_font_form_pdf(form: bool = True) -> bytes:
    """One page with "Nama:Budi" in an embedded Tinos (the font keeps all its glyphs and its cmap in the file). With
    `form`: a text widget `nama` whose appearance stream uses that same font and an AcroForm /DR listing it, as
    Word/Acrobat forms do, so a viewer re-filling the field needs the whole program."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="FT", fontfile=str(FONT_FILES / "Tinos-Regular.ttf"))
    page.insert_text((72, 90), "Nama:Budi", fontname="FT", fontsize=12)
    if form:
        _widget(page, pymupdf.PDF_WIDGET_TYPE_TEXT, "nama", (72, 100, 272, 120), field_value="Budi", text_fontsize=11)
        font = page.get_fonts(full=True)[0][0]
        widget = next(page.widgets())
        ap = int(doc.xref_get_key(widget.xref, "AP/N")[1].split()[0])
        doc.xref_set_key(ap, "Resources", f"<</Font<</FT {font} 0 R>>>>")
        doc.xref_set_key(doc.pdf_catalog(), "AcroForm/DR", f"<</Font<</FT {font} 0 R>>>>")
    return doc.tobytes(garbage=3, deflate=True)


# Damage FreeType accepts but fontTools can't read (the rebuild must fall back to "not reusable").
BROKEN_TABLES: dict[str, tuple[bytes, Callable[[bytes], bytes]]] = {
    "glyf garbage": (b"glyf", lambda t: b"\xff" * len(t)),
    "hhea garbage": (b"hhea", lambda t: b"\xff" * len(t)),
    "maxp numGlyphs 0xFFFF": (b"maxp", lambda t: t[:4] + b"\xff\xff" + t[6:]),
}


def break_font_table(data: bytes, name: str, damage: str) -> bytes:
    """`data` with one table of the embedded program of Type0 font `name` damaged as BROKEN_TABLES[damage] says."""
    tag, fn = BROKEN_TABLES[damage]
    doc = pymupdf.open(stream=data, filetype="pdf")
    xref = next(e[0] for e in doc[0].get_fonts(full=True) if e[3].endswith(name))
    cid_font = int(doc.xref_get_key(xref, "DescendantFonts")[1].strip("[]").split()[0])
    descriptor = int(doc.xref_get_key(cid_font, "FontDescriptor")[1].split()[0])
    stream = int(doc.xref_get_key(descriptor, "FontFile2")[1].split()[0])
    buf = bytearray(doc.xref_stream(stream))
    for i in range(struct.unpack(">H", buf[4:6])[0]):
        rec = 12 + 16 * i
        if buf[rec:rec + 4] == tag:
            offset, length = struct.unpack(">II", buf[rec + 8:rec + 16])
            buf[offset:offset + length] = fn(bytes(buf[offset:offset + length]))
    doc.update_stream(stream, bytes(buf))
    return doc.tobytes(garbage=3, deflate=True)


KO_LABEL = "1.1 성명 Full name in English"


def make_korean_form_pdf() -> bytes:
    """A stand-in for the owner's Korean visa form (apps/web/e2e/fixtures/form-ko.pdf): Korean and Latin text in a
    cmap-less CID subset named "Dotum" (as Hancom exports it), an instruction list, and a bordered table whose two
    labels share one baseline 12 pt apart across a cell border, a field label under a rule and two checkbox rows."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    droid = pymupdf.Font("korea")
    page.insert_font(fontname="DO", fontbuffer=_renamed(droid.buffer, "Dotum"))
    for i, text in enumerate(["<신청서 작성방법>", "※ 신청서는 한글 또는 영문으로 작성합니다.", "※ 해당 칸에 표시를 하시기 바랍니다."]):
        page.insert_text((56, 80 + 13 * i), text, fontname="DO", fontsize=10)
    page.draw_rect(pymupdf.Rect(50, 150, 545, 240), color=(0, 0, 0), width=0.5)
    page.draw_line((300, 150), (300, 240), color=(0, 0, 0), width=0.5)
    page.draw_line((50, 175), (545, 175), color=(0, 0, 0), width=0.5)
    page.insert_text((294 - droid.text_length(KO_LABEL, 10), 167), KO_LABEL, fontname="DO", fontsize=10)
    page.insert_text((306, 167), "1.2 성별 Sex", fontname="DO", fontsize=10)
    page.insert_text((56, 195), "성 Family Name", fontname="DO", fontsize=10)
    page.insert_text((306, 195), "남성 Male      [   ]", fontname="DO", fontsize=10)
    page.insert_text((306, 210), "여성 Female    [   ]", fontname="DO", fontsize=10)
    doc.subset_fonts()
    for xref, *_rest in page.get_fonts(full=True):
        doc.xref_set_key(xref, "BaseFont", "/EDITHB+Dotum")
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)  # no random trailer /ID: byte-reproducible


# A wrapped Korean + Latin note, 10 pt at a 14 pt leading from baseline 120, condensed with Tz as Hancom does.
KEEP_LINES = ("신청인은 아래 사항을 정확하게 기재하여야 하며 사실과 다른 내용을",
              "기재한 경우에는 사증 발급이 거부될 수 있습니다. Applicants must fill in",
              "every item correctly; a visa may be refused when the form is false.")
KEEP_TZ = 94.7
# A tight paragraph: 10 pt at a 10 pt leading from baseline 300, descenders on every line.
TIGHT_LINES = ("Pygmy jiggery gypsy quippy jagged foggy yoga by the grumpy happy",
               "guy, gladly sloppy giggly jumpy puppy yapping happily gulping soggy",
               "porridge quickly; grumpy goggles gaping at a jiggly pig.")


def make_keep_lines_pdf() -> bytes:
    """apps/web/e2e/fixtures/keep-lines.pdf: KEEP_LINES as one paragraph in a cmap-less CID subset named "Dotum",
    every line set with horizontal scaling Tz KEEP_TZ (the Hancom export of the owner's visa form condenses its text
    so): Edith's own layout of a line (font advances) puts its words elsewhere, the original glyphs stay exact.
    TIGHT_LINES below it: a paragraph whose descenders reach into the next line's ascender band."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    droid = pymupdf.Font("korea")
    page.insert_font(fontname="DO", fontbuffer=_renamed(droid.buffer, "Dotum"))
    page.insert_text((56, 80), "사증발급 신청서 작성 안내", fontname="DO", fontsize=12)
    for i, text in enumerate(KEEP_LINES):
        page.insert_text((56, 120 + 14 * i), text, fontname="DO", fontsize=10)
    page.insert_text((56, 200), "다음 쪽으로 계속 Continued overleaf", fontname="DO", fontsize=10)
    for i, text in enumerate(TIGHT_LINES):
        page.insert_text((56, 300 + 10 * i), text, fontname="DO", fontsize=10)
    page.clean_contents()
    xref = page.get_contents()[0]
    stream = doc.xref_stream(xref).decode("latin-1")
    doc.update_stream(xref, stream.replace(" Tf", f" Tf {KEEP_TZ} Tz").encode("latin-1"))
    doc.subset_fonts()
    for xref, *_rest in page.get_fonts(full=True):
        doc.xref_set_key(xref, "BaseFont", "/EDITHC+Dotum")
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


# M5d: three multi-line paragraphs (Helvetica 11, leading 14) whose widest line has no room for one more letter in its
# box: justified (word spacing Tw spreads every line but the last to the column 72…523), centred on the page, and
# right-aligned at the margin 523. A one-letter edit of that line must not re-wrap it.
WRAP_JUSTIFIED = ("Kerja praktek bertujuan memberikan wawasan kepada mahasiswa tentang dunia kantor unit",
                  "industri yang sesungguhnya sehingga mahasiswa mampu menerapkan ilmu yang telah",
                  "dipelajari selama perkuliahan.")
WRAP_CENTRED = ("Fakultas dan Program Studi Teknik Informatika Angkatan 2026",
                "Sekolah Teknik Elektro dan Informatika Institut Teknologi Bandung",
                "Jalan Ganesa Nomor 10 Bandung")
WRAP_RIGHT = ("Bandung, 9 November 2026",
              "Kepala Program Studi Sarjana Teknik Informatika",
              "Dr. Budi Santoso, M.T.")
WRAP_Y = (120, 300, 480)  # first baselines
WRAP_COLUMN = (72, 523)


def make_wrap_pdf() -> bytes:
    """apps/web/e2e/fixtures/wrap.pdf (M5d): WRAP_JUSTIFIED / WRAP_CENTRED / WRAP_RIGHT from the WRAP_Y baselines, below a
    heading at the left margin (72)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 70), "Contoh paragraf rata kiri kanan, tengah dan kanan", fontname="helv", fontsize=11)
    page.clean_contents()
    xref = page.get_contents()[0]
    stream = doc.xref_stream(xref).decode("latin-1")
    font = stream[stream.index("/"):stream.index(" Tf")].split()[0]  # the resource name insert_text gave Helvetica
    width = lambda t: pymupdf.get_text_length(t, fontname="helv", fontsize=11)  # noqa: E731
    left, right = WRAP_COLUMN
    blocks = []
    for lines, y0, align in ((WRAP_JUSTIFIED, WRAP_Y[0], "justify"), (WRAP_CENTRED, WRAP_Y[1], "center"),
                             (WRAP_RIGHT, WRAP_Y[2], "right")):
        for k, text in enumerate(lines):
            w, tw = width(text), 0.0
            if align == "justify":
                x = left
                if k < len(lines) - 1:
                    tw = (right - left - w) / text.count(" ")
            else:
                x = (595 - w) / 2 if align == "center" else right - w
            blocks.append(f"BT {font} 11 Tf {tw:.4f} Tw 1 0 0 1 {x:.3f} {842 - y0 - 14 * k:.3f} Tm ({text}) Tj ET")
    doc.update_stream(xref, (stream + "\n" + "\n".join(blocks)).encode("latin-1"))
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


# M5b F2: one paragraph per kind of original spacing, in an embedded Tinos (reusable: clients lay out with its program).
SPACING_LINES = (
    ("Condensed text with horizontal scaling Tz", 12, "90 Tz"),  # hScale 0.9 (MuPDF reports size 12·√0.9)
    ("LETTER SPACED HEADING", 14, "1.5 Tc"),                      # charSpacing 1.5 pt
    ("wide word gaps placed word by word", 11, None),             # each space + SPACING_GAP (TJ), as Hancom places words
)
SPACING_GAP = 130  # thousandths of an em after every space of the third line (Hancom: gaps ≈ 1.4 × the space glyph)
SPACING_Y = (100, 160, 220)


def make_text_state_pdf(state: str = "", matrix: str | None = None, text: str = "Teks dengan keadaan aneh",
                        size: float = 13) -> bytes:
    """One line of `text` in an embedded Tinos at (72, 100) with text state operators `state` set after Tf (e.g.
    "20 Tz", "3 Tr 450 Tz", "8 Tc") and, with `matrix` ("1 0 0 0.22"), a text matrix instead of the plain position:
    the odd and degenerate cases the spacing measurement must survive (M5b F2 review)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="TI", fontbuffer=(FONT_FILES / "Tinos-Regular.ttf").read_bytes())
    page.insert_text((72, 100), text, fontname="TI", fontsize=size)
    page.clean_contents()
    xref = page.get_contents()[0]
    stream = doc.xref_stream(xref).decode("latin-1")
    tf = f"/TI {size:g} Tf"
    assert tf in stream and " 742 TD" in stream
    stream = stream.replace(tf, f"{tf} {state}", 1)
    if matrix:
        stream = stream.replace("72 742 TD", f"{matrix} 72 742 Tm", 1)
    doc.update_stream(xref, stream.encode("latin-1"))
    doc.subset_fonts()
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


def make_spacing_pdf() -> bytes:
    """apps/web/e2e/fixtures/spacing.pdf and the F2 unit tests: SPACING_LINES at x 72 on baselines SPACING_Y."""
    tinos = (FONT_FILES / "Tinos-Regular.ttf").read_bytes()
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="TI", fontbuffer=tinos)
    for (text, size, _op), y in zip(SPACING_LINES, SPACING_Y):
        page.insert_text((72, y), text, fontname="TI", fontsize=size)
    page.clean_contents()
    xref = page.get_contents()[0]
    stream = doc.xref_stream(xref).decode("latin-1")
    for _text, size, op in SPACING_LINES:
        if op:
            stream = stream.replace(f"/TI {size} Tf", f"/TI {size} Tf {op}", 1)
    tf = f"/TI {SPACING_LINES[2][1]} Tf"
    head, rest = stream.split(tf, 1)
    start, end = rest.index("[<") + 2, rest.index(">]")
    space = f"{pymupdf.Font(fontbuffer=tinos).has_glyph(32):04X}"
    glyphs = [rest[i:i + 4] for i in range(start, end, 4)]
    tj = "".join(g + (f">-{SPACING_GAP}<" if g.upper() == space else "") for g in glyphs)
    doc.update_stream(xref, (head + tf + rest[:start] + tj + rest[end:]).encode("latin-1"))
    doc.subset_fonts()
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


# M5c: text that is a picture. The letterhead of a reference "Nota Dinas" is an image of its lines with the same text
# laid over it invisibly (iLovePDF / OCR); the body of a reference form is an image of print with no text at all.
SCAN_LINES = ("KEMENTERIAN CONTOH REPUBLIK", "SEKRETARIAT JENDERAL", "BIRO UMUM DAN ORGANISASI")
SCAN_RECT = (72, 60, 432, 132)        # make_hidden_text_pdf: where the picture of SCAN_LINES sits (pt)
RASTER_LINES = tuple(f"{i}. Nama pemohon dan keperluan surat pengantar baris {i}" for i in range(1, 9))
RASTER_RECT = (72, 300, 512, 480)     # make_raster_text_pdf: the picture of RASTER_LINES
PRINTED_RECT = (72, 560, 512, 680)    # make_raster_text_pdf: a picture of print with real text written over it


def _text_image(lines: tuple[str, ...], width: float, height: float, size: float = 14, scale: float = 3,
                color: tuple = (0.35, 0.35, 0.35)) -> pymupdf.Pixmap:
    """`lines` printed in Helvetica Bold on white, as a `scale`× bitmap of a width × height pt box (a scan of them)."""
    doc = pymupdf.open()
    page = doc.new_page(width=width, height=height)
    for i, line in enumerate(lines):
        page.insert_text((4, size * 1.25 * (i + 1)), line, fontname="hebo", fontsize=size, color=color)
    return page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)


def _resources(doc: pymupdf.Document, page: pymupdf.Page) -> tuple[int, str]:
    """(xref, key prefix) under which `page`'s resource dictionary entries are set with xref_set_key."""
    kind, value = doc.xref_get_key(page.xref, "Resources")
    return (int(value.split()[0]), "") if kind == "xref" else (page.xref, "Resources/")


def _fax_image(doc: pymupdf.Document, page: pymupdf.Page, pix: pymupdf.Pixmap, rect: tuple, name: str) -> None:
    """`pix` thresholded to a 1-bit image placed in `rect` of `page` (call _to_fax afterwards: CCITT G4, as scanners and
    iLovePDF store such images, which pdf.js draws only with its wasm decoders)."""
    gray = pymupdf.Pixmap(pymupdf.csGRAY, pix)
    w, h = gray.width, gray.height
    rows = []
    for y in range(h):
        bits = bytearray((w + 7) // 8)
        for x, v in enumerate(gray.samples[y * w:(y + 1) * w]):
            if v >= 128:
                bits[x >> 3] |= 0x80 >> (x & 7)
        rows.append(bytes(bits))
    xref = doc.get_new_xref()
    doc.update_object(xref, f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceGray"
                            f" /BitsPerComponent 1 >>")
    doc.update_stream(xref, b"".join(rows))
    res, prefix = _resources(doc, page)
    doc.xref_set_key(res, f"{prefix}XObject/{name}", f"{xref} 0 R")
    x0, y0, x1, y1 = rect
    c = page.get_contents()[-1]
    ph = page.rect.height
    doc.update_stream(c, doc.xref_stream(c) + f"\nq {x1 - x0} 0 0 {y1 - y0} {x0} {ph - y1} cm /{name} Do Q\n".encode())


def _to_fax(doc: pymupdf.Document) -> None:
    """Every 1-bit image of `doc` recompressed with CCITTFaxDecode."""
    options = pymupdf.mupdf.PdfImageRewriterOptions()
    options.bitonal_image_recompress_method = pymupdf.mupdf.FZ_RECOMPRESS_FAX
    options.recompress_when = pymupdf.mupdf.FZ_RECOMPRESS_WHEN_ALWAYS
    doc.rewrite_images(options=options)


def make_picture_text_pdf() -> bytes:
    """apps/web/e2e/fixtures/picture-text.pdf (M5c): the two reference cases on one page, with 1-bit CCITT pictures.
    A letterhead: SCAN_LINES pictured in SCAN_RECT under the same lines as invisible text (render mode 3); a visible
    paragraph at (72, 200); the body of a form pictured in RASTER_RECT, with no text."""
    x0, y0, x1, y1 = SCAN_RECT
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 200), "Paragraf biasa yang terlihat.", fontname="helv", fontsize=12)
    _fax_image(doc, page, _text_image(SCAN_LINES, x1 - x0, y1 - y0, color=(0, 0, 0)), SCAN_RECT, "Kop")
    rx0, ry0, rx1, ry1 = RASTER_RECT
    _fax_image(doc, page, _text_image(RASTER_LINES, rx1 - rx0, ry1 - ry0, size=11, color=(0, 0, 0)), RASTER_RECT, "Isi")
    writer = pymupdf.TextWriter(page.rect)
    for i, line in enumerate(SCAN_LINES):
        writer.append((x0 + 4, y0 + 17.5 * (i + 1)), line, font=pymupdf.Font("tiro"), fontsize=13)
    writer.write_text(page, render_mode=3)
    _to_fax(doc)
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


def make_hidden_text_pdf(hide: str = "mode3") -> bytes:
    """SCAN_LINES as a grey picture in SCAN_RECT and, laid over it, the same lines as invisible black text (`hide`:
    "mode3", render mode 3; "opacity", a fill opacity of 0) in Times, narrower than the picture's print; below, a
    visible paragraph at (72, 200)."""
    x0, y0, x1, y1 = SCAN_RECT
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(*SCAN_RECT), pixmap=_text_image(SCAN_LINES, x1 - x0, y1 - y0))
    page.insert_text((72, 200), "Paragraf biasa yang terlihat.", fontname="helv", fontsize=12)
    writer = pymupdf.TextWriter(page.rect)
    for i, line in enumerate(SCAN_LINES):
        writer.append((x0 + 4, y0 + 17.5 * (i + 1)), line, font=pymupdf.Font("tiro"), fontsize=13)
    if hide == "mode3":
        writer.write_text(page, render_mode=3)
    else:
        writer.write_text(page, opacity=0)
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


def make_clip_text_pdf(mode: int = 7, clip_first: bool = False) -> bytes:
    """"Gradient heading" in Helvetica 24 at (72, 142) shown with render mode `mode`, then a horizontal red-to-blue
    shading painted through it: mode 7 is text used only as a clip (a gradient fill), modes 4–6 fill and/or stroke it
    too. MuPDF reports the clip as a span with alpha 0. `clip_first`: the text sits inside a plain `re W n` clip
    instead (mode 3 or opacity 0 text stays invisible there)."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 300), "Teks biasa di bawahnya.", fontname="helv", fontsize=12)
    sh = doc.get_new_xref()
    doc.update_object(sh, "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [72 0 400 0] /Function << /FunctionType 2"
                          " /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>")
    res, prefix = _resources(doc, page)
    doc.xref_set_key(res, f"{prefix}Shading/Sh1", f"{sh} 0 R")
    font = next(name for _x, _e, _t, base, name, *_ in page.get_fonts(full=True) if base == "Helvetica")
    clip = b"0 0 595 842 re W n " if clip_first else b""
    paint = b"" if clip_first else b" /Sh1 sh"
    xref = page.get_contents()[-1]
    doc.update_stream(xref, doc.xref_stream(xref) + b"\nq " + clip + f"BT /{font} 24 Tf {mode} Tr 72 700 Td".encode()
                      + b" (Gradient heading) Tj ET" + paint + b" Q\n")
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


def make_type3_pdf() -> bytes:
    """A heading in a Type 3 font at (72, 100), each glyph a box painted with B (fill and stroke): MuPDF reports its
    spans with alpha 0 and neither fill nor stroke, yet it shows (a reference visa form's "VISA APPLICATION FORM")."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 300), "Teks biasa di bawahnya.", fontname="helv", fontsize=12)
    proc = doc.get_new_xref()
    doc.update_object(proc, "<< >>")
    doc.update_stream(proc, b"600 0 0 0 500 700 d1 0 0 500 700 re B")
    font = doc.get_new_xref()
    doc.update_object(font, f"<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] /FontMatrix [0.001 0 0 0.001 0 0]"
                            f" /CharProcs << /box {proc} 0 R >> /Encoding << /Type /Encoding /Differences [65 /box] >>"
                            f" /FirstChar 65 /LastChar 65 /Widths [600] /Resources << >> >>")
    res, prefix = _resources(doc, page)
    doc.xref_set_key(res, f"{prefix}Font/T3", f"{font} 0 R")
    xref = page.get_contents()[-1]
    doc.update_stream(xref, doc.xref_stream(xref) + b"\nq 0 g BT /T3 16 Tf 72 742 Td (AAAA) Tj ET Q\n")
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


def make_raster_text_pdf(rotation: int = 0) -> bytes:
    """A page whose body is a picture of print (RASTER_LINES in RASTER_RECT, no text layer), next to real text (a
    title at (72, 100)), a photo-like picture (smooth shading) and a logo (one solid shape) that hold no text, and a
    picture of print with real text written over it in PRINTED_RECT (a form typed on a scanned background)."""
    import math
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Formulir permohonan", fontname="helv", fontsize=14)
    x0, y0, x1, y1 = RASTER_RECT
    page.insert_image(pymupdf.Rect(*RASTER_RECT),
                      pixmap=_text_image(RASTER_LINES, x1 - x0, y1 - y0, size=11, color=(0, 0, 0)))
    photo = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 90), False)
    for y in range(90):
        for x in range(120):
            v = int(128 + 100 * math.sin(x / 9) * math.cos(y / 7))
            photo.set_pixel(x, y, (v, (v + 60) % 256, 255 - v))
    page.insert_image(pymupdf.Rect(400, 120, 520, 210), pixmap=photo)
    logo = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 80, 80), False)
    logo.clear_with(255)
    for y in range(80):
        for x in range(80):
            if (x - 40) ** 2 + (y - 40) ** 2 < 900:
                logo.set_pixel(x, y, (20, 60, 160))
    page.insert_image(pymupdf.Rect(80, 120, 160, 200), pixmap=logo)
    px0, py0, px1, py1 = PRINTED_RECT
    page.insert_image(pymupdf.Rect(*PRINTED_RECT), pixmap=_text_image(RASTER_LINES[:5], px1 - px0, py1 - py0, size=11))
    page.insert_text((80, 600), "Isian yang diketik di atas latar pindaian", fontname="helv", fontsize=11)
    if rotation:
        page.set_rotation(rotation)
    return doc.tobytes(garbage=3, deflate=True, no_new_id=True)


# M5d: OCR. A synthetic scanned form (invented content, no personal data): known Indonesian/English text printed with the
# bundled fonts, rasterised as a scanner would (optionally turned, blurred, noisy, JPEG) and embedded as the page's only
# content. scan_form_words() gives the ground truth: every word and its box (pt).
SCAN_TITLE = "FORMULIR PERMOHONAN SURAT PENGANTAR"
SCAN_ROWS = (("Nama Lengkap", "Budi Santoso"), ("NIK", "3273012345670001"), ("Tempat/Tgl Lahir", "Bandung, 12 Maret 1985"),
             ("Pekerjaan", "Karyawan Swasta"), ("Alamat", "Jl. Merdeka No. 45, RT 03/RW 07"))
SCAN_BODY = ("Dengan ini mengajukan permohonan surat pengantar untuk keperluan pembuatan",
             "Kartu Tanda Penduduk. Demikian permohonan ini saya buat dengan sebenarnya dan",
             "dapat dipergunakan sebagaimana mestinya.")
SCAN_NOTE = "Please submit this form to the village office before Friday, 14 November 2026."
SCAN_TABLE = (("No", "Dokumen", "Keterangan"), ("1", "Fotokopi KTP", "Ada"), ("2", "Kartu Keluarga", "Ada"))
SCAN_SIGN = ("Bandung, 9 November 2026", "Pemohon,", "(Budi Santoso)")
SCAN_SIZE = 11          # pt: rows, body and table; the title is 14 pt bold, the note 10 pt
SCAN_TABLE_RECT = (72, 430, 452, 496)  # the table's outer border (pt)
SCAN_BODY_TOP = 300     # baseline of the body's first line


def _scan_form(doc: pymupdf.Document, family: str, ink: tuple, paper: tuple, angle: float) -> pymupdf.Page:
    page = doc.new_page(width=595, height=842)
    morph = (pymupdf.Point(297.5, 421), pymupdf.Matrix(-angle)) if angle else None  # Matrix(θ) turns counter-clockwise
    page.draw_rect(page.rect, color=None, fill=paper, width=0)
    reg = pymupdf.Font(fontfile=str(FONT_FILES / f"{family}-Regular.ttf"))
    page.insert_font(fontname="R", fontfile=str(FONT_FILES / f"{family}-Regular.ttf"))
    page.insert_font(fontname="B", fontfile=str(FONT_FILES / f"{family}-Bold.ttf"))
    bold = pymupdf.Font(fontfile=str(FONT_FILES / f"{family}-Bold.ttf"))

    def text(x: float, y: float, s: str, name: str = "R", size: float = SCAN_SIZE) -> None:
        page.insert_text((x, y), s, fontname=name, fontsize=size, color=ink, morph=morph)

    def line(a: tuple, b: tuple, width: float = 0.8) -> None:
        page.draw_line(a, b, color=ink, width=width, morph=morph)

    text((595 - bold.text_length(SCAN_TITLE, 14)) / 2, 90, SCAN_TITLE, "B", 14)
    line((72, 104), (523, 104), 1.2)
    text(72, 140, "Yang bertanda tangan di bawah ini:")
    for i, (label, value) in enumerate(SCAN_ROWS):
        y = 166 + 22 * i
        text(90, y, label)
        text(200, y, ":")
        text(212, y, value)
    for i, s in enumerate(SCAN_BODY):
        text(72, SCAN_BODY_TOP + 15 * i, s)
    text(72, 370, SCAN_NOTE, size=10)
    x0, y0, x1, y1 = SCAN_TABLE_RECT
    cols, row_h = (x0, 112, 312, x1), (y1 - y0) / len(SCAN_TABLE)
    for k in range(len(SCAN_TABLE) + 1):
        line((x0, y0 + k * row_h), (x1, y0 + k * row_h))
    for c in cols:
        line((c, y0), (c, y1))
    for r, row in enumerate(SCAN_TABLE):
        for c, cell in enumerate(row):
            text(cols[c] + 6, y0 + r * row_h + 15, cell, "B" if r == 0 else "R")
    for i, s in enumerate(SCAN_SIGN):
        text(523 - reg.text_length(s, SCAN_SIZE), 560 + 18 * i + (40 if i == 2 else 0), s)
    return page


def scan_form_words(family: str = "Tinos", angle: float = 0.0) -> list[tuple[str, pymupdf.Rect]]:
    """The words of the synthetic scanned form and their boxes (pt; turned by `angle` as make_scan_form_pdf does:
    the box around each turned word)."""
    doc = pymupdf.open()
    page = _scan_form(doc, family, (0, 0, 0), (1, 1, 1), angle)
    return [(w[4], pymupdf.Rect(w[:4])) for w in page.get_text("words")]


def make_scan_form_pdf(family: str = "Tinos", angle: float = 0.0, noise: float = 0.0, blur: bool = False,
                       dpi: int = 300, jpeg: int | None = None, paper: tuple = (1, 1, 1), ink: tuple = (0, 0, 0),
                       seed: int = 1) -> bytes:
    """The synthetic scanned form as an image-only A4 page: printed in `family` with `ink` on `paper` (RGB 0–1), turned
    `angle` degrees clockwise around the page centre, rasterised at `dpi`, blurred (3×3 box), with Gaussian noise of
    σ = `noise` grey levels, stored as PNG or as JPEG of quality `jpeg`."""
    import numpy as np
    doc = pymupdf.open()
    page = _scan_form(doc, family, ink, paper, angle)
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, :pix.width * 3]
    img = img.reshape(pix.height, pix.width, 3).astype(np.float32)
    if blur:
        padded = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
        img = sum(padded[dy:dy + pix.height, dx:dx + pix.width] for dy in range(3) for dx in range(3)) / 9
    if noise:
        img = img + np.random.default_rng(seed).normal(0, noise, img.shape)
    out = pymupdf.Pixmap(pymupdf.csRGB, pix.width, pix.height, np.clip(img, 0, 255).astype(np.uint8).tobytes(), False)
    out.set_dpi(dpi, dpi)
    data = out.tobytes("jpeg", jpg_quality=jpeg) if jpeg else out.tobytes("png")
    scan = pymupdf.open()
    target = scan.new_page(width=595, height=842)
    target.insert_image(target.rect, stream=data)
    return scan.tobytes(garbage=3, deflate=True, no_new_id=True)


LSHAPE_CORNER = "Jumlah: Rp 500.000"


def make_lshape_scan_pdf(dpi: int = 200) -> bytes:
    """A scanned page whose first paragraph ends in a short line with other text beside it in the corner (at x 330 on
    the same baseline): a cover of the paragraph's bounding box would paint that text over. Filler lines below."""
    src = pymupdf.open()
    p = src.new_page(width=595, height=842)
    f = dict(fontname="tiro", fontsize=11)
    p.insert_text((72, 200), "Dengan ini kami menyatakan bahwa seluruh data yang kami isi adalah benar", **f)
    p.insert_text((72, 214), "dan dapat dipertanggungjawabkan.", **f)
    p.insert_text((330, 214), LSHAPE_CORNER, **f)
    p.insert_text((72, 260), "Paragraf lain yang tidak berhubungan sama sekali dengan yang di atas.", **f)
    for i in range(25):
        p.insert_text((72, 300 + i * 16), f"Baris pengisi nomor {i} untuk membuat halaman tampak seperti hasil pindai.", **f)
    pix = p.get_pixmap(dpi=dpi, alpha=False)
    out = pymupdf.open()
    q = out.new_page(width=595, height=842)
    q.insert_image(q.rect, stream=pix.tobytes("png"))
    return out.tobytes(garbage=3, deflate=True, no_new_id=True)


# A small-print form (invented content): 7.5–10 pt labels between dot leaders ("NIK : ……… Opsi: ………"), checkboxes drawn
# before list items, rasterised coarsely (218 dpi, grey) as a scanned office form often is. What makes Tesseract unsure
# there is the leaders' and boxes' ink next to the words, not the words. small_form_words() gives the ground truth.
SMALL_ROWS = (("Nama Lengkap", None), ("NIK", "Opsi:"), ("Tempat/ Tgl. Lahir", None), ("Nomor Tlp / HP", None),
              ("E-mail", None), ("Pekerjaan & Status", "(…) Aktif atau (…) Pensiun"), ("Alamat Kantor", None))
SMALL_ITEMS = (("Surat Keterangan Domisili", "Rekomendasi dari Ketua RT"), ("Ijin keramaian acara warga", "Pengantar SKCK"),
               ("Keterangan Tidak Mampu", "Lain-lain:"))
SMALL_FOOT = ("Untuk Keperluan:", "Ditujukan kepada:")
SMALL_RECT = (60, 90, 545, 335)  # the picture (pt)


def _small_form(doc: pymupdf.Document, family: str) -> tuple[pymupdf.Page, list[tuple[str, pymupdf.Rect]]]:
    page = doc.new_page(width=612, height=792)
    fonts = {}
    for name, style in (("R", "Regular"), ("B", "Bold")):
        page.insert_font(fontname=name, fontfile=str(FONT_FILES / f"{family}-{style}.ttf"))
        fonts[name] = pymupdf.Font(fontfile=str(FONT_FILES / f"{family}-{style}.ttf"))
    words: list[tuple[str, pymupdf.Rect]] = []

    def text(x: float, y: float, s: str, size: float, name: str = "R") -> float:
        """Writes `s` with its baseline at y; its words (not leader dots) go into the truth. Returns its end."""
        page.insert_text((x, y), s, fontname=name, fontsize=size)
        font, at = fonts[name], x
        for part in s.split(" "):
            w = font.text_length(part, size)
            if part and part.strip("."):
                words.append((part, pymupdf.Rect(at, y - 0.8 * size, at + w, y + 0.2 * size)))
            at += w + font.text_length(" ", size)
        return x + font.text_length(s, size)

    def leader(x0: float, x1: float, y: float, size: float) -> None:
        n = int((x1 - x0) / fonts["R"].text_length(".", size))
        text(x0, y, "." * n, size)

    for k, (label, extra) in enumerate(SMALL_ROWS):
        y = 110 + 17 * k
        text(90, y, label, 10)
        text(205, y, ":", 10)
        if extra is None:
            leader(218, 520, y, 10)
        elif extra.startswith("("):
            leader(218, 330, y, 10)
            text(372, y, extra, 10)
        else:
            leader(218, 320, y, 10)
            end = text(321, y, extra, 10)
            leader(end + 1, 520, y, 10)
    text(75, 240, "Mohon dibuatkan:", 10, "B")
    for k, row in enumerate(SMALL_ITEMS):
        y = 256 + 10 * k
        for x, item in zip((120, 330), row):
            page.draw_rect(pymupdf.Rect(x, y - 5.6, x + 5.2, y - 0.4), color=(0, 0, 0), width=0.5)
            end = text(x + 14, y, item, 7.5)
            if item.endswith(":"):
                leader(end + 2, 520, y, 7.5)
    for k, label in enumerate(SMALL_FOOT):
        y = 310 + 17 * k
        end = text(75, y, label, 10)
        leader(end + 2, 525, y, 10)
    return page, words


def small_form_words(family: str = "Caladea") -> list[tuple[str, pymupdf.Rect]]:
    """The words of the small-print form (make_small_form_pdf) and their boxes (pt): not its leaders nor checkboxes."""
    return _small_form(pymupdf.open(), family)[1]


def make_small_form_pdf(family: str = "Caladea", dpi: int = 218) -> bytes:
    """The small-print form as an image-only page: rasterised in grey at `dpi`, in SMALL_RECT."""
    doc = pymupdf.open()
    page, _ = _small_form(doc, family)
    pix = page.get_pixmap(dpi=dpi, clip=SMALL_RECT, colorspace=pymupdf.csGRAY, alpha=False)
    scan = pymupdf.open()
    target = scan.new_page(width=612, height=792)
    target.insert_image(pymupdf.Rect(SMALL_RECT), stream=pix.tobytes("png"))
    return scan.tobytes(garbage=3, deflate=True, no_new_id=True)
