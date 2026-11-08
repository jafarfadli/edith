# Task 3: Bake: native text markup, sticky notes and links

Per page, after every drawn op: `annot.add` becomes a native Highlight/Underline/StrikeOut annotation over the given quads, or a Text (sticky note) annotation with MuPDF's 16 × 16 pt "Note" icon; then `link.add` becomes a `LINK_URI` or `LINK_GOTO` link, page targets resolved through the layout's `pageKey → output index`. Everything is added on the unrotated page, so it rotates with the page when the bake restores `/Rotate` (spec: Urutan bake 4–5). Also hoists the `redact_handlers` dict out of the page loop (M2 backlog, Task 7).

**Files:**
- Modify: `apps/api/edith/bake/__init__.py`
- Create: `apps/api/edith/bake/annots.py`
- Modify: `apps/api/edith/bake/context.py`
- Modify: `apps/api/edith/bake/registry.py`
- Create: `apps/api/tests/test_bake_annots.py`

**Interfaces:**
- Consumes: Task 1 `AnnotAdd`, `LinkAdd`, `PageTarget`; M1 `build_pages` (returns `key_to_index`), `register`.
- Produces:
  - `register(op_type, phase)` accepts phases `"annot"` and `"link"`; `bake()` runs per page: text redactions → redactions → `draw` → `annot` → `link`.
  - `BakeContext.page_index: dict[str, int] | None` (set by `bake()` after `build_pages`).
  - `edith.bake.annots`: handlers `annot.add` (phase annot; colors via `set_colors(stroke=…)`, MuPDF default `/BM /Multiply` for highlights; note content in `/Contents`) and `link.add` (phase link; `LINK_GOTO` with `to=(0, 0)`, `zoom=0`).
  - `bake()` raises `InvalidOp(op_index=i)` for a link whose target `pageKey` is not in the layout.

- [ ] **Step 1: Write the failing tests**

Spike facts these tests rely on: `Annot.vertices` lists each quad as top-left, top-right, bottom-left, bottom-right; `Page.get_links()` reports rects in the coordinates of the rotation the page was *loaded* with, so link positions are checked on a saved copy whose pages were un-rotated before reopening (`unrotated_doc`); an `Annot` read from a temporary `doc[i]` is unbound once the page object is gone, so `annots_of` copies the facts out while the page is alive.

