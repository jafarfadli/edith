import math
from collections import defaultdict
from dataclasses import replace

import pymupdf

from edith.bake.context import BakeContext
from edith.bake.pages import build_pages
from edith.bake.registry import HANDLERS, PHASE, TEXT_REDACTIONS
from edith.bake.scrub import scrub_outside, scrub_page, under_redaction
from edith.bake.source import SourcePages
from edith.bake.text import links_under_redactions, restore_links
from edith.bake.transform import draw_transformed
from edith.bake.util import to_rect
from edith.errors import BakeFailed, EdithError, InvalidOp
from edith.forms import FieldValueError, drop_xfa, fill_forms
from edith.ops import DocSrc, LayoutPage, PageTarget, PagesLayout

# Handler modules register themselves on import (later tasks add more, e.g. text):
from edith.bake import annots, draw, stamps, symbols, text  # noqa: F401,E402  (registers handlers)

# text.edit removes only the glyphs of the edited lines; images and vector art stay.
TEXT_ONLY = dict(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                 text=pymupdf.PDF_REDACT_TEXT_REMOVE)
# redact.add removes everything under the box.
EVERYTHING = dict(images=pymupdf.PDF_REDACT_IMAGE_PIXELS, graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                  text=pymupdf.PDF_REDACT_TEXT_REMOVE)


def _default_layout(page_count: int, doc_id: str) -> PagesLayout:
    return PagesLayout(id="default", type="pages.layout", pages=[
        LayoutPage(pageKey=f"o{i}", src=DocSrc(doc=doc_id, index=i)) for i in range(page_count)
    ])


def _run(handler, page, op, ctx) -> None:
    try:
        draw_transformed(page, op, lambda: handler(page, op, ctx))
    except EdithError as exc:
        raise BakeFailed(exc.message, op_id=op.id) from exc
    except Exception as exc:  # noqa: BLE001
        raise BakeFailed(str(exc), op_id=op.id) from exc


def _memo(load):
    cache: dict[str, bytes] = {}

    def cached(doc_id: str) -> bytes:
        if doc_id not in cache:
            cache[doc_id] = load(doc_id)
        return cache[doc_id]
    return cached


CROP_SLACK = 0.01  # pt: a crop this far past the page edge is clamped, not rejected


def _crop_rect(page: pymupdf.Page, crop, layout_index: int) -> pymupdf.Rect:
    """A layout crop (page coordinates of the unrotated page) as a rect inside the page."""
    if not all(math.isfinite(v) for v in (crop.x, crop.y, crop.w, crop.h)):
        raise InvalidOp("crop is not finite", op_index=layout_index)
    r = pymupdf.Rect(crop.x, crop.y, crop.x + crop.w, crop.y + crop.h)
    bounds = page.rect
    if r.x1 > bounds.x1 + CROP_SLACK or r.y1 > bounds.y1 + CROP_SLACK:
        raise InvalidOp("crop outside the page", op_index=layout_index)
    return r & bounds


def _fill(doc: pymupdf.Document, forms: list, flatten: bool, widgets_removed: bool) -> None:
    if forms or flatten or widgets_removed:
        drop_xfa(doc)
    try:
        fill_forms(doc, forms)
    except FieldValueError as exc:
        raise BakeFailed(str(exc), op_id=exc.op_id) from exc
    except Exception as exc:  # noqa: BLE001
        raise BakeFailed(f"cannot fill the form: {exc}") from exc
    if flatten:
        try:
            doc.bake(annots=False, widgets=True)  # widgets become page content; other annotations stay
        except Exception as exc:  # noqa: BLE001
            raise BakeFailed(f"cannot flatten the form: {exc}") from exc


