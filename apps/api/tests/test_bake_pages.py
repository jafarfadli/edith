import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.bake.registry import HANDLERS, PHASE
from edith.errors import BakeFailed, InvalidOp
from edith.fonts import FontRegistry
from edith.ops import PagesLayout, WhiteoutAdd
from edith.settings import Settings
from tests.pdfs import make_pdf

DOC = "D" * 22


@pytest.fixture
def ctx(tmp_path) -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: tmp_path / a, fonts=FontRegistry(Settings().fonts_dir))


def texts(doc) -> list[str]:
    return [" ".join(p.get_text().split()) for p in doc]


def layout(*pages) -> PagesLayout:
    return PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": list(pages)})


def src(i, key=None, rotate=0):
    return {"pageKey": key or f"o{i}", "src": {"doc": DOC, "index": i}, "rotate": rotate}


def mark(key: str, op_id: str = "m") -> WhiteoutAdd:
    return WhiteoutAdd.model_validate({"id": op_id, "type": "whiteout.add", "pageKey": key, "rect": {"x": 0, "y": 0, "w": 1, "h": 1}})


@pytest.fixture
def marker(monkeypatch):
    """Replace the whiteout handler with one that writes MARK, so page tests stay independent of Task 7."""
    def handler(page, op, ctx):
        page.insert_text((72, 200), f"MARK-{op.id}", fontsize=12)
    monkeypatch.setitem(HANDLERS, "whiteout.add", handler)
    monkeypatch.setitem(PHASE, "whiteout.add", "draw")


def test_default_layout_keeps_pages(ctx):
    out = bake(make_pdf(pages=3), [], ctx)
    assert texts(out) == ["Page 0", "Page 1", "Page 2"]


def test_reorder_and_delete(ctx):
    out = bake(make_pdf(pages=3), [layout(src(2), src(0))], ctx)
    assert texts(out) == ["Page 2", "Page 0"]


def test_duplicate_pages_do_not_share_content(ctx, marker):
    ops = [layout(src(0), src(0, key="u-dup")), mark("u-dup")]
    out = bake(make_pdf(pages=1), ops, ctx)
    assert texts(out) == ["Page 0", "Page 0 MARK-m"]


def test_blank_page(ctx):
    ops = [layout(src(0), {"pageKey": "u-b", "src": {"blank": {"width": 300, "height": 400}}})]
    out = bake(make_pdf(pages=1), ops, ctx)
    assert out.page_count == 2
    assert (out[1].rect.width, out[1].rect.height) == (300, 400)
    assert texts(out)[1] == ""


def test_rotation_adds_to_source_rotation(ctx):
    out = bake(make_pdf(pages=2, rotation=90), [layout(src(0, rotate=90), src(1))], ctx)
    assert [p.rotation for p in out] == [180, 90]


def test_content_drawn_before_rotation_uses_unrotated_coords(ctx, marker):
    out = bake(make_pdf(pages=1), [layout(src(0, rotate=90)), mark("o0")], ctx)
    words = out[0].get_text("words")
    m = next(w for w in words if w[4] == "MARK-m")
    assert abs(m[0] - 72) < 1  # x in unrotated space is unchanged


def test_unknown_page_key(ctx, marker):
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), [layout(src(0)), mark("o5")], ctx)
    assert e.value.extra["op_index"] == 1


def test_deleted_page_ops_are_invalid(ctx, marker):
    with pytest.raises(InvalidOp):
        bake(make_pdf(pages=2), [layout(src(1)), mark("o0")], ctx)


def test_bad_source(ctx):
    with pytest.raises(InvalidOp) as e:
        bake(make_pdf(pages=1), [layout(src(3))], ctx)
    assert e.value.extra["op_index"] == 0
    bad_doc = {"pageKey": "o0", "src": {"doc": "X" * 22, "index": 0}}
    with pytest.raises(InvalidOp):
        bake(make_pdf(pages=1), [layout(bad_doc)], ctx)


def test_handler_failure_reports_op_id(ctx, monkeypatch):
    def boom(page, op, ctx):
        raise RuntimeError("kaboom")
    monkeypatch.setitem(HANDLERS, "whiteout.add", boom)
    monkeypatch.setitem(PHASE, "whiteout.add", "draw")
    with pytest.raises(BakeFailed) as e:
        bake(make_pdf(pages=1), [mark("o0", op_id="bad")], ctx)
    assert e.value.extra["op_id"] == "bad"
