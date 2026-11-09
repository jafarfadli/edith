"""text.ocr_edit (M5d): a paragraph OCR read in a picture, rewritten. The old picture of it is covered with an opaque
rectangle of the picture's own background colour (`cover`, `coverColor`, measured by POST .../ocr), painted over the
page's original content before any drawn object; the new text is drawn in the op's stacking order like a text box.

Covering rather than erasing pixels: the image stays byte for byte as it was (an image shared by several pages or
placed twice is not changed elsewhere, its compression is kept, nothing outside the cover can change), and the PDF
stays as valid as a whiteout leaves it. The old pixels remain inside the image under the cover, as under a whiteout:
an edit, not a redaction (Redaksi removes them). Text of the page under the covers (an invisible OCR layer over the
scan) is removed, so the old words do not stay findable next to the new ones."""
import pymupdf

from edith.bake.registry import register
from edith.bake.text import draw_text_box
from edith.bake.util import rgb, to_rect
from edith.ops import TextOcrEdit


def cover_rects(op: TextOcrEdit) -> list[pymupdf.Rect]:
    """What `op` paints: one rect per line (`covers`), else its one `cover`."""
    return [to_rect(r) for r in (op.covers or [op.cover])]


BAND = 0.2  # of a cover's height, above and below its middle: the band the old text under it is removed in


@register("text.ocr_edit", phase="redact_text")
def remove_old_text(page: pymupdf.Page, op: TextOcrEdit, ctx) -> None:
    """Text of the page under the covers goes, in the text-only redaction pass (images and drawings stay): a scan with
    an invisible OCR layer would otherwise still give the old words when the export is copied or searched, next to the
    new ones. Only a band through each cover's middle (BAND), 1 pt in from its ends, so the characters of the lines
    above and below and of words just beside it, whose boxes may reach into the cover's padding, are kept."""
    for c in cover_rects(op):
        mid, half, inset = (c.y0 + c.y1) / 2, BAND * c.height, min(1.0, c.width / 4)
        band = pymupdf.Rect(c.x0 + inset, mid - half, c.x1 - inset, mid + half) & page.rect
        if not band.is_empty:
            page.add_redact_annot(band, fill=False)


@register("text.ocr_edit", phase="cover")
def cover(page: pymupdf.Page, op: TextOcrEdit, ctx) -> None:
    for c in cover_rects(op):
        r = c & page.rect
        if not r.is_empty:
            page.draw_rect(r, color=None, fill=rgb(op.coverColor), width=0, overlay=True)


@register("text.ocr_edit")
def ocr_edit(page: pymupdf.Page, op: TextOcrEdit, ctx) -> None:
    draw_text_box(page, op.box, ctx)


def keep_redactions(page: pymupdf.Page, covers: list[pymupdf.Rect], boxes: list[tuple[pymupdf.Rect, str]]) -> None:
    """Paints the redaction boxes (rect, "black" | "white") a cover went over again: a redaction's look stays on top of
    the covers, as it does on screen (covers lie under the page's objects, redactions among them)."""
    for box, fill in boxes:
        for c in covers:
            hit = box & c
            if not hit.is_empty:
                page.draw_rect(hit, color=None, fill=(0, 0, 0) if fill == "black" else (1, 1, 1), width=0, overlay=True)
