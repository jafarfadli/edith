# Task 2: Bake polygon, polyline, cloud and dashed strokes

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 1 leaves, new files are complete.

**Goal:** `shape.add` bakes the three new kinds and the three dash styles with geometry shared with the web (`bake/geometry.py` ↔ `lib/geometry.ts`).

**Files:**
- Modify: `apps/api/edith/bake/draw.py`
- Create: `apps/api/edith/bake/geometry.py`
- Create: `apps/api/tests/test_bake_shapes.py`

**Interfaces:**
- Consumes: Task 1 `ShapeAdd.kind/dash/points`.
- Produces:
- `edith/bake/geometry.py`: `dash_pattern(dash, width) -> ([on, off], cap) | None`, `dashes_arg(pattern) -> str`, `signed_area2(points)`, `cloud_beziers(points, width) -> list[(p0, c1, c2, p3)]`, constants `KAPPA, CLOUD_ARC=8, CLOUD_ARC_PER_WIDTH=2, BUTT=0, ROUND=1`.
- Contract pinned by both suites (see README Global Constraints).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_bake_shapes.py`:

```python
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.bake.geometry import KAPPA, cloud_beziers, dash_pattern, signed_area2
from edith.fonts import FontRegistry
from edith.ops import ExportRequest
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22
SQUARE = [(0.0, 0.0), (20.0, 0.0), (20.0, 20.0), (0.0, 20.0)]  # clockwise on screen


@pytest.fixture
def ctx(tmp_path) -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: tmp_path / a, fonts=FontRegistry(Settings().fonts_dir))


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def shape(**kw) -> dict:
    return {"id": "s", "type": "shape.add", "pageKey": "o0", "stroke": "#ff0000", "fill": None, "width": 2, **kw}


def drawings(out):
    return [d for d in out[0].get_drawings() if d.get("color") == (1.0, 0.0, 0.0) or d.get("fill") == (0.0, 0.0, 1.0)]


# Shared contract with apps/web/src/lib/geometry.test.ts: same inputs, same numbers.
def test_dash_patterns():
    assert dash_pattern("solid", 2) is None
    assert dash_pattern("dashed", 2) == ([6, 4], 0)
    assert dash_pattern("dotted", 2) == ([0, 4], 1)
    assert dash_pattern("dashed", 0) == ([1.5, 1.0], 0)  # width floor 0.5


def test_cloud_square_contract():
    assert signed_area2(SQUARE) == 800
    arcs = cloud_beziers(SQUARE, 1)  # arc 10 pt: each 20 pt edge gets 2 half circles of radius 5
    assert len(arcs) == 16
    k = KAPPA * 5
    first = arcs[0]
    assert first[0] == (0, 0) and first[3] == (5, -5)  # bulges up, out of the square
    assert first[1] == pytest.approx((0, -k)) and first[2] == pytest.approx((5 - k, -5))
    assert arcs[1][3] == (10, 0)
    assert arcs[-1][3] == pytest.approx((0, 0))


def test_cloud_bulges_outward_either_winding():
    ccw = list(reversed(SQUARE))  # (0,20) → (20,20) → (20,0) → (0,0)
    tops = [b[3] for b in cloud_beziers(ccw, 1)[0::2]]
    assert all(not (0 < x < 20 and 0 < y < 20) for x, y in tops)
    assert cloud_beziers(ccw, 1)[0][3] == (5, 25)  # first edge (0,20)→(20,20): bulges down


def test_cloud_short_edges_get_one_arc():
    assert len(cloud_beziers([(0, 0), (4, 0), (2, 3)], 1)) == 6
    assert cloud_beziers([(0, 0), (0, 0), (4, 0), (2, 3)], 1)[0][0] == (0, 0)  # zero-length edge skipped


def test_polygon_closed_and_filled(ctx):
    out = bake(make_pdf(pages=1), ops(shape(kind="polygon", points=[[100, 100], [200, 100], [150, 180]], fill="#0000ff")), ctx)
    (d,) = drawings(out)
    assert d["type"] == "fs" and d["fill"] == (0.0, 0.0, 1.0) and d["color"] == (1.0, 0.0, 0.0)
    assert len(d["items"]) == 3 and d["items"][-1][2] == pymupdf.Point(100, 100)  # closed back to the start
    assert tuple(d["rect"]) == pytest.approx((100, 100, 200, 180), abs=0.01)


