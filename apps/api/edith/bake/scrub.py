"""What redact.add removes besides page content: MuPDF's apply_redactions() leaves annotations and form
fields under the box alone, so their text (a note's comment, a field's value) would survive the redaction."""
import logging

import pymupdf

from edith.bake.annots import NOTE_SIZE
from edith.bake.util import to_rect
from edith.ops import AnnotAdd, LinkAdd

log = logging.getLogger(__name__)


def _hits(rect: pymupdf.Rect, boxes: list[pymupdf.Rect]) -> bool:
    return any(rect.intersects(box) for box in boxes)


def scrub_page(page: pymupdf.Page, boxes: list[pymupdf.Rect]) -> int:
    """Deletes every annotation, form widget and link of `page` that touches one of `boxes`; returns how
    many widgets went."""
    widgets = 0
    for xref, kind, *_ in page.annot_xrefs():
        if kind == pymupdf.PDF_ANNOT_POPUP:
            continue  # goes with its parent
        try:
            annot = page.load_widget(xref) if kind == pymupdf.PDF_ANNOT_WIDGET else page.load_annot(xref)
        except Exception as exc:  # noqa: BLE001
            log.warning("cannot load annotation %s on page %s: %s", xref, page.number, exc)
            continue
        if annot is None or not _hits(annot.rect, boxes):
            continue
        if kind == pymupdf.PDF_ANNOT_WIDGET:
            page.delete_widget(annot)
            widgets += 1
        else:
            page.delete_annot(annot)
    for link in page.get_links():
        if _hits(link["from"], boxes):
            page.delete_link(link)
    return widgets


def under_redaction(op, boxes: list[pymupdf.Rect]) -> bool:
    """An annot.add / link.add op that would sit (partly) under a redaction box."""
    if not boxes:
        return False
    if isinstance(op, LinkAdd):
        return _hits(to_rect(op.rect), boxes)
    if isinstance(op, AnnotAdd):
        if op.kind == "note":
            x, y = op.point
            return _hits(pymupdf.Rect(x, y, x + NOTE_SIZE, y + NOTE_SIZE), boxes)
        return any(_hits(to_rect(q), boxes) for q in op.quads)
    return False
