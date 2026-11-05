# Task 6: Bake pipeline + `pages.layout`

**Files:**
- Create: `apps/api/edith/bake/__init__.py`, `apps/api/edith/bake/context.py`, `apps/api/edith/bake/registry.py`, `apps/api/edith/bake/pages.py`, `apps/api/tests/test_bake_pages.py`

**Interfaces:**
- Consumes: `edith.ops` models (Task 3), `edith.errors.InvalidOp`, `BakeFailed` (Task 4), `FontRegistry` (Task 2).
- Produces:
  - `edith.bake.context.BakeContext` dataclass: `doc_id: str`, `asset_path: Callable[[str], Path]`, `fonts: FontRegistry`.
  - `edith.bake.registry`: `Handler = Callable[[pymupdf.Page, op, BakeContext], None]`; `HANDLERS: dict[str, Handler]`; `PHASE: dict[str, str]` (`"redact"` or `"draw"`); decorator `register(op_type: str, phase: str = "draw")`.
  - `edith.bake.pages.build_pages(doc, layout: PagesLayout, layout_index: int, ctx) -> tuple[dict[str, int], list[int]]` — mutates `doc` to the final page order; returns `pageKey → page index` and each output page's base rotation.
  - `edith.bake.bake(source: bytes, ops: list[Op], ctx: BakeContext) -> pymupdf.Document` — the full pipeline. Later tasks only add handler modules and import them in `bake/__init__.py`.

Pipeline order (spec "Urutan bake", M1 subset):
1. Find the `pages.layout` op (default: every source page in order, keys `o{i}`, rotate 0).
2. Every content op's `pageKey` must be in the layout, else `InvalidOp(op_index=i)`.
3. `build_pages`. Duplicated sources use `doc.fullcopy_page` (repeated `select` indices share one page object).
4. For each output page: run `redact`-phase handlers for that page's ops, then `page.apply_redactions(images=PDF_REDACT_IMAGE_PIXELS, graphics=PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED, text=PDF_REDACT_TEXT_REMOVE)` once if any ran.
5. Run `draw`-phase handlers in original op order.
6. Set rotation `(base_rotation + entry.rotate) % 360` per page.
Any handler exception → `BakeFailed(str(exc), op_id=op.id)`. A missing handler → `BakeFailed("no handler", op_id=...)`.

- [ ] **Step 1: Failing tests**

