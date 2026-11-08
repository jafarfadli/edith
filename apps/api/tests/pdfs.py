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
