# Task 2: Bake: signatures, stamps (vector + text), check/cross symbols

Drawn M3 content. A signature is an image asset like `image.add`. A stamp is a rounded border plus centred Arimo Bold text, drawn through `draw_text_box` (so it gets the ToUnicode fix and the PDF-quantized advances); its layout is computed from the rect alone by a shared formula that Task 7 mirrors in `apps/web/src/lib/stamps.ts` (both test suites pin the same numbers). Check/cross are stroked polylines (no font has to cover ✓/✗).

**Files:**
- Modify: `apps/api/edith/bake/__init__.py`
- Modify: `apps/api/edith/bake/draw.py`
- Create: `apps/api/edith/bake/stamps.py`
- Create: `apps/api/edith/bake/symbols.py`
- Create: `apps/api/tests/test_bake_marks.py`

**Interfaces:**
- Consumes: Task 1 `SignatureAdd`, `StampAdd`, `SymbolAdd`, `STAMP_PRESETS`; M2 `edith.bake.text.draw_text_box(page, TextBox, ctx)`, `quantized_width(font, text, size)`; M1 `register`, `rgb`, `to_rect`, `FontRegistry.font(family, bold, italic)`.
- Produces:
  - `edith.bake.stamps`: `STAMP_LABELS: dict[preset, label]`, `STAMP_FONT = BundledFont(family="Arimo", bold=True)`, constants `CAP_HEIGHT=0.688, BORDER=0.05, RADIUS=0.2, PAD=0.12, ONE_LINE_SIZE=0.5, LABEL_SIZE=0.36, SUB_SIZE=0.2, LABEL_BASELINE=0.5, SUB_BASELINE=0.78`; `StampLine(text, size, x, baseline)` (x/baseline relative to the rect); `stamp_texts(op) -> list[str]` (label, then `"date time"` when given); `border_width(w, h) = max(0.5, 0.05·min(w, h))`; `stamp_layout(w, h, texts, width_at_1pt) -> list[StampLine]`; handler `stamp.add`.
  - `edith.bake.symbols`: `SYMBOL_PATHS`, `SYMBOL_WIDTH = 0.12`, `symbol_paths(kind, rect) -> (paths, width)`; handler `symbol.add`.
  - `edith.bake.draw`: handler `signature.add` (PNG transparency kept).
  - Layout contract (Task 7 copies it): border = rect inset by bw/2, radius `0.2 × min(inner w, inner h)`; available width `w − 2·(0.12·h + bw)`; one line: size `min(0.5·h, avail/width₁)`, baseline `h/2 + 0.688·size/2`; two lines: sizes `min(0.36·h, …)` / `min(0.2·h, …)`, baselines `0.5·h` / `0.78·h`; every line centred: `x = (w − width₁·size)/2`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_bake_marks.py`:
```python
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.bake.stamps import STAMP_LABELS, border_width, stamp_layout
from edith.bake.symbols import symbol_paths
from edith.bake.text import quantized_width
from edith.errors import AssetNotFound
from edith.fonts import FontRegistry
from edith.ops import STAMP_PRESETS, ExportRequest, Rect
from edith.settings import Settings
from tests.pdfs import make_pdf, unrotated

DOC = "D" * 22


@pytest.fixture
def fonts() -> FontRegistry:
    return FontRegistry(Settings().fonts_dir)


@pytest.fixture
def ctx(tmp_path, fonts) -> BakeContext:
    def asset_path(asset_id: str):
        p = tmp_path / f"{asset_id}.png"
        if not p.exists():
            raise AssetNotFound()
        return p
    return BakeContext(doc_id=DOC, asset_path=asset_path, fonts=fonts)


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def pixel(page, x, y):
    return page.get_pixmap(clip=pymupdf.Rect(x, y, x + 1, y + 1)).pixel(0, 0)


def spans(page):
    return [s for b in page.get_text("dict")["blocks"] for line in b.get("lines", []) for s in line["spans"]]


def test_every_preset_has_a_label():
    assert set(STAMP_LABELS) == set(STAMP_PRESETS)


def test_stamp_layout_shared_numbers(fonts):
    """Same numbers as apps/web/src/lib/stamps.test.ts."""
    bold = fonts.font("Arimo", True, False)
    width = lambda t: quantized_width(bold, t, 1)  # noqa: E731
    [one] = stamp_layout(140, 40, ["APPROVED"], width)
    assert (one.size, round(one.x, 4), round(one.baseline, 4)) == (20.0, 13.93, 26.88)
    label, sub = stamp_layout(160, 54, ["DIPERIKSA", "05/11/2026 14:30"], width)
    assert (round(label.size, 4), round(label.x, 4), label.baseline) == (19.44, 27.1232, 27.0)
    assert (round(sub.size, 4), round(sub.x, 4), round(sub.baseline, 4)) == (10.8, 37.6856, 42.12)
    [narrow] = stamp_layout(120, 40, ["NOT FOR PUBLIC RELEASE"], width)  # shrunk to fit the width
    assert (round(narrow.size, 4), round(narrow.x, 4)) == (7.8897, 6.8)
    assert border_width(140, 40) == 2.0 and border_width(10, 4) == 0.5


