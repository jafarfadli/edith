import pymupdf
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

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

    def _store() -> dict:
        ext = sniff(data)
        try:
            pix = pymupdf.Pixmap(data)
        except Exception as exc:  # noqa: BLE001
            raise UnsupportedMedia("image cannot be decoded") from exc
        asset_id = storage.save_asset(doc_id, data, ext)
        return {"asset_id": asset_id, "width": pix.width, "height": pix.height}

    return await run_in_threadpool(_store)


@router.get("/documents/{doc_id}/assets/{asset_id}")
def get_asset(request: Request, doc_id: str, asset_id: str) -> FileResponse:
    path = request.app.state.storage.asset_path(doc_id, asset_id)
    media = "image/png" if path.suffix == ".png" else "image/jpeg"
    return FileResponse(path, media_type=media)
