"""Native PDF annotations (text markup, sticky notes) and links — added after the drawn content, on
the unrotated page, so they rotate with the page when bake() restores its rotation."""
import pymupdf

from edith.bake.registry import register
from edith.bake.util import rgb, safe_uri, to_rect
from edith.ops import AnnotAdd, LinkAdd, PageTarget

_MARKUP = {
    "highlight": pymupdf.Page.add_highlight_annot,
    "underline": pymupdf.Page.add_underline_annot,
    "strike": pymupdf.Page.add_strikeout_annot,
}
NOTE_ICON = "Note"  # MuPDF draws it NOTE_SIZE × NOTE_SIZE pt with its top-left corner at the point
NOTE_SIZE = 16


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
        page.insert_link({"kind": pymupdf.LINK_URI, "from": to_rect(op.rect), "uri": safe_uri(op.target.url)})
