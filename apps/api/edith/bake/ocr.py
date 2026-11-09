"""text.ocr_edit (M5d): a paragraph OCR read in a picture, rewritten. The old picture of it is covered with an opaque
rectangle of the picture's own background colour (`cover`, `coverColor`, measured by POST .../ocr), painted over the
page's original content before any drawn object; the new text is drawn in the op's stacking order like a text box.

Covering rather than erasing pixels: the image stays byte for byte as it was (an image shared by several pages or
placed twice is not changed elsewhere, its compression is kept, nothing outside the cover can change), and the PDF
stays as valid as a whiteout leaves it. The old pixels remain inside the image under the cover, as under a whiteout:
an edit, not a redaction (Redaksi removes them)."""
import pymupdf

from edith.bake.registry import register
from edith.bake.text import draw_text_box
from edith.bake.util import rgb, to_rect
from edith.ops import TextOcrEdit


@register("text.ocr_edit", phase="cover")
def cover(page: pymupdf.Page, op: TextOcrEdit, ctx) -> None:
    r = to_rect(op.cover) & page.rect
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
