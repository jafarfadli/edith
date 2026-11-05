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
