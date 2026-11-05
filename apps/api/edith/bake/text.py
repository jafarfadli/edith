from collections import defaultdict

import pymupdf

from edith.bake.registry import register
from edith.bake.util import rgb
from edith.ops import TextAdd, TextBox


def writer_origin(page: pymupdf.Page, point: tuple[float, float]) -> pymupdf.Point:
    """The TextWriter position that makes `point` (page coordinates, i.e. relative to the
    top-left of the CropBox) land where intended.

    TextWriter.write_text() shifts its content by `cropbox_position`, a top-left MediaBox
    offset, as if it were a PDF (bottom-left) offset, so on a cropped page — or one whose
    MediaBox does not start at the origin — text drifts by the difference. Map the point to
    PDF space with the page's own transformation and undo the shift write_text() will add.
    """
    cb = page.cropbox_position
    delta = page.rect.height - page.rect.width if page.rotation in (90, 270) else 0
    shift = pymupdf.Point(cb.x, cb.y + page.mediabox.y0 - delta)
    pdf = pymupdf.Point(point) * ~page.transformation_matrix
    flip = pymupdf.Matrix(1, 0, 0, -1, 0, page.rect.height)  # == TextWriter's ctm (self-inverse)
    return (pdf - shift) * flip


def draw_text_box(page: pymupdf.Page, box: TextBox, ctx) -> None:
    runs = [r for paragraph in box.paragraphs for r in paragraph]
    writers: dict[str, pymupdf.TextWriter] = defaultdict(lambda: pymupdf.TextWriter(page.rect))
    for line in box.layout:
        for seg in line.segments:
            if not seg.text:
                continue
            r = runs[seg.runIndex]
            font = ctx.fonts.font(r.font.family, r.font.bold, r.font.italic)
            origin = writer_origin(page, (box.rect.x + seg.x, box.rect.y + line.baseline))
            writers[r.color].append(origin, seg.text, font=font, fontsize=r.size)
    for color, writer in writers.items():
        writer.write_text(page, color=rgb(color))


@register("text.add")
def text_add(page: pymupdf.Page, op: TextAdd, ctx) -> None:
    draw_text_box(page, op.box, ctx)
