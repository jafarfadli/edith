from typing import Annotated

from fastapi import APIRouter, Form, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from edith.errors import DocExpired, TooLarge
from edith.extract import extract_structure, open_pdf
from edith.tools import needs_password, open_input, plain_bytes

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
async def upload_document(request: Request, file: UploadFile, password: Annotated[str | None, Form()] = None) -> dict:
    """Stores a PDF to edit. A locked one needs its `password` (pdf_encrypted without, pdf_password_wrong with a wrong
    one): the copy stored is then unlocked, so the editor and every tool read it as any other."""
    s = request.app.state.settings
    storage = request.app.state.storage
    data = await read_limited(file, s.max_upload_bytes)

    def _ingest() -> dict:
        nonlocal data
        if password and needs_password(data):
            locked = open_input(data, s.max_pages, password)
            try:
                data = plain_bytes(locked)
            finally:
                locked.close()
        doc = open_pdf(data, s.max_pages)
        try:
            page_count = doc.page_count
        finally:
            doc.close()
        meta = storage.create(data, page_count=page_count)
        return {"doc_id": meta.doc_id, "sha256": meta.sha256, "page_count": meta.page_count}

    return await run_in_threadpool(_ingest)


@router.get("/documents/{doc_id}/structure")
def get_structure(request: Request, doc_id: str) -> dict:
    s = request.app.state.settings
    storage = request.app.state.storage
    path = storage.source_path(doc_id)
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        raise DocExpired() from None
    doc = open_pdf(data, s.max_pages)
    try:
        structure = extract_structure(doc)
    finally:
        doc.close()
    return {"doc_id": doc_id, "sha256": storage.meta(doc_id).sha256, **structure}


@router.get("/documents/{doc_id}/file")
def get_file(request: Request, doc_id: str) -> FileResponse:
    path = request.app.state.storage.source_path(doc_id)
    return FileResponse(path, media_type="application/pdf")
