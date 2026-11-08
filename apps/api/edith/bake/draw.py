import math

import pymupdf

from edith.bake.geometry import BUTT, ROUND, cloud_beziers, dash_pattern, dashes_arg
from edith.bake.registry import register
from edith.bake.util import rgb, to_rect
from edith.ops import ImageAdd, InkAdd, RedactAdd, ShapeAdd, SignatureAdd, WhiteoutAdd


@register("whiteout.add")
def whiteout(page: pymupdf.Page, op: WhiteoutAdd, ctx) -> None:
    page.draw_rect(to_rect(op.rect), color=None, fill=(1, 1, 1), width=0, overlay=True)


@register("redact.add", phase="redact")
def redact(page: pymupdf.Page, op: RedactAdd, ctx) -> None:
    fill = (0, 0, 0) if op.fill == "black" else (1, 1, 1)
    page.add_redact_annot(to_rect(op.rect), fill=fill)


def _arrow_head(p1, p2, width: float):
    length = max(6.0, width * 4)
    angle = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    spread = math.radians(25)
    left = (p2[0] - length * math.cos(angle - spread), p2[1] - length * math.sin(angle - spread))
    right = (p2[0] - length * math.cos(angle + spread), p2[1] - length * math.sin(angle + spread))
    return [pymupdf.Point(left), pymupdf.Point(p2), pymupdf.Point(right)]


def _stroke_style(op: ShapeAdd, cap: int) -> dict:
    """dashes/lineCap of the shape's stroke (`cap` for solid strokes)."""
    pattern = dash_pattern(op.dash, op.width)
    if pattern is None:
        return {"lineCap": cap}
    return {"dashes": dashes_arg(pattern[0]), "lineCap": pattern[1]}


@register("shape.add")
def shape(page: pymupdf.Page, op: ShapeAdd, ctx) -> None:
    stroke = rgb(op.stroke) if op.width > 0 else None
    fill = rgb(op.fill) if op.fill else None
    if op.kind == "rect":
        page.draw_rect(to_rect(op.rect), color=stroke, fill=fill, width=op.width, **_stroke_style(op, BUTT))
    elif op.kind == "ellipse":
        page.draw_oval(to_rect(op.rect), color=stroke, fill=fill, width=op.width, **_stroke_style(op, BUTT))
    elif op.kind in ("polygon", "polyline"):
        closed = op.kind == "polygon"
        page.draw_polyline([pymupdf.Point(p) for p in op.points], color=stroke, fill=fill if closed else None,
                           width=op.width, closePath=closed, lineJoin=ROUND, **_stroke_style(op, ROUND))
    elif op.kind == "cloud":
        sh = page.new_shape()
        for p0, c1, c2, p3 in cloud_beziers([tuple(p) for p in op.points], op.width):
            sh.draw_bezier(p0, c1, c2, p3)
        sh.finish(color=stroke, fill=fill, width=op.width, closePath=True, lineJoin=ROUND, **_stroke_style(op, ROUND))
        sh.commit()
    else:
        p1, p2 = op.points
        page.draw_line(pymupdf.Point(p1), pymupdf.Point(p2), color=rgb(op.stroke), width=max(op.width, 0.5),
                       **_stroke_style(op, ROUND))
        if op.kind == "arrow":
            head = _arrow_head(p1, p2, op.width)
            page.draw_polyline(head, color=rgb(op.stroke), fill=rgb(op.stroke), width=0.5, closePath=True)


@register("ink.add")
def ink(page: pymupdf.Page, op: InkAdd, ctx) -> None:
    color = rgb(op.color)
    for path in op.paths:
        if len(path) == 1:
            page.draw_circle(pymupdf.Point(path[0]), op.width / 2, color=None, fill=color, width=0)
        else:
            page.draw_polyline([pymupdf.Point(p) for p in path], color=color, width=op.width,
                               lineCap=1, lineJoin=1, closePath=False)


@register("image.add")
def image(page: pymupdf.Page, op: ImageAdd, ctx) -> None:
    page.insert_image(to_rect(op.rect), filename=str(ctx.asset_path(op.assetId)), keep_proportion=False)


@register("signature.add")
def signature(page: pymupdf.Page, op: SignatureAdd, ctx) -> None:
    # Drawn, typed and uploaded signatures are all PNG/JPEG assets (a PNG keeps its transparency).
    page.insert_image(to_rect(op.rect), filename=str(ctx.asset_path(op.assetId)), keep_proportion=False)
