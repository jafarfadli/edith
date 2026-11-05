import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from edith.ops import ExportRequest, PagesLayout, ShapeAdd, TextAdd
from edith.settings import REPO_ROOT
from scripts.export_schema import build_schema

OPS_DIR = REPO_ROOT / "packages" / "ops"


def test_example_validates():
    data = json.loads((OPS_DIR / "examples" / "basic.json").read_text())
    req = ExportRequest.model_validate(data)
    types = [op.type for op in req.ops]
    assert types == ["pages.layout", "text.add", "shape.add", "ink.add", "whiteout.add", "redact.add", "image.add"]
    assert isinstance(req.ops[1], TextAdd)


def test_schema_file_is_fresh():
    on_disk = json.loads((OPS_DIR / "schema.json").read_text())
    assert on_disk == build_schema(), "run: cd apps/api && uv run python -m scripts.export_schema"


def test_shape_requires_rect_for_rect_kind():
    with pytest.raises(ValidationError):
        ShapeAdd.model_validate({"id": "a", "type": "shape.add", "pageKey": "o0", "kind": "rect", "stroke": "#000000", "width": 1})


def test_line_requires_two_points():
    with pytest.raises(ValidationError):
        ShapeAdd.model_validate({"id": "a", "type": "shape.add", "pageKey": "o0", "kind": "line", "points": [[0, 0]], "stroke": "#000000", "width": 1})


def test_bad_color_and_pagekey_rejected():
    with pytest.raises(ValidationError):
        ShapeAdd.model_validate({"id": "a", "type": "shape.add", "pageKey": "x1", "kind": "rect", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}, "stroke": "red", "width": 1})


def test_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [], "bogus": 1})


def test_only_one_layout_and_unique_ids():
    layout = {"id": "L", "type": "pages.layout", "pages": [{"pageKey": "o0", "src": {"doc": "d", "index": 0}}]}
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [layout, {**layout, "id": "L2"}]})
    w = {"id": "same", "type": "whiteout.add", "pageKey": "o0", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}}
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [w, w]})


def test_layout_page_keys_unique():
    with pytest.raises(ValidationError):
        PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": [
            {"pageKey": "o0", "src": {"doc": "d", "index": 0}},
            {"pageKey": "o0", "src": {"doc": "d", "index": 0}},
        ]})


def test_too_many_ops():
    w = {"type": "whiteout.add", "pageKey": "o0", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}}
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [{**w, "id": str(i)} for i in range(5001)]})


def test_layout_pages_are_bounded():
    page = {"pageKey": "u0", "src": {"blank": {"width": 10, "height": 10}}}
    pages = [dict(page, pageKey=f"u{i}") for i in range(1001)]
    with pytest.raises(ValidationError):
        PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": pages})
    PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": pages[:1000]})
