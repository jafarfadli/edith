import pymupdf

from tests.pdfs import make_pdf


def upload(client, data: bytes, name="a.pdf", ctype="application/pdf"):
    return client.post("/documents", files={"file": (name, data, ctype)})


def test_upload_structure_file(client):
    data = make_pdf(pages=3, rotation=0)
    r = upload(client, data)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["page_count"] == 3 and len(body["sha256"]) == 64
    doc_id = body["doc_id"]

    s = client.get(f"/documents/{doc_id}/structure").json()
    assert s["page_count"] == 3
    assert s["sha256"] == body["sha256"]
    assert s["pages"][0] == {"index": 0, "width": 595, "height": 842, "rotation": 0, "hasText": True}

    f = client.get(f"/documents/{doc_id}/file")
    assert f.status_code == 200
    assert f.headers["content-type"] == "application/pdf"
    assert f.content == data


def test_rotated_page_reports_unrotated_size(client):
    doc_id = upload(client, make_pdf(pages=1, rotation=90)).json()["doc_id"]
    p = client.get(f"/documents/{doc_id}/structure").json()["pages"][0]
    assert (p["width"], p["height"], p["rotation"]) == (595, 842, 90)


def test_blank_page_has_no_text(client):
    doc_id = upload(client, make_pdf(pages=1, text=False)).json()["doc_id"]
    assert client.get(f"/documents/{doc_id}/structure").json()["pages"][0]["hasText"] is False


def test_corrupt(client):
    r = upload(client, b"not a pdf at all")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "pdf_corrupt"


def test_encrypted(client):
    r = upload(client, make_pdf(password="rahasia"))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "pdf_encrypted"


def test_too_large_bytes(client, settings):
    settings.max_upload_bytes = 1000
    r = upload(client, make_pdf(pages=50))
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "too_large"


def test_too_many_pages(client, settings):
    settings.max_pages = 2
    r = upload(client, make_pdf(pages=3))
    assert r.status_code == 413


def test_unknown_doc(client):
    r = client.get("/documents/AAAAAAAAAAAAAAAAAAAAAA/structure")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "doc_not_found"