Create `apps/api/tests/test_bake_annots.py`:
```python
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.errors import AssetNotFound, InvalidOp
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22


@pytest.fixture
def ctx() -> BakeContext:
    def asset_path(asset_id: str):
        raise AssetNotFound()
    return BakeContext(doc_id=DOC, asset_path=asset_path, fonts=FontRegistry(Settings().fonts_dir))


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def R(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def layout(*pages):
    return {"id": "L", "type": "pages.layout", "pages": [
        {"pageKey": key, "src": {"doc": DOC, "index": index}, "rotate": rotate} for key, index, rotate in pages]}


def markup(kind, quads, color="#ffeb3b", page_key="o0", op_id="m"):
    return {"id": op_id, "type": "annot.add", "pageKey": page_key, "kind": kind, "quads": quads, "color": color}


def reload(doc: pymupdf.Document) -> pymupdf.Document:
    return pymupdf.open(stream=doc.tobytes(), filetype="pdf")


def annots_of(page: pymupdf.Page) -> list[dict]:
    """Annotation facts, read while the page is alive (an Annot outlives its page only unbound)."""
    return [{"type": a.type[1], "vertices": [v for pt in a.vertices or [] for v in pt], "stroke": a.colors["stroke"], "rect": tuple(a.rect),
             "content": a.info["content"], "blendmode": a.blendmode} for a in page.annots()]


def corners(r: dict) -> list[float]:
    """QuadPoints in the order PyMuPDF reports them: top-left, top-right, bottom-left, bottom-right."""
    x0, y0, x1, y1 = r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]
    return [x0, y0, x1, y0, x0, y1, x1, y1]


def unrotated_doc(doc: pymupdf.Document) -> pymupdf.Document:
    """A saved and reopened copy without /Rotate on any page (Page.get_links() keeps the rotation the
    page was loaded with, so tests.pdfs.unrotated() is not enough for links)."""
    copy = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    for page in copy:
        page.set_rotation(0)
    return reload(copy)


def test_text_markup_kinds_quads_and_colors(ctx):
    q1, q2 = R(72, 61.2, 40, 13.8), R(72, 81.2, 25, 13.8)
    out = reload(bake(make_pdf(pages=1), ops(
        markup("highlight", [q1, q2], "#ffeb3b", op_id="h"),
        markup("underline", [q1], "#e11d48", op_id="u"),
        markup("strike", [q2], "#1d4ed8", op_id="s")), ctx))
    annots = {a["type"]: a for a in annots_of(out[0])}
    assert set(annots) == {"Highlight", "Underline", "StrikeOut"}
    hl = annots["Highlight"]
    assert hl["vertices"] == pytest.approx(corners(q1) + corners(q2), abs=0.01)
    assert hl["stroke"] == pytest.approx([1, 0xEB / 255, 0x3B / 255], abs=0.01)
    assert hl["blendmode"] == "Multiply"  # MuPDF's default: text under a highlight stays dark
    assert annots["Underline"]["stroke"] == pytest.approx([0xE1 / 255, 0x1D / 255, 0x48 / 255], abs=0.01)
    assert annots["StrikeOut"]["vertices"] == pytest.approx(corners(q2), abs=0.01)


def test_sticky_note(ctx):
    out = reload(bake(make_pdf(pages=1), ops({"id": "n", "type": "annot.add", "pageKey": "o0", "kind": "note",
                                               "point": [300, 400], "color": "#facc15", "content": "Periksa lagi"}), ctx))
    [note] = [a for a in annots_of(out[0]) if a["type"] != "Popup"]
    assert note["type"] == "Text" and note["content"] == "Periksa lagi"
    assert note["rect"] == pytest.approx((300, 400, 316, 416))
    assert note["stroke"] == pytest.approx([0xFA / 255, 0xCC / 255, 0x15 / 255], abs=0.01)


def test_annotations_cover_drawn_content(ctx):
    """Annotations come after every drawn op, whatever the op order (spec: Urutan bake 4 → 5)."""
    out = bake(make_pdf(pages=1, text=False), ops(
        markup("highlight", [R(100, 100, 50, 20)], "#ffeb3b"),
        {"id": "w", "type": "whiteout.add", "pageKey": "o0", "rect": R(90, 90, 80, 40)}), ctx)
    pix = out[0].get_pixmap(clip=pymupdf.Rect(120, 110, 121, 111))
    assert pix.pixel(0, 0) == (255, 235, 59)  # yellow over the white box


@pytest.mark.parametrize("rotation", [0, 90, 270])
def test_markup_on_rotated_cropped_page_stays_on_its_text(ctx, rotation):
    q = R(72, 61.2, 40, 13.8)
    out = bake(make_pdf(pages=1, rotation=rotation, crop=(30, 40, 565, 800)), ops(markup("highlight", [q])), ctx)
    assert out[0].rotation == rotation
    [hl] = annots_of(unrotated_doc(out)[0])
    assert hl["vertices"] == pytest.approx(corners(q), abs=0.01)


def links(page: pymupdf.Page) -> list[dict]:
    return page.get_links()


def test_link_to_page_follows_the_layout(ctx):
    """Page targets resolve to output indexes: o2 is the first output page here."""
    out = reload(bake(make_pdf(pages=3), ops(
        layout(("o2", 2, 0), ("o0", 0, 0), ("o1", 1, 0)),
        {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"pageKey": "o2"}},
        {"id": "b", "type": "link.add", "pageKey": "o0", "rect": R(72, 130, 100, 20), "target": {"pageKey": "o1"}},
        {"id": "c", "type": "link.add", "pageKey": "o0", "rect": R(72, 160, 100, 20), "target": {"url": "https://example.com/a?b=1"}}), ctx))
    got = links(out[1])
    assert [(ln["kind"], ln.get("page"), ln.get("uri")) for ln in got] == [
        (pymupdf.LINK_GOTO, 0, None), (pymupdf.LINK_GOTO, 2, None), (pymupdf.LINK_URI, None, "https://example.com/a?b=1")]
    assert tuple(got[0]["from"]) == pytest.approx((72, 100, 172, 120))
    assert "Page 2" in out[0].get_text()


@pytest.mark.parametrize("rotation", [0, 90])
def test_link_on_rotated_cropped_page_is_crop_relative(ctx, rotation):
    out = bake(make_pdf(pages=2, rotation=rotation, crop=(30, 40, 565, 800)), ops(
        {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"pageKey": "o1"}}), ctx)
    [ln] = links(unrotated_doc(out)[0])
    assert tuple(ln["from"]) == pytest.approx((72, 100, 172, 120), abs=0.01)
    assert ln["page"] == 1


def test_link_rotates_with_its_page(ctx):
    out = reload(bake(make_pdf(pages=1), ops(
        layout(("o0", 0, 90)),
        {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"url": "https://a.b"}}), ctx))
    [ln] = links(out[0])  # rotated page coordinates: x = H − y
    assert tuple(ln["from"]) == pytest.approx((842 - 120, 72, 842 - 100, 172), abs=0.01)


def test_link_to_unknown_page_is_invalid(ctx):
    with pytest.raises(InvalidOp) as err:
        bake(make_pdf(pages=2), ops(
            layout(("o0", 0, 0)),
            {"id": "a", "type": "link.add", "pageKey": "o0", "rect": R(72, 100, 100, 20), "target": {"pageKey": "o1"}}), ctx)
    assert err.value.extra["op_index"] == 1
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest tests/test_bake_annots.py -q`
Expected: `11 failed` — `BakeFailed: no handler for annot.add` / `no handler for link.add`.

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/__init__.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -8,10 +8,10 @@ from edith.bake.pages import build_pages
 from edith.bake.registry import HANDLERS, PHASE, TEXT_REDACTIONS
 from edith.bake.source import SourcePages
 from edith.errors import BakeFailed, EdithError, InvalidOp
