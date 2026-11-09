"""Straight lines drawn on a page (table borders, separators): where text must not be merged across."""
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field

import pymupdf

RULE_MIN = 10.0    # pt: shorter strokes are glyph parts, tick marks or checkbox sides, not rules
RULE_THICK = 3.0   # pt: a filled shape at most this thick is drawn as a line
AXIS_TOL = 1.0     # pt: how far from horizontal/vertical a segment may lean


@dataclass(frozen=True)
class Segment:
    at: float   # y of a horizontal rule, x of a vertical one
    lo: float   # extent along the rule: x0 … x1 (horizontal) or y0 … y1 (vertical)
    hi: float


MERGE_AT = 0.5     # pt: segments this close across the rule are collinear …
MERGE_GAP = 1.0    # … and are one rule when their ends are at most this far apart


def _merged(segments: list[Segment]) -> list[Segment]:
    """Collinear segments with small gaps as one rule: Word draws a table's vertical borders row by row, with
    0.5 pt gaps between the rows (a test at the middle of two lines may fall into such a gap)."""
    out: list[Segment] = []
    cluster: list[Segment] = []

    def flush() -> None:
        merged: list[Segment] = []
        for s in sorted(cluster, key=lambda s: s.lo):
            if merged and s.lo <= merged[-1].hi + MERGE_GAP:
                last = merged[-1]
                merged[-1] = Segment(last.at, last.lo, max(last.hi, s.hi))
            else:
                merged.append(s)
        out.extend(merged)

    for s in sorted(segments, key=lambda s: s.at):
        if cluster and s.at - cluster[0].at > MERGE_AT:
            flush()
            cluster = []
        cluster.append(s)
    if cluster:
        flush()
    return out


def _sorted(segments: list[Segment]) -> tuple[list[Segment], list[float]]:
    # Shared cell borders are drawn by every neighbour: keep one of each (compared to 0.01 pt).
    segments = list({(round(s.at, 2), round(s.lo, 2), round(s.hi, 2)): s for s in reversed(segments)}.values())
    segments = _merged(segments)
    segments.sort(key=lambda s: s.at)
    return segments, [s.at for s in segments]


@dataclass
class Rules:
    horizontal: list[Segment] = field(default_factory=list)
    vertical: list[Segment] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.horizontal, self._h_at = _sorted(list(self.horizontal))
        self.vertical, self._v_at = _sorted(list(self.vertical))

    def _h(self, y0: float, y1: float) -> list[Segment]:
        return self.horizontal[bisect_left(self._h_at, y0):bisect_right(self._h_at, y1)]

    def _v(self, x0: float, x1: float) -> list[Segment]:
        return self.vertical[bisect_left(self._v_at, x0):bisect_right(self._v_at, x1)]

    def h_between(self, y0: float, y1: float, x0: float, x1: float) -> bool:
        """A horizontal rule strictly between heights y0 < y1 that overlaps x0 … x1."""
        return y0 < y1 and any(y0 < s.at < y1 and s.lo < x1 and s.hi > x0 for s in self._h(y0, y1))

    def v_between(self, x0: float, x1: float, y0: float, y1: float) -> bool:
        """A vertical rule within x0 … x1 that covers the middle of y0 … y1."""
        mid = (y0 + y1) / 2
        return x0 <= x1 and any(s.lo <= mid <= s.hi for s in self._v(x0, x1))


def _add_segment(rules: tuple[list, list], a: tuple, b: tuple) -> None:
    (ax, ay), (bx, by) = a, b
    if abs(ay - by) <= AXIS_TOL and abs(ax - bx) >= RULE_MIN:
        rules[0].append(Segment((ay + by) / 2, min(ax, bx), max(ax, bx)))
    elif abs(ax - bx) <= AXIS_TOL and abs(ay - by) >= RULE_MIN:
        rules[1].append(Segment((ax + bx) / 2, min(ay, by), max(ay, by)))


def _add_rect(rules: tuple[list, list], r: pymupdf.Rect) -> None:
    if r.width <= RULE_THICK and r.height >= RULE_MIN:      # a filled vertical bar
        rules[1].append(Segment((r.x0 + r.x1) / 2, r.y0, r.y1))
    elif r.height <= RULE_THICK and r.width >= RULE_MIN:    # a filled horizontal bar
        rules[0].append(Segment((r.y0 + r.y1) / 2, r.x0, r.x1))
    elif r.width > RULE_THICK and r.height > RULE_THICK:    # a box: its four sides
        for a, b in ((r.tl, r.tr), (r.bl, r.br), (r.tl, r.bl), (r.tr, r.br)):
            _add_segment(rules, tuple(a), tuple(b))


AREA_TOL = 0.02    # a filled polygon is a rectangle when its area is within 2 % of its bounding box


def _filled_rect(items: list) -> pymupdf.Rect | None:
    """The rectangle a filled path draws, or None: one rect/quad item, or 3–5 straight edges that are all
    axis-aligned and enclose (nearly) their whole bounding box (a triangle, arrow or pentagon does not)."""
    if len(items) == 1 and items[0][0] == "re":
        return pymupdf.Rect(items[0][1])
    if len(items) == 1 and items[0][0] == "qu":
        quad = pymupdf.Quad(items[0][1])
        return quad.rect if quad.is_rectangular else None
    if not 3 <= len(items) <= 5 or any(it[0] != "l" for it in items):
        return None
    if any(abs(it[1][0] - it[2][0]) > AXIS_TOL and abs(it[1][1] - it[2][1]) > AXIS_TOL for it in items):
        return None  # a slanted edge
    pts = [it[1] for it in items]
    area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))) / 2
    box = pymupdf.Rect(min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
    if box.width * box.height == 0:
        return box if area == 0 else None
    return box if abs(area - box.width * box.height) <= AREA_TOL * box.width * box.height else None


def page_rules(page: pymupdf.Page) -> Rules:
    """Rules from the page's vector drawings: stroked straight lines, the sides of rectangles and thin filled
    bars. Paths with curves and filled polygons that are not rectangles (vector glyphs, logos) are ignored."""
    rules: tuple[list, list] = ([], [])
    for path in page.get_cdrawings():
        items = path["items"]
        if any(it[0] == "c" for it in items):
            continue  # curves: glyph outlines, logos, rounded shapes
        if "f" in path["type"]:
            # A filled shape counts only as a rectangle (cell shading, a bar): letters drawn as polygons don't.
            rect = _filled_rect(items)
            if rect is not None:
                _add_rect(rules, rect)
                continue
            if "s" not in path["type"]:
                continue
            # filled and stroked but not a rectangle: its stroke is still a border, so fall through
        for it in items:
            if it[0] == "l":
                _add_segment(rules, it[1], it[2])
            elif it[0] == "re":
                _add_rect(rules, pymupdf.Rect(it[1]))
            elif it[0] == "qu" and pymupdf.Quad(it[1]).is_rectangular:
                _add_rect(rules, pymupdf.Quad(it[1]).rect)
    return Rules(horizontal=rules[0], vertical=rules[1])
