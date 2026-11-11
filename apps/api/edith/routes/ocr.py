import math
import threading

import pymupdf
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from edith import ocr
from edith.errors import HiddenTextBusy, InvalidRequest, OcrBusy, OcrTimeout, OcrUnavailable, PageNotFound
from edith.imagetext import page_words
from edith.routes.text import _open_source, hidden_paragraphs

router = APIRouter()

MIN_AREA_SIDE = 4.0  # pt: an area to read must be at least this wide and high (inside the page)


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


AREA_BOUND = 1e5  # pt: what an area's coordinates and size may be (far beyond any page; a huge float overflows MuPDF)


class Area(BaseModel):
    x: float = Field(ge=-AREA_BOUND, le=AREA_BOUND)
    y: float = Field(ge=-AREA_BOUND, le=AREA_BOUND)
    w: float = Field(gt=0, le=AREA_BOUND)
    h: float = Field(gt=0, le=AREA_BOUND)


class OcrRequest(BaseModel):
    """`rect`: the part of the page to read (a picture the user picked, or an area dragged on the page), in
    unrotated-CropBox points; none: the page's pictures of print."""
    rect: Area | None = None


def _area(page: pymupdf.Page, rect: Area) -> pymupdf.Rect:
    if not all(math.isfinite(v) for v in (rect.x, rect.y, rect.w, rect.h)):
        raise InvalidRequest("rect must be finite")
    area = pymupdf.Rect(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h) & pymupdf.Rect(
        0, 0, page.cropbox.width, page.cropbox.height)
    if area.is_empty or area.width < MIN_AREA_SIDE or area.height < MIN_AREA_SIDE:
        raise InvalidRequest(f"rect must cover at least {MIN_AREA_SIDE:g} × {MIN_AREA_SIDE:g} pt of the page")
    return area


def _known(request: Request, doc, doc_id: str, index: int) -> list[pymupdf.Rect]:
    """Where the page's text is already editable: its visible characters, and the lines of the hidden paragraphs whose
    picture was measured (GET .../hidden-text, from its cache). When measuring is busy, every invisible character
    counts: an OCR paragraph is rather left out than read twice."""
    shown, invisible = page_words(doc[index])
    out = list(shown)
    if invisible:
        try:
            out += [pymupdf.Rect(c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"])
                    for p in hidden_paragraphs(request, doc_id, index, doc) for c in p["covers"]]
        except HiddenTextBusy:
            out += invisible
    return out


def _unknown_only(paragraphs: list[dict], known: list[pymupdf.Rect]) -> list[dict]:
    """The OCR paragraphs that read no text the page already has editable: none whose covers hold a visible character
    or reach well into a measured hidden line (that text is edited as such; its OCR copy would be a second target over
    it, and its edit would cover letters it does not redraw)."""
    out = []
    for p in paragraphs:
        covers = [pymupdf.Rect(c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"]) for c in p.get("covers") or [p["cover"]]]
        if any(c.contains((k.tl + k.br) / 2) or (c & k).get_area() > 0.3 * min(c.get_area(), k.get_area())
               for c in covers for k in known if c.intersects(k)):
            continue
        out.append(p)
    return out


@router.post("/documents/{doc_id}/pages/{index}/ocr")
def ocr_page(request: Request, doc_id: str, index: int, body: OcrRequest | None = None) -> dict:
    """Paragraphs read by OCR in the pictures of print on source page `index` (edith.ocr.ocr_page), or in `rect` of
    it (OcrRequest): in GET /text's paragraph shape plus `ocr`, `confidence`, `cover`, `coverColor`, `coverUniform`;
    ids `ocr0`, `ocr1`, … Text the page already has editable is left out (_unknown_only). Nothing is stored: the client
    keeps the result, and an edit of such a paragraph (text.ocr_edit) carries all it needs."""
    s = request.app.state.settings
    gate: OcrGate = request.app.state.ocr_gate
    doc = _open_source(request, doc_id)
    try:
        if not 0 <= index < doc.page_count:
            raise PageNotFound(f"no page {index}")
        page = doc[index]
        area = _area(page, body.rect) if body is not None and body.rect is not None else None
        cmd = ocr.tesseract_cmd(s.tesseract_cmd)
        if cmd is None or not ocr.available(s.tesseract_cmd):
            raise OcrUnavailable("tesseract with Indonesian and English is not installed")
        gate.enter(doc_id)
        try:
            result = ocr.ocr_page(page, request.app.state.fonts, cmd, timeout=s.ocr_timeout_seconds, area=area)
            if result["paragraphs"]:
                # Still within the gate: what is known costs a measurement of the page's hidden text (cached).
                kept = _unknown_only(result["paragraphs"], _known(request, doc, doc_id, index))
                result = {**result, "paragraphs": kept, **({} if kept else {"quality": "empty"})}
        except OcrTimeout:
            limit = s.ocr_timeout_seconds
            raise OcrTimeout(f"OCR took longer than {limit:g} s", seconds=limit) from None
        finally:
            gate.leave(doc_id)
    finally:
        doc.close()
    return {"doc_id": doc_id, "index": index, **result}
