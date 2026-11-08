import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from edith.ops import (STAMP_PRESETS, AnnotAdd, BundledFont, ExportRequest, FormSet, LinkAdd, OriginalFont, PageTarget, PagesLayout,
                       Run, ShapeAdd, StampAdd, TextAdd, TextEdit, UrlTarget)
from edith.settings import REPO_ROOT
from scripts.export_schema import build_schema

OPS_DIR = REPO_ROOT / "packages" / "ops"


def test_example_validates():
    data = json.loads((OPS_DIR / "examples" / "basic.json").read_text())
    req = ExportRequest.model_validate(data)
    types = [op.type for op in req.ops]
    assert types == ["pages.layout", "text.add", "shape.add", "ink.add", "whiteout.add", "redact.add", "image.add", "text.edit"]
    assert isinstance(req.ops[1], TextAdd)
    edit = req.ops[-1]
    assert isinstance(edit, TextEdit) and edit.paragraphId == "g0"
    first, second = edit.box.paragraphs[0]
    assert isinstance(first.font, OriginalFont) and first.font.ref == "f12"
    assert isinstance(second.font, BundledFont) and second.underline and second.bgColor == "#ffff00"


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


def _edit(op_id: str, page_key: str = "o0", paragraph_id: str = "g0") -> dict:
    return {"id": op_id, "type": "text.edit", "pageKey": page_key, "paragraphId": paragraph_id,
            "box": {"rect": {"x": 0, "y": 0, "w": 10, "h": 10}, "lineHeight": 12, "paragraphs": [], "layout": []}}


def test_one_text_edit_per_paragraph():
    ExportRequest.model_validate({"ops": [_edit("a"), _edit("b", paragraph_id="g1"), _edit("c", page_key="u-dup")]})
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [_edit("a"), _edit("b")]})


def test_paragraph_id_and_font_ref_patterns():
    with pytest.raises(ValidationError):
        TextEdit.model_validate(_edit("a", paragraph_id="p0"))
    run = {"text": "x", "size": 10, "color": "#000000"}
    assert Run.model_validate({**run, "font": {"kind": "original", "ref": "f3"}}).font == OriginalFont(kind="original", ref="f3")
    assert Run.model_validate({**run, "font": {"kind": "bundled", "family": "Arimo"}}).underline is False
    for bad in ({"kind": "original", "ref": "3"}, {"kind": "original"}, {"family": "Arimo", "ref": "f1"}):
        with pytest.raises(ValidationError):
            Run.model_validate({**run, "font": bad})


def test_annotations_example_validates():
    data = json.loads((OPS_DIR / "examples" / "annotations.json").read_text())
    req = ExportRequest.model_validate(data)
    assert [op.type for op in req.ops] == ["pages.layout", "signature.add", "stamp.add", "stamp.add", "symbol.add",
                                           "link.add", "link.add", "annot.add", "annot.add", "form.set", "form.set"]
    assert isinstance(req.ops[6].target, PageTarget) and req.ops[6].target.pageKey == "o1"
    assert isinstance(req.ops[5].target, UrlTarget)
    assert req.ops[3].custom.date == "05/11/2026"
    assert req.ops[-1].value is True and req.flatten_forms is True


def _annot(**kw) -> dict:
    return {"id": "a", "type": "annot.add", "pageKey": "o0", "color": "#ffeb3b", **kw}


QUAD = {"x": 0, "y": 0, "w": 10, "h": 10}


def test_annot_geometry():
    AnnotAdd.model_validate(_annot(kind="highlight", quads=[QUAD]))
    AnnotAdd.model_validate(_annot(kind="note", point=[1, 2], content="x"))
    for bad in (_annot(kind="highlight"), _annot(kind="underline", quads=[]), _annot(kind="strike", quads=[QUAD], point=[0, 0]),
                _annot(kind="note"), _annot(kind="note", point=[0, 0], quads=[QUAD]), _annot(kind="squiggly", quads=[QUAD])):
        with pytest.raises(ValidationError):
            AnnotAdd.model_validate(bad)


