import math
from collections import defaultdict
from dataclasses import dataclass

import pymupdf

from edith.bake.registry import register
from edith.bake.tounicode import fix_to_unicode
from edith.bake.util import rgb
from edith.decor import PageMarks
from edith.doc_fonts import name_key
from edith.ops import Run, TextAdd, TextBox, TextEdit
from edith.paragraphs import SPACE_CHARS

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


def decor_bands(x: float, y: float, w: float, r: Run) -> list[tuple[str, pymupdf.Rect, str]]:
    """("bg" | "underline" | "strike", rect, colour) of a segment of run `r` drawn at (x, baseline y) with advance `w`:
    the original's geometry and colour where the run carries them (Run.underlineTop …), else the defaults."""
    out = []
    if r.bgColor:
        out.append(("bg", _band(x, y, w, -BG_ASCENT, BG_ASCENT + BG_DESCENT, r.size), r.bgColor))
    thickness = r.decorThickness if r.decorThickness is not None else DECOR_THICKNESS
    if r.underline:
        top = r.underlineTop if r.underlineTop is not None else UNDERLINE_TOP
        out.append(("underline", _band(x, y, w, top, thickness, r.size), r.decorColor or r.color))
    if r.strike:
        top = r.strikeTop if r.strikeTop is not None else STRIKE_TOP
        out.append(("strike", _band(x, y, w, top, thickness, r.size), r.decorColor or r.color))
    return out


JOIN_GAP = 0.5  # pt: bands of one colour and height this close along a line are drawn as one (no seams between segments)


def _joined(bands: list[tuple[pymupdf.Rect, str]]) -> list[tuple[pymupdf.Rect, str]]:
    out: list[tuple[pymupdf.Rect, str]] = []
    for rect, color in bands:
        last = out[-1] if out else None
        if (last and last[1] == color and abs(last[0].y0 - rect.y0) < 1e-3 and abs(last[0].y1 - rect.y1) < 1e-3
                and -JOIN_GAP <= rect.x0 - last[0].x1 <= JOIN_GAP):
            out[-1] = (pymupdf.Rect(last[0].x0, rect.y0, max(last[0].x1, rect.x1), rect.y1), color)
        else:
            out.append((rect, color))
    return out


def draw_text_box(page: pymupdf.Page, box: TextBox, ctx, skip: set[int] | frozenset[int] = frozenset(),
                  heads: dict[int, int] | None = None) -> None:
    """Draws the box's layout, except the lines whose index is in `skip` (kept original lines of a text.edit) and the
    glyphs of the first `heads[k]` segments of line k (the kept prefix of an edited original line: its decorations are
    drawn, as the edit removes the original line's decoration marks whole, see text_edit_decor)."""
    runs = [r for paragraph in box.paragraphs for r in paragraph]
    writers: dict[tuple[str, float], pymupdf.TextWriter] = defaultdict(lambda: pymupdf.TextWriter(page.rect))
    backgrounds: list[tuple[pymupdf.Rect, str]] = []
    lines: list[tuple[pymupdf.Rect, str]] = []
    for k, line in enumerate(box.layout):
        if k in skip:
            continue
        head = (heads or {}).get(k, 0)
        for i, seg in enumerate(line.segments):
            r = runs[seg.runIndex]
            if not seg.text or (i < head and not (r.bgColor or r.underline or r.strike)):
                continue
            font = run_font(r, ctx)
            x, y = box.rect.x + seg.x, box.rect.y + line.baseline
            if r.bgColor or r.underline or r.strike:
                for kind, rect, color in decor_bands(x, y, run_width(font, seg.text, r), r):
                    (backgrounds if kind == "bg" else lines).append((rect, color))
            if i < head:
                continue  # the original's own glyphs stay
            if r.font.kind == "original":
                # TextWriter would silently draw missing glyphs with another font; the client never sends them.
                missing = sorted({c for c in seg.text if not font.has_glyph(ord(c))})
                if missing:
                    raise ValueError(f"font {r.font.ref} has no glyph for {''.join(missing)!r}")
            origin = writer_origin(page, (x, y))
            if r.hScale != 1:  # undone by the writer's morph (see SCALE_PIVOT)
                origin = pymupdf.Point(SCALE_PIVOT.x + (origin.x - SCALE_PIVOT.x) / r.hScale, origin.y)
            writers[(r.color, r.hScale)].append(origin, seg.text, font=font, fontsize=r.size)
    for rect, color in _joined(backgrounds):
        page.draw_rect(rect, color=None, fill=rgb(color), width=0, overlay=True)
    before = {f[0] for f in page.get_fonts(full=True)}
    for (color, scale), writer in writers.items():
        morph = None if scale == 1 else (SCALE_PIVOT, pymupdf.Matrix(scale, 0, 0, 1, 0, 0))
        writer.write_text(page, color=rgb(color), morph=morph)
    for xref in {f[0] for f in page.get_fonts(full=True)} - before:
        fix_to_unicode(page.parent, xref)  # spaces read back as U+0020, not U+00A0
    for rect, color in _joined(lines):
        page.draw_rect(rect, color=None, fill=rgb(color), width=0, overlay=True)


