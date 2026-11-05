import pymupdf

from edith.ops import Rect


def rgb(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def to_rect(r: Rect) -> pymupdf.Rect:
    return pymupdf.Rect(r.x, r.y, r.x + r.w, r.y + r.h)
