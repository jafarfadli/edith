# Task 5: Bake crop last

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 4 leaves, new files are complete.

**Goal:** A layout page's `crop` (page coordinates) becomes its CropBox after everything else (spec Urutan bake 7): `set_cropbox(crop + original CropBox origin)` in MediaBox coordinates, then the rotation. Content does not move.

**Files:**
- Modify: `apps/api/edith/bake/__init__.py`
- Create: `apps/api/tests/test_bake_crop.py`

**Interfaces:**
- Consumes: Task 1 `LayoutPage.crop`.
- Produces:
- `_crop_rect(page, crop, layout_index)` in `bake/__init__.py`; a crop past the page (more than 0.01 pt) → `invalid_op`; within the slack it is clamped. `render-page` shows the crop for free.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_bake_crop.py`:

```python
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import InvalidOp
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf, unrotated

DOC = "D" * 22


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: a, fonts=FontRegistry(Settings().fonts_dir))


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def layout(*pages) -> dict:
    return {"id": "L", "type": "pages.layout", "pages": list(pages)}


def page(key: str, index: int, crop=None, rotate=0) -> dict:
    out = {"pageKey": key, "src": {"doc": DOC, "index": index}, "rotate": rotate}
    if crop:
        out["crop"] = dict(zip("xywh", crop))
    return out


def word(p: pymupdf.Page, text: str):
    return next(w for w in p.get_text("words") if w[4] == text)


def reopened(out) -> pymupdf.Document:
    return pymupdf.open(stream=out.tobytes(), filetype="pdf")


@pytest.mark.parametrize("source_crop", [None, (50, 40, 545, 800)], ids=["mediabox", "cropbox-offset"])
def test_crop_keeps_content_in_place(ctx, source_crop):
    rect = {"x": 100, "y": 150, "w": 50, "h": 20}
    out = reopened(bake(make_pdf(pages=1, crop=source_crop), ops(
        layout(page("o0", 0, crop=(60, 40, 200, 300))),
        {"id": "w", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": rect, "stroke": "#ff0000", "width": 1},
        {"id": "l", "type": "link.add", "pageKey": "o0", "rect": rect, "target": {"url": "https://a.b"}}), ctx))
    p = out[0]
    assert (p.rect.width, p.rect.height) == (200, 300)
    before = word(bake(make_pdf(pages=1, crop=source_crop), [], ctx)[0], "Page")
    assert word(p, "Page")[:2] == pytest.approx((before[0] - 60, before[1] - 40), abs=0.01)
    (d,) = [d for d in p.get_drawings() if d.get("color") == (1.0, 0.0, 0.0)]
    assert tuple(d["rect"]) == pytest.approx((40, 110, 90, 130), abs=0.6)  # content moved by the crop origin only
    assert tuple(p.get_links()[0]["from"]) == pytest.approx((40, 110, 90, 130), abs=0.01)


def test_crop_then_rotate(ctx):
    out = reopened(bake(make_pdf(pages=1), ops(layout(page("o0", 0, crop=(60, 40, 200, 300), rotate=90))), ctx))
    p = out[0]
    assert p.rotation == 90 and (p.rect.width, p.rect.height) == (300, 200)
    q = unrotated(out)
    assert round(word(q, "Page")[0]) == 12


def test_duplicates_crop_independently(ctx):
    out = reopened(bake(make_pdf(pages=1), ops(layout(page("o0", 0, crop=(0, 0, 100, 100)), page("u-d", 0))), ctx))
    assert [(p.rect.width, p.rect.height) for p in out] == [(100, 100), (595, 842)]


def test_crop_past_the_page_is_invalid(ctx):
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), ops(layout(page("o0", 0, crop=(500, 0, 200, 100)))), ctx)
    assert e.value.extra["op_index"] == 0


def test_crop_overshoot_within_slack_is_clamped(ctx):
    out = bake(make_pdf(pages=1), ops(layout(page("o0", 0, crop=(495, 742, 100.005, 100.005)))), ctx)
    assert (out[0].rect.width, out[0].rect.height) == pytest.approx((100, 100))


def test_crop_on_blank_page(ctx):
    blank = {"pageKey": "u-b", "src": {"blank": {"width": 300, "height": 300}}, "crop": {"x": 10, "y": 10, "w": 100, "h": 50}}
    out = bake(make_pdf(pages=1), ops(layout(page("o0", 0), blank)), ctx)
    assert (out[1].rect.width, out[1].rect.height) == (100, 50)
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_bake_crop.py`
Expected: FAIL: cropped page keeps its full size (`(595.0, 842.0) != (200, 300)`)

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/__init__.py`:

```diff
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -41,6 +41,18 @@ def _run(handler, page, op, ctx) -> None:
         raise BakeFailed(str(exc), op_id=op.id) from exc
 
 
+CROP_SLACK = 0.01  # pt: a crop this far past the page edge is clamped, not rejected
+
+
+def _crop_rect(page: pymupdf.Page, crop, layout_index: int) -> pymupdf.Rect:
+    """A layout crop (page coordinates of the unrotated page) as a rect inside the page."""
+    r = pymupdf.Rect(crop.x, crop.y, crop.x + crop.w, crop.y + crop.h)
+    bounds = page.rect
+    if r.x1 > bounds.x1 + CROP_SLACK or r.y1 > bounds.y1 + CROP_SLACK:
+        raise InvalidOp("crop outside the page", op_index=layout_index)
+    return r & bounds
+
+
 def _fill(doc: pymupdf.Document, forms: list, flatten: bool, widgets_removed: bool) -> None:
     if forms or flatten or widgets_removed:
         drop_xfa(doc)
@@ -89,6 +101,7 @@ def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False
 
         key_to_index, base_rotation = build_pages(doc, layout, layout_index, ctx)
         ctx = replace(ctx, page_index=key_to_index)
+        crops = [_crop_rect(doc[i], entry.crop, layout_index) if entry.crop else None for i, entry in enumerate(layout.pages)]
 
         by_page: dict[int, list] = defaultdict(list)
         for _, op in content:
@@ -120,7 +133,11 @@ def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False
 
         _fill(doc, [op for op in ops if op.type == "form.set"], flatten_forms, widgets_removed)
 
+        # Crop and rotation last: neither moves the content (spec: Urutan bake 7).
         for i, entry in enumerate(layout.pages):
+            if crops[i] is not None:
+                cb = doc[i].cropbox  # MediaBox coordinates, top-left origin
+                doc[i].set_cropbox(crops[i] + (cb.x0, cb.y0, cb.x0, cb.y0))
             doc[i].set_rotation((base_rotation[i] + entry.rotate) % 360)
         return doc
     except BaseException:
```


- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q`
Expected: 353 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/bake/__init__.py apps/api/tests/test_bake_crop.py
git commit -m "feat(api): crop pages at export" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