@register("text.add")
def text_add(page: pymupdf.Page, op: TextAdd, ctx) -> None:
    draw_text_box(page, op.box, ctx)


def redaction_rects(paragraph: dict, keep: frozenset[int] | set[int] = frozenset(),
                    cut: dict[int, float | None] | None = None) -> list[pymupdf.Rect]:
    """One thin band per original line of `paragraph` (see REDACT_BAND), except the lines in `keep`. A line in `cut`
    keeps its first words: its band starts at that x (MuPDF removes a glyph only when the band reaches well into its
    box, so the space glyph ending there stays and the glyph starting there goes); None: nothing of it goes."""
    out = []
    for i, line in enumerate(paragraph["lines"]):
        if i in keep:
            continue
        r = line["rect"]
        y = line["baseline"] - REDACT_BAND * line["size"]
        inset = 0.5 if r["w"] > 2 else 0
        x0, x1 = r["x"] + inset, r["x"] + r["w"] - inset
        if cut is not None and i in cut:
            if cut[i] is None or cut[i] >= x1:
                continue
            x0 = cut[i]
        out.append(pymupdf.Rect(x0, y - 0.5, x1, y + 0.5))
    return out


# A kept line (LayoutLine.source) must be in place: the box anchored where the client's paragraphBox anchors it (pt)
# and the line's baseline on the original line's (pt, or this share of its size when larger: originals may space
# lines unevenly). Shared contract with KEEP_Y_TOL / KEEP_Y_EM in apps/web/src/lib/keepLines.ts: change both.
KEEP_X_TOL = 0.5
KEEP_Y_TOL, KEEP_Y_EM = 1.0, 0.4
SIZE_TOL = 0.05
H_SCALE_TOL, SPACING_TOL = 0.0005, 0.005  # hScale, charSpacing / wordSpacing (pt) of a kept line: as measured
# The whitespace a kept line is compared without (paragraphs.SPACE_CHARS): what the client's layout drops at line
# ends and between justified words.


def _anchor_offset(box: TextBox, paragraph: dict) -> float:
    """How far the box is from where paragraphBox (apps/web/src/lib/paragraphs.ts) puts it: a single line that may
    grow (not justified) keeps its centre or right edge when centred or right-aligned; anything else its left edge."""
    r = paragraph["rect"]
    if len(paragraph["lines"]) == 1 and box.align == "center":
        return (box.rect.x + box.rect.w / 2) - (r["x"] + r["w"] / 2)
    if len(paragraph["lines"]) == 1 and box.align == "right":
        return (box.rect.x + box.rect.w) - (r["x"] + r["w"])
    return box.rect.x - r["x"]


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
    if box.align != paragraph["align"] or abs(_anchor_offset(box, paragraph)) > KEEP_X_TOL:
        return {}
    out: dict[int, int] = {}
    for k, line in enumerate(box.layout):
        j = line.source
        if j is None or j >= len(lines) or j in out.values():
            continue
        orig = lines[j]
        if abs(box.rect.y + line.baseline - orig["baseline"]) > max(KEEP_Y_TOL, KEEP_Y_EM * orig["size"]):
            continue
        want = [(text[i], styles[i]) for i in range(orig["start"], orig["end"]) if text[i] not in SPACE_CHARS]
        got = [(c, runs[seg.runIndex]) for seg in line.segments for c in seg.text if c not in SPACE_CHARS]
        if len(want) == len(got) and all(_same_char(o, r, font_keys) for o, r in zip(want, got)):
            out[k] = j
    return out


