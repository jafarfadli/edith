# Task 4: Storage, errors, document endpoints

**Files:**
- Create: `apps/api/edith/errors.py`, `apps/api/edith/storage.py`, `apps/api/edith/extract.py`, `apps/api/edith/routes/__init__.py`, `apps/api/edith/routes/documents.py`, `apps/api/tests/pdfs.py`, `apps/api/tests/test_storage.py`, `apps/api/tests/test_documents.py`
- Modify: `apps/api/edith/main.py`, `apps/api/tests/conftest.py`

**Interfaces:**
- Consumes: `Settings` (Task 1).
- Produces:
  - `edith.errors`: `EdithError(message="", **extra)` with class attrs `status`, `code`; subclasses `PdfCorrupt`, `PdfEncrypted`, `TooLarge`, `UnsupportedMedia`, `DocNotFound`, `AssetNotFound`, `DocExpired`, `InvalidOp`, `BakeFailed`; `install_error_handlers(app)`.
  - `edith.storage.Storage(root: Path, ttl: int, tombstone_ttl: int, clock: Callable[[], float] = time.time)`: `create(data: bytes, page_count: int) -> DocMeta`, `source_path(doc_id) -> Path` (touches TTL; raises `DocNotFound`/`DocExpired`), `meta(doc_id) -> DocMeta` (touches), `doc_dir(doc_id) -> Path` (touches), `cleanup() -> int`. `DocMeta` dataclass: `doc_id: str, sha256: str, page_count: int`.
  - `edith.extract.open_pdf(data: bytes, max_pages: int) -> pymupdf.Document` (validates; raises `PdfCorrupt`/`PdfEncrypted`/`TooLarge`), `extract_structure(doc) -> dict`.
  - `app.state.storage` set in `create_app`.
  - HTTP: `POST /documents` (multipart field `file`) → `201 {doc_id, sha256, page_count}`; `GET /documents/{doc_id}/structure` → `{doc_id, sha256, page_count, pages: [{index, width, height, rotation, hasText}]}`; `GET /documents/{doc_id}/file` → `application/pdf`.
  - Test helper `tests.pdfs.make_pdf(pages=2, text=True, password=None, size=(595, 842), rotation=0) -> bytes`; each page `i` contains text `"Page {i}"` at (72, 72) when `text=True`.

- [ ] **Step 1: Test PDF helper + conftest storage fixture**

`apps/api/tests/pdfs.py`:
```python
import pymupdf


def make_pdf(pages: int = 2, text: bool = True, password: str | None = None,
             size: tuple[float, float] = (595, 842), rotation: int = 0) -> bytes:
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=size[0], height=size[1])
        if text:
            page.insert_text((72, 72), f"Page {i}", fontsize=14)
        if rotation:
            page.set_rotation(rotation)
    if password:
        return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password)
    return doc.tobytes()
```

Append to `apps/api/tests/conftest.py`:
```python
from edith.storage import Storage


class FakeClock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def storage(tmp_path, clock) -> Storage:
    return Storage(tmp_path / "store", ttl=3600, tombstone_ttl=86400, clock=clock)
```

- [ ] **Step 2: Failing storage tests**

`apps/api/tests/test_storage.py`:
```python
import hashlib
import re

import pytest

from edith.errors import DocExpired, DocNotFound


def test_create_and_read(storage):
    meta = storage.create(b"%PDF-data", page_count=3)
    assert re.fullmatch(r"[A-Za-z0-9_-]{22}", meta.doc_id)
    assert meta.sha256 == hashlib.sha256(b"%PDF-data").hexdigest()
    assert storage.source_path(meta.doc_id).read_bytes() == b"%PDF-data"
    assert storage.meta(meta.doc_id).page_count == 3


def test_unknown_and_malformed_ids(storage):
    with pytest.raises(DocNotFound):
        storage.source_path("A" * 22)
    with pytest.raises(DocNotFound):
        storage.source_path("../../etc/passwd")


def test_expiry_after_ttl_without_access(storage, clock):
    meta = storage.create(b"x", page_count=1)
    clock.t += 3000
    storage.source_path(meta.doc_id)          # access refreshes TTL
    clock.t += 3000
    storage.source_path(meta.doc_id)          # still alive (6000s total, 3000 since access)
    clock.t += 3601
    with pytest.raises(DocExpired):
        storage.source_path(meta.doc_id)
    with pytest.raises(DocExpired):           # tombstone remembers it
        storage.source_path(meta.doc_id)


def test_cleanup_removes_expired_and_old_tombstones(storage, clock):
    a = storage.create(b"a", page_count=1)
    clock.t += 1800
    b = storage.create(b"b", page_count=1)
    clock.t += 1801
    assert storage.cleanup() == 1
    with pytest.raises(DocExpired):
        storage.source_path(a.doc_id)
    assert storage.source_path(b.doc_id).exists()
    clock.t += 86400 + 3601
    storage.cleanup()
    with pytest.raises(DocNotFound):          # tombstone purged
        storage.source_path(a.doc_id)
```

