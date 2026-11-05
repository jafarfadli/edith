# Task 6: Bake rich runs — original fonts, glyph check, background/underline/strike

**Files:**
- Create: `apps/api/edith/bake/source.py`
- Modify: `apps/api/edith/bake/context.py`, `apps/api/edith/bake/text.py` (rewrite), `apps/api/edith/bake/__init__.py`, `apps/api/tests/test_bake_text.py`

**Interfaces:**
- Consumes: Task 2 `Run` (`font: FontRef`, `bgColor`, `underline`, `strike`); Task 3 `load_font`; Task 4 `extract_paragraphs`; Task 3 fixtures `make_fonts_pdf`, `SUBSET_TTF`.
- Produces:
  - `BakeContext.source: SourcePages | None = None` — set by `bake()` for the duration of one bake (callers keep building `BakeContext(doc_id=…, asset_path=…, fonts=…)`).
  - `edith.bake.source.SourcePages(source: bytes, page_src: dict[str, int | None])` with `paragraph(page_key, paragraph_id) -> dict | None` (the extraction of Task 4 on the untouched source page; `None` for blank pages / unknown ids), `font(ref) -> pymupdf.Font` (raises `ValueError` unless `ref` is a reusable font of the document), `close()`.
  - `edith.bake.text`: constants `BG_ASCENT=0.9`, `BG_DESCENT=0.25`, `UNDERLINE_TOP=0.075`, `STRIKE_TOP=-0.3`, `DECOR_THICKNESS=0.06`; `quantized_width(font, text, size) -> float`; `run_font(run, ctx) -> pymupdf.Font`; `draw_text_box(page, box, ctx)` now draws all background bands, then the glyphs, then underline/strike bands, and raises `ValueError` when an original-font segment has a character without a glyph (→ `bake_failed` with the op id).

- [ ] **Step 1: Failing tests**

In `apps/api/tests/test_bake_text.py` replace `from tests.pdfs import make_pdf` with:
```python
from edith.bake.text import quantized_width
from edith.doc_fonts import collect_fonts
from tests.pdfs import SUBSET_TTF, make_fonts_pdf, make_pdf
```
and append:
```python


def test_decorations_follow_the_shared_geometry(ctx, fonts):
    r = {**run("Garis", size=20, color="#00ff00"), "underline": True, "strike": True, "bgColor": "#ffff00"}
    ops = text_op([r], [{"baseline": 15, "segments": [{"x": 5, "text": "Garis", "runIndex": 0}]}])
    page = pymupdf.open(stream=bake(make_pdf(pages=1, text=False), ops, ctx).tobytes(), filetype="pdf")[0]
    w = quantized_width(fonts.font("Arimo", False, False), "Garis", 20)
    x, y = 105, 215  # rect (100, 200) + segment x 5, baseline 15
    drawings = sorted(page.get_drawings(), key=lambda d: d["seqno"])
    assert [d["fill"] for d in drawings] == [(1.0, 1.0, 0.0), (0.0, 1.0, 0.0), (0.0, 1.0, 0.0)]
    bg, under, strike = (d["rect"] for d in drawings)
    assert tuple(bg) == pytest.approx((x, y - 18, x + w, y + 5), abs=0.01)       # −0.9·size … +0.25·size
    assert tuple(under) == pytest.approx((x, y + 1.5, x + w, y + 2.7), abs=0.01)  # +0.075·size, 0.06·size thick
    assert tuple(strike) == pytest.approx((x, y - 6, x + w, y - 4.8), abs=0.01)   # −0.3·size
    text_seq = page.get_texttrace()[0]["seqno"]
    assert drawings[0]["seqno"] < text_seq < drawings[1]["seqno"]  # background under the glyphs, lines over


def test_quantized_width_matches_the_client_rule(fonts):
    assert quantized_width(fonts.font("Arimo", False, False), "A", 20) == pytest.approx(13.32)  # floor(666.99)/1000·20


def _ref(data: bytes, name: str) -> str:
    return next(f.ref for f in collect_fonts(pymupdf.open(stream=data, filetype="pdf")).values() if f.name == name)


def _original_op(data: bytes, text: str, name: str = "Tinos Regular"):
    r = {"text": text, "font": {"kind": "original", "ref": _ref(data, name)}, "size": 12, "color": "#000000"}
    return text_op([r], [{"baseline": 15, "segments": [{"x": 0, "text": text, "runIndex": 0}]}], y=400)


def test_original_font_is_reused(ctx):
    data = make_fonts_pdf()
    out = pymupdf.open(stream=bake(data, _original_op(data, "lorem dolor"), ctx).tobytes(garbage=3), filetype="pdf")
    span = next(s for b in out[0].get_text("dict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"]
                if s["text"] == "lorem dolor")
    assert "Tinos" in span["font"] and span["origin"] == pytest.approx((100, 415), abs=0.01)
    sizes = {len(out.extract_font(x[0])[3]) for x in out[0].get_fonts(full=True)}
    assert len(SUBSET_TTF.read_bytes()) in sizes  # the subset embedded in the PDF, not the bundled Tinos


def test_original_font_missing_a_glyph_fails(ctx):
    data = make_fonts_pdf()
    with pytest.raises(BakeFailed) as e:
        bake(data, _original_op(data, "xyz"), ctx)  # the subset has no x, y, z
    assert e.value.extra["op_id"] == "t"


def test_non_reusable_original_font_fails(ctx):
    data = make_fonts_pdf()
    with pytest.raises(BakeFailed):
        bake(data, _original_op(data, "Halo", name="Helvetica"), ctx)
```