def test_preset_stamp_text_and_border(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 200, 140, 40), "preset": "approved", "color": "#15803d"}), ctx)
    page = unrotated(out)
    [span] = spans(page)
    assert span["text"] == "APPROVED" and "Arimo" in span["font"] and "Bold" in span["font"]
    assert span["size"] == pytest.approx(20, abs=0.01)
    assert span["origin"][0] == pytest.approx(113.93, abs=0.01) and span["origin"][1] == pytest.approx(226.88, abs=0.01)
    assert span["color"] == 0x15803D
    [border] = [d for d in page.get_drawings() if d.get("color")]
    assert border["width"] == pytest.approx(2.0)
    assert tuple(border["rect"]) == pytest.approx((101, 201, 239, 239), abs=0.01)


def test_custom_stamp_with_date_and_time(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 300, 160, 54),
         "custom": {"text": "DIPERIKSA", "date": "05/11/2026", "time": "14:30"}, "color": "#1d4ed8"}), ctx)
    texts = {s["text"]: s for s in spans(unrotated(out))}
    assert set(texts) == {"DIPERIKSA", "05/11/2026 14:30"}  # spaces read back as U+0020 (ToUnicode fix)
    assert texts["05/11/2026 14:30"]["origin"][1] == pytest.approx(342.12, abs=0.01)


