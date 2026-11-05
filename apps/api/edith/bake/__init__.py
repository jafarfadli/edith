from collections import defaultdict
from dataclasses import replace

import pymupdf

from edith.bake.context import BakeContext
from edith.bake.pages import build_pages
from edith.bake.registry import HANDLERS, PHASE, TEXT_REDACTIONS
from edith.bake.source import SourcePages
from edith.errors import BakeFailed, EdithError, InvalidOp
from edith.ops import DocSrc, LayoutPage, PagesLayout

# Handler modules register themselves on import (later tasks add more, e.g. text):
from edith.bake import draw, stamps, symbols, text  # noqa: F401,E402  (registers handlers)

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
        handler(page, op, ctx)
    except EdithError as exc:
        raise BakeFailed(exc.message, op_id=op.id) from exc
    except Exception as exc:  # noqa: BLE001
        raise BakeFailed(str(exc), op_id=op.id) from exc


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

        keys = {p.pageKey for p in layout.pages}
        content = [(i, op) for i, op in enumerate(ops) if op.type not in ("pages.layout", "form.set")]
        for op in ops:
            if op.type == "form.set":
                raise BakeFailed("no handler for form.set", op_id=op.id)  # Task 4 fills forms
        for i, op in content:
            if op.pageKey not in keys:
                raise InvalidOp(f"unknown pageKey {op.pageKey}", op_index=i)
            if op.type not in HANDLERS:
                raise BakeFailed(f"no handler for {op.type}", op_id=op.id)
            if op.type == "text.edit" and pages_src.paragraph(op.pageKey, op.paragraphId) is None:
                raise InvalidOp(f"no paragraph {op.paragraphId} on {op.pageKey}", op_index=i)

        key_to_index, base_rotation = build_pages(doc, layout, layout_index, ctx)

        by_page: dict[int, list] = defaultdict(list)
        for _, op in content:
            by_page[key_to_index[op.pageKey]].append(op)

        for page_index, page_ops in by_page.items():
            page = doc[page_index]
            # Two passes: one apply_redactions() call has a single images/graphics mode.
            redact_handlers = {t: HANDLERS[t] for t, phase in PHASE.items() if phase == "redact"}
            for handlers, mode in ((TEXT_REDACTIONS, TEXT_ONLY), (redact_handlers, EVERYTHING)):
                marked = [op for op in page_ops if op.type in handlers]
                for op in marked:
                    _run(handlers[op.type], page, op, ctx)
                if marked:
                    page.apply_redactions(**mode)
            for op in page_ops:
                if PHASE[op.type] == "draw":
                    _run(HANDLERS[op.type], page, op, ctx)

        for i, entry in enumerate(layout.pages):
            doc[i].set_rotation((base_rotation[i] + entry.rotate) % 360)
        return doc
    except BaseException:
        doc.close()
        raise
    finally:
        if pages_src is not None:
            pages_src.close()
