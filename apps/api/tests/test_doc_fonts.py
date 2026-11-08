import pymupdf

from edith.doc_fonts import collect_fonts, fill_substitutes, load_font, name_key, span_fonts
from edith.fonts import FontRegistry
from edith.settings import Settings
from tests.pdfs import make_cid_subset_pdf, make_fonts_pdf, make_pymupdf_subset_pdf, rename_font


def fonts_of(data: bytes):
    doc = pymupdf.open(stream=data, filetype="pdf")
    return doc, collect_fonts(doc)


def by_name(fonts) -> dict:
    return {f.name: f for f in fonts.values()}


def test_name_key():
    assert name_key("ABCDEF+Arimo Regular") == name_key("Arimo-Regular") == "arimoregular"


def test_font_table_per_kind():
    _, fonts = fonts_of(make_fonts_pdf())
    f = by_name(fonts)
    assert [(n, f[n].embedded, f[n].format, f[n].reusable) for n in f] == [
        ("Helvetica", False, None, False),
        ("Times-Roman", False, None, False),
        ("Arimo Regular", True, "ttf", True),
        ("Tinos Regular", True, "ttf", True),   # subset with a cmap
        ("Courier", True, "cff", False),        # bare CFF
    ]
    assert f["Helvetica"].ref == f"f{f['Helvetica'].xref}"
    assert f["Courier"].family == "courier"


def test_pymupdf_subset_gets_a_rebuilt_cmap():
    doc, fonts = fonts_of(make_pymupdf_subset_pdf())
    (font,) = fonts.values()
    assert (font.name, font.format, font.reusable) == ("Cousine Regular", "ttf", True)
    rebuilt = load_font(doc, font.xref)
    assert all(rebuilt.has_glyph(ord(c)) for c in "Cousine subset")
    assert not rebuilt.has_glyph(ord("X"))  # only what the subset kept


def test_symbol_fonts_are_flagged():
    _, fonts = fonts_of(make_cid_subset_pdf())
    assert {f.name: f.symbolic for f in fonts.values()} == {"Dotum": False, "Batang": False, "Wingdings": True}


def test_every_span_maps_to_its_font():
    doc, fonts = fonts_of(make_fonts_pdf())
    by_key = span_fonts(doc[0], fonts)
    spans = [s for b in doc[0].get_text("dict")["blocks"] for ln in b["lines"] for s in ln["spans"]]
    got = {s["text"]: by_key[name_key(s["font"])].name for s in spans}
    assert got == {"Standard Helvetica line": "Helvetica", "Standard Times line": "Times-Roman",
                   "Embedded Arimo line": "Arimo Regular", "Subset lorem ipsum": "Tinos Regular",
                   "Courier CFF line": "Courier"}  # the CFF span is named after its program (NimbusMonoPS)


def test_load_font_only_for_reusable_programs():
    doc, fonts = fonts_of(make_fonts_pdf())
    f = by_name(fonts)
    assert load_font(doc, f["Tinos Regular"].xref).has_glyph(ord("S"))
    assert load_font(doc, f["Courier"].xref) is None
    assert load_font(doc, f["Helvetica"].xref) is None
    doc, fonts = fonts_of(make_pymupdf_subset_pdf())
    assert load_font(doc, next(iter(fonts))).has_glyph(ord("C"))  # cmap rebuilt from ToUnicode


def test_ambiguous_names_map_to_none():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "a", fontname="helv")
    writer = pymupdf.TextWriter(page.rect)
    writer.append((72, 100), "b", font=pymupdf.Font("helv"))  # embedded NimbusSans, BaseFont "Helvetica" too
    writer.write_text(page)
    doc = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    assert span_fonts(doc[0], collect_fonts(doc))["helvetica"] is None


def test_substitutes_from_base_font_names():
    _, fonts = fonts_of(rename_font(make_fonts_pdf(), "Helvetica", "Calibri"))
    fill_substitutes(fonts, FontRegistry(Settings().fonts_dir))
    f = by_name(fonts)
    assert f["Calibri"].substitute == {"kind": "bundled", "family": "Carlito", "bold": False, "italic": False}
    assert f["Courier"].substitute["family"] == "Cousine"
    assert f["Calibri"].to_json()["substitute"]["family"] == "Carlito"


def test_two_subsets_sharing_a_name_each_draw_their_own_spans():
    """M5b FONT_SUB: an ambiguous name used to give every span the bundled substitute; each span now gets the
    subset that draws all of its characters."""
    from edith.extract import extract_text
    from tests.pdfs import TWIN_TEXTS, make_twin_subsets_pdf
    doc = pymupdf.open(stream=make_twin_subsets_pdf(), filetype="pdf")
    body = extract_text(doc, FontRegistry(Settings().fonts_dir))
    runs = [p["runs"][0] for p in body["pages"][0]["paragraphs"]]
    assert [r["text"] for r in runs] == list(TWIN_TEXTS)
    assert all(r["font"]["kind"] == "original" for r in runs)
    assert runs[0]["font"]["ref"] != runs[1]["font"]["ref"]
    for run in runs:
        program = load_font(doc, int(run["font"]["ref"][1:]))
        assert all(program.has_glyph(ord(c)) for c in run["text"] if c != " ")
