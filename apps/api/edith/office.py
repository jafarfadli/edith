"""Office documents to PDF with LibreOffice (headless soffice), and PDF to Word with pdf2docx.

LibreOffice runs one conversion per slot, each slot with its own user profile directory under the data directory:
two conversions sharing a profile would block each other, and a new profile costs seconds, so they are kept. Macros
never run (headless conversion opens documents with macros disabled). A conversion that takes too long is killed."""
import io
import logging
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

import pymupdf

from edith.errors import BadOptions, OfficeBusy, OfficeFailed, OfficeUnavailable, TooLarge

logger = logging.getLogger("edith")

OFFICE_TYPES = {
    "doc", "docx", "odt", "rtf",  # text documents
    "ppt", "pptx", "odp",          # presentations
    "xls", "xlsx", "ods",          # spreadsheets
}
MAC_APP = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
DOCX_MAX_PAGES = 100  # pages pdf2docx converts in one request (it takes about a second a page on a busy one)


def soffice_cmd(configured: str | None = None) -> str | None:
    if configured:
        return configured
    for name in ("soffice", "libreoffice"):
        if found := shutil.which(name):
            return found
    return MAC_APP if Path(MAC_APP).exists() else None


class OfficeGate:
    """At most `slots` conversions at once; each holds a slot's profile directory while it runs."""

    def __init__(self, slots: int, root: Path):
        self._free = [root / f"lo-profile-{i}" for i in range(max(slots, 1))]
        self._lock = threading.Lock()

    def enter(self) -> Path:
        with self._lock:
            if not self._free:
                raise OfficeBusy("every conversion slot is taken")
            return self._free.pop()

    def leave(self, profile: Path) -> None:
        with self._lock:
            self._free.append(profile)


def office_to_pdf(data: bytes, name: str, cmd: str, profile: Path, timeout: float) -> bytes:
    """The office document `data` (its type from `name`'s extension) as PDF."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in OFFICE_TYPES:
        raise BadOptions(f"{name}: not an office document", field="files", file=name)
    profile.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="edith-office-") as tmp:
        src = Path(tmp) / f"input.{ext}"
        src.write_bytes(data)
        out_dir = Path(tmp) / "out"
        try:
            run = subprocess.run(
                [cmd, "--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
                 f"-env:UserInstallation={profile.resolve().as_uri()}", "--convert-to", "pdf", "--outdir", str(out_dir),
                 str(src)],
                capture_output=True, timeout=timeout, check=False, cwd=tmp)
        except subprocess.TimeoutExpired:
            raise OfficeFailed("the conversion took too long") from None
        except OSError:
            logger.exception("cannot run soffice")
            raise OfficeUnavailable("cannot run LibreOffice") from None
        result = out_dir / "input.pdf"
        if run.returncode != 0 or not result.exists():
            logger.warning("soffice failed (%s): %s", run.returncode, run.stderr.decode("utf-8", "replace")[-500:])
            raise OfficeFailed(f"{name}: LibreOffice could not convert it")
        return result.read_bytes()


def pdf_to_docx(doc: pymupdf.Document) -> bytes:
    """`doc` (open, so unlocked) as a Word document: text with its fonts and layout, tables and pictures, as pdf2docx
    rebuilds them. A scan converts to pictures only (read it with OCR first)."""
    from edith.tools import plain_bytes
    if doc.page_count > DOCX_MAX_PAGES:
        raise TooLarge(f"more than {DOCX_MAX_PAGES} pages", max_pages=DOCX_MAX_PAGES)
    from pdf2docx import Converter
    logging.getLogger("pdf2docx").setLevel(logging.WARNING)
    cv = Converter(stream=plain_bytes(doc))
    try:
        out = io.BytesIO()
        cv.convert(out, multi_processing=False)
        return out.getvalue()
    except Exception as exc:  # noqa: BLE001 - pdf2docx fails in many ways on odd PDFs
        logger.exception("pdf2docx failed")
        raise OfficeFailed("this PDF could not be converted to Word") from exc
    finally:
        cv.close()