Run: `cd apps/api && uv run pytest tests/test_bake_text.py -q`
Expected: FAIL — `ImportError: cannot import name 'quantized_width'`.

- [ ] **Step 2: Source pages**

`apps/api/edith/bake/context.py` (replace):
```python
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from edith.fonts import FontRegistry

if TYPE_CHECKING:
    from edith.bake.source import SourcePages


@dataclass
class BakeContext:
    doc_id: str
    asset_path: Callable[[str], Path]
    fonts: FontRegistry
    source: "SourcePages | None" = None  # set by bake() for the duration of one bake
```

`apps/api/edith/bake/source.py`:
```python
import pymupdf

from edith.doc_fonts import load_font
from edith.paragraphs import extract_paragraphs


class SourcePages:
    """Read-only view of the uploaded PDF, for ops that refer to its original content: paragraphs
    (`text.edit`) and embedded fonts (`FontRef` kind "original"). Paragraph ids come from the same
    extraction GET /documents/{id}/text uses, run on the untouched source file."""

    def __init__(self, source: bytes, page_src: dict[str, int | None]):
        self._doc = pymupdf.open(stream=source, filetype="pdf")
        self._page_src = page_src  # pageKey → source page index (None for blank pages)
        self._paragraphs: dict[int, dict[str, dict]] = {}
        self._fonts: dict[str, pymupdf.Font] = {}

    def paragraph(self, page_key: str, paragraph_id: str) -> dict | None:
        index = self._page_src.get(page_key)
        if index is None:
            return None
        if index not in self._paragraphs:
            self._paragraphs[index] = {p["id"]: p for p in extract_paragraphs(self._doc[index])}
        return self._paragraphs[index].get(paragraph_id)

    def font(self, ref: str) -> pymupdf.Font:
        if ref not in self._fonts:
            font = load_font(self._doc, int(ref[1:])) if self._is_font(int(ref[1:])) else None
            if font is None:
                raise ValueError(f"font {ref} is not a reusable font of this document")
            self._fonts[ref] = font
        return self._fonts[ref]

    def _is_font(self, xref: int) -> bool:
        return any(entry[0] == xref for page in self._doc for entry in page.get_fonts(full=True))

    def close(self) -> None:
        self._doc.close()
```

In `apps/api/edith/bake/__init__.py`:
- Add imports `from dataclasses import replace` (after `from collections import defaultdict`) and `from edith.bake.source import SourcePages` (after the registry import).
- Change the start of `bake()` up to the layout default so it reads:
```python
def bake(source: bytes, ops: list, ctx: BakeContext) -> pymupdf.Document:
    doc = pymupdf.open(stream=source, filetype="pdf")
    pages_src = None
    try:
        layout, layout_index = None, -1
        for i, op in enumerate(ops):
            if op.type == "pages.layout":
                layout, layout_index = op, i
        if layout is None:
            layout = _default_layout(doc.page_count, ctx.doc_id)

        pages_src = SourcePages(source, {
            p.pageKey: (p.src.index if isinstance(p.src, DocSrc) and p.src.doc == ctx.doc_id
                        and p.src.index < doc.page_count else None)
            for p in layout.pages
        })
        ctx = replace(ctx, source=pages_src)
```
  (the rest of the body is unchanged, re-indented as it was), and extend the function's error handling to:
```python
    except BaseException:
        doc.close()
        raise
    finally:
        if pages_src is not None:
            pages_src.close()
```
  Also remove the stray blank line right after `try:` (M1 backlog).

- [ ] **Step 3: Rich text drawing**

`apps/api/edith/bake/text.py` (replace):
```python
import math
from collections import defaultdict

import pymupdf

from edith.bake.registry import register
from edith.bake.util import rgb
from edith.ops import Run, TextAdd, TextBox

# Decoration geometry, in multiples of the run's font size relative to the baseline (y grows down).
# Shared contract with apps/web/src/lib/textDecor.ts — change both together.
BG_ASCENT, BG_DESCENT = 0.9, 0.25      # background: baseline − 0.9·size … baseline + 0.25·size
UNDERLINE_TOP = 0.075                  # underline: baseline + 0.075·size, thickness 0.06·size
STRIKE_TOP = -0.3                      # strike: baseline − 0.3·size, thickness 0.06·size
DECOR_THICKNESS = 0.06


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
    for color, writer in writers.items():
        writer.write_text(page, color=rgb(color))
    for rect, color in lines:
        page.draw_rect(rect, color=None, fill=rgb(color), width=0, overlay=True)


@register("text.add")
def text_add(page: pymupdf.Page, op: TextAdd, ctx) -> None:
    draw_text_box(page, op.box, ctx)
```

Run: `cd apps/api && uv run pytest -q`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/edith/bake apps/api/tests/test_bake_text.py
git commit -m "feat(api): bake original fonts and text background/underline/strike

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
