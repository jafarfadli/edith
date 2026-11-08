# Task 1: Page rules from vector drawings

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Owner feedback 1 ("pemisahan teksnya masih sangat berantakan"): the segmentation never looked at the table borders and separators drawn on the page. This task reads them: straight stroked lines, the four sides of rectangles and thin filled bars become horizontal/vertical `Segment`s, with fast range queries Task 2 uses to never merge text across a rule. Curved paths and filled polygons that are not rectangles (vector glyphs, logos) are ignored; strokes shorter than 10 pt (ticks, checkbox sides) too.

**Files:**
- Create: `apps/api/edith/rules.py`
- Create: `apps/api/tests/test_rules.py`

**Interfaces:**
- Consumes: `page.get_cdrawings()` (PyMuPDF 2.1; same coordinate space as `get_text`, also on rotated and cropped pages — checked in the spike).
- Produces: `edith.rules`: `Segment(at, lo, hi)`; `Rules(horizontal, vertical)` with `h_between(y0, y1, x0, x1) -> bool` (a horizontal rule strictly between heights y0 < y1 overlapping x0…x1) and `v_between(x0, x1, y0, y1) -> bool` (a vertical rule within x0…x1 covering the middle of y0…y1); `page_rules(page) -> Rules`; constants `RULE_MIN = 10`, `RULE_THICK = 3`, `AXIS_TOL = 1`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_rules.py`:

```python
import pymupdf

from edith.rules import Rules, Segment, page_rules


def rules_of(draw) -> Rules:
    doc = pymupdf.open()
    draw(doc.new_page(width=595, height=842))
    return page_rules(pymupdf.open(stream=doc.tobytes(), filetype="pdf")[0])


def spans(segments: list[Segment]) -> list[tuple]:
    return sorted((round(s.at, 2), round(s.lo, 2), round(s.hi, 2)) for s in segments)


def test_strokes_box_sides_and_thin_bars_are_rules():
    def draw(pg):
        pg.draw_line((50, 100), (300, 100))
        pg.draw_line((200, 50), (200, 150))
        pg.draw_rect(pymupdf.Rect(50, 200, 150, 260))
        pg.draw_rect(pymupdf.Rect(50, 300, 250, 301.5), color=None, fill=(0, 0, 0))  # a 1.5 pt filled bar
    r = rules_of(draw)
    assert spans(r.horizontal) == [(100, 50, 300), (200, 50, 150), (260, 50, 150), (300.75, 50, 250)]
    assert spans(r.vertical) == [(50, 200, 260), (150, 200, 260), (200, 50, 150)]


def test_ticks_curves_and_filled_polygons_are_not_rules():
    def draw(pg):
        pg.draw_line((50, 100), (58, 100))  # 8 pt: a tick or a checkbox side
        pg.draw_circle((300, 300), 40)
        pg.draw_polyline([(100, 400), (112, 400), (112, 430), (130, 430), (130, 442), (100, 442)],
                         closePath=True, fill=(0, 0, 0))  # an "L" drawn as a glyph outline
    r = rules_of(draw)
    assert r.horizontal == [] and r.vertical == []


def test_between_queries():
    r = Rules(horizontal=[Segment(100, 50, 300)], vertical=[Segment(200, 50, 150)])
    assert r.h_between(90, 110, 100, 120)
    assert not r.h_between(90, 110, 310, 400)   # beside the rule
    assert not r.h_between(101, 110, 60, 70)    # below it
    assert r.v_between(190, 210, 90, 110)
    assert not r.v_between(190, 210, 160, 170)  # the rule ends above
    assert not r.v_between(201, 210, 90, 110)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_rules.py`

Expected: FAIL — `edith.rules` does not exist. Spike output (last lines):

```
==================================== ERRORS ====================================
_____________________ ERROR collecting tests/test_rules.py _____________________
ImportError while importing test module '<repo>/apps/api/tests/test_rules.py'.
E   ModuleNotFoundError: No module named 'edith.rules'
ERROR tests/test_rules.py
```

- [ ] **Step 3: Implement**

Create `apps/api/edith/rules.py`:

```python
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


def _sorted(segments: list[Segment]) -> tuple[list[Segment], list[float]]:
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
            if len(items) == 1 and items[0][0] in ("re", "qu") or 3 <= len(items) <= 5 and all(it[0] == "l" for it in items):
                _add_rect(rules, pymupdf.Rect(path["rect"]))
            continue
        for it in items:
            if it[0] == "l":
                _add_segment(rules, it[1], it[2])
            elif it[0] == "re":
                _add_rect(rules, pymupdf.Rect(it[1]))
            elif it[0] == "qu" and pymupdf.Quad(it[1]).is_rectangular:
                _add_rect(rules, pymupdf.Quad(it[1]).rect)
    return Rules(horizontal=rules[0], vertical=rules[1])
```

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q`
Expected: 375 passed (warning-free).

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add apps/api/edith/rules.py apps/api/tests/test_rules.py
git commit -m "feat(api): page rules from vector drawings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