def test_polyline_is_open(ctx):
    out = bake(make_pdf(pages=1), ops(shape(kind="polyline", points=[[100, 100], [200, 100], [150, 180]], fill="#0000ff")), ctx)
    (d,) = drawings(out)
    assert d["type"] == "s" and d["fill"] is None and len(d["items"]) == 2


def test_cloud_is_bezier_path_outside_polygon(ctx):
    pts = [[100, 100], [140, 100], [140, 140], [100, 140]]
    out = bake(make_pdf(pages=1), ops(shape(kind="cloud", points=pts, width=1)), ctx)
    (d,) = drawings(out)
    assert {item[0] for item in d["items"]} == {"c"} and len(d["items"]) == 32  # 4 edges × 4 arcs × 2
    assert tuple(d["rect"]) == pytest.approx((95, 95, 145, 145), abs=0.1)  # half circles of radius 5


@pytest.mark.parametrize("dash, pattern, cap", [("dashed", "[ 6 4 ] 0", 0), ("dotted", "[ 0 4 ] 0", 1)])
def test_dashed_strokes(ctx, dash, pattern, cap):
    out = bake(make_pdf(pages=1), ops(
        shape(id="r", kind="rect", rect={"x": 100, "y": 100, "w": 100, "h": 50}, dash=dash),
        shape(id="e", kind="ellipse", rect={"x": 100, "y": 200, "w": 100, "h": 50}, dash=dash),
        shape(id="l", kind="line", points=[[100, 300], [200, 300]], dash=dash),
    ), ctx)
    ds = drawings(out)
    assert len(ds) == 3
    for d in ds:
        assert d["dashes"] == pattern and d["lineCap"][0] == cap


def test_solid_line_keeps_round_caps(ctx):
    out = bake(make_pdf(pages=1), ops(shape(kind="line", points=[[100, 300], [200, 300]])), ctx)
    (d,) = drawings(out)
    assert d["lineCap"][0] == 1 and d["dashes"] == "[] 0"
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_bake_shapes.py`
Expected: FAIL: `ModuleNotFoundError: edith.bake.geometry`

- [ ] **Step 3: Implement**

Modify `apps/api/edith/bake/draw.py`:

```diff
--- a/apps/api/edith/bake/draw.py
+++ b/apps/api/edith/bake/draw.py
@@ -2,6 +2,7 @@ import math
 
 import pymupdf
 
+from edith.bake.geometry import BUTT, ROUND, cloud_beziers, dash_pattern, dashes_arg
 from edith.bake.registry import register
 from edith.bake.util import rgb, to_rect
 from edith.ops import ImageAdd, InkAdd, RedactAdd, ShapeAdd, SignatureAdd, WhiteoutAdd
@@ -27,17 +28,36 @@ def _arrow_head(p1, p2, width: float):
     return [pymupdf.Point(left), pymupdf.Point(p2), pymupdf.Point(right)]
 
 
+def _stroke_style(op: ShapeAdd, cap: int) -> dict:
+    """dashes/lineCap of the shape's stroke (`cap` for solid strokes)."""
+    pattern = dash_pattern(op.dash, op.width)
+    if pattern is None:
+        return {"lineCap": cap}
+    return {"dashes": dashes_arg(pattern[0]), "lineCap": pattern[1]}
+
+
 @register("shape.add")
 def shape(page: pymupdf.Page, op: ShapeAdd, ctx) -> None:
     stroke = rgb(op.stroke) if op.width > 0 else None
     fill = rgb(op.fill) if op.fill else None
     if op.kind == "rect":
-        page.draw_rect(to_rect(op.rect), color=stroke, fill=fill, width=op.width)
+        page.draw_rect(to_rect(op.rect), color=stroke, fill=fill, width=op.width, **_stroke_style(op, BUTT))
     elif op.kind == "ellipse":
-        page.draw_oval(to_rect(op.rect), color=stroke, fill=fill, width=op.width)
+        page.draw_oval(to_rect(op.rect), color=stroke, fill=fill, width=op.width, **_stroke_style(op, BUTT))
+    elif op.kind in ("polygon", "polyline"):
+        closed = op.kind == "polygon"
+        page.draw_polyline([pymupdf.Point(p) for p in op.points], color=stroke, fill=fill if closed else None,
+                           width=op.width, closePath=closed, lineJoin=ROUND, **_stroke_style(op, ROUND))
+    elif op.kind == "cloud":
+        sh = page.new_shape()
+        for p0, c1, c2, p3 in cloud_beziers([tuple(p) for p in op.points], op.width):
+            sh.draw_bezier(p0, c1, c2, p3)
+        sh.finish(color=stroke, fill=fill, width=op.width, closePath=True, lineJoin=ROUND, **_stroke_style(op, ROUND))
+        sh.commit()
     else:
         p1, p2 = op.points
