# Task 7: Bake `text.edit` — text-only redaction pass, then draw

**Files:**
- Modify: `apps/api/edith/bake/registry.py` (rewrite), `apps/api/edith/bake/text.py`, `apps/api/edith/bake/__init__.py`, `apps/api/tests/test_export.py`
- Create: `apps/api/tests/test_bake_text_edit.py`

**Interfaces:**
- Consumes: Task 6 `SourcePages.paragraph`, `draw_text_box`; Task 2 `TextEdit`; Task 4 fixture `make_edit_pdf`; Task 3 fixtures.
- Produces:
  - `edith.bake.registry`: `register(op_type, phase)` accepts `"redact_text"` in addition to `"redact"`/`"draw"`; `TEXT_REDACTIONS: dict[str, Handler]` holds the text-only redaction handlers (an op type can have one there *and* a main handler in `HANDLERS`/`PHASE`, which keep their M1 meaning).
  - `edith.bake.text`: `REDACT_BAND = 0.3`; `redaction_rects(paragraph: dict) -> list[pymupdf.Rect]` (per original line a 1 pt band centred at `baseline − 0.3·size`, inset 0.5 pt left/right); handlers `text.edit` (phase `redact_text`: `add_redact_annot(rect, fill=False)` per band) and `text.edit` (phase `draw`: `draw_text_box`).
  - `bake()` per page: pass 1 = `TEXT_REDACTIONS` handlers + `apply_redactions(images=NONE, graphics=LINE_ART_NONE, text=REMOVE)`; pass 2 = `redact` phase handlers (`redact.add`) + M1's `apply_redactions(PIXELS, REMOVE_IF_TOUCHED, REMOVE)`; then draw handlers in op order. Validation raises `InvalidOp(op_index=i)` with message `no paragraph <id> on <pageKey>` when a `text.edit` names a paragraph the source page doesn't have (incl. blank pages).

- [ ] **Step 1: Failing tests**

