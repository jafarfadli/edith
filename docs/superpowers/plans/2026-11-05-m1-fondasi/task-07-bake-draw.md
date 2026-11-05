# Task 7: Draw + redact handlers

**Files:**
- Create: `apps/api/edith/bake/util.py`, `apps/api/edith/bake/draw.py`, `apps/api/tests/test_bake_draw.py`
- Modify: `apps/api/edith/bake/__init__.py` (import handler module)

**Interfaces:**
- Consumes: `register`, `BakeContext`, `bake` (Task 6), ops models (Task 3).
- Produces:
  - `edith.bake.util.rgb(hex: str) -> tuple[float, float, float]`, `edith.bake.util.to_rect(r: ops.Rect) -> pymupdf.Rect`.
  - Registered handlers: `whiteout.add`, `shape.add`, `ink.add`, `image.add` (phase `draw`), `redact.add` (phase `redact`).
  - Missing asset → `BakeFailed(op_id=...)` (via pipeline wrapper, because `ctx.asset_path` raises `AssetNotFound`).

- [ ] **Step 1: Failing tests**

`apps/api/tests/test_bake_draw.py`:
```python
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import AssetNotFound, BakeFailed
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22


@pytest.fixture
def ctx(tmp_path) -> BakeContext:
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


def pixel(page, x, y):
    pix = page.get_pixmap(clip=pymupdf.Rect(x, y, x + 1, y + 1))
    return pix.pixel(0, 0)


def test_whiteout_covers_but_keeps_text(ctx):
    out = bake(make_pdf(pages=1), ops({"id": "w", "type": "whiteout.add", "pageKey": "o0", "rect": R(60, 50, 120, 30)}), ctx)
    assert pixel(out[0], 75, 68) == (255, 255, 255)
    assert "Page 0" in out[0].get_text()


def test_redact_removes_text_and_line_art(ctx):
    src = pymupdf.open(stream=make_pdf(pages=1), filetype="pdf")
    src[0].draw_line((60, 65), (200, 65), color=(0, 0, 1), width=2)
    out = bake(src.tobytes(), ops({"id": "r", "type": "redact.add", "pageKey": "o0", "rect": R(60, 50, 120, 30), "fill": "black"}), ctx)
    assert "Page 0" not in out[0].get_text()
    assert pixel(out[0], 75, 68) == (0, 0, 0)
    assert not [d for d in out[0].get_drawings() if d.get("color") == (0.0, 0.0, 1.0)]


def test_rect_and_ellipse(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "a", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": R(100, 100, 50, 40), "stroke": "#ff0000", "fill": "#00ff00", "width": 2},
        {"id": "b", "type": "shape.add", "pageKey": "o0", "kind": "ellipse", "rect": R(200, 100, 50, 40), "stroke": "#0000ff", "fill": None, "width": 1},
    ), ctx)
    drawings = out[0].get_drawings()
    rect = next(d for d in drawings if d["color"] == (1.0, 0.0, 0.0))
    assert rect["fill"] == (0.0, 1.0, 0.0)
    assert rect["rect"] == pymupdf.Rect(100, 100, 150, 140)
    ellipse = next(d for d in drawings if d["color"] == (0.0, 0.0, 1.0))
    assert ellipse["fill"] is None
    assert any(item[0] == "c" for item in ellipse["items"])


def test_line_and_arrow(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "l", "type": "shape.add", "pageKey": "o0", "kind": "line", "points": [[10, 10], [110, 10]], "stroke": "#000000", "width": 3},
        {"id": "a", "type": "shape.add", "pageKey": "o0", "kind": "arrow", "points": [[10, 50], [110, 50]], "stroke": "#ff0000", "width": 2},
    ), ctx)
    red = [d for d in out[0].get_drawings() if d.get("color") == (1.0, 0.0, 0.0) or d.get("fill") == (1.0, 0.0, 0.0)]
    assert len(red) >= 2  # shaft + filled head
    assert pixel(out[0], 108, 50) != (255, 255, 255)


def test_ink(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "i", "type": "ink.add", "pageKey": "o0", "paths": [[[10, 10], [50, 50], [90, 10]], [[200, 200]]], "color": "#00ff00", "width": 4},
    ), ctx)
    greens = [d for d in out[0].get_drawings() if d.get("color") == (0.0, 1.0, 0.0) or d.get("fill") == (0.0, 1.0, 0.0)]
    assert len(greens) == 2  # polyline + dot


def test_image(ctx, tmp_path):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 10, 10), 0)
    pix.set_rect(pix.irect, (255, 0, 0))
    (tmp_path / "img1.png").write_bytes(pix.tobytes("png"))
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "m", "type": "image.add", "pageKey": "o0", "rect": R(100, 100, 80, 40), "assetId": "img1"},
    ), ctx)
    xref = out[0].get_images()[0][0]
    assert out[0].get_image_rects(xref)[0] == pymupdf.Rect(100, 100, 180, 140)


def test_missing_asset(ctx):
    with pytest.raises(BakeFailed) as e:
        bake(make_pdf(pages=1), ops({"id": "m", "type": "image.add", "pageKey": "o0", "rect": R(0, 0, 10, 10), "assetId": "nope"}), ctx)
    assert e.value.extra["op_id"] == "m"
```

