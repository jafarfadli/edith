import io

import pymupdf
import pytest
from fontTools.ttLib import TTFont

from edith.cid_fonts import add_cmap, char_to_glyph, parse_to_unicode
from tests.pdfs import CID_TEXT, make_cid_subset_pdf, make_fonts_pdf

CMAP = b"""/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
3 beginbfchar
<0003> <0041>
<0004> <c2e0>
<0005> <00660069>
endbfchar
2 beginbfrange
<0010> <0012> <0061>
<0020> <0021> [<ac00> <zz>]
endbfrange
endcmap"""


def test_parse_to_unicode():
    assert parse_to_unicode(CMAP) == {3: "A", 4: "신", 5: "fi", 0x10: "a", 0x11: "b", 0x12: "c", 0x20: "가"}


def doc_and_font(name: str) -> tuple[pymupdf.Document, int]:
    doc = pymupdf.open(stream=make_cid_subset_pdf(), filetype="pdf")
    xref = next(e[0] for e in doc[0].get_fonts(full=True) if e[3].endswith(name))
    return doc, xref


def test_char_to_glyph_reads_tounicode_and_identity_gids():
    doc, xref = doc_and_font("Dotum")
    mapping = char_to_glyph(doc, xref)
    # PyMuPDF keeps the whole ToUnicode of the subset font (its dropped glyphs are empty, see add_cmap).
    assert {ord(c) for c in CID_TEXT} <= set(mapping)
    assert all(gid > 0 for gid in mapping.values())
    helvetica = pymupdf.open(stream=make_fonts_pdf(), filetype="pdf")
    assert char_to_glyph(helvetica, helvetica[0].get_fonts(full=True)[0][0]) == {}  # not Type0


def test_char_to_glyph_follows_a_cidtogidmap_stream():
    doc, xref = doc_and_font("Dotum")
    identity = char_to_glyph(doc, xref)
    cid_font = int(doc.xref_get_key(xref, "DescendantFonts")[1].strip("[]").split()[0])
    a, b = identity[ord("V")], identity[ord("F")]
    table = bytearray(b"".join(i.to_bytes(2, "big") for i in range(max(identity.values()) + 1)))
    table[2 * a:2 * a + 2], table[2 * b:2 * b + 2] = b.to_bytes(2, "big"), a.to_bytes(2, "big")  # swap V and F
    stream = doc.get_new_xref()
    doc.update_object(stream, "<<>>")
    doc.update_stream(stream, bytes(table))
    doc.xref_set_key(cid_font, "CIDToGIDMap", f"{stream} 0 R")
    swapped = char_to_glyph(doc, xref)
    assert (swapped[ord("V")], swapped[ord("F")]) == (b, a)


def test_add_cmap_covers_exactly_the_subset_and_keeps_advances():
    doc, xref = doc_and_font("Dotum")
    buf = doc.extract_font(xref)[3]
    rebuilt = TTFont(io.BytesIO(add_cmap(buf, char_to_glyph(doc, xref), "Edith Original 5")))
    drawn = {cp for cp in rebuilt.getBestCmap() if not chr(cp).isspace()}
    assert drawn == {ord(c) for c in CID_TEXT if c != " "}  # glyphs the subset kept (+ spaces, which are empty)
    assert {"name", "OS/2", "post"} <= set(rebuilt.keys())
    original = TTFont(io.BytesIO(buf))
    assert ([rebuilt["hmtx"][g] for g in rebuilt.getGlyphOrder()]
            == [original["hmtx"][g] for g in original.getGlyphOrder()])  # same advances, glyph for glyph
    font = pymupdf.Font(fontbuffer=add_cmap(buf, char_to_glyph(doc, xref), "Edith Original 5"))
    # Glyph advances are the ones the PDF shows the original text with.
    chars = [c for b in doc[0].get_text("rawdict")["blocks"] for ln in b["lines"][:1] for s in ln["spans"]
             for c in s["chars"]][:len(CID_TEXT)]
    for c in chars:
        assert font.text_length(c["c"], 12) == pytest.approx(c["bbox"][2] - c["bbox"][0], abs=0.01)


def test_add_cmap_needs_a_glyph_and_a_readable_program():
    doc, xref = doc_and_font("Dotum")
    assert add_cmap(doc.extract_font(xref)[3], {}, "X") is None
    assert add_cmap(b"not a font", {65: 1}, "X") is None
