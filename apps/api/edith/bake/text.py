from collections import defaultdict

import pymupdf

from edith.bake.registry import register
from edith.bake.util import rgb
from edith.ops import TextAdd, TextBox


def draw_text_box(page: pymupdf.Page, box: TextBox, ctx) -> None:
    runs = [r for paragraph in box.paragraphs for r in paragraph]
    writers: dict[str, pymupdf.TextWriter] = defaultdict(lambda: pymupdf.TextWriter(page.rect))
    for line in box.layout:
        for seg in line.segments:
            if not seg.text:
                continue
            r = runs[seg.runIndex]
            font = ctx.fonts.font(r.font.family, r.font.bold, r.font.italic)
            origin = (box.rect.x + seg.x, box.rect.y + line.baseline)
            writers[r.color].append(origin, seg.text, font=font, fontsize=r.size)
    for color, writer in writers.items():
        writer.write_text(page, color=rgb(color))


@register("text.add")
def text_add(page: pymupdf.Page, op: TextAdd, ctx) -> None:
    draw_text_box(page, op.box, ctx)
