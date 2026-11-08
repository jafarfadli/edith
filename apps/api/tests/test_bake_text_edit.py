import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.doc_fonts import collect_fonts
from edith.errors import BakeFailed, InvalidOp
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import CID_TEXT, SUBSET_TTF, make_cid_subset_pdf, make_edit_pdf, make_fonts_pdf

DOC = "D" * 22
ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=FontRegistry(Settings().fonts_dir))


def edit(paragraph_id="g0", text="Teks baru", font=ARIMO, page_key="o0", x=72, y=88, baseline=12.0, op_id="e"):
    runs = [{"text": text, "font": font, "size": 12, "color": "#000000"}]
    layout = [{"baseline": baseline, "segments": [{"x": 0, "text": text, "runIndex": 0}]}] if text else []
    return {"id": op_id, "type": "text.edit", "pageKey": page_key, "paragraphId": paragraph_id,
            "box": {"rect": {"x": x, "y": y, "w": 300, "h": 16}, "align": "left", "lineHeight": 12,
                    "paragraphs": [runs], "layout": layout}}


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def reload(doc: pymupdf.Document) -> pymupdf.Document:
    return pymupdf.open(stream=doc.tobytes(garbage=3, deflate=True), filetype="pdf")


def text(page) -> str:
    return " ".join(page.get_text("text").split())


def spans(page):
    return [s for b in page.get_text("dict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"]]


def test_replaces_only_the_paragraph_and_keeps_graphics(ctx):
    out = reload(bake(make_edit_pdf(), ops(edit()), ctx))
    t = text(out[0])
    assert "Paragraf yang diedit" not in t and "baris dua." not in t
    assert "Teks baru" in t
    assert "Paragraf tetangga tetap utuh di sini sampai akhir." in t  # neighbours at 1.0× leading survive
    drawings = out[0].get_drawings()
    assert any(d["color"] == (1.0, 0.0, 0.0) for d in drawings)  # the red line under the paragraph
    assert len(out[0].get_images()) == 1
    assert out[0].get_pixmap(clip=pymupdf.Rect(320, 100, 321, 101)).pixel(0, 0) == (0, 0, 255)


def test_new_baseline_matches_layout(ctx):
    out = reload(bake(make_edit_pdf(), ops(edit(x=72, y=88, baseline=12.0)), ctx))
    span = next(s for s in spans(out[0]) if s["text"].startswith("Teks baru"))
    assert span["origin"] == pytest.approx((72, 100), abs=0.5)
    assert "Arimo" in span["font"]


def test_redact_add_still_removes_pixels_after_text_edit(ctx):
    redact = {"id": "r", "type": "redact.add", "pageKey": "o0", "rect": {"x": 295, "y": 85, "w": 50, "h": 35}, "fill": "black"}
    out = reload(bake(make_edit_pdf(), ops(edit(), redact), ctx))
    assert "Teks baru" in text(out[0])
    assert out[0].get_pixmap(clip=pymupdf.Rect(320, 100, 321, 101)).pixel(0, 0) == (0, 0, 0)


