import pymupdf

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
