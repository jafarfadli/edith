"""POST /tools/{tool}: the PDF tools of edith.tools, on uploaded files (multipart: `file` or `files`, a `password`
for locked PDFs, the tool's options as form fields). The answer is the resulting file, named after the input."""
import re
from typing import Annotated

from fastapi import APIRouter, Form, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from edith import office, tools
from edith.errors import BadOptions, OfficeUnavailable, TooLarge

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
from edith.routes.documents import read_limited

router = APIRouter()

TOOL_NAMES = {"unlock", "protect", "to-images", "to-text", "compress", "merge", "split", "extract", "images-to-pdf",
              "watermark", "page-numbers", "ocr", "office-to-pdf", "to-docx", "scan"}
# A whole document read by OCR (POST /tools/ocr): at most this many pages without text, in one request.
OCR_MAX_PAGES = 60
MAX_FILES = 50


def _stem(name: str | None) -> str:
    stem = re.sub(r"(?i)\.(pdf|png|jpe?g|docx?|odt|rtf|pptx?|odp|xlsx?|ods)$", "", (name or "").strip()) or "dokumen"
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", stem)[:120]


def _disposition(name: str) -> str:
    from urllib.parse import quote
    ascii_name = name.encode("ascii", "ignore").decode() or "hasil"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"


SUFFIX = {"office-to-pdf": "", "to-docx": "", "watermark": "watermark", "page-numbers": "bernomor", "ocr": "bisa-dicari", "unlock": "terbuka", "protect": "terkunci", "compress": "kecil", "merge": "gabungan", "split": "terpisah",
          "extract": "halaman", "to-images": "gambar", "to-text": "teks", "images-to-pdf": "gambar", "scan": "scan"}


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
    size: Annotated[str, Form()] = "a4", margin: Annotated[float | None, Form()] = None,
    text: Annotated[str | None, Form()] = None, font_size: Annotated[float | None, Form()] = None,
    colour: Annotated[str | None, Form()] = None, opacity: Annotated[float, Form()] = 0.35,
    diagonal: Annotated[bool, Form()] = True,
    position: Annotated[str, Form()] = "bottom-center", number_format: Annotated[str, Form()] = "n",
    start: Annotated[int, Form()] = 1,
    scan_mode: Annotated[str, Form()] = "color", crop: Annotated[bool, Form()] = True,
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
    registry = request.app.state.fonts

    def sans(bold: bool) -> str:
        return str(registry.path(registry.fallback("sans"), bold, False))

    def convert_office(data: bytes, name: str) -> tools.Output:
        if (name.rsplit(".", 1)[-1].lower() if "." in name else "") not in office.OFFICE_TYPES:
            raise BadOptions(f"{name}: not an office document", field="files", file=name)
        cmd = office.soffice_cmd(s.soffice_cmd)
        if cmd is None:
            raise OfficeUnavailable("LibreOffice is not installed")
        gate = request.app.state.office_gate
        profile = gate.enter()
        try:
            pdf = office.office_to_pdf(data, name, cmd, profile, s.office_timeout_seconds)
        finally:
            gate.leave(profile)
        tools.open_input(pdf, s.max_pages).close()  # what LibreOffice made is a PDF within the limits
        return tools.pdf(pdf)

    def read_scan(doc) -> tools.Output:
        from edith import ocr
        from edith.errors import OcrUnavailable
        cmd = ocr.tesseract_cmd(s.tesseract_cmd)
        if cmd is None or not ocr.available(s.tesseract_cmd):
            raise OcrUnavailable("tesseract with Indonesian and English is not installed")
        gate = request.app.state.ocr_gate
        key = f"tool:{id(doc)}"
        gate.enter(key)
        try:
            out, _read = tools.searchable(doc, cmd, "+".join(ocr.LANGS), s.ocr_timeout_seconds, OCR_MAX_PAGES)
            return out
        finally:
            gate.leave(key)

    def _run() -> tools.Output:
        if tool == "images-to-pdf":
            return tools.images_to_pdf(blobs, size, margin or 0, s.max_pages)
        if tool == "scan":
            from edith import scan
            return scan.scan_pdf(blobs, scan_mode, crop, size, s.max_pages)
        if tool == "office-to-pdf":
            if len(blobs) != 1:
                raise BadOptions("office-to-pdf takes one file", field="files")
            return convert_office(*blobs[0])
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
                case "watermark":
                    return tools.watermark(doc, text or "", tools.parse_pages(pages, doc.page_count), sans(True),
                                           font_size or 48, colour or "#9ca3af", opacity, diagonal)
                case "page-numbers":
                    return tools.page_numbers(doc, tools.parse_pages(pages, doc.page_count), sans(False), position,
                                              number_format, start, font_size or 10, 28 if margin is None else margin,
                                              colour or "#000000")
                case "ocr":
                    return read_scan(doc)
                case "to-docx":
                    data = office.pdf_to_docx(doc)
                    return tools.Output(data, DOCX, "docx")
                case _:  # extract
                    if not pages or not pages.strip():
                        raise BadOptions("pages are empty", field="pages")
                    return tools.extract(doc, tools.parse_pages(pages, doc.page_count))
        finally:
            for d in docs:
                d.close()

    out = await run_in_threadpool(_run)
    name = f"{stem}-{SUFFIX[tool]}.{out.extension}" if SUFFIX[tool] else f"{stem}.{out.extension}"
    return Response(out.data, media_type=out.media_type, headers={"Content-Disposition": _disposition(name)})
