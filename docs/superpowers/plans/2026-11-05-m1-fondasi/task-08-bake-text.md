# Task 8: `text.add` handler

**Files:**
- Create: `apps/api/edith/bake/text.py`, `apps/api/tests/test_bake_text.py`
- Modify: `apps/api/edith/bake/__init__.py` (import `text`)

**Interfaces:**
- Consumes: `register`, `rgb` (Tasks 6–7), `FontRegistry.font` (Task 2), `TextAdd`/`TextBox` (Task 3).
- Produces: registered `text.add` handler. Semantics: for every `LayoutLine` and `Segment`, draw `segment.text` with the segment's run font/size/color, glyph origin of the first char at `(box.rect.x + segment.x, box.rect.y + line.baseline)`. No kerning, no re-layout on the server. `box.rect.h` is ignored (layout is authoritative).

- [ ] **Step 1: Failing tests**

`apps/api/tests/test_bake_text.py`:
```python
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import BakeFailed
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22


@pytest.fixture
def fonts() -> FontRegistry:
    return FontRegistry(Settings().fonts_dir)


@pytest.fixture
def ctx(fonts) -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=fonts)


def run(text, family="Arimo", bold=False, italic=False, size=12, color="#000000"):
    return {"text": text, "font": {"kind": "bundled", "family": family, "bold": bold, "italic": italic}, "size": size, "color": color}


def text_op(runs, layout, x=100, y=200):
    return ExportRequest.model_validate({"ops": [{
        "id": "t", "type": "text.add", "pageKey": "o0",
        "box": {"rect": {"x": x, "y": y, "w": 300, "h": 50}, "align": "left", "lineHeight": 14.4,
                "paragraphs": [runs], "layout": layout},
    }]}).ops


def chars(page):
    out = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                for ch in span["chars"]:
                    out.append((ch["c"], ch["origin"], span["font"], span["color"], span["size"]))
    return out


def test_single_segment_position_font_color(ctx):
    ops = text_op([run("Halo", color="#ff0000", size=20)],
                  [{"baseline": 15, "segments": [{"x": 5, "text": "Halo", "runIndex": 0}]}])
    out = bake(make_pdf(pages=1, text=False), ops, ctx)
    cs = chars(out[0])
    assert "".join(c[0] for c in cs) == "Halo"
    c, origin, font, color, size = cs[0]
    assert origin == pytest.approx((105, 215), abs=0.01)
    assert "Arimo" in font
    assert color == 0xFF0000
    assert size == pytest.approx(20)


def test_no_kerning_advance_matches_registry(ctx, fonts):
    ops = text_op([run("AV", size=20)], [{"baseline": 15, "segments": [{"x": 0, "text": "AV", "runIndex": 0}]}])
    out = bake(make_pdf(pages=1, text=False), ops, ctx)
    (_, a, *_), (_, v, *_) = chars(out[0])
    assert v[0] - a[0] == pytest.approx(fonts.font("Arimo", False, False).text_length("A", fontsize=20), abs=0.01)


def test_multi_run_multi_line(ctx):
    runs = [run("Tebal ", bold=True), run("miring", family="Tinos", italic=True, color="#0000ff")]
    layout = [
        {"baseline": 12, "segments": [{"x": 0, "text": "Tebal ", "runIndex": 0}]},
        {"baseline": 26.4, "segments": [{"x": 0, "text": "miring", "runIndex": 1}]},
    ]
    out = bake(make_pdf(pages=1, text=False), text_op(runs, layout), ctx)
    cs = chars(out[0])
    t = next(c for c in cs if c[0] == "T")
    m = next(c for c in cs if c[0] == "m")
    assert "Bold" in t[2] and "Arimo" in t[2]
    assert "Tinos" in m[2] and "Italic" in m[2] and m[3] == 0x0000FF
    assert m[1][1] == pytest.approx(200 + 26.4, abs=0.01)


def test_unknown_family_fails_with_op_id(ctx):
    ops = text_op([run("x", family="Nope")], [{"baseline": 10, "segments": [{"x": 0, "text": "x", "runIndex": 0}]}])
    with pytest.raises(BakeFailed) as e:
        bake(make_pdf(pages=1), ops, ctx)
    assert e.value.extra["op_id"] == "t"
```

Run: `cd apps/api && uv run pytest tests/test_bake_text.py -q` → Expected: FAIL.

- [ ] **Step 2: Handler**

`apps/api/edith/bake/text.py`:
```python
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
```

Update the import in `apps/api/edith/bake/__init__.py`:
```python
from edith.bake import draw, text  # noqa: F401,E402  (registers handlers)
```

Run: `cd apps/api && uv run pytest -q` → Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api
git commit -m "feat(api): bake client-laid-out text boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