`apps/api/tests/test_bake_text_edit.py`:
```python
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.doc_fonts import collect_fonts
from edith.errors import InvalidOp
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import SUBSET_TTF, make_edit_pdf, make_fonts_pdf

DOC = "D" * 22
ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=FontRegistry(Settings().fonts_dir))


def edit(paragraph_id="g0", text="Teks baru", font=ARIMO, page_key="o0", x=72, y=88, baseline=12.0, op_id="e"):
    runs = [{"text": text, "font": font, "size": 12, "color": "#000000"}]
    layout = [{"baseline": baseline, "segments": [{"x": 0, "text": text, "runIndex": 0}]}] if text else []
    return {"id": op_id, "type": "text.edit", "pageKey": page_key, "paragraphId": paragraph_id,
            "box": {"rect": {"x": x, "y": y, "w": 300, "h": 16}, "align": "left", "lineHeight": 12,
                    "paragraphs": [runs], "layout": layout}}


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def reload(doc: pymupdf.Document) -> pymupdf.Document:
    return pymupdf.open(stream=doc.tobytes(garbage=3, deflate=True), filetype="pdf")


def text(page) -> str:
    return " ".join(page.get_text("text").split())


def spans(page):
    return [s for b in page.get_text("dict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"]]


def test_replaces_only_the_paragraph_and_keeps_graphics(ctx):
    out = reload(bake(make_edit_pdf(), ops(edit()), ctx))
    t = text(out[0])
    assert "Paragraf yang diedit" not in t and "baris dua." not in t
    assert "Teks baru" in t
    assert "Paragraf tetangga tetap utuh di sini sampai akhir." in t  # neighbours at 1.0× leading survive
    drawings = out[0].get_drawings()
    assert any(d["color"] == (1.0, 0.0, 0.0) for d in drawings)  # the red line under the paragraph
    assert len(out[0].get_images()) == 1
    assert out[0].get_pixmap(clip=pymupdf.Rect(320, 100, 321, 101)).pixel(0, 0) == (0, 0, 255)


def test_new_baseline_matches_layout(ctx):
    out = reload(bake(make_edit_pdf(), ops(edit(x=72, y=88, baseline=12.0)), ctx))
    span = next(s for s in spans(out[0]) if s["text"].startswith("Teks baru"))
    assert span["origin"] == pytest.approx((72, 100), abs=0.5)
    assert "Arimo" in span["font"]


def test_redact_add_still_removes_pixels_after_text_edit(ctx):
    redact = {"id": "r", "type": "redact.add", "pageKey": "o0", "rect": {"x": 295, "y": 85, "w": 50, "h": 35}, "fill": "black"}
    out = reload(bake(make_edit_pdf(), ops(edit(), redact), ctx))
    assert "Teks baru" in text(out[0])
    assert out[0].get_pixmap(clip=pymupdf.Rect(320, 100, 321, 101)).pixel(0, 0) == (0, 0, 0)


def test_empty_box_deletes_the_paragraph(ctx):
    out = reload(bake(make_edit_pdf(), ops(edit(text="")), ctx))
    t = text(out[0])
    assert "diedit" not in t
    assert "Paragraf tetangga tetap utuh" in t
    # The redaction band painted nothing: the red line still shows where the band crossed it.
    pix = out[0].get_pixmap(dpi=288, clip=pymupdf.Rect(79, 95, 81, 98))
    assert pix.pixel(pix.width // 2, pix.height // 2) == (255, 0, 0)


def test_duplicate_page_edits_only_the_copy(ctx):
    layout = {"id": "L", "type": "pages.layout", "pages": [
        {"pageKey": "o0", "src": {"doc": DOC, "index": 0}},
        {"pageKey": "u-dup", "src": {"doc": DOC, "index": 0}},
    ]}
    out = reload(bake(make_edit_pdf(), ops(layout, edit(page_key="u-dup")), ctx))
    assert "Paragraf yang diedit" in text(out[0]) and "Teks baru" not in text(out[0])
    assert "Paragraf yang diedit" not in text(out[1]) and "Teks baru" in text(out[1])


def test_unknown_paragraph_is_invalid_op(ctx):
    with pytest.raises(InvalidOp) as e:
        bake(make_edit_pdf(), ops(edit(paragraph_id="g99")), ctx)
    assert e.value.extra["op_index"] == 0


def test_blank_page_has_no_paragraphs(ctx):
    layout = {"id": "L", "type": "pages.layout", "pages": [{"pageKey": "u-b", "src": {"blank": {"width": 100, "height": 100}}}]}
    with pytest.raises(InvalidOp):
        bake(make_edit_pdf(), ops(layout, edit(page_key="u-b")), ctx)


def test_original_subset_font_is_reused(ctx):
    data = make_fonts_pdf()
    ref = next(f.ref for f in collect_fonts(pymupdf.open(stream=data, filetype="pdf")).values() if f.name == "Tinos Regular")
    out = reload(bake(data, ops(edit(paragraph_id="g3", text="lorem dolor", font={"kind": "original", "ref": ref}, y=208)), ctx))
    assert "Subset lorem ipsum" not in text(out[0])
    span = next(s for s in spans(out[0]) if s["text"] == "lorem dolor")
    assert "Tinos" in span["font"]
    sizes = {len(out.extract_font(x[0])[3]) for x in out[0].get_fonts(full=True)}
    assert len(SUBSET_TTF.read_bytes()) in sizes  # the 8 KB subset, not the 500 KB bundled Tinos
```

Append to `apps/api/tests/test_export.py`:
```python


def test_export_text_edit(client):
    from tests.pdfs import make_edit_pdf
    doc_id = client.post("/documents", files={"file": ("e.pdf", make_edit_pdf(), "application/pdf")}).json()["doc_id"]
    run = {"text": "Diganti", "font": {"kind": "bundled", "family": "Arimo"}, "size": 12, "color": "#000000"}
    edit = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0", "box": {
        "rect": R(72, 88, 300, 16), "lineHeight": 12, "paragraphs": [[run]],
        "layout": [{"baseline": 12, "segments": [{"x": 0, "text": "Diganti", "runIndex": 0}]}]}}
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [edit]})
    assert r.status_code == 200, r.text
    text = pymupdf.open(stream=r.content, filetype="pdf")[0].get_text()
    assert "Diganti" in text and "diedit" not in text and "tetangga" in text
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [{**edit, "paragraphId": "g9"}]})
    assert r.status_code == 422 and r.json()["error"] == {"code": "invalid_op", "message": "no paragraph g9 on o0", "op_index": 0}
```

Run: `cd apps/api && uv run pytest tests/test_bake_text_edit.py tests/test_export.py -q`
Expected: FAIL — `BakeFailed: no handler for text.edit` (and the export test gets `500 bake_failed`).

- [ ] **Step 2: Registry with a text-only redaction phase**

