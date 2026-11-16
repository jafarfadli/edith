"""The PDF tools (edith.tools, POST /tools/{tool}) and the upload of a locked PDF with its password."""
import io
import zipfile

import pymupdf
import pytest

from tests.test_documents import upload


def make_pdf(pages: int = 3, image: bool = False) -> bytes:
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"Halaman {i + 1}", fontsize=14)
        if image:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 1200, 1200), False)
            pix.set_rect(pix.irect, (200, 40, 40))
            for x in range(0, 1200, 7):
                pix.set_rect(pymupdf.IRect(x, 0, x + 3, 1200), (x % 255, 90, 160))
            page.insert_image(pymupdf.Rect(72, 100, 372, 400), pixmap=pix)
    return doc.tobytes()


def locked(data: bytes, password: str = "rahasia") -> bytes:
    doc = pymupdf.open(stream=data)
    return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password)


def png(w: int, h: int) -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), False)
    pix.set_rect(pix.irect, (30, 120, 200))
    return pix.tobytes("png")


def run(client, tool: str, files: list[tuple[str, bytes]], **data):
    return client.post(f"/tools/{tool}", files=[("files", (n, b)) for n, b in files],
                       data={k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in data.items()})


def pdf_of(r) -> pymupdf.Document:
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    return pymupdf.open(stream=r.content)


def texts(doc: pymupdf.Document) -> list[str]:
    return [p.get_text().strip() for p in doc]


def test_unlock_needs_the_password_and_gives_a_plain_copy(client):
    data = locked(make_pdf(2))
    r = run(client, "unlock", [("surat.pdf", data)])
    assert r.status_code == 400 and r.json()["error"]["code"] == "pdf_encrypted"
    r = run(client, "unlock", [("surat.pdf", data)], password="salah")
    assert r.json()["error"]["code"] == "pdf_password_wrong"
    r = run(client, "unlock", [("surat.pdf", data)], password="rahasia")
    doc = pdf_of(r)
    assert not doc.needs_pass and not doc.is_encrypted and texts(doc) == ["Halaman 1", "Halaman 2"]
    assert "surat-terbuka.pdf" in r.headers["content-disposition"]


@pytest.mark.parametrize(("allow_print", "allow_copy"), [(True, True), (False, False)])
def test_protect_locks_with_the_password_and_the_permissions_chosen(client, allow_print, allow_copy):
    r = run(client, "protect", [("a.pdf", make_pdf(1))], new_password="kunci123", allow_print=allow_print,
            allow_copy=allow_copy)
    assert pymupdf.open(stream=r.content).needs_pass
    doc = pymupdf.open(stream=r.content)
    assert not doc.authenticate("lain") and doc.authenticate("kunci123")
    assert texts(doc) == ["Halaman 1"]
    assert bool(doc.permissions & pymupdf.PDF_PERM_PRINT) == allow_print
    assert bool(doc.permissions & pymupdf.PDF_PERM_COPY) == allow_copy


def test_protect_refuses_an_empty_password(client):
    r = run(client, "protect", [("a.pdf", make_pdf(1))], new_password="")
    assert r.json()["error"] == {"code": "bad_options", "message": "password is empty", "field": "password"}


def test_pictures_of_pages_one_file_or_a_zip(client):
    data = make_pdf(3)
    r = run(client, "to-images", [("lap.pdf", data)], format="png", dpi=72, pages="2")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    pix = pymupdf.Pixmap(r.content)
    assert (pix.width, pix.height) == (595, 842)
    r = run(client, "to-images", [("lap.pdf", data)], format="jpg", dpi=150, pages="1, 3")
    assert r.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert z.namelist() == ["lap-1.jpg", "lap-3.jpg"]
    assert pymupdf.Pixmap(z.read("lap-1.jpg")).width == 1240


@pytest.mark.parametrize("pages", ["0", "4", "2-1", "abc", "1,,2"])
def test_page_numbers_outside_the_document_are_refused(client, pages):
    r = run(client, "to-images", [("a.pdf", make_pdf(3))], pages=pages)
    assert r.status_code == 400 and r.json()["error"]["field"] == "pages"


def test_page_numbers_are_read_as_people_write_them():
    from edith.tools import parse_pages
    assert parse_pages("", 5) == [0, 1, 2, 3, 4]
    assert parse_pages("1-2, 4", 5) == [0, 1, 3]
    assert parse_pages("4-", 5) == [3, 4]
    assert parse_pages("5, 1", 5) == [4, 0]


def test_text_of_every_page(client):
    r = run(client, "to-text", [("a.pdf", make_pdf(2))])
    assert r.headers["content-type"].startswith("text/plain")
    assert [t.strip() for t in r.content.decode().split("\f")] == ["Halaman 1", "Halaman 2"]


@pytest.mark.parametrize("level", ["low", "medium", "high"])
def test_compress_makes_a_pdf_with_big_pictures_smaller_and_keeps_its_pages(client, level):
    data = make_pdf(2, image=True)
    doc = pdf_of(run(client, "compress", [("a.pdf", data)], level=level))
    assert texts(doc) == ["Halaman 1", "Halaman 2"]
    assert len(doc.tobytes()) <= len(data)


