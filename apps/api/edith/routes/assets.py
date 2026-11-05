import struct

import pymupdf
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from edith.errors import TooLarge, UnsupportedMedia
from edith.routes.documents import read_limited

router = APIRouter()

_MAGIC = {b"\x89PNG\r\n\x1a\n": "png", b"\xff\xd8\xff": "jpg"}
# Start-of-frame markers SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
_SOF = set(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


def sniff(data: bytes) -> str:
    for magic, ext in _MAGIC.items():
        if data.startswith(magic):
            return ext
    raise UnsupportedMedia("only PNG or JPEG images are accepted")


def image_size(data: bytes, ext: str) -> tuple[int, int]:
    """Read (width, height) from the header without decoding the pixels."""
    if ext == "png":
        if len(data) < 24 or data[12:16] != b"IHDR":
            raise UnsupportedMedia("image header unreadable")
        width, height = struct.unpack(">II", data[16:24])
    elif ext == "jpg":
        width, height = _jpeg_size(data)
    else:
        raise UnsupportedMedia("image header unreadable")
    if width == 0 or height == 0:
        raise UnsupportedMedia("image header unreadable")
    return width, height


def _jpeg_size(data: bytes) -> tuple[int, int]:
    i, n = 2, len(data)  # skip SOI
    while i + 1 < n:
        if data[i] != 0xFF:
            break
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte
            i += 1
            continue
        if marker == 0xD9 or marker == 0xDA:  # EOI or SOS: no frame header seen
            break
        if marker in (0x01, 0xD8) or 0xD0 <= marker <= 0xD7:  # standalone markers
            i += 2
            continue
        if i + 4 > n:
            break
        if marker in _SOF:
            if i + 9 > n:
                break
            height, width = struct.unpack(">HH", data[i + 5 : i + 9])  # after length (2) + precision (1)
            return width, height
        i += 2 + struct.unpack(">H", data[i + 2 : i + 4])[0]
    raise UnsupportedMedia("image header unreadable")


@router.post("/documents/{doc_id}/assets", status_code=201)
async def upload_asset(request: Request, doc_id: str, file: UploadFile) -> dict:
    s = request.app.state.settings
    storage = request.app.state.storage
    storage.doc_dir(doc_id)  # 404/410 before reading the body
    data = await read_limited(file, s.max_asset_bytes)

    def _store() -> dict:
        ext = sniff(data)
        width, height = image_size(data, ext)
        if width * height > s.max_asset_pixels:
            raise TooLarge(
                f"image has {width * height} pixels, limit is {s.max_asset_pixels}",
                max_pixels=s.max_asset_pixels,
            )
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
