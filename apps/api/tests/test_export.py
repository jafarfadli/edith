import pymupdf
import pytest

from tests.pdfs import make_pdf


def new_doc(client, **kw) -> str:
    return client.post("/documents", files={"file": ("a.pdf", make_pdf(**kw), "application/pdf")}).json()["doc_id"]


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def test_export_applies_ops(client):
    doc_id = new_doc(client, pages=2)
    body = {"ops": [
        {"id": "L", "type": "pages.layout", "pages": [{"pageKey": "o1", "src": {"doc": doc_id, "index": 1}}, {"pageKey": "o0", "src": {"doc": doc_id, "index": 0}}]},
        {"id": "r", "type": "redact.add", "pageKey": "o0", "rect": R(60, 50, 120, 30), "fill": "black"},
    ], "filename": "Laporan Akhir"}
    r = client.post(f"/documents/{doc_id}/export", json=body)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert 'filename="Laporan Akhir.pdf"' in r.headers["content-disposition"]
    out = pymupdf.open(stream=r.content, filetype="pdf")
    assert out.page_count == 2
    assert "Page 1" in out[0].get_text()
    assert "Page 0" not in out[1].get_text()


def test_export_no_ops_roundtrip(client):
    doc_id = new_doc(client, pages=1)
    r = client.post(f"/documents/{doc_id}/export", json={"ops": []})
    assert r.status_code == 200
    assert "Page 0" in pymupdf.open(stream=r.content, filetype="pdf")[0].get_text()


def test_invalid_op_reports_index(client):
    doc_id = new_doc(client)
    body = {"ops": [
        {"id": "a", "type": "whiteout.add", "pageKey": "o0", "rect": R(0, 0, 1, 1)},
        {"id": "b", "type": "shape.add", "pageKey": "o0", "kind": "rect", "stroke": "#000000", "width": 1},
    ]}
    r = client.post(f"/documents/{doc_id}/export", json=body)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_op"
    assert r.json()["error"]["op_index"] == 1


def test_unknown_page_key_is_invalid_op(client):
    doc_id = new_doc(client, pages=1)
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [{"id": "a", "type": "whiteout.add", "pageKey": "o9", "rect": R(0, 0, 1, 1)}]})
    assert r.status_code == 422
    assert r.json()["error"]["op_index"] == 0


def test_bake_failure_reports_op_id(client):
    doc_id = new_doc(client)
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [
        {"id": "img", "type": "image.add", "pageKey": "o0", "rect": R(0, 0, 10, 10), "assetId": "missing"}]})
    assert r.status_code == 500
    assert r.json()["error"] == {"code": "bake_failed", "message": r.json()["error"]["message"], "op_id": "img"}


def test_expired_doc(client, settings):
    doc_id = new_doc(client)
    storage = client.app.state.storage
    storage.clock = lambda: 10**12
    r = client.post(f"/documents/{doc_id}/export", json={"ops": []})
    assert r.status_code == 410
    assert r.json()["error"]["code"] == "doc_expired"


def test_render_page(client):
    doc_id = new_doc(client, pages=2)
    body = {"pageKey": "o1", "ops": [{"id": "w", "type": "whiteout.add", "pageKey": "o1", "rect": R(0, 0, 10, 10)}]}
    r = client.post(f"/documents/{doc_id}/render-page", json=body)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    pix = pymupdf.Pixmap(r.content)
    assert (pix.width, pix.height) == (1190, 1684)


def test_render_page_unknown_key(client):
    doc_id = new_doc(client, pages=1)
    r = client.post(f"/documents/{doc_id}/render-page", json={"pageKey": "u-x", "ops": []})
    assert r.status_code == 422


def test_safe_filename():
    from edith.routes.export import safe_filename
    assert safe_filename("a/b\\c.pdf") == "abc.pdf"
    assert safe_filename("") == "document.pdf"
    assert safe_filename("Résumé") == "Résumé.pdf"
    assert safe_filename('x"y.PDF') == "xy.PDF"


def test_render_scale_caps_pixels():
    import math

    import pymupdf as m

    from edith.routes.export import MAX_RENDER_PIXELS, render_scale
    assert render_scale(m.Rect(0, 0, 595, 842)) == 2
    s = render_scale(m.Rect(0, 0, 14400, 14400))
    assert s < 2
    assert math.ceil(14400 * s) ** 2 <= MAX_RENDER_PIXELS
    assert (14400 * s) ** 2 == pytest.approx(MAX_RENDER_PIXELS, rel=0.01)


