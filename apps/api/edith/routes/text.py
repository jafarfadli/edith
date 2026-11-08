import re

from fastapi import APIRouter, Request, Response

from edith.chars import page_chars
from edith.doc_fonts import font_bytes
from edith.errors import DocExpired, FontNotFound, PageNotFound
from edith.extract import extract_text, open_pdf

router = APIRouter()


def _open_source(request: Request, doc_id: str):
    s = request.app.state.settings
    path = request.app.state.storage.source_path(doc_id)
    try:
        data = path.read_bytes()
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


@router.get("/documents/{doc_id}/pages/{index}/chars")
def get_chars(request: Request, doc_id: str, index: int) -> dict:
    doc = _open_source(request, doc_id)
    try:
        if not 0 <= index < doc.page_count:
            raise PageNotFound(f"no page {index}")
        return {"doc_id": doc_id, "index": index, "lines": page_chars(doc[index])}
    finally:
        doc.close()


@router.get("/documents/{doc_id}/fonts/{ref}")
def get_font(request: Request, doc_id: str, ref: str) -> Response:
    if not re.fullmatch(r"f[0-9]{1,9}", ref):
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
