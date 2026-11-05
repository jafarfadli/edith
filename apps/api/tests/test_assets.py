import pymupdf
import pytest

from edith.errors import AssetNotFound
from tests.pdfs import make_pdf


def png_bytes(w=4, h=3) -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), 0)
    pix.set_rect(pix.irect, (255, 0, 0))
    return pix.tobytes("png")


def new_doc(client) -> str:
    return client.post("/documents", files={"file": ("a.pdf", make_pdf(), "application/pdf")}).json()["doc_id"]


def test_upload_png(client):
    doc_id = new_doc(client)
    r = client.post(f"/documents/{doc_id}/assets", files={"file": ("x.png", png_bytes(), "image/png")})
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["width"], body["height"]) == (4, 3)
    path = client.app.state.storage.asset_path(doc_id, body["asset_id"])
    assert path.read_bytes() == png_bytes()
    g = client.get(f"/documents/{doc_id}/assets/{body['asset_id']}")
    assert g.status_code == 200
    assert g.headers["content-type"] == "image/png"
    assert g.content == png_bytes()
    assert client.get(f"/documents/{doc_id}/assets/nope").status_code == 404


def test_rejects_non_image(client):
    doc_id = new_doc(client)
    r = client.post(f"/documents/{doc_id}/assets", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 415
    assert r.json()["error"]["code"] == "unsupported_media"


def test_rejects_undecodable_image(client):
    doc_id = new_doc(client)
    bogus = b"\x89PNG\r\n\x1a\n" + b"not really a png"
    r = client.post(f"/documents/{doc_id}/assets", files={"file": ("x.png", bogus, "image/png")})
    assert r.status_code == 415
    assert r.json()["error"]["code"] == "unsupported_media"


def test_rejects_large(client, settings):
    settings.max_asset_bytes = 10
    doc_id = new_doc(client)
    r = client.post(f"/documents/{doc_id}/assets", files={"file": ("x.png", png_bytes(), "image/png")})
    assert r.status_code == 413


def test_asset_path_unknown(storage):
    meta = storage.create(b"x", page_count=1)
    with pytest.raises(AssetNotFound):
        storage.asset_path(meta.doc_id, "nope")
    with pytest.raises(AssetNotFound):
        storage.asset_path(meta.doc_id, "../meta.json")
