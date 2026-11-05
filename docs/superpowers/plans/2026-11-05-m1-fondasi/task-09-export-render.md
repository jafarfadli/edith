# Task 9: Export and render-page endpoints

**Files:**
- Create: `apps/api/edith/routes/export.py`, `apps/api/tests/test_export.py`
- Modify: `apps/api/edith/main.py` (create `FontRegistry`, include router)

**Interfaces:**
- Consumes: `bake`, `BakeContext` (Task 6), `Storage` (Tasks 4–5), `ExportRequest`, `RenderPageRequest` (Task 3), `FontRegistry` (Task 2).
- Produces:
  - `app.state.fonts: FontRegistry`.
  - `POST /documents/{doc_id}/export` body `ExportRequest` → `200 application/pdf`, header `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<utf8>` (name always ends in `.pdf`).
  - `POST /documents/{doc_id}/render-page` body `RenderPageRequest` → `200 image/png` at 144 dpi of the page identified by `pageKey`.
  - `edith.routes.export.safe_filename(name: str) -> str`.

- [ ] **Step 1: Failing tests**

`apps/api/tests/test_export.py`:
```python
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
```

Run: `cd apps/api && uv run pytest tests/test_export.py -q` → Expected: FAIL (404 routes).

- [ ] **Step 2: Routes**

`apps/api/edith/routes/export.py`:
```python
import re
from urllib.parse import quote

import pymupdf
from fastapi import APIRouter, Request, Response

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import InvalidOp
from edith.ops import ExportRequest, RenderPageRequest

router = APIRouter()


def safe_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name).strip()
    if not name:
        name = "document"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name


def _ctx(request: Request, doc_id: str) -> BakeContext:
    storage = request.app.state.storage
    return BakeContext(
        doc_id=doc_id,
        asset_path=lambda asset_id: storage.asset_path(doc_id, asset_id),
        fonts=request.app.state.fonts,
    )


def _page_index(ops: list, page_key: str, page_count: int) -> int:
    for op in ops:
        if op.type == "pages.layout":
            keys = [p.pageKey for p in op.pages]
            if page_key in keys:
                return keys.index(page_key)
            raise InvalidOp(f"unknown pageKey {page_key}")
    m = re.fullmatch(r"o(\d+)", page_key)
    if m and int(m.group(1)) < page_count:
        return int(m.group(1))
    raise InvalidOp(f"unknown pageKey {page_key}")


@router.post("/documents/{doc_id}/export")
def export(request: Request, doc_id: str, body: ExportRequest) -> Response:
    source = request.app.state.storage.source_path(doc_id).read_bytes()
    doc = bake(source, body.ops, _ctx(request, doc_id))
    data = doc.tobytes(garbage=3, deflate=True)
    name = safe_filename(body.filename)
    ascii_name = name.encode("ascii", "ignore").decode() or "document.pdf"
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": disposition})


@router.post("/documents/{doc_id}/render-page")
def render_page(request: Request, doc_id: str, body: RenderPageRequest) -> Response:
    storage = request.app.state.storage
    source = storage.source_path(doc_id).read_bytes()
    index = _page_index(body.ops, body.pageKey, storage.meta(doc_id).page_count)
    doc = bake(source, body.ops, _ctx(request, doc_id))
    pix = doc[index].get_pixmap(dpi=144)
    return Response(pix.tobytes("png"), media_type="image/png")
```

Note: `test_safe_filename` expects `"Résumé.pdf"` — the ASCII fallback in the header drops `é`, the `filename*` part keeps it.

In `apps/api/edith/main.py`:
- `from edith.fonts import FontRegistry` and `from edith.routes import assets, documents, export`
- after `app.state.storage = storage`: `app.state.fonts = FontRegistry(settings.fonts_dir)`
- `app.include_router(export.router)`

Run: `cd apps/api && uv run pytest -q` → Expected: all pass.

- [ ] **Step 3: Manual smoke**

Run: `cd apps/api && uv run uvicorn edith.main:app --port 8000` in background, then:
```bash
curl -s -F "file=@pyproject.toml" http://localhost:8000/documents
```
Expected: JSON `{"error":{"code":"pdf_corrupt",...}}`. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): add export and render-page endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