def bake(source: bytes, ops: list, ctx: BakeContext, flatten_forms: bool = False) -> pymupdf.Document:
    doc = pymupdf.open(stream=source, filetype="pdf")
    pages_src = None
    try:
        layout, layout_index = None, -1
        for i, op in enumerate(ops):
            if op.type == "pages.layout":
                layout, layout_index = op, i
        if layout is None:
            layout = _default_layout(doc.page_count, ctx.doc_id)

        # Each imported PDF is read once, by SourcePages (text.edit, original fonts) and build_pages alike.
        if ctx.load_source is not None:
            ctx = replace(ctx, load_source=_memo(ctx.load_source))
        pages_src = SourcePages(ctx.doc_id, source, {
            p.pageKey: (p.src.doc, p.src.index) if isinstance(p.src, DocSrc) else None for p in layout.pages
        }, ctx.load_source)
        ctx = replace(ctx, source=pages_src)
        forms = [op for op in ops if op.type == "form.set"]
        main_forms = [op for op in forms if op.doc in (None, ctx.doc_id)]
        import_forms: dict[str, list] = defaultdict(list)
        for op in forms:
            if op.doc not in (None, ctx.doc_id):
                import_forms[op.doc].append(op)

        keys = {p.pageKey for p in layout.pages}
        content = [(i, op) for i, op in enumerate(ops) if op.type not in ("pages.layout", "form.set")]
        for i, op in content:
            if op.pageKey not in keys:
                raise InvalidOp(f"unknown pageKey {op.pageKey}", op_index=i)
            if op.type not in HANDLERS:
                raise BakeFailed(f"no handler for {op.type}", op_id=op.id)
            if op.type == "text.edit" and pages_src.paragraph(op.pageKey, op.paragraphId) is None:
                raise InvalidOp(f"no paragraph {op.paragraphId} on {op.pageKey}", op_index=i)
            if op.type == "link.add" and isinstance(op.target, PageTarget) and op.target.pageKey not in keys:
                raise InvalidOp(f"link to unknown pageKey {op.target.pageKey}", op_index=i)

        key_to_index, base_rotation = build_pages(doc, layout, layout_index, ctx, import_forms)
        ctx = replace(ctx, page_index=key_to_index)
        crops = [_crop_rect(doc[i], entry.crop, layout_index) if entry.crop else None for i, entry in enumerate(layout.pages)]

        by_page: dict[int, list] = defaultdict(list)
        for _, op in content:
            by_page[key_to_index[op.pageKey]].append(op)

        widgets_removed = False
        redact_handlers = {t: HANDLERS[t] for t, phase in PHASE.items() if phase == "redact"}
        for page_index, page_ops in by_page.items():
            page = doc[page_index]
            # Two passes: one apply_redactions() call has a single images/graphics mode.
            for handlers, mode in ((TEXT_REDACTIONS, TEXT_ONLY), (redact_handlers, EVERYTHING)):
                marked = [op for op in page_ops if op.type in handlers]
                for op in marked:
                    _run(handlers[op.type], page, op, ctx)
                if marked:
                    kept = links_under_redactions(page) if mode is TEXT_ONLY else []
                    page.apply_redactions(**mode)
                    restore_links(page, kept)  # text.edit replaces glyphs, not the links over them
            # What apply_redactions() leaves under a redaction box: annotations, links, form fields.
            boxes = [to_rect(op.rect) for op in page_ops if op.type == "redact.add"]
            if boxes:
                widgets_removed |= scrub_page(page, boxes) > 0
            # Drawn content in stacking order, then native annotations over it, then links (none under
            # a redaction box: it would show — or carry — what the box hides).
            for phase in ("draw", "annot", "link"):
                for op in page_ops:
                    if PHASE[op.type] == phase and not (phase != "draw" and under_redaction(op, boxes)):
                        _run(HANDLERS[op.type], page, op, ctx)

        _fill(doc, main_forms, flatten_forms, widgets_removed)

        # Crop and rotation last: neither moves the content (spec: Urutan bake 7). Annotations, links and
        # widgets the crop hides entirely go (owner decision); a removed widget makes the XFA stale.
        cropped_widgets = 0
        for i, entry in enumerate(layout.pages):
            if crops[i] is not None:
                cropped_widgets += scrub_outside(doc[i], crops[i])
                cb = doc[i].cropbox  # MediaBox coordinates, top-left origin
                doc[i].set_cropbox(crops[i] + (cb.x0, cb.y0, cb.x0, cb.y0))
            doc[i].set_rotation((base_rotation[i] + entry.rotate) % 360)
        if cropped_widgets:
            drop_xfa(doc)
        return doc
    except BaseException:
        doc.close()
        raise
    finally:
        if pages_src is not None:
            pages_src.close()