-        page.draw_line(pymupdf.Point(p1), pymupdf.Point(p2), color=rgb(op.stroke), width=max(op.width, 0.5), lineCap=1)
+        page.draw_line(pymupdf.Point(p1), pymupdf.Point(p2), color=rgb(op.stroke), width=max(op.width, 0.5),
+                       **_stroke_style(op, ROUND))
         if op.kind == "arrow":
             head = _arrow_head(p1, p2, op.width)
             page.draw_polyline(head, color=rgb(op.stroke), fill=rgb(op.stroke), width=0.5, closePath=True)
```

Create `apps/api/edith/bake/geometry.py`:

```python
"""Shape geometry shared with apps/web/src/lib/geometry.ts — change both together (both test suites pin
the same numbers).

- Dash patterns, in multiples of the stroke width w' = max(width, 0.5): dashed = [3w', 2w'] with butt caps,
  dotted = [0, 2w'] with round caps (round dots).
- Cloud border: each edge of the closed polygon is split into n = floor(len / arc + 0.5) (at least 1)
  equal chords, arc = CLOUD_ARC + CLOUD_ARC_PER_WIDTH · width; every chord gets a half circle bulging
  out of the polygon, drawn as two cubic Béziers (KAPPA)."""
import math

Pt = tuple[float, float]
Bezier = tuple[Pt, Pt, Pt, Pt]

KAPPA = 0.5522847498  # 4/3·tan(π/8): a quarter circle as one cubic Bézier
CLOUD_ARC = 8.0
CLOUD_ARC_PER_WIDTH = 2.0
BUTT, ROUND = 0, 1


def dash_pattern(dash: str, width: float) -> tuple[list[float], int] | None:
    """(PDF dash array, line cap) of a non-solid stroke, None for solid."""
    w = max(width, 0.5)
    if dash == "dashed":
        return [3 * w, 2 * w], BUTT
    if dash == "dotted":
        return [0, 2 * w], ROUND
    return None


def dashes_arg(pattern: list[float]) -> str:
    """The `dashes` argument of PyMuPDF's drawing methods."""
    return "[" + " ".join(f"{v:g}" for v in pattern) + "] 0"


def signed_area2(points: list[Pt]) -> float:
    """Twice the signed area (shoelace); > 0 means clockwise on screen (y grows down)."""
    n = len(points)
    return sum(points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1] for i in range(n))


def cloud_beziers(points: list[Pt], width: float) -> list[Bezier]:
    """The scalloped border of the closed polygon `points`, as consecutive cubic Béziers."""
    arc = CLOUD_ARC + CLOUD_ARC_PER_WIDTH * width
    clockwise = signed_area2(points) > 0
    out: list[Bezier] = []
    n = len(points)
    for i in range(n):
        (px, py), (qx, qy) = points[i], points[(i + 1) % n]
        length = math.hypot(qx - px, qy - py)
        if length == 0:
            continue
        ux, uy = (qx - px) / length, (qy - py) / length
        nx, ny = (uy, -ux) if clockwise else (-uy, ux)  # outward normal
        count = max(1, math.floor(length / arc + 0.5))
        for k in range(count):
            ax, ay = px + (qx - px) * k / count, py + (qy - py) * k / count
            bx, by = px + (qx - px) * (k + 1) / count, py + (qy - py) * (k + 1) / count
            r = length / count / 2
            mx, my = (ax + bx) / 2, (ay + by) / 2
            top = (mx + r * nx, my + r * ny)
            k_r = KAPPA * r
            out.append(((ax, ay), (ax + k_r * nx, ay + k_r * ny), (top[0] - k_r * ux, top[1] - k_r * uy), top))
            out.append((top, (top[0] + k_r * ux, top[1] + k_r * uy), (bx + k_r * nx, by + k_r * ny), (bx, by)))
    return out
```


- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q`
Expected: 326 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/bake/draw.py apps/api/edith/bake/geometry.py apps/api/tests/test_bake_shapes.py
git commit -m "feat(api): bake polygons, polylines, clouds and dashed strokes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