-from edith.ops import DocSrc, LayoutPage, PagesLayout
+from edith.ops import DocSrc, LayoutPage, PageTarget, PagesLayout
 
 # Handler modules register themselves on import (later tasks add more, e.g. text):
-from edith.bake import draw, stamps, symbols, text  # noqa: F401,E402  (registers handlers)
+from edith.bake import annots, draw, stamps, symbols, text  # noqa: F401,E402  (registers handlers)
 
 # text.edit removes only the glyphs of the edited lines; images and vector art stay.
 TEXT_ONLY = dict(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
@@ -66,26 +66,31 @@ def bake(source: bytes, ops: list, ctx: BakeContext) -> pymupdf.Document:
                 raise BakeFailed(f"no handler for {op.type}", op_id=op.id)
             if op.type == "text.edit" and pages_src.paragraph(op.pageKey, op.paragraphId) is None:
                 raise InvalidOp(f"no paragraph {op.paragraphId} on {op.pageKey}", op_index=i)
+            if op.type == "link.add" and isinstance(op.target, PageTarget) and op.target.pageKey not in keys:
+                raise InvalidOp(f"link to unknown pageKey {op.target.pageKey}", op_index=i)
 
         key_to_index, base_rotation = build_pages(doc, layout, layout_index, ctx)
+        ctx = replace(ctx, page_index=key_to_index)
 
         by_page: dict[int, list] = defaultdict(list)
         for _, op in content:
             by_page[key_to_index[op.pageKey]].append(op)
 
+        redact_handlers = {t: HANDLERS[t] for t, phase in PHASE.items() if phase == "redact"}
         for page_index, page_ops in by_page.items():
             page = doc[page_index]
             # Two passes: one apply_redactions() call has a single images/graphics mode.
-            redact_handlers = {t: HANDLERS[t] for t, phase in PHASE.items() if phase == "redact"}
             for handlers, mode in ((TEXT_REDACTIONS, TEXT_ONLY), (redact_handlers, EVERYTHING)):
                 marked = [op for op in page_ops if op.type in handlers]
                 for op in marked:
                     _run(handlers[op.type], page, op, ctx)
                 if marked:
                     page.apply_redactions(**mode)
-            for op in page_ops:
-                if PHASE[op.type] == "draw":
-                    _run(HANDLERS[op.type], page, op, ctx)
+            # Drawn content in stacking order, then native annotations over it, then links.
+            for phase in ("draw", "annot", "link"):
+                for op in page_ops:
+                    if PHASE[op.type] == phase:
+                        _run(HANDLERS[op.type], page, op, ctx)
 
         for i, entry in enumerate(layout.pages):
             doc[i].set_rotation((base_rotation[i] + entry.rotate) % 360)
```

Create `apps/api/edith/bake/annots.py`:
```python
"""Native PDF annotations (text markup, sticky notes) and links — added after the drawn content, on
the unrotated page, so they rotate with the page when bake() restores its rotation."""
import pymupdf

from edith.bake.registry import register
from edith.bake.util import rgb, to_rect
from edith.ops import AnnotAdd, LinkAdd, PageTarget

_MARKUP = {
    "highlight": pymupdf.Page.add_highlight_annot,
    "underline": pymupdf.Page.add_underline_annot,
    "strike": pymupdf.Page.add_strikeout_annot,
}
NOTE_ICON = "Note"  # MuPDF draws it 16 × 16 pt with its top-left corner at the point


@register("annot.add", phase="annot")
def annot(page: pymupdf.Page, op: AnnotAdd, ctx) -> None:
    if op.kind == "note":
        a = page.add_text_annot(pymupdf.Point(op.point), op.content or "", icon=NOTE_ICON)
    else:
        a = _MARKUP[op.kind](page, quads=[to_rect(q).quad for q in op.quads])
        if op.content:
            a.set_info(content=op.content)
    a.set_colors(stroke=rgb(op.color))
    a.update()


@register("link.add", phase="link")
def link(page: pymupdf.Page, op: LinkAdd, ctx) -> None:
    if isinstance(op.target, PageTarget):
        target = ctx.page_index[op.target.pageKey]
        page.insert_link({"kind": pymupdf.LINK_GOTO, "from": to_rect(op.rect), "page": target,
                          "to": pymupdf.Point(0, 0), "zoom": 0})
    else:
        page.insert_link({"kind": pymupdf.LINK_URI, "from": to_rect(op.rect), "uri": op.target.url})
```

Modify `apps/api/edith/bake/context.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/bake/context.py
+++ b/apps/api/edith/bake/context.py
@@ -14,3 +14,4 @@ class BakeContext:
     asset_path: Callable[[str], Path]
     fonts: FontRegistry
     source: "SourcePages | None" = None  # set by bake() for the duration of one bake
+    page_index: dict[str, int] | None = None  # pageKey → output page index, set by bake() (links)
```

Modify `apps/api/edith/bake/registry.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/bake/registry.py
+++ b/apps/api/edith/bake/registry.py
@@ -12,9 +12,11 @@ TEXT_REDACTIONS: dict[str, Handler] = {}
 
 
 def register(op_type: str, phase: str = "draw"):
-    """phase "draw" or "redact": the op's main handler. phase "redact_text": an extra handler that
-    marks text for the text-only redaction pass (an op type may have both)."""
-    assert phase in ("redact_text", "redact", "draw")
+    """phase "redact", "draw", "annot" or "link": the op's main handler; per page, bake() runs the
+    redactions, then the drawn content, then native annotations, then links (spec: Urutan bake).
+    phase "redact_text": an extra handler that marks text for the text-only redaction pass (an op
+    type may have both)."""
+    assert phase in ("redact_text", "redact", "draw", "annot", "link")
 
     def deco(fn: Handler) -> Handler:
         if phase == "redact_text":
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/api && uv run pytest tests/test_bake_annots.py -q`
Expected: `11 passed`.

- [ ] **Step 5: Full check**

Run: `cd apps/api && uv run pytest -q`
Expected: `282 passed`, no warnings summary.

- [ ] **Step 6: Commit**

```bash
git add apps/api/edith/bake/__init__.py apps/api/edith/bake/annots.py apps/api/edith/bake/context.py apps/api/edith/bake/registry.py apps/api/tests/test_bake_annots.py
git commit -m "feat(api): bake native text markup, sticky notes and links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
