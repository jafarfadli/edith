import math
from collections import defaultdict

import pymupdf

from edith.bake.registry import register
from edith.bake.tounicode import fix_to_unicode
from edith.bake.util import rgb
from edith.doc_fonts import name_key
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


def run_width(font: pymupdf.Font, text: str, run: Run) -> float:
    """Pen advance of `text` in `run` (Run.hScale / charSpacing / wordSpacing), as the web measures it
    (lib/fonts.ts textWidth)."""
    return (quantized_width(font, text, run.size) * run.hScale + len(text) * run.charSpacing
            + text.count(" ") * run.wordSpacing)


# Horizontally scaled text (Run.hScale) is written by one TextWriter per (colour, scale), morphed by the scale
# around this fixed point (writer coordinates): a segment's origin is moved so that it lands where intended.
SCALE_PIVOT = pymupdf.Point(0, 0)


def run_font(run: Run, ctx) -> pymupdf.Font:
    if run.font.kind == "original":
        if ctx.source is None:
            raise ValueError("original fonts need the source document")
        return ctx.source.font(run.font.ref, run.font.doc)
    return ctx.fonts.font(run.font.family, run.font.bold, run.font.italic)


def _band(x: float, y: float, w: float, top: float, height: float, size: float) -> pymupdf.Rect:
    return pymupdf.Rect(x, y + top * size, x + w, y + (top + height) * size)


def draw_text_box(page: pymupdf.Page, box: TextBox, ctx, skip: set[int] | frozenset[int] = frozenset()) -> None:
    """Draws the box's layout, except the lines whose index is in `skip` (kept original lines of a text.edit)."""
    runs = [r for paragraph in box.paragraphs for r in paragraph]
    writers: dict[tuple[str, float], pymupdf.TextWriter] = defaultdict(lambda: pymupdf.TextWriter(page.rect))
    backgrounds: list[tuple[pymupdf.Rect, str]] = []
    lines: list[tuple[pymupdf.Rect, str]] = []
    for k, line in enumerate(box.layout):
        if k in skip:
            continue
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
                w = run_width(font, seg.text, r)
                if r.bgColor:
                    backgrounds.append((_band(x, y, w, -BG_ASCENT, BG_ASCENT + BG_DESCENT, r.size), r.bgColor))
                if r.underline:
                    lines.append((_band(x, y, w, UNDERLINE_TOP, DECOR_THICKNESS, r.size), r.color))
                if r.strike:
                    lines.append((_band(x, y, w, STRIKE_TOP, DECOR_THICKNESS, r.size), r.color))
            origin = writer_origin(page, (x, y))
            if r.hScale != 1:  # undone by the writer's morph (see SCALE_PIVOT)
                origin = pymupdf.Point(SCALE_PIVOT.x + (origin.x - SCALE_PIVOT.x) / r.hScale, origin.y)
            writers[(r.color, r.hScale)].append(origin, seg.text, font=font, fontsize=r.size)
    for rect, color in backgrounds:
        page.draw_rect(rect, color=None, fill=rgb(color), width=0, overlay=True)
    before = {f[0] for f in page.get_fonts(full=True)}
    for (color, scale), writer in writers.items():
        morph = None if scale == 1 else (SCALE_PIVOT, pymupdf.Matrix(scale, 0, 0, 1, 0, 0))
        writer.write_text(page, color=rgb(color), morph=morph)
    for xref in {f[0] for f in page.get_fonts(full=True)} - before:
        fix_to_unicode(page.parent, xref)  # spaces read back as U+0020, not U+00A0
    for rect, color in lines:
        page.draw_rect(rect, color=None, fill=rgb(color), width=0, overlay=True)


@register("text.add")
def text_add(page: pymupdf.Page, op: TextAdd, ctx) -> None:
    draw_text_box(page, op.box, ctx)


def redaction_rects(paragraph: dict, keep: frozenset[int] | set[int] = frozenset()) -> list[pymupdf.Rect]:
    """One thin band per original line of `paragraph` (see REDACT_BAND), except the lines in `keep`."""
    out = []
    for i, line in enumerate(paragraph["lines"]):
        if i in keep:
            continue
        r = line["rect"]
        y = line["baseline"] - REDACT_BAND * line["size"]
        inset = 0.5 if r["w"] > 2 else 0
        out.append(pymupdf.Rect(r["x"] + inset, y - 0.5, r["x"] + r["w"] - inset, y + 0.5))
    return out


# A kept line (LayoutLine.source) must be in place: the box's left edge on the paragraph's (pt) and the line's
# baseline on the original line's (pt, or this share of its size when larger: originals may space lines unevenly).
KEEP_X_TOL = 0.5
KEEP_Y_TOL, KEEP_Y_EM = 1.0, 0.4
SIZE_TOL = 0.05