Run: `cd apps/api && uv run pytest tests/test_storage.py -q` → Expected: FAIL (import errors).

- [ ] **Step 3: Errors**

`apps/api/edith/errors.py`:
```python
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class EdithError(Exception):
    status = 400
    code = "error"

    def __init__(self, message: str = "", **extra):
        super().__init__(message or self.code)
        self.message = message or self.code
        self.extra = extra


class PdfCorrupt(EdithError):
    status, code = 400, "pdf_corrupt"


class PdfEncrypted(EdithError):
    status, code = 400, "pdf_encrypted"


class TooLarge(EdithError):
    status, code = 413, "too_large"


class UnsupportedMedia(EdithError):
    status, code = 415, "unsupported_media"


class DocNotFound(EdithError):
    status, code = 404, "doc_not_found"


class AssetNotFound(EdithError):
    status, code = 404, "asset_not_found"


class DocExpired(EdithError):
    status, code = 410, "doc_expired"


class InvalidOp(EdithError):
    status, code = 422, "invalid_op"


class BakeFailed(EdithError):
    status, code = 500, "bake_failed"


def _body(code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, **extra}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(EdithError)
    async def _edith(_: Request, exc: EdithError):
        return JSONResponse(_body(exc.code, exc.message, **exc.extra), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        extra = {}
        for err in errors:
            loc = list(err.get("loc", []))
            if len(loc) >= 3 and loc[0] == "body" and loc[1] == "ops" and isinstance(loc[2], int):
                extra["op_index"] = loc[2]
                break
        msg = "; ".join(f"{'.'.join(map(str, e.get('loc', [])))}: {e.get('msg')}" for e in errors[:5])
        return JSONResponse(_body("invalid_op", msg, **extra), status_code=422)
```

- [ ] **Step 4: Storage**

`apps/api/edith/storage.py`:
```python
import hashlib
import json
import os
import re
import secrets
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from edith.errors import DocExpired, DocNotFound

_ID = re.compile(r"^[A-Za-z0-9_-]{22}$")


@dataclass
class DocMeta:
    doc_id: str
    sha256: str
    page_count: int


class Storage:
    def __init__(self, root: Path, ttl: int, tombstone_ttl: int, clock: Callable[[], float] = time.time):
        self.root = Path(root)
        self.ttl = ttl
        self.tombstone_ttl = tombstone_ttl
        self.clock = clock
        self._docs = self.root / "docs"
        self._tombs = self.root / "expired"
        self._docs.mkdir(parents=True, exist_ok=True)
        self._tombs.mkdir(parents=True, exist_ok=True)

    # internal helpers
    def _touch(self, path: Path) -> None:
        now = self.clock()
        os.utime(path, (now, now))

    def _last_access(self, d: Path) -> float:
        return (d / ".access").stat().st_mtime

    def _expire(self, doc_id: str) -> None:
        shutil.rmtree(self._docs / doc_id, ignore_errors=True)
        tomb = self._tombs / doc_id
        tomb.touch()
        self._touch(tomb)

    def _alive_dir(self, doc_id: str) -> Path:
        if not _ID.match(doc_id):
            raise DocNotFound()
        d = self._docs / doc_id
        if not d.is_dir():
            if (self._tombs / doc_id).exists():
                raise DocExpired()
            raise DocNotFound()
        if self.clock() - self._last_access(d) > self.ttl:
            self._expire(doc_id)
            raise DocExpired()
        self._touch(d / ".access")
        return d

    # public API
    def create(self, data: bytes, page_count: int) -> DocMeta:
        doc_id = secrets.token_urlsafe(16)
        d = self._docs / doc_id
        (d / "assets").mkdir(parents=True)
        (d / "source.pdf").write_bytes(data)
        meta = DocMeta(doc_id, hashlib.sha256(data).hexdigest(), page_count)
        (d / "meta.json").write_text(json.dumps(asdict(meta)))
        (d / ".access").touch()
        self._touch(d / ".access")
        return meta

    def doc_dir(self, doc_id: str) -> Path:
        return self._alive_dir(doc_id)

    def source_path(self, doc_id: str) -> Path:
        return self._alive_dir(doc_id) / "source.pdf"

    def meta(self, doc_id: str) -> DocMeta:
        return DocMeta(**json.loads((self._alive_dir(doc_id) / "meta.json").read_text()))

    def cleanup(self) -> int:
        now = self.clock()
        removed = 0
        for d in self._docs.iterdir():
            if d.is_dir() and now - self._last_access(d) > self.ttl:
                self._expire(d.name)
                removed += 1
        for t in self._tombs.iterdir():
            if now - t.stat().st_mtime > self.tombstone_ttl:
                t.unlink(missing_ok=True)
        return removed
```