def test_empty_box_deletes_the_paragraph(ctx):
    out = reload(bake(make_edit_pdf(), ops(edit(text="")), ctx))
    t = text(out[0])
    assert "diedit" not in t
    assert "Paragraf tetangga tetap utuh" in t
    # The redaction band painted nothing: the red line still shows where the band crossed it.
    pix = out[0].get_pixmap(dpi=288, clip=pymupdf.Rect(79, 95, 81, 98))
    assert pix.pixel(pix.width // 2, pix.height // 2) == (255, 0, 0)


def test_duplicate_page_edits_only_the_copy(ctx):
    layout = {"id": "L", "type": "pages.layout", "pages": [
        {"pageKey": "o0", "src": {"doc": DOC, "index": 0}},
        {"pageKey": "u-dup", "src": {"doc": DOC, "index": 0}},
    ]}
    out = reload(bake(make_edit_pdf(), ops(layout, edit(page_key="u-dup")), ctx))
    assert "Paragraf yang diedit" in text(out[0]) and "Teks baru" not in text(out[0])
    assert "Paragraf yang diedit" not in text(out[1]) and "Teks baru" in text(out[1])


def test_unknown_paragraph_is_invalid_op(ctx):
    with pytest.raises(InvalidOp) as e:
        bake(make_edit_pdf(), ops(edit(paragraph_id="g99")), ctx)
    assert e.value.extra["op_index"] == 0


def test_blank_page_has_no_paragraphs(ctx):
    layout = {"id": "L", "type": "pages.layout", "pages": [{"pageKey": "u-b", "src": {"blank": {"width": 100, "height": 100}}}]}
    with pytest.raises(InvalidOp):
        bake(make_edit_pdf(), ops(layout, edit(page_key="u-b")), ctx)


def test_original_subset_font_is_reused(ctx):
    data = make_fonts_pdf()
    ref = next(f.ref for f in collect_fonts(pymupdf.open(stream=data, filetype="pdf")).values() if f.name == "Tinos Regular")
    out = reload(bake(data, ops(edit(paragraph_id="g3", text="lorem dolor", font={"kind": "original", "ref": ref}, y=208)), ctx))
    assert "Subset lorem ipsum" not in text(out[0])
    span = next(s for s in spans(out[0]) if s["text"] == "lorem dolor")
    assert "Tinos" in span["font"]
    sizes = {len(out.extract_font(x[0])[3]) for x in out[0].get_fonts(full=True)}
    assert len(SUBSET_TTF.read_bytes()) in sizes  # the 8 KB subset, not the 500 KB bundled Tinos


def test_links_over_the_edited_paragraph_survive(ctx):
    """The text-only redaction of the old lines also deletes links touching them: they are put back."""
    src = pymupdf.open(stream=make_edit_pdf(), filetype="pdf")
    src[0].insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 88, 250, 104), "uri": "https://contoh.id/a(b)"})
    src[0].insert_link({"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(72, 104, 120, 116), "page": 0,
                        "to": pymupdf.Point(0, 0), "zoom": 0})
    src[0].insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(400, 700, 450, 720), "uri": "https://lain.id"})
    out = reload(bake(src.tobytes(), ops(edit()), ctx))
    got = sorted((ln["kind"], ln.get("uri"), ln.get("page"), tuple(round(v, 1) for v in ln["from"])) for ln in out[0].get_links())
    assert got == [(pymupdf.LINK_GOTO, None, 0, (72, 104, 120, 116)),
                   (pymupdf.LINK_URI, "https://contoh.id/a(b)", None, (72, 88, 250, 104)),
                   (pymupdf.LINK_URI, "https://lain.id", None, (400, 700, 450, 720))]
    assert "Teks baru" in text(out[0])


def cid_font_ref(data: bytes, name: str) -> dict:
    fonts = collect_fonts(pymupdf.open(stream=data, filetype="pdf")).values()
    return {"kind": "original", "ref": next(f.ref for f in fonts if f.name == name)}


def test_unchanged_edit_in_a_cmapless_cid_subset_redraws_the_line_like_the_original(ctx):
    """MS Word / Hancom subsets have no cmap: the bake reuses them with one rebuilt from ToUnicode, so the same
    text at the same place renders the same glyphs with the same advances."""
    data = make_cid_subset_pdf()
    clip = pymupdf.Rect(60, 84, 320, 106)
    before = pymupdf.open(stream=data, filetype="pdf")[0].get_pixmap(dpi=144, clip=clip)
    out = reload(bake(data, ops(edit(text=CID_TEXT, font=cid_font_ref(data, "Dotum"), y=88)), ctx))
    after = out[0].get_pixmap(dpi=144, clip=clip)
    changed = sum(a != b for a, b in zip(before.samples, after.samples))
    assert changed / len(before.samples) < 0.01
    span = next(s for s in spans(out[0]) if round(s["origin"][1]) == 100)
    assert span["text"] == CID_TEXT and "Dotum" in span["font"]
    assert text(out[0]).count(CID_TEXT) == 2  # the edited line and the Batang line below it


def test_characters_missing_from_a_reused_subset_fail_the_bake(ctx):
    data = make_cid_subset_pdf()
    with pytest.raises(BakeFailed):  # the client sends them in a fallback font, never in the subset
        bake(data, ops(edit(text="가나다", font=cid_font_ref(data, "Dotum"), y=88)), ctx)