@pytest.mark.parametrize("rotation", [0, 90])
def test_stamp_on_rotated_cropped_page_is_crop_relative(ctx, rotation):
    out = bake(make_pdf(pages=1, text=False, rotation=rotation, crop=(30, 40, 565, 800)), ops(
        {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": R(100, 200, 140, 40), "preset": "void", "color": "#b91c1c"}), ctx)
    assert out[0].rotation == rotation
    [span] = spans(unrotated(out))
    assert span["origin"][1] == pytest.approx(226.88, abs=0.01)


def test_symbol_paths_shared_numbers():
    """Same numbers as apps/web/src/lib/symbols.test.ts."""
    paths, width = symbol_paths("check", Rect(x=10, y=20, w=50, h=40))
    assert paths == [[(16.0, 40.8), (30.0, 52.0), (54.0, 28.0)]] and width == pytest.approx(4.8)
    paths, _ = symbol_paths("cross", Rect(x=0, y=0, w=100, h=100))
    assert paths == [[(18.0, 18.0), (82.0, 82.0)], [(82.0, 18.0), (18.0, 82.0)]]


def test_check_and_cross_are_stroked_paths(ctx):
    out = bake(make_pdf(pages=1, text=False), ops(
        {"id": "c", "type": "symbol.add", "pageKey": "o0", "kind": "check", "rect": R(100, 100, 20, 20), "color": "#1d4ed8"},
        {"id": "x", "type": "symbol.add", "pageKey": "o0", "kind": "cross", "rect": R(200, 100, 20, 20), "color": "#b91c1c"}), ctx)
    drawings = unrotated(out).get_drawings()
    check = [d for d in drawings if d["color"] == pytest.approx((0x1D / 255, 0x4E / 255, 0xD8 / 255))]
    cross = [d for d in drawings if d["color"] == pytest.approx((0xB9 / 255, 0x1C / 255, 0x1C / 255))]
    assert len(check) == 1 and len(check[0]["items"]) == 2  # one polyline, two segments
    assert sum(len(d["items"]) for d in cross) == 2
    assert check[0]["width"] == pytest.approx(2.4)
    assert pixel(out[0], 108, 116)[2] > 150  # on the stroke near the check's bottom point: blue
    assert out[0].get_text() == ""  # vector art, no text


def test_signature_png_keeps_transparency(ctx, tmp_path):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 10), True)  # with alpha
    pix.set_rect(pymupdf.IRect(0, 0, 10, 10), (0, 0, 255, 255))  # left half opaque blue
    pix.set_rect(pymupdf.IRect(10, 0, 20, 10), (0, 0, 0, 0))  # right half fully transparent
    (tmp_path / "sig.png").write_bytes(pix.tobytes("png"))
    src = pymupdf.open(stream=make_pdf(pages=1, text=False), filetype="pdf")
    src[0].draw_rect(pymupdf.Rect(0, 0, 595, 842), color=None, fill=(1, 0, 0))  # red page
    out = bake(src.tobytes(), ops(
        {"id": "s", "type": "signature.add", "pageKey": "o0", "rect": R(100, 100, 200, 100), "assetId": "sig"}), ctx)
    assert pixel(out[0], 150, 150) == (0, 0, 255)  # opaque half
    assert pixel(out[0], 250, 150) == (255, 0, 0)  # transparent half shows the page
    assert len(out[0].get_images()) == 1
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest tests/test_bake_marks.py -q`
Expected: collection error — `ModuleNotFoundError: No module named 'edith.bake.stamps'`.

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/__init__.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -11,7 +11,7 @@ from edith.errors import BakeFailed, EdithError, InvalidOp
 from edith.ops import DocSrc, LayoutPage, PagesLayout
 
 # Handler modules register themselves on import (later tasks add more, e.g. text):
-from edith.bake import draw, text  # noqa: F401,E402  (registers handlers)
+from edith.bake import draw, stamps, symbols, text  # noqa: F401,E402  (registers handlers)
 
 # text.edit removes only the glyphs of the edited lines; images and vector art stay.
 TEXT_ONLY = dict(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
```

Modify `apps/api/edith/bake/draw.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/bake/draw.py
+++ b/apps/api/edith/bake/draw.py
@@ -4,7 +4,7 @@ import pymupdf
 
 from edith.bake.registry import register
 from edith.bake.util import rgb, to_rect
-from edith.ops import ImageAdd, InkAdd, RedactAdd, ShapeAdd, WhiteoutAdd
+from edith.ops import ImageAdd, InkAdd, RedactAdd, ShapeAdd, SignatureAdd, WhiteoutAdd
 
 
 @register("whiteout.add")
@@ -57,3 +57,9 @@ def ink(page: pymupdf.Page, op: InkAdd, ctx) -> None:
 @register("image.add")
 def image(page: pymupdf.Page, op: ImageAdd, ctx) -> None:
     page.insert_image(to_rect(op.rect), filename=str(ctx.asset_path(op.assetId)), keep_proportion=False)
+
+
+@register("signature.add")
+def signature(page: pymupdf.Page, op: SignatureAdd, ctx) -> None:
+    # Drawn, typed and uploaded signatures are all PNG/JPEG assets (a PNG keeps its transparency).
+    page.insert_image(to_rect(op.rect), filename=str(ctx.asset_path(op.assetId)), keep_proportion=False)
```

Create `apps/api/edith/bake/stamps.py`:
```python
"""Stamps: a rounded border plus centred label (and an optional date/time line), drawn as vector
art + text (spec: bake/stamps.py). The geometry is a shared contract with apps/web/src/lib/stamps.ts —
change both together."""
from dataclasses import dataclass
from typing import Callable

import pymupdf

from edith.bake.registry import register
from edith.bake.text import draw_text_box, quantized_width
from edith.bake.util import rgb
from edith.ops import BundledFont, LayoutLine, Rect, Run, Segment, StampAdd, TextBox

STAMP_LABELS = {
    "approved": "APPROVED", "not-approved": "NOT APPROVED", "draft": "DRAFT", "final": "FINAL",
    "completed": "COMPLETED", "confidential": "CONFIDENTIAL", "for-public-release": "FOR PUBLIC RELEASE",
    "not-for-public-release": "NOT FOR PUBLIC RELEASE", "for-comment": "FOR COMMENT", "void": "VOID",
    "preliminary-results": "PRELIMINARY RESULTS", "information-only": "INFORMATION ONLY", "witness": "WITNESS",
    "initial-here": "INITIAL HERE", "sign-here": "SIGN HERE", "accepted": "ACCEPTED", "rejected": "REJECTED",
}
STAMP_FONT = BundledFont(family="Arimo", bold=True)
CAP_HEIGHT = 0.688       # Arimo Bold sCapHeight / unitsPerEm (1409 / 2048)
BORDER = 0.05            # border width × the rect's shorter side (at least 0.5 pt)
RADIUS = 0.2             # corner radius × the shorter side of the border rect
PAD = 0.12               # horizontal padding × height, plus the border width
ONE_LINE_SIZE = 0.5      # label size × height (one line), shrunk to fit the width
LABEL_SIZE, SUB_SIZE = 0.36, 0.2           # two lines: label and date/time sizes × height
LABEL_BASELINE, SUB_BASELINE = 0.5, 0.78   # two lines: baselines × height from the top


@dataclass
class StampLine:
    text: str
    size: float
    x: float          # relative to the stamp rect
    baseline: float   # relative to the stamp rect


def stamp_texts(op: StampAdd) -> list[str]:
    """The label, then the date/time line (custom stamps that have one)."""
    if op.preset is not None:
        return [STAMP_LABELS[op.preset]]
    sub = " ".join(t for t in (op.custom.date, op.custom.time) if t)
    return [op.custom.text, sub] if sub else [op.custom.text]


def border_width(w: float, h: float) -> float:
    return max(0.5, BORDER * min(w, h))


def stamp_layout(w: float, h: float, texts: list[str], width_at_1pt: Callable[[str], float]) -> list[StampLine]:
    """Sizes and positions of the stamp's text lines in a `w` × `h` rect."""
    avail = max(w - 2 * (PAD * h + border_width(w, h)), 1.0)

    def fit(text: str, size: float) -> float:
        unit = width_at_1pt(text)
        return min(size, avail / unit) if unit > 0 else size

    if len(texts) == 1:
        s = fit(texts[0], ONE_LINE_SIZE * h)
        rows = [(texts[0], s, h / 2 + CAP_HEIGHT * s / 2)]
    else:
        rows = [(texts[0], fit(texts[0], LABEL_SIZE * h), LABEL_BASELINE * h),
                (texts[1], fit(texts[1], SUB_SIZE * h), SUB_BASELINE * h)]
    return [StampLine(text, s, (w - width_at_1pt(text) * s) / 2, baseline) for text, s, baseline in rows]


@register("stamp.add")
def stamp(page: pymupdf.Page, op: StampAdd, ctx) -> None:
    r = op.rect
    bw = border_width(r.w, r.h)
    inner = pymupdf.Rect(r.x + bw / 2, r.y + bw / 2, r.x + r.w - bw / 2, r.y + r.h - bw / 2)
    page.draw_rect(inner, color=rgb(op.color), fill=None, width=bw, radius=RADIUS)
    font = ctx.fonts.font(STAMP_FONT.family, STAMP_FONT.bold, STAMP_FONT.italic)
    lines = stamp_layout(r.w, r.h, stamp_texts(op), lambda t: quantized_width(font, t, 1))
    box = TextBox(
        rect=Rect(x=r.x, y=r.y, w=r.w, h=r.h), lineHeight=max(r.h, 1),
        paragraphs=[[Run(text=ln.text, font=STAMP_FONT, size=ln.size, color=op.color)] for ln in lines],
        layout=[LayoutLine(baseline=ln.baseline, segments=[Segment(x=ln.x, text=ln.text, runIndex=i)])
                for i, ln in enumerate(lines)],
    )
    draw_text_box(page, box, ctx)  # TextWriter + the ToUnicode fix
```

Create `apps/api/edith/bake/symbols.py`:
```python
"""Check (✓) and cross (✗) symbols as stroked vector paths — no font has to cover the glyphs.
Shared contract with apps/web/src/lib/symbols.ts: points in the unit square of the rect."""
import pymupdf

from edith.bake.registry import register
from edith.bake.util import rgb
from edith.ops import Rect, SymbolAdd

SYMBOL_PATHS = {
    "check": [[(0.12, 0.52), (0.4, 0.8), (0.88, 0.2)]],
    "cross": [[(0.18, 0.18), (0.82, 0.82)], [(0.82, 0.18), (0.18, 0.82)]],
}
SYMBOL_WIDTH = 0.12  # stroke width × the rect's shorter side


def symbol_paths(kind: str, r: Rect) -> tuple[list[list[tuple[float, float]]], float]:
    paths = [[(r.x + u * r.w, r.y + v * r.h) for u, v in path] for path in SYMBOL_PATHS[kind]]
    return paths, SYMBOL_WIDTH * min(r.w, r.h)


@register("symbol.add")
def symbol(page: pymupdf.Page, op: SymbolAdd, ctx) -> None:
    paths, width = symbol_paths(op.kind, op.rect)
    for path in paths:
        page.draw_polyline([pymupdf.Point(p) for p in path], color=rgb(op.color), width=max(width, 0.1),
                           lineCap=1, lineJoin=1, closePath=False)
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/api && uv run pytest tests/test_bake_marks.py -q`
Expected: `9 passed`.

- [ ] **Step 5: Full check**

Run: `cd apps/api && uv run pytest -q`
Expected: `271 passed`, no warnings summary.

- [ ] **Step 6: Commit**

```bash
git add apps/api/edith/bake/__init__.py apps/api/edith/bake/draw.py apps/api/edith/bake/stamps.py apps/api/edith/bake/symbols.py apps/api/tests/test_bake_marks.py
git commit -m "feat(api): bake signatures, vector stamps and check/cross symbols" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
