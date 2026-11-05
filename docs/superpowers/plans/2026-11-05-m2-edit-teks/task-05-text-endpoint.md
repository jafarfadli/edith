# Task 5: `GET /documents/{id}/text` and `GET /documents/{id}/fonts/{ref}`

**Files:**
- Modify: `apps/api/edith/extract.py` (add `extract_text`), `apps/api/edith/errors.py` (`FontNotFound`), `apps/api/edith/main.py` (router), `apps/api/tests/pdfs.py` (`make_layout_pdf`)
- Create: `apps/api/edith/routes/text.py`, `apps/api/tests/test_text.py`, `apps/api/scripts/text_fixture.py`, `apps/web/src/lib/fixtures/text.json` (generated, committed)

**Interfaces:**
- Consumes: Task 3 `collect_fonts`, `span_fonts`, `name_key`, `fill_substitutes`, `font_bytes`; Task 4 `extract_paragraphs`; Task 1 `FontRegistry.substitute`; M1 `open_pdf`, storage, `DocExpired`.
- Produces:
  - `edith.extract.extract_text(doc, registry) -> {"pages": [{"index": int, "paragraphs": [Paragraph]}], "fonts": [DocFont.to_json()]}` — a run whose font is reusable gets `{"kind": "original", "ref": "f<xref>"}`, any other run its bundled substitute (from the BaseFont name when the span maps to a document font, else from the span's font name and flags).
  - `GET /documents/{doc_id}/text` → `200 {"doc_id", "pages", "fonts"}`; `410 doc_expired`, `404 doc_not_found` as M1.
  - `GET /documents/{doc_id}/fonts/{ref}` → the font program, `content-type: font/ttf` or `font/otf`, `Cache-Control: private, max-age=3600`; `404 font_not_found` for a malformed ref, a ref not used by any page, or a font that is not reusable.
  - `edith.errors.FontNotFound` (404, `font_not_found`).
  - `tests.pdfs.make_layout_pdf()`; `apps/web/src/lib/fixtures/text.json` = `{"doc_id": "fixture", **extract_text(make_layout_pdf())}` (Task 9 tests the client layout against it). Regenerate with `cd apps/api && uv run python -m scripts.text_fixture`.

- [ ] **Step 1: Failing endpoint tests**

`apps/api/tests/test_text.py`:
```python
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
```

Run: `cd apps/api && uv run pytest tests/test_text.py -q`
Expected: FAIL — 7 failures, the routes return `404 not_found`.

- [ ] **Step 2: Extraction over the whole document**

In `apps/api/edith/extract.py`, extend the imports:
```python
import pymupdf

from edith.doc_fonts import collect_fonts, fill_substitutes, name_key, span_fonts
from edith.errors import PdfCorrupt, PdfEncrypted, TooLarge
from edith.fonts import FontRegistry
from edith.paragraphs import extract_paragraphs
```
and append:
```python


def extract_text(doc: pymupdf.Document, registry: FontRegistry) -> dict:
    """Paragraphs of every page plus the fonts they use. A run whose font is reusable gets
    `{"kind": "original", "ref"}`; any other run gets its bundled substitute."""
    fonts = collect_fonts(doc)
    pages = []
    for page in doc:
        by_name = span_fonts(page, fonts)

        def resolve(span: dict, by_name=by_name) -> dict:
            font = by_name.get(name_key(span["font"]))
            if font is None:
                return registry.substitute(span["font"], span["flags"])
            if font.substitute is None:  # BaseFont names map better than program names
                font.substitute = registry.substitute(font.name, span["flags"])
            return {"kind": "original", "ref": font.ref} if font.reusable else dict(font.substitute)

        pages.append({"index": page.number, "paragraphs": extract_paragraphs(page, resolve)})
    fill_substitutes(fonts, registry)
    return {"pages": pages, "fonts": [f.to_json() for f in fonts.values()]}
```

In `apps/api/edith/errors.py`, after `class AssetNotFound`:
```python
class FontNotFound(EdithError):
    status, code = 404, "font_not_found"
```

- [ ] **Step 3: Routes**

`apps/api/edith/routes/text.py`:
```python
import re

from fastapi import APIRouter, Request, Response

from edith.doc_fonts import font_bytes
from edith.errors import DocExpired, FontNotFound
from edith.extract import extract_text, open_pdf

router = APIRouter()


def _open_source(request: Request, doc_id: str):
    s = request.app.state.settings
    try:
        data = request.app.state.storage.source_path(doc_id).read_bytes()
    except FileNotFoundError:
        raise DocExpired() from None
    return open_pdf(data, s.max_pages)


@router.get("/documents/{doc_id}/text")
def get_text(request: Request, doc_id: str) -> dict:
    doc = _open_source(request, doc_id)
    try:
        return {"doc_id": doc_id, **extract_text(doc, request.app.state.fonts)}
    finally:
        doc.close()


@router.get("/documents/{doc_id}/fonts/{ref}")
def get_font(request: Request, doc_id: str, ref: str) -> Response:
    if not re.fullmatch(r"f\d{1,9}", ref):
        raise FontNotFound()
    doc = _open_source(request, doc_id)
    try:
        xref = int(ref[1:])
        used = any(entry[0] == xref for page in doc for entry in page.get_fonts(full=True))
        found = font_bytes(doc, xref) if used else None
    finally:
        doc.close()
    if found is None:
        raise FontNotFound()
    data, ext = found
    return Response(data, media_type=f"font/{ext}", headers={"Cache-Control": "private, max-age=3600"})
```

In `apps/api/edith/main.py`: `from edith.routes import assets, documents, export, text` and, after `app.include_router(export.router)`, add `app.include_router(text.router)`.

Run: `cd apps/api && uv run pytest -q`
Expected: all pass.

- [ ] **Step 4: Web layout fixture**

Append to `apps/api/tests/pdfs.py`:
```python


def make_layout_pdf() -> bytes:
    """Wrapped paragraphs (standard Helvetica/Times/Courier, every alignment) plus hand-broken lines."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    boxes = [("helv", pymupdf.TEXT_ALIGN_LEFT), ("tiro", pymupdf.TEXT_ALIGN_JUSTIFY), ("helv", pymupdf.TEXT_ALIGN_CENTER),
             ("cour", pymupdf.TEXT_ALIGN_LEFT), ("tiro", pymupdf.TEXT_ALIGN_RIGHT)]
    for i, (font, align) in enumerate(boxes):
        rest = page.insert_textbox(pymupdf.Rect(72, 60 + i * 140, 320, 190 + i * 140), LOREM, fontname=font,
                                   fontsize=10.5, align=align)
        assert rest >= 0, "text did not fit its box"
    for i, text in enumerate(["Jl. Merdeka Barat No. 17, Jakarta", "Pusat", "Indonesia"]):  # an address: hard breaks
        page.insert_text((360, 80 + i * 13), text, fontname="helv", fontsize=11)
    return doc.tobytes(garbage=3, deflate=True)
```

`apps/api/scripts/text_fixture.py`:
```python
"""Writes apps/web/src/lib/fixtures/text.json: GET /documents/{id}/text of tests.pdfs.make_layout_pdf(),
for the web tests that check client layout against the original line breaks."""
import json

import pymupdf

from edith.extract import extract_text
from edith.fonts import FontRegistry
from edith.settings import REPO_ROOT, Settings
from tests.pdfs import make_layout_pdf

OUT = REPO_ROOT / "apps" / "web" / "src" / "lib" / "fixtures" / "text.json"


def build() -> dict:
    doc = pymupdf.open(stream=make_layout_pdf(), filetype="pdf")
    return {"doc_id": "fixture", **extract_text(doc, FontRegistry(Settings().fonts_dir))}


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), indent=1) + "\n")
    print("wrote", OUT)
```

Run: `cd apps/api && uv run python -m scripts.text_fixture`
Expected: `wrote …/apps/web/src/lib/fixtures/text.json`; the file has 6 paragraphs on page 0 — `g0` left (Arimo), `g1` justify (Tinos), `g2` center (Arimo), `g3` left (Cousine), `g4` right (Tinos), `g5` the 3-line address (Arimo) — and 3 fonts (Helvetica, Times-Roman, Courier; none reusable).

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web/src/lib/fixtures/text.json
git commit -m "feat(api): serve original paragraphs, document fonts and reusable font files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
