"""Text decorations a PDF draws as vector art rather than as part of the text: underlines and strikethroughs (thin
horizontal bars or strokes) and highlights (filled rectangles behind the text). Word, LibreOffice and most generators
draw them so; GET /text reports them on the runs (Run.underline / strike / bgColor) and the bake of a text.edit removes
the ones of the lines it redraws, so they follow the new text instead of staying where the old text was.

A mark belongs to text only when it fits that text exactly: its ends sit on character edges of one line (Word draws an
underline from the first underlined character's origin to the last one's advance), at an underline's or a strike's
height (or around the line, for a highlight), and it reaches no further than a space past the ink it covers. Table
borders, fill-in lines ("Nama : ______") and separators do not fit so and are never touched. A mark is only reported
when removing it (MuPDF's "remove line art fully covered by a redaction", one subpath at a time) cannot remove anything
else: no other drawing lies inside the rect that removes it (see PageMarks.removable)."""
from dataclasses import dataclass

import pymupdf

LINE_MIN = 0.1        # pt: thinner paint (a zero-height fill, a hairline) is no decoration …
LINE_MAX = 3.0        # pt: an underline or strike is at most this thick …
LINE_EM = 0.15        # … and this share of the text size
AXIS_TOL = 0.1        # pt: how far a stroked decoration's ends may differ in y
UNDER = (0.02, 0.32)  # an underline's centre lies this far below the baseline (× size)
STRIKE = (-0.45, -0.15)  # a strikethrough's centre: this far above it (negative: up)
BG_TOP = (-1.6, -0.5)    # a highlight's top edge (× size, relative to the baseline) …
BG_BOTTOM = (0.05, 0.8)  # … and its bottom edge
EDGE_TOL, EDGE_EM = 0.75, 0.06  # pt, or this share of the size when larger: a mark's end on a character edge
SPILL_EM = 0.35       # a mark may run this far past the ink it covers (an underlined space), no further
PAD = 0.3             # pt around a mark's painted extent: the rect that removes it
SAME = 0.05           # pt: drawings this close are the same mark (drawn twice)
WHITE = 0.98          # a fill whose every component is at least this is white: paper, not a highlight
OPAQUE = 0.99         # a translucent fill (a tint, a multiply-like overlay) is no highlight we can redraw
TOUCH = 0.5           # pt: a bar's end this close to other line art meets it


@dataclass(frozen=True)
class Mark:
    """A candidate decoration: `rect` its painted extent (a stroke's half width included across it), `bar` a thin
    horizontal bar (underline or strike; else a filled rect: a highlight), `color` "#rrggbb", `remove` the rect whose
    redaction removes it (its painted extent with the stroke's caps, padded)."""
    rect: pymupdf.Rect
    bar: bool
    color: str
    remove: pymupdf.Rect
    seqno: int = -1        # its place in the page's painting order (get_cdrawings / get_texttrace)
    opaque: bool = True    # painted at full opacity


def _hex(c) -> str | None:
    if not c or len(c) != 3:
        return None
    return "#" + "".join(f"{max(0, min(255, round(v * 255))):02x}" for v in c)


def _rect_of(item) -> pymupdf.Rect | None:
    if item[0] == "re":
        return pymupdf.Rect(item[1])
    if item[0] == "qu":
        q = pymupdf.Quad(item[1])
        return q.rect if q.is_rectangular else None
    return None


def _strokes(items: list) -> list[tuple[float, float, float]] | None:
    """(x0, x1, y) of the horizontal lines a stroked path of straight `l` items draws, connected pieces joined; None
    when some item is not a horizontal line."""
    segs = []
    for it in items:
        if it[0] != "l" or abs(it[1][1] - it[2][1]) > AXIS_TOL:
            return None
        segs.append((min(it[1][0], it[2][0]), max(it[1][0], it[2][0]), (it[1][1] + it[2][1]) / 2))
    out: list[list[float]] = []
    for x0, x1, y in sorted(segs, key=lambda s: (round(s[2], 1), s[0])):
        last = out[-1] if out else None
        if last and abs(last[2] - y) <= AXIS_TOL and x0 <= last[1] + 1e-6:
            last[1] = max(last[1], x1)
        else:
            out.append([x0, x1, y])
    return [tuple(s) for s in out]


