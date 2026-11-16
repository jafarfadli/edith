"""POST /tools/{tool}: the PDF tools of edith.tools, on uploaded files (multipart: `file` or `files`, a `password`
for locked PDFs, the tool's options as form fields). The answer is the resulting file, named after the input."""
import re
from typing import Annotated

from fastapi import APIRouter, Form, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from edith import tools
from edith.errors import BadOptions, TooLarge
from edith.routes.documents import read_limited

router = APIRouter()

TOOL_NAMES = {"unlock", "protect", "to-images", "to-text", "compress", "merge", "split", "extract", "images-to-pdf"}
MAX_FILES = 50


def _stem(name: str | None) -> str:
    stem = re.sub(r"(?i)\.(pdf|png|jpe?g)$", "", (name or "").strip()) or "dokumen"
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", stem)[:120]


def _disposition(name: str) -> str:
    from urllib.parse import quote
    ascii_name = name.encode("ascii", "ignore").decode() or "hasil"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


SUFFIX = {"unlock": "terbuka", "protect": "terkunci", "compress": "kecil", "merge": "gabungan", "split": "terpisah",
          "extract": "halaman", "to-images": "gambar", "to-text": "teks", "images-to-pdf": "gambar"}


@router.post("/tools/{tool}")
async def run_tool(
    request: Request, tool: str,
    files: list[UploadFile] | None = None, file: UploadFile | None = None,
    password: Annotated[str | None, Form()] = None,
    new_password: Annotated[str | None, Form()] = None,
    allow_print: Annotated[bool, Form()] = True, allow_copy: Annotated[bool, Form()] = True,
    format: Annotated[str, Form()] = "png", dpi: Annotated[int, Form()] = 150,
    pages: Annotated[str | None, Form()] = None,
    level: Annotated[str, Form()] = "medium",
    mode: Annotated[str, Form()] = "every", every: Annotated[int, Form()] = 1, ranges: Annotated[str | None, Form()] = None,
    size: Annotated[str, Form()] = "a4", margin: Annotated[float, Form()] = 0,
) -> Response:
    if tool not in TOOL_NAMES:
        raise BadOptions(f"unknown tool {tool!r}", field="tool")
    s = request.app.state.settings
    uploads = [*(files or []), *([file] if file else [])]
    if not uploads:
        raise BadOptions("no file", field="files")
    if len(uploads) > MAX_FILES:
        raise TooLarge(f"more than {MAX_FILES} files", max_files=MAX_FILES)
    blobs: list[tuple[bytes, str]] = []
    total = 0
    for up in uploads:
        data = await read_limited(up, s.max_upload_bytes)
        total += len(data)
        if total > s.max_upload_bytes:
            raise TooLarge(f"files larger than {s.max_upload_bytes} bytes together", max_bytes=s.max_upload_bytes)
        blobs.append((data, up.filename or "dokumen.pdf"))
    stem = _stem(blobs[0][1])

    def _run() -> tools.Output:
        if tool == "images-to-pdf":
            return tools.images_to_pdf(blobs, size, margin, s.max_pages)
        docs = [tools.open_input(data, s.max_pages, password) for data, _ in blobs]
        try:
            if tool == "merge":
                return tools.merge(docs, s.max_pages)
            if len(docs) != 1:
                raise BadOptions(f"{tool} takes one PDF", field="files")
            doc = docs[0]
            match tool:
                case "unlock":
                    return tools.unlock(doc)
                case "protect":
                    return tools.protect(doc, new_password or "", allow_print, allow_copy)
                case "to-images":
                    return tools.to_images(doc, format, dpi, tools.parse_pages(pages, doc.page_count), stem)
                case "to-text":
                    return tools.to_text(doc)
                case "compress":
                    return tools.compress(doc, level)
                case "split":
                    return tools.split(doc, mode, stem, every, ranges)
                case _:  # extract
                    if not pages or not pages.strip():
                        raise BadOptions("pages are empty", field="pages")
                    return tools.extract(doc, tools.parse_pages(pages, doc.page_count))
        finally:
            for d in docs:
                d.close()

    out = await run_in_threadpool(_run)
    name = f"{stem}-{SUFFIX[tool]}.{out.extension}"
    return Response(out.data, media_type=out.media_type, headers={"Content-Disposition": _disposition(name)})