`apps/api/tests/test_bake_pages.py`:
```python
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.bake.registry import HANDLERS, PHASE
from edith.errors import BakeFailed, InvalidOp
from edith.fonts import FontRegistry
from edith.ops import PagesLayout, WhiteoutAdd
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22


@pytest.fixture
def ctx(tmp_path) -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: tmp_path / a, fonts=FontRegistry(Settings().fonts_dir))


def texts(doc) -> list[str]:
    return [" ".join(p.get_text().split()) for p in doc]


def layout(*pages) -> PagesLayout:
    return PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": list(pages)})


def src(i, key=None, rotate=0):
    return {"pageKey": key or f"o{i}", "src": {"doc": DOC, "index": i}, "rotate": rotate}


def mark(key: str, op_id: str = "m") -> WhiteoutAdd:
    return WhiteoutAdd.model_validate({"id": op_id, "type": "whiteout.add", "pageKey": key, "rect": {"x": 0, "y": 0, "w": 1, "h": 1}})


@pytest.fixture
def marker(monkeypatch):
    """Replace the whiteout handler with one that writes MARK, so page tests stay independent of Task 7."""
    def handler(page, op, ctx):
        page.insert_text((72, 200), f"MARK-{op.id}", fontsize=12)
    monkeypatch.setitem(HANDLERS, "whiteout.add", handler)
    monkeypatch.setitem(PHASE, "whiteout.add", "draw")


def test_default_layout_keeps_pages(ctx):
    out = bake(make_pdf(pages=3), [], ctx)
    assert texts(out) == ["Page 0", "Page 1", "Page 2"]


def test_reorder_and_delete(ctx):
    out = bake(make_pdf(pages=3), [layout(src(2), src(0))], ctx)
    assert texts(out) == ["Page 2", "Page 0"]


def test_duplicate_pages_do_not_share_content(ctx, marker):
    ops = [layout(src(0), src(0, key="u-dup")), mark("u-dup")]
    out = bake(make_pdf(pages=1), ops, ctx)
    assert texts(out) == ["Page 0", "Page 0 MARK-m"]


def test_blank_page(ctx):
    ops = [layout(src(0), {"pageKey": "u-b", "src": {"blank": {"width": 300, "height": 400}}})]
    out = bake(make_pdf(pages=1), ops, ctx)
    assert out.page_count == 2
    assert (out[1].rect.width, out[1].rect.height) == (300, 400)
    assert texts(out)[1] == ""


def test_rotation_adds_to_source_rotation(ctx):
    out = bake(make_pdf(pages=2, rotation=90), [layout(src(0, rotate=90), src(1))], ctx)
    assert [p.rotation for p in out] == [180, 90]


def test_content_drawn_before_rotation_uses_unrotated_coords(ctx, marker):
    out = bake(make_pdf(pages=1), [layout(src(0, rotate=90)), mark("o0")], ctx)
    words = out[0].get_text("words")
    m = next(w for w in words if w[4] == "MARK-m")
    assert abs(m[0] - 72) < 1  # x in unrotated space is unchanged


def test_unknown_page_key(ctx, marker):
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), [layout(src(0)), mark("o5")], ctx)
    assert e.value.extra["op_index"] == 1


def test_deleted_page_ops_are_invalid(ctx, marker):
    with pytest.raises(InvalidOp):
        bake(make_pdf(pages=2), [layout(src(1)), mark("o0")], ctx)


def test_bad_source(ctx):
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), [layout(src(3))], ctx)
    assert e.value.extra["op_index"] == 0
    bad_doc = {"pageKey": "o0", "src": {"doc": "X" * 22, "index": 0}}
    with pytest.raises(InvalidOp):
        bake(make_pdf(pages=1), [layout(bad_doc)], ctx)


def test_handler_failure_reports_op_id(ctx, monkeypatch):
    def boom(page, op, ctx):
        raise RuntimeError("kaboom")
    monkeypatch.setitem(HANDLERS, "whiteout.add", boom)
    monkeypatch.setitem(PHASE, "whiteout.add", "draw")
    with pytest.raises(BakeFailed) as e:
        bake(make_pdf(pages=1), [mark("o0", op_id="bad")], ctx)
    assert e.value.extra["op_id"] == "bad"
```

Run: `cd apps/api && uv run pytest tests/test_bake_pages.py -q` → Expected: FAIL (import errors).

- [ ] **Step 2: Context + registry**

`apps/api/edith/bake/context.py`:
```python
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from edith.fonts import FontRegistry


@dataclass
class BakeContext:
    doc_id: str
    asset_path: Callable[[str], Path]
    fonts: FontRegistry
```

`apps/api/edith/bake/registry.py`:
```python
from typing import Any, Callable

import pymupdf

from edith.bake.context import BakeContext

Handler = Callable[[pymupdf.Page, Any, BakeContext], None]
HANDLERS: dict[str, Handler] = {}
PHASE: dict[str, str] = {}


def register(op_type: str, phase: str = "draw"):
    assert phase in ("redact", "draw")

    def deco(fn: Handler) -> Handler:
        HANDLERS[op_type] = fn
        PHASE[op_type] = phase
        return fn

    return deco
```

- [ ] **Step 3: Page builder**