class PageMarks:
    """The page's candidate decorations and the extent of every drawing (to tell whether removing a mark is safe)."""

    def __init__(self, page: pymupdf.Page):
        self.marks: list[Mark] = []
        self.claimed: set[int] = set()  # id() of the marks a line's text already has (see decorate): one owner each
        self._extents: list[pymupdf.Rect] = []  # every drawn piece (a subpath's bounds, without its stroke)
        for path in page.get_cdrawings():
            items = path["items"]
            kind = path.get("type", "")
            for it in items:
                if it[0] == "l":
                    self._extents.append(pymupdf.Rect(min(it[1][0], it[2][0]), min(it[1][1], it[2][1]),
                                                      max(it[1][0], it[2][0]), max(it[1][1], it[2][1])))
                elif it[0] == "c":
                    pts = it[1:]
                    self._extents.append(pymupdf.Rect(min(p[0] for p in pts), min(p[1] for p in pts),
                                                      max(p[0] for p in pts), max(p[1] for p in pts)))
                else:
                    r = pymupdf.Rect(it[1]) if it[0] == "re" else pymupdf.Quad(it[1]).rect
                    self._extents.append(r)
            seqno = path.get("seqno", -1)
            if kind == "f" and path.get("fill_opacity", 1) > 0:
                color = _hex(path.get("fill"))
                opaque = path.get("fill_opacity", 1) >= OPAQUE
                for it in items:
                    r = _rect_of(it)
                    if color and r is not None and r.width > 0.5 and r.height >= LINE_MIN:
                        self.marks.append(Mark(r, r.height <= LINE_MAX, color, r + (-PAD, -PAD, PAD, PAD), seqno, opaque))
            elif kind == "s" and path.get("stroke_opacity", 1) > 0 and LINE_MIN <= (path.get("width") or 0) <= LINE_MAX:
                color, w = _hex(path.get("color")), path["width"]
                for x0, x1, y in _strokes(items) or []:
                    if color and x1 - x0 > 0.5:
                        r = pymupdf.Rect(x0, y - w / 2, x1, y + w / 2)
                        self.marks.append(Mark(r, True, color, r + (-w / 2 - PAD, -PAD, w / 2 + PAD, PAD), seqno,
                                               path.get("stroke_opacity", 1) >= OPAQUE))
        # get_cdrawings() also gives the appearances of annotations (a highlight, a square, a widget's border): no
        # redaction removes those, they stay drawings (in _extents) but are no marks.
        # (Not every page has them: OCR extracts paragraphs from a stand-in page of its own.)
        annots = [pymupdf.Rect(a.rect) + (-1, -1, 1, 1) for a in (page.annots() if hasattr(page, "annots") else [])]
        annots += [pymupdf.Rect(w.rect) + (-1, -1, 1, 1) for w in (page.widgets() if hasattr(page, "widgets") else [])]
        if annots:
            self.marks = [m for m in self.marks if not any(m.rect in a for a in annots)]
        self._page = page
        self._trace: list[tuple[pymupdf.Rect, int]] | None = None

    def under_text(self, mark: Mark, area: pymupdf.Rect) -> bool:
        """`mark` is painted before every piece of text over `area` (a highlight lies under its text; a box painted over
        the text covers it). False when the page cannot say (no text trace)."""
        if self._trace is None:
            try:
                self._trace = [(pymupdf.Rect(s["bbox"]), s["seqno"]) for s in self._page.get_texttrace()]
            except Exception:  # noqa: BLE001 - a stand-in page (OCR) or an unreadable trace
                self._trace = []
        over = [seq for r, seq in self._trace if r.intersects(area)]
        return bool(over) and mark.seqno >= 0 and all(seq > mark.seqno for seq in over)

    def touches_line_art(self, mark: Mark) -> bool:
        """An end of bar `mark` meets other line art reaching above or below it: the bottom of a box (a table cell as wide
        as its text, with its side borders), not an underline (which touches nothing, or the next underline)."""
        r = mark.rect
        for x in (r.x0, r.x1):
            probe = pymupdf.Rect(x - TOUCH, r.y0 - TOUCH, x + TOUCH, r.y1 + TOUCH)
            for e in self._extents:
                if _meets(e, probe) and (e.y0 < r.y0 - TOUCH or e.y1 > r.y1 + TOUCH):
                    return True
        return False

    def removable(self, mark: Mark) -> bool:
        """Removing `mark` removes nothing else: every drawn piece inside its removal rect is the mark itself (or the
        same mark drawn again)."""
        own, box = pymupdf.Rect(mark.rect), mark.remove
        for e in self._extents:
            inside = box.x0 <= e.x0 and e.x1 <= box.x1 and box.y0 <= e.y0 and e.y1 <= box.y1
            if inside and not _same(e, own, mark):
                return False
        return True

    def find(self, rect: pymupdf.Rect) -> list[Mark]:
        """The marks whose painted extent is `rect` (within SAME)."""
        return [m for m in self.marks if all(abs(a - b) <= SAME for a, b in zip(m.rect, rect))]


