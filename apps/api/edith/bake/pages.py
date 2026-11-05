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
