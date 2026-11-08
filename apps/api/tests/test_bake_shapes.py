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