def _same_char(orig: tuple[str, dict], new: tuple[str, Run], font_keys) -> bool:
    (c, span), (d, run) = orig, new
    if c != d or abs(run.size - span["size"]) > SIZE_TOL or run.color.lower() != span["color"].lower():
        return False
    if not _same_decor(run, span):
        return False
    # The original's measured scale and spacing (SourcePages measures them as GET /text does): unchanged.
    if (abs(run.hScale - span.get("hScale", 1)) > H_SCALE_TOL or abs(run.charSpacing - span.get("charSpacing", 0)) > SPACING_TOL
            or abs(run.wordSpacing - span.get("wordSpacing", 0)) > SPACING_TOL):
        return False
    # A bundled font stands in for an original one the client could not reuse (or lacked a glyph of): accepted.
    return run.font.kind != "original" or name_key(span["font"]["name"]) in font_keys(run.font)


DECOR_TOL = 0.005  # × size: a kept line's decoration geometry as measured


def _same_decor(run: Run, span: dict) -> bool:
    """The run has exactly the original character's decorations (the marks the page draws for it, as GET /text reports
    them): a kept line keeps those marks, so a line with any other decoration is redrawn."""
    if (run.bgColor or "").lower() != (span.get("bgColor") or "").lower() or run.underline != bool(span.get("underline")) \
            or run.strike != bool(span.get("strike")):
        return False
    if not (run.underline or run.strike):
        return True
    for field in ("underlineTop", "strikeTop", "decorThickness"):
        a, b = getattr(run, field), span.get(field)
        if (a is None) != (b is None) or (a is not None and abs(a - b) > DECOR_TOL):
            return False
    return (run.decorColor or run.color).lower() == (span.get("decorColor") or span["color"]).lower()


@dataclass(frozen=True)
class KeptPrefix:
    """A kept prefix (LayoutLine.prefix) the bake accepted: original line `source` keeps its glyphs left of `cut` (its
    first other word's x; None: the whole line stays, the layout line only adds words after it), the first `segments`
    segments of the layout line are not drawn."""
    source: int
    segments: int
    cut: float | None


