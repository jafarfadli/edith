"""Stamps: a rounded border plus centred label (and an optional date/time line), drawn as vector
art + text (spec: bake/stamps.py). The geometry is a shared contract with apps/web/src/lib/stamps.ts —
change both together."""
import json
from dataclasses import dataclass
from typing import Callable

import pymupdf

from edith.bake.registry import register
from edith.bake.text import draw_text_box, quantized_width
from edith.bake.util import rgb
from edith.ops import BundledFont, LayoutLine, Rect, Run, Segment, StampAdd, TextBox
from edith.settings import REPO_ROOT

# One table for both sides: the web client imports the same file (packages/ops/stamp-presets.json).
# 34 presets: the 17 English ones, then their Indonesian equivalents (same colour as the English one).
STAMP_PRESETS_FILE = REPO_ROOT / "packages" / "ops" / "stamp-presets.json"
_TABLE = json.loads(STAMP_PRESETS_FILE.read_text(encoding="utf-8"))
STAMP_LABELS: dict[str, str] = {p["id"]: p["label"] for p in _TABLE}
STAMP_COLORS: dict[str, str] = {p["id"]: p["color"] for p in _TABLE}
STAMP_FONT = BundledFont(family="Arimo", bold=True)
CAP_HEIGHT = 0.688       # Arimo Bold sCapHeight / unitsPerEm (1409 / 2048)
BORDER = 0.05            # border width × the rect's shorter side (at least 0.5 pt)
RADIUS = 0.2             # corner radius × the shorter side of the border rect
PAD = 0.12               # horizontal padding × height, plus the border width
ONE_LINE_SIZE = 0.5      # label size × height (one line), shrunk to fit the width
LABEL_SIZE, SUB_SIZE = 0.36, 0.2           # two lines: label and date/time sizes × height
LABEL_BASELINE, SUB_BASELINE = 0.5, 0.78   # two lines: baselines × height from the top


@dataclass
class StampLine:
    text: str
    size: float
    x: float          # relative to the stamp rect
    baseline: float   # relative to the stamp rect


def stamp_texts(op: StampAdd) -> list[str]:
    """The label, then the date/time line (custom stamps that have one)."""
    if op.preset is not None:
        return [STAMP_LABELS[op.preset]]
    sub = " ".join(t for t in (op.custom.date, op.custom.time) if t)
    return [op.custom.text, sub] if sub else [op.custom.text]


def border_width(w: float, h: float) -> float:
    return max(0.5, BORDER * min(w, h))


def stamp_layout(w: float, h: float, texts: list[str], width_at_1pt: Callable[[str], float]) -> list[StampLine]:
    """Sizes and positions of the stamp's text lines in a `w` × `h` rect."""
    avail = max(w - 2 * (PAD * h + border_width(w, h)), 1.0)

    def fit(text: str, size: float) -> float:
        unit = width_at_1pt(text)
        return min(size, avail / unit) if unit > 0 else size

    if len(texts) == 1:
        s = fit(texts[0], ONE_LINE_SIZE * h)
        rows = [(texts[0], s, h / 2 + CAP_HEIGHT * s / 2)]
    else:
        rows = [(texts[0], fit(texts[0], LABEL_SIZE * h), LABEL_BASELINE * h),
                (texts[1], fit(texts[1], SUB_SIZE * h), SUB_BASELINE * h)]
    return [StampLine(text, s, (w - width_at_1pt(text) * s) / 2, baseline) for text, s, baseline in rows]


@register("stamp.add")
def stamp(page: pymupdf.Page, op: StampAdd, ctx) -> None:
    r = op.rect
    bw = border_width(r.w, r.h)
    inner = pymupdf.Rect(r.x + bw / 2, r.y + bw / 2, r.x + r.w - bw / 2, r.y + r.h - bw / 2)
    page.draw_rect(inner, color=rgb(op.color), fill=None, width=bw, radius=RADIUS)
    font = ctx.fonts.font(STAMP_FONT.family, STAMP_FONT.bold, STAMP_FONT.italic)
    lines = stamp_layout(r.w, r.h, stamp_texts(op), lambda t: quantized_width(font, t, 1))
    box = TextBox(
        rect=Rect(x=r.x, y=r.y, w=r.w, h=r.h), lineHeight=max(r.h, 1),
        paragraphs=[[Run(text=ln.text, font=STAMP_FONT, size=ln.size, color=op.color)] for ln in lines],
        layout=[LayoutLine(baseline=ln.baseline, segments=[Segment(x=ln.x, text=ln.text, runIndex=i)])
                for i, ln in enumerate(lines)],
    )
    draw_text_box(page, box, ctx)  # TextWriter + the ToUnicode fix