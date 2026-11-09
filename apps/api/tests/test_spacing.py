"""M5b F2: the original's horizontal scale (Tz), character spacing (Tc) and word spacing (per-word placement) are
measured into the runs, and text laid out and baked with them lands where the original glyphs were."""
import json
import re

import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.bake.text import run_width
from edith.doc_fonts import load_font
from edith.extract import extract_text
from edith.fonts import FontRegistry
from edith.ops import ExportRequest, Run
from edith.settings import Settings
from scripts.spacing_fixture import OUT as FIXTURE, build
from tests.pdfs import SPACING_GAP, SPACING_LINES, SPACING_Y, make_spacing_pdf

DOC = "D" * 22
TOL = 0.3  # pt: web layout width == bake width == original width


@pytest.fixture(scope="module")
def data() -> bytes:
    return make_spacing_pdf()


@pytest.fixture(scope="module")
def paragraphs(data) -> list[dict]:
    return extract_text(pymupdf.open(stream=data, filetype="pdf"), FontRegistry(Settings().fonts_dir))["pages"][0]["paragraphs"]


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=FontRegistry(Settings().fonts_dir))


def test_each_kind_of_spacing_is_measured_into_its_run(paragraphs):
    (tz,), (tc,), (tw,) = (p["runs"] for p in paragraphs)
    assert [p["runs"][0]["text"] for p in paragraphs] == [t for t, _s, _o in SPACING_LINES]
    # Tz 90: MuPDF reports 12·√0.9 = 11.38; the run carries the true size and the scale.
    assert tz["size"] == pytest.approx(12, abs=0.02) and tz["hScale"] == pytest.approx(0.9, abs=0.002)
    assert "charSpacing" not in tz and "wordSpacing" not in tz
    assert tc["charSpacing"] == pytest.approx(1.5, abs=0.01) and "hScale" not in tc and "wordSpacing" not in tc
    assert tw["wordSpacing"] == pytest.approx(SPACING_GAP / 1000 * 11, abs=0.02) and "charSpacing" not in tw
    assert all(r["font"]["kind"] == "original" for p in paragraphs for r in p["runs"])


def _layout(run: dict, font: pymupdf.Font) -> list[dict]:
    """lib/layout.ts placeSegments for one left-aligned line: one segment per glyph with charSpacing, per word and
    space with wordSpacing, else one segment; x advances by run_width (lib/fonts.ts textWidth)."""
    r = Run.model_validate(run)
    pieces = [run["text"]] if not (r.charSpacing or r.wordSpacing) else (
        list(run["text"]) if r.charSpacing else re.findall(r"\s+|\S+", run["text"]))
    segs, x = [], 0.0
    for piece in pieces:
        segs.append({"x": x, "text": piece, "runIndex": 0})
        x += run_width(font, piece, r)
    return segs


def _glyphs(page: pymupdf.Page, baseline: float) -> list[float]:
    return [c["origin"][0] for b in page.get_text("rawdict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"]
            for c in s["chars"] if not c["c"].isspace() and abs(c["origin"][1] - baseline) < 1]


@pytest.mark.parametrize("k", range(len(SPACING_LINES)))
def test_a_redrawn_line_lands_on_the_original_glyphs(data, paragraphs, ctx, k):
    """Width from the measured spacing == the original ink width, and every baked glyph on its original origin."""
    src = pymupdf.open(stream=data, filetype="pdf")
    p = paragraphs[k]
    run = p["runs"][0]
    font = load_font(src, int(run["font"]["ref"][1:]))
    r = Run.model_validate(run)
    # The ink ends at the last glyph's box: its advance, without the character spacing after it.
    assert run_width(font, run["text"], r) - r.charSpacing == pytest.approx(p["rect"]["w"], abs=TOL)
    ascent = font.ascender * r.size
    op = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": p["id"],
          "box": {"rect": {"x": p["rect"]["x"], "y": SPACING_Y[k] - ascent, "w": 449, "h": 20}, "align": "left",
                  "lineHeight": 20, "paragraphs": [[run]], "layout": [{"baseline": ascent, "segments": _layout(run, font)}]}}
    out = bake(data, ExportRequest.model_validate({"ops": [op]}).ops, ctx)
    before, after = _glyphs(src[0], SPACING_Y[k]), _glyphs(out[0], SPACING_Y[k])
    assert len(after) == len(before)
    assert max(abs(a - b) for a, b in zip(before, after)) < TOL


def test_a_kept_line_of_scaled_text_is_accepted_with_its_true_size(data, paragraphs, ctx):
    """The client sends the true size (12) and hScale; the bake's own extraction sees MuPDF's 11.38: still the same."""
    src = pymupdf.open(stream=data, filetype="pdf")
    p = paragraphs[0]
    run = p["runs"][0]
    op = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": p["id"],
          "box": {"rect": {"x": p["rect"]["x"], "y": 90, "w": 449, "h": 20}, "align": "left", "lineHeight": 20,
                  "paragraphs": [[run]],
                  "layout": [{"baseline": SPACING_Y[0] - 90, "source": 0,
                              "segments": [{"x": 0, "text": run["text"], "runIndex": 0}]}]}}
    out = bake(data, ExportRequest.model_validate({"ops": [op]}).ops, ctx)
    spans = lambda page: [(s["text"], s["origin"], s["size"]) for b in page.get_text("dict")["blocks"]  # noqa: E731
                          for ln in b.get("lines", []) for s in ln["spans"]]
    assert spans(out[0]) == spans(src[0])  # kept: nothing redacted, nothing drawn


def test_spacing_fixture_is_current():
    """apps/web/src/lib/fixtures/spacing.json (regenerate: cd apps/api && uv run python -m scripts.spacing_fixture)."""
    assert json.loads(FIXTURE.read_text()) == json.loads(json.dumps(build()))