def kept_prefixes(box: TextBox, paragraph: dict, font_keys, kept: dict[int, int]) -> dict[int, KeptPrefix]:
    """Layout line index → KeptPrefix, for the lines of a text.edit `box` whose `prefix` still matches the original
    `paragraph` (as kept_lines checks a whole line: in place, same characters whitespace aside, same styles), whose
    original line is neither kept (`kept`, kept_lines) nor another line's prefix, and which ends at a word boundary
    of the original line (whitespace after it: the band starting at the next word leaves the prefix's glyphs alone).
    The layout line's other segments must start at or right of that word (they are drawn where its glyphs were)."""
    if box.align != paragraph["align"] or abs(_anchor_offset(box, paragraph)) > KEEP_X_TOL:
        return {}
    runs = [r for p in box.paragraphs for r in p]
    lines = paragraph["lines"]
    styles = [run for run in paragraph["runs"] for _ in run["text"]]
    text = "".join(r["text"] for r in paragraph["runs"])
    out: dict[int, KeptPrefix] = {}
    for k, line in enumerate(box.layout):
        pre = line.prefix
        if pre is None or k in kept or pre.source >= len(lines) or pre.source in kept.values() \
                or any(p.source == pre.source for p in out.values()) or pre.segments > len(line.segments):
            continue
        orig = lines[pre.source]
        if abs(box.rect.y + line.baseline - orig["baseline"]) > max(KEEP_Y_TOL, KEEP_Y_EM * orig["size"]):
            continue
        got = [(c, runs[seg.runIndex]) for seg in line.segments[:pre.segments] for c in seg.text if c not in SPACE_CHARS]
        ink = [i for i in range(orig["start"], orig["end"]) if text[i] not in SPACE_CHARS]
        if not got or len(got) > len(ink):
            continue
        if not all(_same_char((text[i], styles[i]), r, font_keys) for i, r in zip(ink, got)):
            continue
        cut: float | None = None
        if len(got) < len(ink):
            c = ink[len(got)]  # the original's first character after the prefix
            xs = orig.get("wordX")
            words = sum(1 for i in range(orig["start"], c + 1)
                        if text[i] not in SPACE_CHARS and (i == orig["start"] or text[i - 1] in SPACE_CHARS))
            if c == ink[len(got) - 1] + 1 or not xs or words > len(xs):
                continue  # inside a word (no whitespace before it), or no word positions
            cut = xs[words - 1]
        limit = (orig["rect"]["x"] + orig["rect"]["w"]) if cut is None else cut
        rest = [seg for seg in line.segments[pre.segments:] if seg.text.strip()]
        if any(box.rect.x + seg.x < limit - KEEP_X_TOL for seg in rest):
            continue
        out[k] = KeptPrefix(pre.source, pre.segments, cut)
    return out


def _kept(op: TextEdit, ctx) -> tuple[dict[int, int], dict[int, KeptPrefix]]:
    paragraph = ctx.source.paragraph(op.pageKey, op.paragraphId)
    font_keys = lambda f: ctx.source.font_keys(f.ref, f.doc)  # noqa: E731
    kept = kept_lines(op.box, paragraph, font_keys)
    return kept, kept_prefixes(op.box, paragraph, font_keys, kept)


@register("text.edit", phase="redact_text")
def text_edit_redact(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    paragraph = ctx.source.paragraph(op.pageKey, op.paragraphId)
    kept, prefixes = _kept(op, ctx)
    for rect in redaction_rects(paragraph, set(kept.values()), {p.source: p.cut for p in prefixes.values()}):
        page.add_redact_annot(rect, fill=False)  # fill=False: paint nothing over what stays


def decor_redactions(page: pymupdf.Page, paragraph: dict, keep: set[int] | frozenset[int] = frozenset()) -> list[pymupdf.Rect]:
    """The redaction rects that remove the decoration marks (GET /text line `decor`: underlines, strikethroughs,
    highlights drawn for the text) of every line of `paragraph` but the kept ones (`keep`): a kept prefix's line loses
    its marks too, its prefix's decorations are drawn again with the new text (draw_text_box). A mark is removed only
    when the page still draws it and nothing else lies inside its rect (PageMarks.removable): else it stays."""
    if not any(line.get("decor") for line in paragraph["lines"]):
        return []
    marks = PageMarks(page)
    out = []
    for i, line in enumerate(paragraph["lines"]):
        if i in keep:
            continue
        for d in line.get("decor", []):
            found = marks.find(pymupdf.Rect(d["x"], d["y"], d["x"] + d["w"], d["y"] + d["h"]))
            if found and all(marks.removable(m) for m in found):
                out.append(found[0].remove)
    return out


@register("text.edit", phase="redact_decor")
def text_edit_decor(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    paragraph = ctx.source.paragraph(op.pageKey, op.paragraphId)
    kept, _prefixes = _kept(op, ctx)
    for rect in decor_redactions(page, paragraph, set(kept.values())):
        page.add_redact_annot(rect, fill=False)


@register("text.edit")
def text_edit(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    kept, prefixes = _kept(op, ctx)
    draw_text_box(page, op.box, ctx, skip=set(kept), heads={k: p.segments for k, p in prefixes.items()})


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
