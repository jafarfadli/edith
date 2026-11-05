import math
from collections import defaultdict

import pymupdf

from edith.bake.registry import register
from edith.bake.tounicode import fix_to_unicode
from edith.bake.util import rgb
from edith.ops import Run, TextAdd, TextBox, TextEdit

# Decoration geometry, in multiples of the run's font size relative to the baseline (y grows down).
# Shared contract with apps/web/src/lib/textDecor.ts — change both together.
BG_ASCENT, BG_DESCENT = 0.9, 0.25      # background: baseline − 0.9·size … baseline + 0.25·size
UNDERLINE_TOP = 0.075                  # underline: baseline + 0.075·size, thickness 0.06·size
STRIKE_TOP = -0.3                      # strike: baseline − 0.3·size, thickness 0.06·size
DECOR_THICKNESS = 0.06
# text.edit redaction: a 1 pt band this far above each original baseline (× size) hits every glyph
# of the line but not the lines above/below (MuPDF removes glyphs whose box touches the redaction).
REDACT_BAND = 0.3


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


def quantized_width(font: pymupdf.Font, text: str, size: float) -> float:
    """Advance of `text` as the saved PDF stores it: whole thousandths of an em, truncated."""
    return sum(math.floor(round(font.glyph_advance(ord(c)) * 1000, 3)) for c in text) / 1000 * size


def run_font(run: Run, ctx) -> pymupdf.Font:
    if run.font.kind == "original":
        if ctx.source is None:
            raise ValueError("original fonts need the source document")
        return ctx.source.font(run.font.ref)
    return ctx.fonts.font(run.font.family, run.font.bold, run.font.italic)


def _band(x: float, y: float, w: float, top: float, height: float, size: float) -> pymupdf.Rect:
    return pymupdf.Rect(x, y + top * size, x + w, y + (top + height) * size)


def draw_text_box(page: pymupdf.Page, box: TextBox, ctx) -> None:
    runs = [r for paragraph in box.paragraphs for r in paragraph]
    writers: dict[str, pymupdf.TextWriter] = defaultdict(lambda: pymupdf.TextWriter(page.rect))
    backgrounds: list[tuple[pymupdf.Rect, str]] = []
    lines: list[tuple[pymupdf.Rect, str]] = []
    for line in box.layout:
        for seg in line.segments:
            if not seg.text:
                continue
            r = runs[seg.runIndex]
            font = run_font(r, ctx)
            if r.font.kind == "original":
                # TextWriter would silently draw missing glyphs with another font; the client never sends them.
                missing = sorted({c for c in seg.text if not font.has_glyph(ord(c))})
                if missing:
                    raise ValueError(f"font {r.font.ref} has no glyph for {''.join(missing)!r}")
            x, y = box.rect.x + seg.x, box.rect.y + line.baseline
            if r.bgColor or r.underline or r.strike:
                w = quantized_width(font, seg.text, r.size)
                if r.bgColor:
                    backgrounds.append((_band(x, y, w, -BG_ASCENT, BG_ASCENT + BG_DESCENT, r.size), r.bgColor))
                if r.underline:
                    lines.append((_band(x, y, w, UNDERLINE_TOP, DECOR_THICKNESS, r.size), r.color))
                if r.strike:
                    lines.append((_band(x, y, w, STRIKE_TOP, DECOR_THICKNESS, r.size), r.color))
            writers[r.color].append(writer_origin(page, (x, y)), seg.text, font=font, fontsize=r.size)
    for rect, color in backgrounds:
        page.draw_rect(rect, color=None, fill=rgb(color), width=0, overlay=True)
    before = {f[0] for f in page.get_fonts(full=True)}
    for color, writer in writers.items():
        writer.write_text(page, color=rgb(color))
    for xref in {f[0] for f in page.get_fonts(full=True)} - before:
        fix_to_unicode(page.parent, xref)  # spaces read back as U+0020, not U+00A0
    for rect, color in lines:
        page.draw_rect(rect, color=None, fill=rgb(color), width=0, overlay=True)


@register("text.add")
def text_add(page: pymupdf.Page, op: TextAdd, ctx) -> None:
    draw_text_box(page, op.box, ctx)


def redaction_rects(paragraph: dict) -> list[pymupdf.Rect]:
    """One thin band per original line of `paragraph` (see REDACT_BAND)."""
    out = []
    for line in paragraph["lines"]:
        r = line["rect"]
        y = line["baseline"] - REDACT_BAND * line["size"]
        inset = 0.5 if r["w"] > 2 else 0
        out.append(pymupdf.Rect(r["x"] + inset, y - 0.5, r["x"] + r["w"] - inset, y + 0.5))
    return out


@register("text.edit", phase="redact_text")
def text_edit_redact(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    paragraph = ctx.source.paragraph(op.pageKey, op.paragraphId)
    for rect in redaction_rects(paragraph):
        page.add_redact_annot(rect, fill=False)  # fill=False: paint nothing over what stays


@register("text.edit")
def text_edit(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    draw_text_box(page, op.box, ctx)