def kept_lines(box: TextBox, paragraph: dict, font_keys) -> dict[int, int]:
    """Layout line index → original line index, for the lines of a text.edit `box` whose `source` still
    matches the original `paragraph` (SourcePages.paragraph: runs name their span font): the same characters
    (whitespace aside) with the same size, colour, font and no decoration, the box in place with the original
    alignment, each original line kept once. The bake keeps those lines' original glyphs; any other line is
    redrawn. `font_keys(FontRef)` gives an original font's name keys (SourcePages.font_keys)."""
    runs = [r for p in box.paragraphs for r in p]
    lines = paragraph["lines"]
    styles = [run for run in paragraph["runs"] for _ in run["text"]]  # original run of each character
    text = "".join(r["text"] for r in paragraph["runs"])
    if box.align != paragraph["align"] or abs(box.rect.x - paragraph["rect"]["x"]) > KEEP_X_TOL:
        return {}
    out: dict[int, int] = {}
    for k, line in enumerate(box.layout):
        j = line.source
        if j is None or j >= len(lines) or j in out.values():
            continue
        orig = lines[j]
        if abs(box.rect.y + line.baseline - orig["baseline"]) > max(KEEP_Y_TOL, KEEP_Y_EM * orig["size"]):
            continue
        want = [(text[i], styles[i]) for i in range(orig["start"], orig["end"]) if not text[i].isspace()]
        got = [(c, runs[seg.runIndex]) for seg in line.segments for c in seg.text if not c.isspace()]
        if len(want) == len(got) and all(_same_char(o, r, font_keys) for o, r in zip(want, got)):
            out[k] = j
    return out


def _same_char(orig: tuple[str, dict], new: tuple[str, Run], font_keys) -> bool:
    (c, span), (d, run) = orig, new
    # GET /text gives horizontally scaled text its true size; the bake's extraction (no font programs) MuPDF's
    # size · √hScale (paragraphs._scale).
    sizes = (run.size, run.size * math.sqrt(run.hScale))
    if c != d or min(abs(s - span["size"]) for s in sizes) > SIZE_TOL or run.color.lower() != span["color"].lower():
        return False
    if run.bgColor or run.underline or run.strike:
        return False
    # A bundled font stands in for an original one the client could not reuse (or lacked a glyph of): accepted.
    return run.font.kind != "original" or name_key(span["font"]["name"]) in font_keys(run.font)


def _kept(op: TextEdit, ctx) -> dict[int, int]:
    paragraph = ctx.source.paragraph(op.pageKey, op.paragraphId)
    return kept_lines(op.box, paragraph, lambda f: ctx.source.font_keys(f.ref, f.doc))


@register("text.edit", phase="redact_text")
def text_edit_redact(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    paragraph = ctx.source.paragraph(op.pageKey, op.paragraphId)
    for rect in redaction_rects(paragraph, set(_kept(op, ctx).values())):
        page.add_redact_annot(rect, fill=False)  # fill=False: paint nothing over what stays


@register("text.edit")
def text_edit(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    draw_text_box(page, op.box, ctx, skip=set(_kept(op, ctx)))


def links_under_redactions(page: pymupdf.Page) -> list[str]:
    """The link annotations touching a pending redaction of `page`, as PDF source: apply_redactions()
    deletes them, even in the text-only mode of text.edit, which must keep them."""
    bands = [a.rect for a in page.annots(types=[pymupdf.PDF_ANNOT_REDACT])]
    doc = page.parent
    return [doc.xref_object(ln["xref"], compressed=True) for ln in page.get_links()
            if ln.get("xref") and any(ln["from"].intersects(b) for b in bands)]


def restore_links(page: pymupdf.Page, objects: list[str]) -> None:
    """Puts link annotations saved by links_under_redactions() back on `page`, unchanged."""
    if not objects:
        return
    doc = page.parent
    refs = []
    for obj in objects:
        xref = doc.get_new_xref()
        doc.update_object(xref, obj)
        refs.append(f"{xref} 0 R")
    kind, value = doc.xref_get_key(page.xref, "Annots")
    if kind == "xref":  # an indirect /Annots array
        arr = int(value.split()[0])
        doc.update_object(arr, doc.xref_object(arr, compressed=True).rstrip()[:-1] + " " + " ".join(refs) + "]")
        return
    current = value.strip()[1:-1] if kind == "array" else ""
    doc.xref_set_key(page.xref, "Annots", "[" + current + " " + " ".join(refs) + "]")
