import threading

from fastapi import APIRouter, Request

from edith import ocr
from edith.errors import OcrBusy, OcrUnavailable, PageNotFound
from edith.routes.text import _open_source

router = APIRouter()


class OcrGate:
    """At most `slots` pages read at once on this server, and one at a time per document."""

    def __init__(self, slots: int):
        self._slots = threading.BoundedSemaphore(max(slots, 1))
        self._lock = threading.Lock()
        self._docs: set[str] = set()

    def enter(self, doc_id: str) -> None:
        with self._lock:
            if doc_id in self._docs:
                raise OcrBusy("OCR already runs for this document")
            if not self._slots.acquire(blocking=False):
                raise OcrBusy("every OCR slot is taken")
            self._docs.add(doc_id)

    def leave(self, doc_id: str) -> None:
        with self._lock:
            self._docs.discard(doc_id)
            self._slots.release()


@router.post("/documents/{doc_id}/pages/{index}/ocr")
def ocr_page(request: Request, doc_id: str, index: int) -> dict:
    """Paragraphs read by OCR in the pictures of print on source page `index` (edith.ocr.ocr_page): in GET /text's
    paragraph shape plus `ocr`, `confidence`, `cover`, `coverColor`, `coverUniform`; ids `ocr0`, `ocr1`, … Nothing is
    stored: the client keeps the result, and an edit of such a paragraph (text.ocr_edit) carries all it needs."""
    s = request.app.state.settings
    gate: OcrGate = request.app.state.ocr_gate
    doc = _open_source(request, doc_id)
    try:
        if not 0 <= index < doc.page_count:
            raise PageNotFound(f"no page {index}")
        cmd = ocr.tesseract_cmd(s.tesseract_cmd)
        if cmd is None or not ocr.available(s.tesseract_cmd):
            raise OcrUnavailable("tesseract with Indonesian and English is not installed")
        gate.enter(doc_id)
        try:
            result = ocr.ocr_page(doc[index], request.app.state.fonts, cmd, timeout=s.ocr_timeout_seconds)
        finally:
            gate.leave(doc_id)
    finally:
        doc.close()
    return {"doc_id": doc_id, "index": index, **result}