Run: `cd apps/api && uv run pytest tests/test_storage.py -q` → Expected: `4 passed`.

- [ ] **Step 5: Failing endpoint tests**

`apps/api/tests/test_documents.py`:
```python
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
```

Run: `cd apps/api && uv run pytest tests/test_documents.py -q` → Expected: FAIL (404s on routes).

- [ ] **Step 6: Extract + routes + wiring**

`apps/api/edith/extract.py`:
```python
import pymupdf

from edith.errors import PdfCorrupt, PdfEncrypted, TooLarge


def open_pdf(data: bytes, max_pages: int) -> pymupdf.Document:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 - any parse failure means corrupt
        raise PdfCorrupt("cannot parse PDF") from exc
    if doc.needs_pass or doc.is_encrypted:
        raise PdfEncrypted()
    if doc.page_count == 0:
        raise PdfCorrupt("PDF has no pages")
    if doc.page_count > max_pages:
        raise TooLarge(f"more than {max_pages} pages", max_pages=max_pages)
    return doc


def _num(v: float) -> float | int:
    r = round(v, 2)
    return int(r) if r == int(r) else r


def extract_structure(doc: pymupdf.Document) -> dict:
    pages = []
    for page in doc:
        box = page.cropbox
        pages.append({
            "index": page.number,
            "width": _num(box.width),
            "height": _num(box.height),
            "rotation": page.rotation,
            "hasText": bool(page.get_text("text").strip()),
        })
    return {"page_count": doc.page_count, "pages": pages}
```

`apps/api/edith/routes/__init__.py`: empty.

`apps/api/edith/routes/documents.py`:
```python
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import FileResponse

from edith.errors import TooLarge
from edith.extract import extract_structure, open_pdf

router = APIRouter()


async def read_limited(file: UploadFile, limit: int) -> bytes:
    chunks, total = [], 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise TooLarge(f"file larger than {limit} bytes", max_bytes=limit)
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/documents", status_code=201)
async def upload_document(request: Request, file: UploadFile) -> dict:
    s = request.app.state.settings
    data = await read_limited(file, s.max_upload_bytes)
    doc = open_pdf(data, s.max_pages)
    meta = request.app.state.storage.create(data, page_count=doc.page_count)
    return {"doc_id": meta.doc_id, "sha256": meta.sha256, "page_count": meta.page_count}


@router.get("/documents/{doc_id}/structure")
def get_structure(request: Request, doc_id: str) -> dict:
    s = request.app.state.settings
    storage = request.app.state.storage
    path = storage.source_path(doc_id)
    doc = open_pdf(path.read_bytes(), s.max_pages)
    return {"doc_id": doc_id, "sha256": storage.meta(doc_id).sha256, **extract_structure(doc)}


@router.get("/documents/{doc_id}/file")
def get_file(request: Request, doc_id: str) -> FileResponse:
    path = request.app.state.storage.source_path(doc_id)
    return FileResponse(path, media_type="application/pdf")
```

Replace `apps/api/edith/main.py` with:
```python
import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from edith.errors import install_error_handlers
from edith.routes import documents
from edith.settings import Settings
from edith.storage import Storage


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    storage = Storage(settings.data_dir, ttl=settings.ttl_seconds, tombstone_ttl=settings.tombstone_seconds)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async def loop():
            while True:
                await asyncio.sleep(settings.cleanup_interval_seconds)
                storage.cleanup()

        task = asyncio.create_task(loop())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    app = FastAPI(title="Edith API", lifespan=lifespan)
    app.state.settings = settings
    app.state.storage = storage
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    install_error_handlers(app)
    app.include_router(documents.router)

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    return app


app = create_app()
```

Note: `test_too_large_bytes` mutates `settings` after the app is created; this works because routes read `request.app.state.settings` per request.

Run: `cd apps/api && uv run pytest -q` → Expected: all pass (health, fonts, ops, storage, documents).

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add document storage with TTL and upload/structure/file endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