def test_render_page_respects_pixel_cap(client, monkeypatch):
    import edith.routes.export as export
    monkeypatch.setattr(export, "MAX_RENDER_PIXELS", 100_000)
    doc_id = new_doc(client, pages=1)
    r = client.post(f"/documents/{doc_id}/render-page", json={"pageKey": "o0", "ops": []})
    assert r.status_code == 200
    pix = pymupdf.Pixmap(r.content)
    assert pix.width * pix.height <= 100_000
    assert pix.width / pix.height == pytest.approx(595 / 842, rel=0.01)


def test_export_text_edit(client):
    from tests.pdfs import make_edit_pdf
    doc_id = client.post("/documents", files={"file": ("e.pdf", make_edit_pdf(), "application/pdf")}).json()["doc_id"]
    run = {"text": "Diganti", "font": {"kind": "bundled", "family": "Arimo"}, "size": 12, "color": "#000000"}
    edit = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0", "box": {
        "rect": R(72, 88, 300, 16), "lineHeight": 12, "paragraphs": [[run]],
        "layout": [{"baseline": 12, "segments": [{"x": 0, "text": "Diganti", "runIndex": 0}]}]}}
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [edit], "paragraphs_version": 2})
    assert r.status_code == 200, r.text
    text = pymupdf.open(stream=r.content, filetype="pdf")[0].get_text()
    assert "Diganti" in text and "diedit" not in text and "tetangga" in text
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [{**edit, "paragraphId": "g9"}], "paragraphs_version": 2})
    assert r.status_code == 422 and r.json()["error"] == {"code": "invalid_op", "message": "no paragraph g9 on o0", "op_index": 0}


def test_export_with_imported_document(client):
    doc_id = new_doc(client, pages=1)
    imported = new_doc(client, pages=2, size=(300, 400))
    layout = {"id": "L", "type": "pages.layout", "pages": [
        {"pageKey": "o0", "src": {"doc": doc_id, "index": 0}},
        {"pageKey": "u-i1", "src": {"doc": imported, "index": 1}},
    ]}
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [layout]})
    assert r.status_code == 200, r.text
    out = pymupdf.open(stream=r.content, filetype="pdf")
    assert [p.get_text().strip() for p in out] == ["Page 0", "Page 1"]
    assert out[1].rect.width == 300
    r = client.post(f"/documents/{doc_id}/render-page", json={"pageKey": "u-i1", "ops": [layout]})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"


def test_export_with_expired_import(client):
    doc_id = new_doc(client, pages=1)
    imported = new_doc(client, pages=1)
    storage = client.app.state.storage
    storage._expire(imported)
    layout = {"id": "L", "type": "pages.layout", "pages": [
        {"pageKey": "o0", "src": {"doc": doc_id, "index": 0}}, {"pageKey": "u-i", "src": {"doc": imported, "index": 0}}]}
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [layout]})
    assert r.status_code == 410
    assert r.json()["error"]["code"] == "doc_expired" and r.json()["error"]["doc_id"] == imported


def text_add(text: str, family: str) -> dict:
    run = {"text": text, "font": {"kind": "bundled", "family": family, "bold": False, "italic": False}, "size": 12,
           "color": "#000000"}
    return {"id": "t", "type": "text.add", "pageKey": "o0", "box": {
        "rect": R(100, 200, 300, 20), "align": "left", "lineHeight": 14.4, "paragraphs": [[run]],
        "layout": [{"baseline": 12, "segments": [{"x": 0, "text": text, "runIndex": 0}]}]}}


def embedded(out: pymupdf.Document, name: str) -> bytes:
    return next(out.extract_font(e[0])[3] for e in out[0].get_fonts(full=True) if name in e[3])


def test_export_embeds_only_the_glyphs_it_uses(client):
    doc_id = new_doc(client, pages=1)
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [text_add("Halo dunia", "Arimo")]})
    out = pymupdf.open(stream=r.content, filetype="pdf")
    assert "Halo dunia" in out[0].get_text()
    assert len(embedded(out, "Arimo")) < 50_000  # Arimo-Regular.ttf is 316 KB


def test_export_with_a_cjk_fallback_font_stays_small(tmp_path):
    from fastapi.testclient import TestClient

    from edith.main import create_app
    from edith.settings import Settings
    from tests.pdfs import fake_cjk_pack
    settings = Settings(data_dir=tmp_path / "data", fonts_dir=fake_cjk_pack(tmp_path / "fonts"))
    with TestClient(create_app(settings)) as c:
        doc_id = new_doc(c, pages=1)
        r = c.post(f"/documents/{doc_id}/export", json={"ops": [text_add("한국어 텍스트", "Noto Sans KR")]})
    assert r.status_code == 200, r.text
    out = pymupdf.open(stream=r.content, filetype="pdf")
    assert "한국어 텍스트" in out[0].get_text()
    assert len(r.content) < 100_000  # the fallback file is 4 MB
