import pymupdf

from tests.pdfs import make_fonts_pdf, make_paragraphs_pdf, make_pdf, make_pymupdf_subset_pdf, rename_font
from tests.test_documents import upload

ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}


def text_of(client, data: bytes) -> dict:
    doc_id = upload(client, data).json()["doc_id"]
    r = client.get(f"/documents/{doc_id}/text")
    assert r.status_code == 200, r.text
    return {"doc_id": doc_id, **r.json()}


def by_name(body: dict) -> dict:
    return {f["name"]: f for f in body["fonts"]}


def run_font(body: dict, starts: str) -> dict:
    p = next(p for p in body["pages"][0]["paragraphs"] if p["runs"][0]["text"].startswith(starts))
    return p["runs"][0]["font"]


def test_fonts_table_per_kind(client):
    body = text_of(client, make_fonts_pdf())
    f = by_name(body)
    assert f["Helvetica"] | {"ref": None} == {
        "ref": None, "name": "Helvetica", "embedded": False, "format": None, "reusable": False,
        "family": "helvetica", "bold": False, "italic": False, "substitute": ARIMO}
    assert f["Times-Roman"]["substitute"]["family"] == "Tinos"
    assert (f["Arimo Regular"]["format"], f["Arimo Regular"]["reusable"]) == ("ttf", True)
    assert (f["Tinos Regular"]["format"], f["Tinos Regular"]["reusable"]) == ("ttf", True)  # subset with a cmap
    assert (f["Courier"]["format"], f["Courier"]["reusable"]) == ("cff", False)
    assert f["Courier"]["substitute"]["family"] == "Cousine"


def test_runs_use_original_fonts_only_when_reusable(client):
    body = text_of(client, make_fonts_pdf())
    f = by_name(body)
    assert run_font(body, "Standard Helvetica") == ARIMO
    assert run_font(body, "Embedded Arimo") == {"kind": "original", "ref": f["Arimo Regular"]["ref"]}
    assert run_font(body, "Subset lorem") == {"kind": "original", "ref": f["Tinos Regular"]["ref"]}
    assert run_font(body, "Courier CFF")["family"] == "Cousine"


def test_pymupdf_subset_without_cmap_is_not_reusable(client):
    body = text_of(client, make_pymupdf_subset_pdf())
    font = by_name(body)["Cousine Regular"]
    assert (font["format"], font["reusable"]) == ("ttf", False)
    assert body["pages"][0]["paragraphs"][0]["runs"][0]["text"] == "Cousine subset"  # nbsp → space


def test_calibri_maps_to_carlito(client):
    body = text_of(client, rename_font(make_fonts_pdf(), "Helvetica", "Calibri"))
    assert by_name(body)["Calibri"]["substitute"]["family"] == "Carlito"
    assert run_font(body, "Standard Helvetica")["family"] == "Carlito"


def test_paragraphs_per_page(client):
    body = text_of(client, make_paragraphs_pdf())
    page = body["pages"][0]
    assert page["index"] == 0
    assert [p["id"] for p in page["paragraphs"]] == [f"g{i}" for i in range(8)]
    assert body["paragraphsVersion"] == 2


def test_font_bytes(client):
    body = text_of(client, make_fonts_pdf())
    f = by_name(body)
    ref = f["Tinos Regular"]["ref"]
    r = client.get(f"/documents/{body['doc_id']}/fonts/{ref}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "font/ttf"
    assert pymupdf.Font(fontbuffer=r.content).has_glyph(ord("S"))
    for bad in (f["Helvetica"]["ref"], f["Courier"]["ref"], "f999999", "zz"):
        r = client.get(f"/documents/{body['doc_id']}/fonts/{bad}")
        assert r.status_code == 404 and r.json()["error"]["code"] == "font_not_found", bad


def test_text_of_expired_doc(client, settings):
    doc_id = upload(client, make_pdf(pages=1)).json()["doc_id"]
    (settings.data_dir / "docs" / doc_id / "source.pdf").unlink()
    assert client.get(f"/documents/{doc_id}/text").json()["error"]["code"] == "doc_expired"


def test_font_bytes_headers_and_rejects_bad_refs(client):
    r = client.get("/documents/" + "a" * 22 + "/fonts/f1")
    assert r.status_code == 404 and r.json()["error"]["code"] == "doc_not_found"
    body = text_of(client, make_fonts_pdf())
    ref = by_name(body)["Arimo Regular"]["ref"]
    r = client.get(f"/documents/{body['doc_id']}/fonts/{ref}")
    assert r.status_code == 200 and r.headers["cache-control"] == "private, max-age=3600"
    assert r.headers["content-type"] == "font/ttf"
    assert pymupdf.Font(fontbuffer=r.content).has_glyph(ord("A"))
    for bad in ("f", "f0x1", "F1", "f1234567890", "f１"):
        r = client.get(f"/documents/{body['doc_id']}/fonts/{bad}")
        assert r.status_code == 404 and r.json()["error"]["code"] == "font_not_found", bad
