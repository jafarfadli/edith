# Task 3: Bake rotation and opacity of drawn objects

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 2 leaves, new files are complete.

**Goal:** Any drawn op with `opacity < 1` or `rotation != 0` is drawn by its normal handler, then the content streams it added are merged and wrapped in `q [/GS gs] [cm] … Q` — one mechanism for shapes, images, signatures, stamps, symbols, ink and text.

**Files:**
- Modify: `apps/api/edith/bake/__init__.py`
- Create: `apps/api/edith/bake/transform.py`
- Create: `apps/api/tests/test_bake_transform.py`

**Interfaces:**
- Consumes: Task 1 `opacity`/`rotation`; the handler registry (`bake/registry.py`).
- Produces:
- `edith/bake/transform.py`: `draw_transformed(page, op, draw)`, `rotation_matrix(page, center, degrees) -> pymupdf.Matrix`, `rotation_center(op)`, `needs_wrap(op)`.
- `bake._run()` calls every handler through `draw_transformed` (a no-op wrapper for ops without the fields: redactions, annots, links).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_bake_transform.py`:

```python
import math

import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import AssetNotFound
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22
ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}


@pytest.fixture
def ctx(tmp_path) -> BakeContext:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20), False)
    pix.set_rect(pix.irect, (255, 0, 0))
    pix.save(tmp_path / "red.png")

    def asset_path(asset_id: str):
        p = tmp_path / f"{asset_id}.png"
        if not p.exists():
            raise AssetNotFound()
        return p
    return BakeContext(doc_id=DOC, asset_path=asset_path, fonts=FontRegistry(Settings().fonts_dir))


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def blue_rect(**kw) -> dict:
    return {"id": "s", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": R(100, 100, 200, 100),
            "stroke": "#000000", "fill": "#0000ff", "width": 0, **kw}


def pixel(page, x, y):
    return page.get_pixmap(clip=pymupdf.Rect(x, y, x + 1, y + 1)).pixel(0, 0)


def fills(page):
    return [d for d in page.get_drawings() if d.get("fill") == (0.0, 0.0, 1.0)]


def unwrapped_pdf() -> bytes:
    """A page whose content leaves a translation in effect (no q/Q around it), as many real PDFs do."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    xref = doc.get_new_xref()
    doc.update_object(xref, "<<>>")
    doc.update_stream(xref, b"1 0 0 1 10 10 cm 0 1 0 rg 0 0 5 5 re f")
    doc.xref_set_key(page.xref, "Contents", f"{xref} 0 R")
    return doc.tobytes()


@pytest.mark.parametrize("source", [make_pdf(pages=1), make_pdf(pages=1, crop=(50, 40, 545, 800)), unwrapped_pdf()],
                         ids=["plain", "cropped", "unwrapped"])
def test_rotation_turns_clockwise_around_rect_center(ctx, source):
    out = bake(source, ops(blue_rect(rotation=90)), ctx)
    (d,) = fills(out[0])
    assert tuple(d["rect"]) == pytest.approx((150, 50, 250, 250), abs=0.01)


def test_rotation_30_degrees_moves_corners_clockwise(ctx):
    out = bake(make_pdf(pages=1), ops(blue_rect(rotation=30)), ctx)
    (d,) = fills(out[0])
    # The top-left corner (100,100) turned 30° clockwise around (200,150).
    a = math.radians(30)
    x = 200 + (-100) * math.cos(a) - (-50) * math.sin(a)
    y = 150 + (-100) * math.sin(a) + (-50) * math.cos(a)
    corners = [p for item in d["items"] for p in item[1:] if isinstance(p, pymupdf.Point)]
    assert any(abs(p.x - x) < 0.01 and abs(p.y - y) < 0.01 for p in corners)


def test_opacity_blends_with_the_page(ctx):
    out = bake(make_pdf(pages=1), ops(blue_rect(opacity=0.5)), ctx)
    assert pixel(out[0], 200, 150) == (127, 127, 255) or pixel(out[0], 200, 150) == (128, 128, 255)
    (d,) = fills(out[0])
    assert d["fill_opacity"] == pytest.approx(0.5)


def test_opaque_unrotated_ops_are_not_wrapped(ctx):
    src = make_pdf(pages=1)
    before = pymupdf.open(stream=src, filetype="pdf")[0].get_contents()
    out = bake(src, ops(blue_rect()), ctx)
    assert len(out[0].get_contents()) == len(before) + 1  # the shape's own stream, nothing merged


def test_rotated_image(ctx):
    image = {"id": "i", "type": "image.add", "pageKey": "o0", "rect": R(100, 300, 200, 100), "assetId": "red", "rotation": 90}
    out = bake(make_pdf(pages=1), ops(image), ctx)
    (info,) = out[0].get_image_info()
    assert tuple(info["bbox"]) == pytest.approx((150, 250, 250, 450), abs=0.01)
    assert pixel(out[0], 200, 260) == (255, 0, 0) and pixel(out[0], 120, 350) == (255, 255, 255)


def test_translucent_ink_has_alpha(ctx):
    ink = {"id": "k", "type": "ink.add", "pageKey": "o0", "paths": [[[100, 500], [300, 500]]], "color": "#0000ff", "width": 10, "opacity": 0.25}
    out = bake(make_pdf(pages=1), ops(ink), ctx)
    (d,) = [d for d in out[0].get_drawings() if d.get("color") == (0.0, 0.0, 1.0)]
    assert d["stroke_opacity"] == pytest.approx(0.25)


def test_rotated_text_box_reads_vertically(ctx):
    box = {"rect": R(100, 600, 100, 14), "align": "left", "lineHeight": 14,
           "paragraphs": [[{"text": "Turned", "font": ARIMO, "size": 12, "color": "#111111"}]],
           "layout": [{"baseline": 11, "segments": [{"x": 0, "text": "Turned", "runIndex": 0}]}]}
    out = bake(make_pdf(pages=1), ops({"id": "t", "type": "text.add", "pageKey": "o0", "box": box, "rotation": 90}), ctx)
    line = next(ln for b in out[0].get_text("dict")["blocks"] for ln in b.get("lines", [])
                if "Turned" in "".join(s["text"] for s in ln["spans"]))
    assert line["dir"] == pytest.approx((0, 1), abs=1e-6)  # left-to-right becomes top-to-bottom
    assert 140 < line["bbox"][0] < 160  # turned around the box centre (150, 607)


def test_rotated_translucent_stamp(ctx):
    stamp = {"id": "st", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 700, 140, 40), "preset": "approved",
             "color": "#15803d", "rotation": -20, "opacity": 0.6}
    out = bake(make_pdf(pages=1), ops(stamp), ctx)
    assert "APPROVED" in out[0].get_text()
    border = [d for d in out[0].get_drawings() if d.get("color") and d["color"][1] > 0.4]
    assert border and all(d["stroke_opacity"] == pytest.approx(0.6) for d in border)
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_bake_transform.py`
Expected: FAIL: `ModuleNotFoundError: edith.bake.transform`

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/__init__.py`:

```diff
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -9,6 +9,7 @@ from edith.bake.registry import HANDLERS, PHASE, TEXT_REDACTIONS
 from edith.bake.scrub import scrub_page, under_redaction
 from edith.bake.source import SourcePages
 from edith.bake.text import links_under_redactions, restore_links
+from edith.bake.transform import draw_transformed
 from edith.bake.util import to_rect
 from edith.errors import BakeFailed, EdithError, InvalidOp
 from edith.forms import FieldValueError, drop_xfa, fill_forms
@@ -33,7 +34,7 @@ def _default_layout(page_count: int, doc_id: str) -> PagesLayout:
 
 def _run(handler, page, op, ctx) -> None:
     try:
-        handler(page, op, ctx)
+        draw_transformed(page, op, lambda: handler(page, op, ctx))
     except EdithError as exc:
         raise BakeFailed(exc.message, op_id=op.id) from exc
     except Exception as exc:  # noqa: BLE001
```

Create `apps/api/edith/bake/transform.py`:

```python
"""Rotation and opacity of drawn objects. The op's handler draws it as usual; the content streams it adds
are then merged into one and wrapped in `q [/GS gs] [cm] … Q`, so every handler (shapes, images, text,
stamps) gets arbitrary rotation and opacity the same way. Rotation is clockwise on screen (Konva's
convention) around the centre of the op's rect."""
from collections.abc import Callable

