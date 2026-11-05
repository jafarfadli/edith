"""Check (✓) and cross (✗) symbols as stroked vector paths — no font has to cover the glyphs.
Shared contract with apps/web/src/lib/symbols.ts: points in the unit square of the rect."""
import pymupdf

from edith.bake.registry import register
from edith.bake.util import rgb
from edith.ops import Rect, SymbolAdd

SYMBOL_PATHS = {
    "check": [[(0.12, 0.52), (0.4, 0.8), (0.88, 0.2)]],
    "cross": [[(0.18, 0.18), (0.82, 0.82)], [(0.82, 0.18), (0.18, 0.82)]],
}
SYMBOL_WIDTH = 0.12  # stroke width × the rect's shorter side


def symbol_paths(kind: str, r: Rect) -> tuple[list[list[tuple[float, float]]], float]:
    paths = [[(r.x + u * r.w, r.y + v * r.h) for u, v in path] for path in SYMBOL_PATHS[kind]]
    return paths, SYMBOL_WIDTH * min(r.w, r.h)


@register("symbol.add")
def symbol(page: pymupdf.Page, op: SymbolAdd, ctx) -> None:
    paths, width = symbol_paths(op.kind, op.rect)
    for path in paths:
        page.draw_polyline([pymupdf.Point(p) for p in path], color=rgb(op.color), width=max(width, 0.1),
                           lineCap=1, lineJoin=1, closePath=False)