`apps/api/edith/bake/registry.py` (replace):
```python
from typing import Any, Callable

import pymupdf

from edith.bake.context import BakeContext

Handler = Callable[[pymupdf.Page, Any, BakeContext], None]
HANDLERS: dict[str, Handler] = {}
PHASE: dict[str, str] = {}
# Handlers of the text-only redaction pass, which runs before the "redact" pass (see bake()).
TEXT_REDACTIONS: dict[str, Handler] = {}


def register(op_type: str, phase: str = "draw"):
    """phase "draw" or "redact": the op's main handler. phase "redact_text": an extra handler that
    marks text for the text-only redaction pass (an op type may have both)."""
    assert phase in ("redact_text", "redact", "draw")

    def deco(fn: Handler) -> Handler:
        if phase == "redact_text":
            TEXT_REDACTIONS[op_type] = fn
        else:
            HANDLERS[op_type] = fn
            PHASE[op_type] = phase
        return fn

    return deco
```

- [ ] **Step 3: `text.edit` handlers**

In `apps/api/edith/bake/text.py`:
- Import `TextEdit` too: `from edith.ops import Run, TextAdd, TextBox, TextEdit`.
- After `DECOR_THICKNESS = 0.06` add:
```python
# text.edit redaction: a 1 pt band this far above each original baseline (× size) hits every glyph
# of the line but not the lines above/below (MuPDF removes glyphs whose box touches the redaction).
REDACT_BAND = 0.3
```
- Append:
```python


def redaction_rects(paragraph: dict) -> list[pymupdf.Rect]:
    """One thin band per original line of `paragraph` (see REDACT_BAND)."""
    out = []
    for line in paragraph["lines"]:
        r = line["rect"]
        y = line["baseline"] - REDACT_BAND * line["size"]
        inset = 0.5 if r["w"] > 2 else 0
        out.append(pymupdf.Rect(r["x"] + inset, y - 0.5, r["x"] + r["w"] - inset, y + 0.5))
    return out


@register("text.edit", phase="redact_text")
def text_edit_redact(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    paragraph = ctx.source.paragraph(op.pageKey, op.paragraphId)
    for rect in redaction_rects(paragraph):
        page.add_redact_annot(rect, fill=False)  # fill=False: paint nothing over what stays


@register("text.edit")
def text_edit(page: pymupdf.Page, op: TextEdit, ctx) -> None:
    draw_text_box(page, op.box, ctx)
```

- [ ] **Step 4: Two redaction passes and validation in `bake()`**

In `apps/api/edith/bake/__init__.py`:
- Import `TEXT_REDACTIONS`: `from edith.bake.registry import HANDLERS, PHASE, TEXT_REDACTIONS`.
- Below the handler-module import add:
```python
# text.edit removes only the glyphs of the edited lines; images and vector art stay.
TEXT_ONLY = dict(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                 text=pymupdf.PDF_REDACT_TEXT_REMOVE)
# redact.add removes everything under the box.
EVERYTHING = dict(images=pymupdf.PDF_REDACT_IMAGE_PIXELS, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                  text=pymupdf.PDF_REDACT_TEXT_REMOVE)
```
- In the validation loop, after the `no handler` check, add:
```python
            if op.type == "text.edit" and pages_src.paragraph(op.pageKey, op.paragraphId) is None:
                raise InvalidOp(f"no paragraph {op.paragraphId} on {op.pageKey}", op_index=i)
```
- Replace the per-page redaction block (from `redactions = [...]` to the end of the `if redactions:` block) with:
```python
            # Two passes: one apply_redactions() call has a single images/graphics mode.
            redact_handlers = {t: HANDLERS[t] for t, phase in PHASE.items() if phase == "redact"}
            for handlers, mode in ((TEXT_REDACTIONS, TEXT_ONLY), (redact_handlers, EVERYTHING)):
                marked = [op for op in page_ops if op.type in handlers]
                for op in marked:
                    _run(handlers[op.type], page, op, ctx)
                if marked:
                    page.apply_redactions(**mode)
```
  (the following draw loop `for op in page_ops: if PHASE[op.type] == "draw": …` stays.)

Run: `cd apps/api && uv run pytest -q`
Expected: all pass (M1 tests that monkeypatch `HANDLERS`/`PHASE` keep working).

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/bake apps/api/tests/test_bake_text_edit.py apps/api/tests/test_export.py
git commit -m "feat(api): bake text.edit with a text-only redaction pass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