Run: `cd apps/api && uv run pytest tests/test_bake_draw.py -q` → Expected: FAIL (`no handler`).

- [ ] **Step 2: Utilities**

`apps/api/edith/bake/util.py`:
```python
import pymupdf

from edith.ops import Rect


def rgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def to_rect(r: Rect) -> pymupdf.Rect:
    return pymupdf.Rect(r.x, r.y, r.x + r.w, r.y + r.h)
```

- [ ] **Step 3: Handlers**

`apps/api/edith/bake/draw.py`:
```python
import math

import pymupdf

from edith.bake.registry import register
from edith.bake.util import rgb, to_rect
from edith.ops import ImageAdd, InkAdd, RedactAdd, ShapeAdd, WhiteoutAdd


@register("whiteout.add")
def whiteout(page: pymupdf.Page, op: WhiteoutAdd, ctx) -> None:
    page.draw_rect(to_rect(op.rect), color=None, fill=(1, 1, 1), width=0, overlay=True)


@register("redact.add", phase="redact")
def redact(page: pymupdf.Page, op: RedactAdd, ctx) -> None:
    fill = (0, 0, 0) if op.fill == "black" else (1, 1, 1)
    page.add_redact_annot(to_rect(op.rect), fill=fill)


def _arrow_head(p1, p2, width: float):
    length = max(6.0, width * 4)
    angle = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    spread = math.radians(25)
    left = (p2[0] - length * math.cos(angle - spread), p2[1] - length * math.sin(angle - spread))
    right = (p2[0] - length * math.cos(angle + spread), p2[1] - length * math.sin(angle + spread))
    return [pymupdf.Point(left), pymupdf.Point(p2), pymupdf.Point(right)]


@register("shape.add")
def shape(page: pymupdf.Page, op: ShapeAdd, ctx) -> None:
    stroke = rgb(op.stroke) if op.width > 0 else None
    fill = rgb(op.fill) if op.fill else None
    if op.kind == "rect":
        page.draw_rect(to_rect(op.rect), color=stroke, fill=fill, width=op.width)
    elif op.kind == "ellipse":
        page.draw_oval(to_rect(op.rect), color=stroke, fill=fill, width=op.width)
    else:
        p1, p2 = op.points
        page.draw_line(pymupdf.Point(p1), pymupdf.Point(p2), color=rgb(op.stroke), width=max(op.width, 0.5), lineCap=1)
        if op.kind == "arrow":
            head = _arrow_head(p1, p2, op.width)
            page.draw_polyline(head, color=rgb(op.stroke), fill=rgb(op.stroke), width=0.5, closePath=True)


@register("ink.add")
def ink(page: pymupdf.Page, op: InkAdd, ctx) -> None:
    color = rgb(op.color)
    for path in op.paths:
        if len(path) == 1:
            page.draw_circle(pymupdf.Point(path[0]), op.width / 2, color=None, fill=color, width=0)
        else:
            page.draw_polyline([pymupdf.Point(p) for p in path], color=color, width=op.width,
                               lineCap=1, lineJoin=1, closePath=False)


@register("image.add")
def image(page: pymupdf.Page, op: ImageAdd, ctx) -> None:
    page.insert_image(to_rect(op.rect), filename=str(ctx.asset_path(op.assetId)), keep_proportion=False)
```

In `apps/api/edith/bake/__init__.py` replace the commented import line with:
```python
from edith.bake import draw  # noqa: F401,E402  (registers handlers)
```
Place it after the other imports.

Run: `cd apps/api && uv run pytest -q` → Expected: all pass. If `test_rect_and_ellipse` fails only on exact `rect` equality because of stroke-width padding, compare with `pymupdf.Rect(...)` using a 1.5 pt tolerance on each coordinate instead.

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): bake whiteout, redaction, shapes, ink and images

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