def test_compress_never_makes_a_pdf_bigger(client):
    data = make_pdf(1)
    r = run(client, "compress", [("a.pdf", data)], level="high")
    assert len(r.content) <= len(pymupdf.open(stream=data).tobytes(garbage=3, deflate=True)) + 16


def test_merge_in_the_order_given(client):
    a, b = make_pdf(1), make_pdf(2)
    doc = pdf_of(run(client, "merge", [("b.pdf", b), ("a.pdf", a)]))
    assert texts(doc) == ["Halaman 1", "Halaman 2", "Halaman 1"]
    r = run(client, "merge", [("a.pdf", a)])
    assert r.json()["error"]["code"] == "bad_options"


def test_split_every_n_pages_and_by_ranges(client):
    data = make_pdf(5)
    r = run(client, "split", [("buku.pdf", data)], mode="every", every=2)
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert z.namelist() == ["buku-01_hal-1-2.pdf", "buku-02_hal-3-4.pdf", "buku-03_hal-5.pdf"]
    assert texts(pymupdf.open(stream=z.read("buku-03_hal-5.pdf"))) == ["Halaman 5"]
    r = run(client, "split", [("buku.pdf", data)], mode="ranges", ranges="1-2, 5")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert [texts(pymupdf.open(stream=z.read(n))) for n in z.namelist()] == [["Halaman 1", "Halaman 2"], ["Halaman 5"]]


def test_extract_keeps_the_pages_asked_in_their_order(client):
    doc = pdf_of(run(client, "extract", [("a.pdf", make_pdf(4))], pages="4, 2"))
    assert texts(doc) == ["Halaman 4", "Halaman 2"]


def test_pictures_to_pdf_on_a4_or_their_own_size(client):
    wide, tall = png(800, 400), png(300, 600)
    doc = pdf_of(run(client, "images-to-pdf", [("a.png", wide), ("b.png", tall)], size="a4", margin=20))
    assert [(round(p.rect.width), round(p.rect.height)) for p in doc] == [(842, 595), (595, 842)]
    doc = pdf_of(run(client, "images-to-pdf", [("a.png", wide)], size="fit"))
    assert (round(doc[0].rect.width), round(doc[0].rect.height)) == (600, 300)  # 800 × 400 px at 96 dpi (no dpi stored)
    r = run(client, "images-to-pdf", [("x.png", b"bukan gambar")], size="a4")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_options"


def test_an_unknown_tool_is_refused(client):
    r = run(client, "explode", [("a.pdf", make_pdf(1))])
    assert r.status_code == 400 and r.json()["error"]["field"] == "tool"


def test_a_locked_pdf_uploads_with_its_password_and_is_stored_unlocked(client):
    data = locked(make_pdf(2))
    r = client.post("/documents", files={"file": ("k.pdf", data, "application/pdf")})
    assert r.json()["error"]["code"] == "pdf_encrypted"
    r = client.post("/documents", files={"file": ("k.pdf", data, "application/pdf")}, data={"password": "x"})
    assert r.json()["error"]["code"] == "pdf_password_wrong"
    r = client.post("/documents", files={"file": ("k.pdf", data, "application/pdf")}, data={"password": "rahasia"})
    assert r.status_code == 201, r.text
    doc_id = r.json()["doc_id"]
    stored = pymupdf.open(stream=client.get(f"/documents/{doc_id}/file").content)
    assert not stored.needs_pass and texts(stored) == ["Halaman 1", "Halaman 2"]


def export(client, data: bytes, output: dict | None, filename: str = "Surat Saya.pdf"):
    doc_id = upload(client, data).json()["doc_id"]
    body = {"ops": [], "filename": filename, **({"output": output} if output is not None else {})}
    return client.post(f"/documents/{doc_id}/export", json=body)


def test_export_of_some_pages_only(client):
    r = export(client, make_pdf(4), {"pages": "3, 1"})
    assert texts(pdf_of(r)) == ["Halaman 3", "Halaman 1"]


def test_export_as_pictures_named_after_the_file(client):
    r = export(client, make_pdf(2), {"format": "png", "dpi": 72, "pages": "2"})
    assert r.headers["content-type"] == "image/png" and "Surat%20Saya.png" in r.headers["content-disposition"]
    r = export(client, make_pdf(2), {"format": "jpg"})
    assert r.headers["content-type"] == "application/zip"
    assert zipfile.ZipFile(io.BytesIO(r.content)).namelist() == ["Surat Saya-1.jpg", "Surat Saya-2.jpg"]


def test_export_compressed_and_locked(client):
    r = export(client, make_pdf(2, image=True), {"compress": "high", "password": "kunci", "allow_copy": False})
    doc = pymupdf.open(stream=r.content)
    assert doc.needs_pass
    doc = pymupdf.open(stream=r.content)
    assert doc.authenticate("kunci") and texts(doc) == ["Halaman 1", "Halaman 2"]
    assert not doc.permissions & pymupdf.PDF_PERM_COPY


@pytest.mark.parametrize("output", [{"format": "gif"}, {"dpi": 96}, {"password": ""}, {"compress": "max"}, {"extra": 1}])
def test_export_refuses_unknown_output_options(client, output):
    r = export(client, make_pdf(1), output)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_export_refuses_pages_past_the_end(client):
    r = export(client, make_pdf(2), {"pages": "3"})
    assert r.status_code == 400 and r.json()["error"]["field"] == "pages"