def test_stamp_needs_exactly_one_kind():
    base = {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": QUAD, "color": "#15803d"}
    assert len(STAMP_PRESETS) == 34 and len(set(STAMP_PRESETS)) == 34
    assert STAMP_PRESETS[:17] == ("approved", "not-approved", "draft", "final", "completed", "confidential", "for-public-release",
                                  "not-for-public-release", "for-comment", "void", "preliminary-results", "information-only",
                                  "witness", "initial-here", "sign-here", "accepted", "rejected")
    for preset in STAMP_PRESETS:
        StampAdd.model_validate({**base, "preset": preset})
    StampAdd.model_validate({**base, "preset": "disetujui"})
    StampAdd.model_validate({**base, "custom": {"text": "OK"}})
    for bad in (base, {**base, "preset": "approved", "custom": {"text": "OK"}}, {**base, "preset": "nope"},
                {**base, "custom": {"text": ""}}):
        with pytest.raises(ValidationError):
            StampAdd.model_validate(bad)


def test_link_targets():
    base = {"id": "l", "type": "link.add", "pageKey": "o0", "rect": QUAD}
    for ok in ({"url": "https://a.b/c?d=1"}, {"url": "http://x"}, {"url": "mailto:a@b.c"}, {"pageKey": "u-1"}):
        LinkAdd.model_validate({**base, "target": ok})
    for bad in ({"url": "javascript:alert(1)"}, {"url": "example.com"}, {"url": "https://a b"}, {"pageKey": "x"}, {}):
        with pytest.raises(ValidationError):
            LinkAdd.model_validate({**base, "target": bad})


def test_one_form_set_per_field():
    f = {"type": "form.set", "fieldName": "nama", "value": "x"}
    ExportRequest.model_validate({"ops": [{**f, "id": "a"}, {**f, "id": "b", "fieldName": "lain", "value": False}]})
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [{**f, "id": "a"}, {**f, "id": "b"}]})
    with pytest.raises(ValidationError):  # form.set is not page content
        FormSet.model_validate({**f, "id": "a", "pageKey": "o0"})
    with pytest.raises(ValidationError):
        FormSet.model_validate({**f, "id": "a", "value": 3})


def _shape(**kw) -> dict:
    return {"id": "s", "type": "shape.add", "pageKey": "o0", "stroke": "#000000", "width": 1, **kw}


def test_pages_example_validates():
    data = json.loads((OPS_DIR / "examples" / "pages.json").read_text())
    req = ExportRequest.model_validate(data)
    layout = req.ops[0]
    assert layout.pages[0].crop.w == 523 and layout.pages[1].crop is None
    assert [op.kind for op in req.ops[1:5]] == ["rect", "polygon", "cloud", "polyline"]
    assert req.ops[1].dash == "dashed" and req.ops[1].rotation == 30 and req.ops[1].opacity == 0.5
    assert req.ops[2].dash == "solid" and req.ops[2].opacity == 1 and req.ops[2].rotation == 0
    assert req.ops[5].rotation == -45 and req.ops[6].opacity == 0.4


def test_point_shapes_need_enough_points_and_no_rect():
    tri = [[0, 0], [10, 0], [5, 8]]
    for kind, pts in (("polygon", tri), ("cloud", tri), ("polyline", tri[:2]), ("line", tri[:2])):
        ShapeAdd.model_validate(_shape(kind=kind, points=pts))
    for bad in (_shape(kind="polygon", points=tri[:2]), _shape(kind="cloud", points=tri[:2]), _shape(kind="polyline", points=tri[:1]),
                _shape(kind="line", points=tri), _shape(kind="polygon", points=tri, rect=QUAD),
                _shape(kind="rect", rect=QUAD, points=tri[:2]), _shape(kind="polygon", points=tri, rotation=10),
                _shape(kind="rect", rect=QUAD, dash="dashdot")):
        with pytest.raises(ValidationError):
            ShapeAdd.model_validate(bad)


def test_opacity_and_rotation_ranges():
    ShapeAdd.model_validate(_shape(kind="rect", rect=QUAD, rotation=-360, opacity=0))
    for bad in (_shape(kind="rect", rect=QUAD, opacity=1.5), _shape(kind="rect", rect=QUAD, rotation=400)):
        with pytest.raises(ValidationError):
            ShapeAdd.model_validate(bad)
    # Only drawn objects carry them: a link has neither.
    with pytest.raises(ValidationError):
        LinkAdd.model_validate({"id": "l", "type": "link.add", "pageKey": "o0", "rect": QUAD, "target": {"url": "https://a.b"}, "opacity": 0.5})


def test_layout_crop_needs_positive_size():
    page = {"pageKey": "o0", "src": {"doc": "d", "index": 0}}
    PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": [{**page, "crop": {"x": 0, "y": 0, "w": 10, "h": 10}}]})
    for crop in ({"x": 0, "y": 0, "w": 0, "h": 10}, {"x": -1, "y": 0, "w": 10, "h": 10}):
        with pytest.raises(ValidationError):
            PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": [{**page, "crop": crop}]})


def test_form_set_and_original_fonts_may_name_a_document():
    ok = [{"id": "a", "type": "form.set", "fieldName": "n", "value": "x"},
          {"id": "b", "type": "form.set", "fieldName": "n", "value": "y", "doc": "IMPORTED"}]
    ExportRequest.model_validate({"ops": ok})
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [*ok, {"id": "c", "type": "form.set", "fieldName": "n", "value": "z", "doc": "IMPORTED"}]})
    run = {"text": "x", "size": 10, "color": "#000000"}
    assert Run.model_validate({**run, "font": {"kind": "original", "ref": "f3", "doc": "IMPORTED"}}).font.doc == "IMPORTED"
    with pytest.raises(ValidationError):
        Run.model_validate({**run, "font": {"kind": "original", "ref": "f3", "doc": "../x"}})


def test_layout_doc_id_must_be_a_valid_doc_id():
    import pytest
    from pydantic import ValidationError
    from edith.ops import ExportRequest
    bad = {"id": "L", "type": "pages.layout", "pages": [{"pageKey": "a", "src": {"doc": "../x", "index": 0}}]}
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [bad]})