def _meets(e: pymupdf.Rect, probe: pymupdf.Rect) -> bool:
    """A degenerate rect (a line's extent) overlapping `probe` (Rect.intersects is False for empty rects)."""
    return e.x0 <= probe.x1 and e.x1 >= probe.x0 and e.y0 <= probe.y1 and e.y1 >= probe.y0


def _same(e: pymupdf.Rect, own: pymupdf.Rect, mark: Mark) -> bool:
    """Drawn piece `e` (bounds without stroke) is `mark`: a filled rect equal to its extent, or a stroke along it."""
    if all(abs(a - b) <= SAME for a, b in zip(e, own)):
        return True
    mid = (own.y0 + own.y1) / 2
    return mark.bar and abs(e.y0 - mid) <= SAME and abs(e.y1 - mid) <= SAME and e.x0 >= own.x0 - SAME and e.x1 <= own.x1 + SAME


@dataclass(frozen=True)
class Decor:
    """What a mark does to a character: `kind` "underline" | "strike" | "bg"; `top` and `thickness` (pt, the bar's top
    edge relative to the character's baseline, down positive) for a bar."""
    kind: str
    mark: Mark
    top: float = 0.0
    thickness: float = 0.0


def _edge(xs: list[float], x: float, tol: float) -> int | None:
    best = min(range(len(xs)), key=lambda i: abs(xs[i] - x), default=None)
    return best if best is not None and abs(xs[best] - x) <= tol else None


def decorate(chars: list[tuple[dict, float, float]], marks: list[Mark], page: PageMarks) -> dict[int, list[Decor]]:
    """Index of a character of one line → the decorations over it. `chars`: (rawdict char, its baseline y, its size).
    A mark decorates the characters whose middle it spans when both its ends sit on character edges of the line, it
    covers ink, runs at most SPILL_EM past that ink and removing it is safe (PageMarks.removable). A mark decorates one
    line only (the first that claims it: a duplicate of the text drawn again does not make it another line's)."""
    if not chars or not marks:
        return {}
    x0s = [c["bbox"][0] for c, _, _ in chars]
    x1s = [c["bbox"][2] for c, _, _ in chars]
    top = min(b - s for _, b, s in chars)
    bottom = max(b + s for _, b, s in chars)
    out: dict[int, list[Decor]] = {}
    for m in marks:
        r = m.rect
        if id(m) in page.claimed or r.y1 < top - 1 or r.y0 > bottom + 1 or r.x1 < x0s[0] - 1 or r.x0 > max(x1s) + 1:
            continue
        size = max(s for _, _, s in chars)
        tol = max(EDGE_TOL, EDGE_EM * size)
        a, b = _edge(x0s, r.x0, tol), _edge(x1s, r.x1, tol)
        if a is None or b is None or b < a:
            continue
        covered = [i for i in range(len(chars)) if r.x0 <= (x0s[i] + x1s[i]) / 2 <= r.x1]
        ink = [i for i in covered if not chars[i][0]["c"].isspace()]
        if not ink:
            continue
        c, base, size = chars[ink[0]]
        spill = SPILL_EM * size
        if r.x0 < x0s[ink[0]] - spill or r.x1 > x1s[ink[-1]] + spill:
            continue
        mid = (r.y0 + r.y1) / 2
        kind = None
        if m.bar and r.height <= LINE_EM * size:
            d = (mid - base) / size
            kind = "underline" if UNDER[0] <= d <= UNDER[1] else "strike" if STRIKE[0] <= d <= STRIKE[1] else None
        elif not m.bar and min(int(m.color[i:i + 2], 16) for i in (1, 3, 5)) < WHITE * 255:
            if BG_TOP[0] <= (r.y0 - base) / size <= BG_TOP[1] and BG_BOTTOM[0] <= (r.y1 - base) / size <= BG_BOTTOM[1]:
                kind = "bg"
        if kind == "bg":
            ink_box = pymupdf.Rect(x0s[ink[0]], r.y0, x1s[ink[-1]], r.y1)
            if not (m.opaque and page.under_text(m, ink_box)):
                continue  # painted over the text (a cover) or translucent: not a highlight we can redraw
        elif kind is not None and page.touches_line_art(m):
            continue  # the bottom of a box (a cell as wide as its text), not an underline
        if kind is None or not page.removable(m):
            continue
        page.claimed.add(id(m))
        for i in covered:
            out.setdefault(i, []).append(Decor(kind, m, r.y0 - chars[i][1], r.height))
    return out


def to_json(rect: pymupdf.Rect) -> dict:
    return {"x": round(rect.x0, 2), "y": round(rect.y0, 2), "w": round(rect.width, 2), "h": round(rect.height, 2)}