`apps/api/edith/bake/pages.py`:
```python
import pymupdf

from edith.bake.context import BakeContext
from edith.errors import InvalidOp
from edith.ops import DocSrc, PagesLayout


def build_pages(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
                ctx: BakeContext) -> tuple[dict[str, int], list[int]]:
    source_count = doc.page_count
    seen: set[int] = set()
    selection: list[int] = []
    base_rotation: list[int] = []
    for entry in layout.pages:
        if isinstance(entry.src, DocSrc):
            if entry.src.doc != ctx.doc_id or entry.src.index >= source_count:
                raise InvalidOp(f"bad page source for {entry.pageKey}", op_index=layout_index)
            idx = entry.src.index
            base_rotation.append(doc[idx].rotation)
            if idx in seen:
                doc.fullcopy_page(idx)  # appended at the end, independent copy
                idx = doc.page_count - 1
            else:
                seen.add(idx)
        else:
            doc.new_page(-1, width=entry.src.blank.width, height=entry.src.blank.height)
            idx = doc.page_count - 1
            base_rotation.append(0)
        selection.append(idx)
    doc.select(selection)
    return {e.pageKey: i for i, e in enumerate(layout.pages)}, base_rotation
```

- [ ] **Step 4: Pipeline**

`apps/api/edith/bake/__init__.py`:
```python
from collections import defaultdict

import pymupdf

from edith.bake.context import BakeContext
from edith.bake.pages import build_pages
from edith.bake.registry import HANDLERS, PHASE
from edith.errors import BakeFailed, EdithError, InvalidOp
from edith.ops import DocSrc, LayoutPage, PagesLayout

# Handler modules register themselves on import (added by later tasks):
# from edith.bake import draw, text  # noqa: F401


def _default_layout(page_count: int, doc_id: str) -> PagesLayout:
    return PagesLayout(id="default", type="pages.layout", pages=[
        LayoutPage(pageKey=f"o{i}", src=DocSrc(doc=doc_id, index=i)) for i in range(page_count)
    ])


def _run(handler, page, op, ctx) -> None:
    try:
        handler(page, op, ctx)
    except EdithError as exc:
        raise BakeFailed(exc.message, op_id=op.id) from exc
    except Exception as exc:  # noqa: BLE001
        raise BakeFailed(str(exc), op_id=op.id) from exc


def bake(source: bytes, ops: list, ctx: BakeContext) -> pymupdf.Document:
    doc = pymupdf.open(stream=source, filetype="pdf")

    layout, layout_index = None, -1
    for i, op in enumerate(ops):
        if op.type == "pages.layout":
            layout, layout_index = op, i
    if layout is None:
        layout = _default_layout(doc.page_count, ctx.doc_id)

    keys = {p.pageKey for p in layout.pages}
    content = [(i, op) for i, op in enumerate(ops) if op.type != "pages.layout"]
    for i, op in content:
        if op.pageKey not in keys:
            raise InvalidOp(f"unknown pageKey {op.pageKey}", op_index=i)
        if op.type not in HANDLERS:
            raise BakeFailed(f"no handler for {op.type}", op_id=op.id)

    key_to_index, base_rotation = build_pages(doc, layout, layout_index, ctx)

    by_page: dict[int, list] = defaultdict(list)
    for _, op in content:
        by_page[key_to_index[op.pageKey]].append(op)

    for page_index, page_ops in by_page.items():
        page = doc[page_index]
        redactions = [op for op in page_ops if PHASE[op.type] == "redact"]
        for op in redactions:
            _run(HANDLERS[op.type], page, op, ctx)
        if redactions:
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                text=pymupdf.PDF_REDACT_TEXT_REMOVE,
            )
        for op in page_ops:
            if PHASE[op.type] == "draw":
                _run(HANDLERS[op.type], page, op, ctx)

    for i, entry in enumerate(layout.pages):
        doc[i].set_rotation((base_rotation[i] + entry.rotate) % 360)

    return doc
```

Run: `cd apps/api && uv run pytest tests/test_bake_pages.py -q` → Expected: `10 passed`.

If `test_content_drawn_before_rotation_uses_unrotated_coords` fails because the page object was re-fetched after rotation, keep the rotation step last (as above) and re-run.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add bake pipeline with page layout support

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
