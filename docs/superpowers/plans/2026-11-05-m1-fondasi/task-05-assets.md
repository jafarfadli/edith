# Task 5: Asset upload endpoint

**Files:**
- Modify: `apps/api/edith/storage.py` (add asset methods)
- Create: `apps/api/edith/routes/assets.py`, `apps/api/tests/test_assets.py`
- Modify: `apps/api/edith/main.py` (include router)

**Interfaces:**
- Consumes: `Storage`, `errors`, `read_limited` from `edith.routes.documents` (Task 4).
- Produces:
  - `Storage.save_asset(doc_id: str, data: bytes, ext: str) -> str` (returns `asset_id` = `secrets.token_urlsafe(12)`, 16 chars), `Storage.asset_path(doc_id: str, asset_id: str) -> Path` (raises `AssetNotFound`).
  - HTTP `POST /documents/{doc_id}/assets` (multipart `file`, PNG or JPEG, ≤ `max_asset_bytes`) → `201 {asset_id, width, height}` (pixel size).
  - HTTP `GET /documents/{doc_id}/assets/{asset_id}` → the image bytes (`image/png` or `image/jpeg`), used by the editor to show images after a reload.

- [ ] **Step 1: Failing tests**

`apps/api/tests/test_assets.py`:
```python
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
```

Run: `cd apps/api && uv run pytest tests/test_assets.py -q` → Expected: FAIL.

- [ ] **Step 2: Storage methods**

Add to `apps/api/edith/storage.py` (import `AssetNotFound` from `edith.errors`; add module constant `_ASSET = re.compile(r"^[A-Za-z0-9_-]{1,64}$")`):
```python
    def save_asset(self, doc_id: str, data: bytes, ext: str) -> str:
        d = self._alive_dir(doc_id) / "assets"
        asset_id = secrets.token_urlsafe(12)
        (d / f"{asset_id}.{ext}").write_bytes(data)
        return asset_id

    def asset_path(self, doc_id: str, asset_id: str) -> Path:
        d = self._alive_dir(doc_id) / "assets"
        if not _ASSET.match(asset_id):
            raise AssetNotFound()
        matches = list(d.glob(f"{asset_id}.*"))
        if not matches:
            raise AssetNotFound()
        return matches[0]
```

- [ ] **Step 3: Route**

`apps/api/edith/routes/assets.py`:
```python
import pymupdf
from fastapi import APIRouter, Request, UploadFile

from edith.errors import UnsupportedMedia
from edith.routes.documents import read_limited

router = APIRouter()

_MAGIC = {b"\x89PNG\r\n\x1a\n": "png", b"\xff\xd8\xff": "jpg"}


def sniff(data: bytes) -> str:
    for magic, ext in _MAGIC.items():
        if data.startswith(magic):
            return ext
    raise UnsupportedMedia("only PNG or JPEG images are accepted")


@router.post("/documents/{doc_id}/assets", status_code=201)
async def upload_asset(request: Request, doc_id: str, file: UploadFile) -> dict:
    s = request.app.state.settings
    storage = request.app.state.storage
    storage.doc_dir(doc_id)  # 404/410 before reading the body
    data = await read_limited(file, s.max_asset_bytes)
    ext = sniff(data)
    try:
        pix = pymupdf.Pixmap(data)
    except Exception as exc:  # noqa: BLE001
        raise UnsupportedMedia("image cannot be decoded") from exc
    asset_id = storage.save_asset(doc_id, data, ext)
    return {"asset_id": asset_id, "width": pix.width, "height": pix.height}


@router.get("/documents/{doc_id}/assets/{asset_id}")
def get_asset(request: Request, doc_id: str, asset_id: str) -> FileResponse:
    path = request.app.state.storage.asset_path(doc_id, asset_id)
    media = "image/png" if path.suffix == ".png" else "image/jpeg"
    return FileResponse(path, media_type=media)
```
Add `from fastapi.responses import FileResponse` to the imports.

In `main.py`: `from edith.routes import assets, documents` and `app.include_router(assets.router)`.

Run: `cd apps/api && uv run pytest -q` → Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): add image asset upload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
