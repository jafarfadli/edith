import struct

import pymupdf
import pytest

from edith.errors import AssetNotFound, UnsupportedMedia
from edith.routes.assets import image_size
from tests.pdfs import make_pdf


def png_bytes(w=4, h=3) -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), 0)
    pix.set_rect(pix.irect, (255, 0, 0))
    return pix.tobytes("png")


def jpeg_bytes(w=17, h=9) -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), 0)
    pix.set_rect(pix.irect, (0, 128, 255))
    return pix.tobytes("jpg")


def png_with_claimed_size(w: int, h: int) -> bytes:
    """Small valid PNG whose IHDR width/height are patched (CRC left stale on purpose)."""
    data = bytearray(png_bytes())
    data[16:24] = struct.pack(">II", w, h)
    return bytes(data)


def new_doc(client) -> str:
    return client.post("/documents", files={"file": ("a.pdf", make_pdf(), "application/pdf")}).json()["doc_id"]


def test_image_size_png():
    assert image_size(png_bytes(4, 3), "png") == (4, 3)
    assert image_size(png_bytes(640, 480), "png") == (640, 480)


def test_image_size_jpeg():
    # pymupdf writes progressive JPEGs (SOF2), so this also covers the SOF range.
    assert image_size(jpeg_bytes(17, 9), "jpg") == (17, 9)


def test_image_size_jpeg_baseline_marker():
    data = bytearray(jpeg_bytes(17, 9))
    sof = data.index(b"\xff\xc2")
    data[sof + 1] = 0xC0  # SOF0 has the same layout
    assert image_size(bytes(data), "jpg") == (17, 9)


@pytest.mark.parametrize(
    "data, ext",
    [
        (b"\x89PNG\r\n\x1a\n", "png"),  # truncated before IHDR
        (b"\x89PNG\r\n\x1a\nxxxx" + b"junkjunk" * 2, "png"),  # no IHDR tag
        (b"\xff\xd8\xff\xd9", "jpg"),  # JPEG with no SOF marker
        (b"\xff\xd8\xff\xc0\x00", "jpg"),  # SOF cut short
        (png_with_claimed_size(0, 5), "png"),  # zero dimension
    ],
)
def test_image_size_unreadable_header(data, ext):
    with pytest.raises(UnsupportedMedia):
        image_size(data, ext)


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


def test_upload_jpeg_round_trip(client):
    doc_id = new_doc(client)
    data = jpeg_bytes(17, 9)
    r = client.post(f"/documents/{doc_id}/assets", files={"file": ("x.jpg", data, "image/jpeg")})
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["width"], body["height"]) == (17, 9)
    g = client.get(f"/documents/{doc_id}/assets/{body['asset_id']}")
    assert g.status_code == 200
    assert g.headers["content-type"] == "image/jpeg"
    assert g.content == data


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


def test_rejects_too_many_pixels_before_decoding(client):
    doc_id = new_doc(client)
    bomb = png_with_claimed_size(30000, 30000)  # 900M pixels; body is tiny
    r = client.post(f"/documents/{doc_id}/assets", files={"file": ("x.png", bomb, "image/png")})
    assert r.status_code == 413
    err = r.json()["error"]
    assert err["code"] == "too_large"
    assert "pixels" in err["message"]


def test_rejects_large(client, settings):
    settings.max_asset_bytes = 10
    doc_id = new_doc(client)
    r = client.post(f"/documents/{doc_id}/assets", files={"file": ("x.png", png_bytes(), "image/png")})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "too_large"


def test_asset_path_unknown(storage):
    meta = storage.create(b"x", page_count=1)
    with pytest.raises(AssetNotFound):
        storage.asset_path(meta.doc_id, "nope")
    with pytest.raises(AssetNotFound):
        storage.asset_path(meta.doc_id, "../meta.json")
