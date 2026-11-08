"""Rotation and opacity of drawn objects. The op's handler draws it as usual; the content streams it adds
are then merged into one and wrapped in `q [/GS gs] [cm] … Q`, so every handler (shapes, images, text,
stamps) gets arbitrary rotation and opacity the same way. Rotation is clockwise on screen (Konva's
convention) around the centre of the op's rect."""
from collections.abc import Callable

import pymupdf

from edith.ops import TextAdd


def rotation_center(op) -> tuple[float, float] | None:
    r = op.box.rect if isinstance(op, TextAdd) else getattr(op, "rect", None)
    return None if r is None else (r.x + r.w / 2, r.y + r.h / 2)


def needs_wrap(op) -> bool:
    return getattr(op, "opacity", 1) < 1 or bool(getattr(op, "rotation", 0))


def rotation_matrix(page: pymupdf.Page, center: tuple[float, float], degrees: float) -> pymupdf.Matrix:
    """`cm` operand (PDF space) that turns content `degrees` clockwise (on screen) around `center` (page space)."""
    to_page = page.transformation_matrix  # PDF space → page space (y down, CropBox top-left origin)
    cx, cy = center
    turn = pymupdf.Matrix(1, 0, 0, 1, -cx, -cy) * pymupdf.Matrix(degrees) * pymupdf.Matrix(1, 0, 0, 1, cx, cy)
    return to_page * turn * ~to_page


def draw_transformed(page: pymupdf.Page, op, draw: Callable[[], None]) -> None:
    if not needs_wrap(op):
        draw()
        return
    if not page.is_wrapped:
        page.wrap_contents()  # else the first drawing call would put a `q` stream in front of the page's own
    doc = page.parent
    before = set(page.get_contents())
    draw()
    new = [x for x in page.get_contents() if x not in before]
    if not new:
        return
    head = "q\n"
    if op.opacity < 1:
        head += f"/{page._set_opacity(CA=op.opacity, ca=op.opacity)} gs\n"
    rotation = getattr(op, "rotation", 0)
    center = rotation_center(op)
    if rotation and center is not None:
        m = rotation_matrix(page, center, rotation)
        head += " ".join(f"{v:.6f}" for v in (m.a, m.b, m.c, m.d, m.e, m.f)) + " cm\n"
    body = b"\n".join(doc.xref_stream(x) or b"" for x in new)
    doc.update_stream(new[0], head.encode() + body + b"\nQ\n")
    for x in new[1:]:
        doc.update_stream(x, b"")
