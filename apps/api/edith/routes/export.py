import math
import re
from urllib.parse import quote

import pymupdf
from fastapi import APIRouter, Request, Response

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import DocExpired, InvalidOp
from edith.ops import ExportRequest, RenderPageRequest

router = APIRouter()

MAX_RENDER_PIXELS = 20_000_000
RENDER_SCALE = 2  # 144 dpi


def render_scale(rect: pymupdf.Rect) -> float:
    """Zoom relative to 72 dpi: 144 dpi, reduced so the bitmap stays within MAX_RENDER_PIXELS."""
    area = rect.width * rect.height
    if area <= 0:
        return RENDER_SCALE
    scale = min(RENDER_SCALE, math.sqrt(MAX_RENDER_PIXELS / area))
    while math.ceil(rect.width * scale) * math.ceil(rect.height * scale) > MAX_RENDER_PIXELS:
        scale *= 0.999  # the bitmap rounds outward to whole pixels
    return scale


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


def _read_source(request: Request, doc_id: str) -> bytes:
    try:
        return request.app.state.storage.source_path(doc_id).read_bytes()
    except FileNotFoundError:
        raise DocExpired() from None


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
    source = _read_source(request, doc_id)
    doc = bake(source, body.ops, _ctx(request, doc_id))
    try:
        data = doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()
    name = safe_filename(body.filename)
    ascii_name = name.encode("ascii", "ignore").decode()
    if not re.sub(r"(?i)\.pdf$", "", ascii_name).strip(". "):
        ascii_name = "document.pdf"
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": disposition})


@router.post("/documents/{doc_id}/render-page")
def render_page(request: Request, doc_id: str, body: RenderPageRequest) -> Response:
    storage = request.app.state.storage
    source = _read_source(request, doc_id)
    index = _page_index(body.ops, body.pageKey, storage.meta(doc_id).page_count)
    doc = bake(source, body.ops, _ctx(request, doc_id))
    try:
        page = doc[index]
        scale = render_scale(page.rect)
        png = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale)).tobytes("png")
    finally:
        doc.close()
    return Response(png, media_type="image/png")
