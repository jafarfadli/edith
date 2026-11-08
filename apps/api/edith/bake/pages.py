import pymupdf

from edith.bake.context import BakeContext
from edith.errors import DocExpired, DocNotFound, InvalidOp
from edith.forms import detach_acroform, reattach_acroform, widget_xrefs
from edith.ops import DocSrc, PagesLayout


def _insert_imports(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
                    ctx: BakeContext) -> dict[str, tuple[int, int]]:
    """Appends every other document the layout uses (imported PDFs), whole and once each; returns doc id →
    (index of its first page in `doc`, its page count). insert_pdf() copies annotations, links and form fields; a field whose
    name the document already has is renamed ("name [xref]"), so it stays a separate field."""
    spans: dict[str, tuple[int, int]] = {}
    for entry in layout.pages:
        if not isinstance(entry.src, DocSrc) or entry.src.doc == ctx.doc_id or entry.src.doc in spans:
            continue
        doc_id = entry.src.doc
        if ctx.load_source is None:
            raise InvalidOp(f"bad page source for {entry.pageKey}", op_index=layout_index)
        try:
            data = ctx.load_source(doc_id)
        except DocNotFound:
            raise InvalidOp(f"unknown document {doc_id} for {entry.pageKey}", op_index=layout_index) from None
        except DocExpired:
            raise DocExpired(f"imported document {doc_id} expired", doc_id=doc_id) from None
        src = pymupdf.open(stream=data, filetype="pdf")
        try:
            spans[doc_id] = (doc.page_count, src.page_count)
            doc.insert_pdf(src)
        finally:
            src.close()
    return spans


def build_pages(doc: pymupdf.Document, layout: PagesLayout, layout_index: int,
                ctx: BakeContext) -> tuple[dict[str, int], list[int]]:
    source_count = doc.page_count
    spans = {ctx.doc_id: (0, source_count), **_insert_imports(doc, layout, layout_index, ctx)}
    acroform = detach_acroform(doc)  # after the imports: one may have brought the document's first form
    copies: dict[int, int] = {}  # widget made by fullcopy_page -> the widget it was copied from
    seen: set[int] = set()
    selection: list[int] = []
    base_rotation: list[int] = []
    for entry in layout.pages:
        if isinstance(entry.src, DocSrc):
            first, count = spans.get(entry.src.doc, (0, 0))
            if entry.src.index >= count:
                raise InvalidOp(f"bad page source for {entry.pageKey}", op_index=layout_index)
            idx = first + entry.src.index
            base_rotation.append(doc[idx].rotation)
            if idx in seen:
                original = widget_xrefs(doc[idx])
                doc.fullcopy_page(idx)  # appended at the end, independent copy
                copies.update(zip(widget_xrefs(doc[doc.page_count - 1]), original))
                idx = doc.page_count - 1
            else:
                seen.add(idx)
        else:
            doc.new_page(-1, width=entry.src.blank.width, height=entry.src.blank.height)
            idx = doc.page_count - 1
            base_rotation.append(0)
        selection.append(idx)
    doc.select(selection)
    reattach_acroform(doc, acroform, copies)  # select() drops /AcroForm; the widgets stay on their pages
    # Ops are in unrotated-CropBox points: draw on unrotated pages, bake() re-applies the
    # rotation (base + layout) last.
    for page in doc:
        page.set_rotation(0)
    return {e.pageKey: i for i, e in enumerate(layout.pages)}, base_rotation
