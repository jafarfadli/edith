"""M5c: text that is a picture. Invisible text laid over an image of it is locked ("hidden"), and images that look
like print with no text over them are reported (`imageText`) so the client can say why nothing there is editable."""
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import InvalidOp
from edith.fonts import FontRegistry
from edith.imagetext import image_text_regions
from edith.ops import ExportRequest
from edith.paragraphs import extract_paragraphs
from edith.settings import Settings
from tests.pdfs import (RASTER_RECT, SCAN_RECT, make_hidden_text_pdf, make_paragraphs_pdf, make_picture_text_pdf,
                        make_raster_text_pdf,
                        make_type3_pdf)
from tests.test_documents import upload

DOC = "D" * 22


def page_of(data: bytes) -> pymupdf.Page:
    return pymupdf.open(stream=data, filetype="pdf")[0]


def text(p: dict) -> str:
    return "".join(r["text"] for r in p["runs"])


def rect(r) -> dict:
    x0, y0, x1, y1 = r
    return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}


@pytest.mark.parametrize("hide", ["mode3", "opacity"])
def test_invisible_text_over_its_picture_is_locked(hide):
    ps = extract_paragraphs(page_of(make_hidden_text_pdf(hide)))
    assert [(text(p), p["editable"], p.get("lock")) for p in ps] == [
        ("Paragraf biasa yang terlihat.", True, None),
        ("KEMENTERIAN CONTOH REPUBLIK SEKRETARIAT JENDERAL", False, "hidden"),
        ("BIRO UMUM DAN ORGANISASI", False, "hidden"),
    ]


def test_type3_text_mupdf_reports_unpainted_is_not_hidden():
    ps = extract_paragraphs(page_of(make_type3_pdf()))
    assert ps and all(p["editable"] and "lock" not in p for p in ps)


def test_every_locked_paragraph_says_why():
    ps = extract_paragraphs(page_of(make_paragraphs_pdf()))
    assert [p.get("lock") for p in ps] == [None] * 7 + ["rotated"]


def test_a_picture_of_print_is_reported_and_other_pictures_are_not():
    # The photo, the logo and the picture with real text typed over it are left out.
    assert image_text_regions(page_of(make_raster_text_pdf())) == [rect(RASTER_RECT)]


def test_image_text_rects_are_unrotated_page_points():
    assert image_text_regions(page_of(make_raster_text_pdf(rotation=90))) == [rect(RASTER_RECT)]


def test_image_text_analysis_stops_when_the_budget_is_spent():
    budget = [100]
    assert image_text_regions(page_of(make_raster_text_pdf()), budget) == []
    assert budget == [100]


def test_get_text_reports_locks_and_image_text(client):
    doc_id = upload(client, make_hidden_text_pdf()).json()["doc_id"]
    page = client.get(f"/documents/{doc_id}/text").json()["pages"][0]
    assert [p.get("lock") for p in page["paragraphs"]] == [None, "hidden", "hidden"]
    assert page["imageText"] == [rect(SCAN_RECT)]  # its only text is invisible: the picture is what shows
    doc_id = upload(client, make_raster_text_pdf()).json()["doc_id"]
    assert client.get(f"/documents/{doc_id}/text").json()["pages"][0]["imageText"] == [rect(RASTER_RECT)]


def test_e2e_fixture_pictures_are_ccitt_and_read_as_the_reference_cases():
    """apps/web/e2e/fixtures/picture-text.pdf (regenerate: cd apps/api && uv run python -m scripts.e2e_picture_pdf)."""
    from pathlib import Path
    fixture = Path(__file__).resolve().parents[2] / "web" / "e2e" / "fixtures" / "picture-text.pdf"
    data = fixture.read_bytes()
    assert data == make_picture_text_pdf()
    doc = pymupdf.open(stream=data, filetype="pdf")
    filters = {doc.xref_get_key(x, "Filter")[1] for x in range(1, doc.xref_length())
               if doc.xref_get_key(x, "Subtype")[1] == "/Image"}
    assert filters == {"/CCITTFaxDecode"}
    ps = extract_paragraphs(doc[0])
    assert [p.get("lock") for p in ps] == [None, "hidden", "hidden"]
    assert image_text_regions(doc[0]) == [rect(SCAN_RECT), rect(RASTER_RECT)]


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=FontRegistry(Settings().fonts_dir))


def edit(paragraph_id: str, x: float, y: float) -> dict:
    runs = [{"text": "Teks baru", "font": {"kind": "bundled", "family": "Arimo"}, "size": 12, "color": "#000000"}]
    return {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": paragraph_id,
            "box": {"rect": {"x": x, "y": y, "w": 300, "h": 16}, "align": "left", "lineHeight": 12,
                    "paragraphs": [runs], "layout": [{"baseline": 12, "segments": [{"x": 0, "text": "Teks baru",
                                                                                     "runIndex": 0}]}]}}


def test_bake_refuses_to_draw_over_the_picture_of_a_hidden_paragraph(ctx):
    ops = ExportRequest.model_validate({"ops": [edit("g1", 76, 62)]}).ops
    with pytest.raises(InvalidOp, match="invisible text"):
        bake(make_hidden_text_pdf(), ops, ctx)


def test_editing_visible_text_leaves_the_picture_alone(ctx):
    source = make_hidden_text_pdf()
    before = page_of(source).get_pixmap(clip=pymupdf.Rect(*SCAN_RECT)).samples
    out = bake(source, ExportRequest.model_validate({"ops": [edit("g0", 72, 188)]}).ops, ctx)
    page = pymupdf.open(stream=out.tobytes(), filetype="pdf")[0]
    assert "Teks baru" in page.get_text() and "Paragraf biasa" not in page.get_text()
    assert page.get_pixmap(clip=pymupdf.Rect(*SCAN_RECT)).samples == before


def test_export_of_a_hidden_paragraph_edit_is_an_invalid_op(client):
    doc_id = upload(client, make_hidden_text_pdf()).json()["doc_id"]
    version = client.get(f"/documents/{doc_id}/text").json()["paragraphsVersion"]
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [edit("g1", 76, 62)], "paragraphs_version": version})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_op"