import pymupdf

from edith.ops import TextAdd


def rotation_center(op) -> tuple[float, float] | None:
    r = op.box.rect if isinstance(op, TextAdd) else getattr(op, "rect", None)
    return None if r is None else (r.x + r.w / 2, r.y + r.h / 2)


def needs_wrap(op) -> bool:
    return getattr(op, "opacity", 1) < 1 or bool(getattr(op, "rotation", 0))


def rotation_matrix(page: pymupdf.Page, center: tuple[float, float], degrees: float) -> pymupdf.Matrix:
    """`cm` operand (PDF space) that turns content `degrees` clockwise (on screen) around `center` (page space)."""
    to_page = page.transformation_matrix  # PDF space → page space (y down, CropBox top-left origin)
    cx, cy = center
    turn = pymupdf.Matrix(1, 0, 0, 1, -cx, -cy) * pymupdf.Matrix(degrees) * pymupdf.Matrix(1, 0, 0, 1, cx, cy)
    return to_page * turn * ~to_page


def draw_transformed(page: pymupdf.Page, op, draw: Callable[[], None]) -> None:
    if not needs_wrap(op):
        draw()
        return
    if not page.is_wrapped:
        page.wrap_contents()  # else the first drawing call would put a `q` stream in front of the page's own
    doc = page.parent
    before = set(page.get_contents())
    draw()
    new = [x for x in page.get_contents() if x not in before]
    if not new:
        return
    head = "q\n"
    if op.opacity < 1:
        head += f"/{page._set_opacity(CA=op.opacity, ca=op.opacity)} gs\n"
    rotation = getattr(op, "rotation", 0)
    center = rotation_center(op)
    if rotation and center is not None:
        m = rotation_matrix(page, center, rotation)
        head += " ".join(f"{v:.6f}" for v in (m.a, m.b, m.c, m.d, m.e, m.f)) + " cm\n"
    body = b"\n".join(doc.xref_stream(x) or b"" for x in new)
    doc.update_stream(new[0], head.encode() + body + b"\nQ\n")
    for x in new[1:]:
        doc.update_stream(x, b"")
```


- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q`
Expected: 336 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/bake/__init__.py apps/api/edith/bake/transform.py apps/api/tests/test_bake_transform.py
git commit -m "feat(api): rotate and fade drawn objects at export" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
