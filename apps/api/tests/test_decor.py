"""Drawn decorations (underline, strikethrough, highlight) of original text: GET /text reports them on the runs, a
text.edit removes the marks of the lines it redraws and draws them again under the new text; nothing else is touched."""
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.bake.text import decor_bands, kept_lines
from edith.extract import extract_text
from edith.fonts import FontRegistry
from edith.ops import ExportRequest, Run, TextBox
from edith.paragraphs import extract_paragraphs
from edith.settings import Settings
from tests.pdfs import DECOR_G0, HELV, make_decor_pdf

DOC = "D" * 22
ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}
UL = {"underline": True, "underlineTop": 0.1, "decorThickness": 0.067}
# The marks make_decor_pdf() draws, as painted rects (x0, y0, x1, y1).
G0_LINE1 = (132.71, 101.2, 188.74, 102.0)
G0_LINE2 = (72.0, 115.2, 207.4, 116.0)
G3_BAR = (72.0, 241.2, 186.72, 242.0)


@pytest.fixture
def ctx() -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=FontRegistry(Settings().fonts_dir))


def paragraphs(data: bytes) -> list[dict]:
    return extract_text(pymupdf.open(stream=data, filetype="pdf"), FontRegistry(Settings().fonts_dir))["pages"][0]["paragraphs"]


def ops(*items):
    return ExportRequest.model_validate({"ops": list(items)}).ops


def reload(doc: pymupdf.Document) -> pymupdf.Document:
    return pymupdf.open(stream=doc.tobytes(garbage=3, deflate=True), filetype="pdf")


def drawn(page) -> list[tuple]:
    """(x0, y0, x1, y1) of every drawn piece (filled rects; strokes with their half width), rounded."""
    out = []
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] == "re":
                r = it[1]
            elif it[0] == "l":
                w = (d.get("width") or 0) / 2
                r = pymupdf.Rect(min(it[1].x, it[2].x), it[1].y - w, max(it[1].x, it[2].x), it[2].y + w)
            else:
                continue
            out.append(tuple(round(v, 1) for v in r))
    return out


def has(page, rect: tuple) -> bool:
    return any(all(abs(a - b) <= 0.15 for a, b in zip(r, rect)) for r in drawn(page))


NEIGHBOURS = [
    (60.0, 118.8, 540.0, 119.2),   # table border just below g0
    (115.0, 201.2, 300.0, 201.8),  # fill-in line after "Nama :"
    G3_BAR,                        # the next paragraph's own underline
    (72.0, 279.8, 250.0, 280.2),   # signature line
]


def test_runs_carry_the_drawn_decorations_and_lines_their_marks():
    ps = paragraphs(make_decor_pdf())
    g0, g1, g2, g3 = ps[:4]
    assert [(r["text"], r.get("underline", False)) for r in g0["runs"]] == [
        ("Alpha beta ", False), ("underlined", True), (" gamma delta ", False), (DECOR_G0[1], True)]
    under = g0["runs"][1]
    assert under["underlineTop"] == pytest.approx(0.1, abs=0.002)
    assert under["decorThickness"] == pytest.approx(0.8 / 12, abs=0.002)
    assert "decorColor" not in under  # drawn in the text colour
    assert [len(line.get("decor", [])) for line in g0["lines"]] == [1, 1]
    struck, plain, lit = g1["runs"]
    assert struck["text"] == "Struck" and struck["strike"] and struck["decorColor"] == "#ff0000"
    assert struck["strikeTop"] == pytest.approx((156.05 - 160) / 12, abs=0.002)
    assert "strike" not in plain and "bgColor" not in plain
    assert lit["text"] == "highlighted" and lit["bgColor"] == "#ffff00"
    # A fill-in line, a table border and a signature line are no decoration.
    assert g2["runs"] == [{k: v for k, v in g2["runs"][0].items() if k not in ("underline", "bgColor")}]
    assert "decor" not in g2["lines"][0]
    assert g3["runs"][0]["underline"]
    every = [d for p in ps for line in p["lines"] for d in line.get("decor", [])]
    assert len(every) == 5  # two bars of g0, strike and highlight of g1, g3's bar


def test_a_mark_whose_removal_would_take_something_else_is_not_reported():
    g3 = paragraphs(make_decor_pdf(extra=True))[3]
    assert not g3["runs"][0].get("underline") and "decor" not in g3["lines"][0]


def g0_edit(line1_runs: list[dict], line1_segments: list[dict], line2_run: dict, source2=1, rect_x=72.0):
    """A text.edit of g0: line 1 redrawn from `line1_*` (runs 0 …), line 2 from `line2_run` (kept when `source2`)."""
    runs = [*line1_runs, line2_run]
    line2 = {"baseline": 26.0, "segments": [{"x": 0, "text": line2_run["text"].strip(), "runIndex": len(runs) - 1}]}
    if source2 is not None:
        line2["source"] = source2
    return {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0",
            "box": {"rect": {"x": rect_x, "y": 88.0, "w": 300, "h": 30}, "align": "left", "lineHeight": 14,
                    "paragraphs": [runs], "layout": [{"baseline": 12.0, "segments": line1_segments}, line2]}}


def run(text: str, **style) -> dict:
    return {"text": text, "font": ARIMO, "size": 12.0, "color": "#000000", **style}


def test_an_edit_moves_the_underline_with_its_word_and_leaves_every_other_line_alone(ctx):
    w = HELV.text_length("Alpha ", 12)
    op = g0_edit([run("Alpha "), run("underlined ", **UL)],
                 [{"x": 0, "text": "Alpha ", "runIndex": 0}, {"x": w, "text": "underlined", "runIndex": 1}],
                 run(DECOR_G0[1], **UL))
    out = reload(bake(make_decor_pdf(), ops(op), ctx))
    page = out[0]
    assert not has(page, G0_LINE1)  # the old bar is gone …
    new = (round(72 + w, 1), 101.2, round(72 + w + HELV.text_length("underlined", 12), 1), 102.0)
    assert has(page, new)            # … and a new one runs under the word where it is now
    assert has(page, G0_LINE2)       # the kept line keeps its own bar
    for r in NEIGHBOURS:
        assert has(page, r), r
    assert has(page, (132.7, 149.2, 190.7, 163.0)) and has(page, (72.0, 156.1, 106.0, 156.8))  # g1's marks
    # Pixels: under the new word dark, where the old bar ran past it white.
    pix = page.get_pixmap(dpi=288, clip=pymupdf.Rect(60, 101.3, 200, 101.9))
    zoom = 4

    def dark(x):
        return sum(pix.pixel(int((x - 60) * zoom), 1)) < 200
    assert dark(72 + w + 5) and dark(72 + w + 50)
    assert not dark(72 + w + HELV.text_length("underlined", 12) + 3)


def test_an_edit_that_drops_the_underline_removes_it(ctx):
    w = HELV.text_length("Alpha ", 12)
    op = g0_edit([run("Alpha "), run("underlined ")],
                 [{"x": 0, "text": "Alpha ", "runIndex": 0}, {"x": w, "text": "underlined", "runIndex": 1}],
                 run(DECOR_G0[1]), source2=1)  # line 2 no longer underlined: not kept, redrawn plain
    page = reload(bake(make_decor_pdf(), ops(op), ctx))[0]
    assert not has(page, G0_LINE1) and not has(page, G0_LINE2)
    assert not any(abs(r[1] - 115.2) < 0.2 or abs(r[1] - 101.2) < 0.2 for r in drawn(page))  # no bar drawn anew
    for r in NEIGHBOURS:
        assert has(page, r), r


def test_deleting_a_paragraph_removes_its_decorations_only(ctx):
    op = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g1",
          "box": {"rect": {"x": 72, "y": 148, "w": 200, "h": 16}, "align": "left", "lineHeight": 14,
                  "paragraphs": [[run("")]], "layout": [{"baseline": 12.0, "segments": []}]}}
    page = reload(bake(make_decor_pdf(), ops(op), ctx))[0]
    assert "Struck" not in page.get_text()
    assert not has(page, (132.7, 149.2, 190.7, 163.0)) and not has(page, (72.0, 156.1, 106.0, 156.8))
    for r in [G0_LINE1, G0_LINE2, *NEIGHBOURS]:
        assert has(page, r), r


def test_an_unsafe_mark_stays(ctx):
    op = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g3",
          "box": {"rect": {"x": 72, "y": 228, "w": 200, "h": 16}, "align": "left", "lineHeight": 14,
                  "paragraphs": [[run("")]], "layout": [{"baseline": 12.0, "segments": []}]}}
    page = reload(bake(make_decor_pdf(extra=True), ops(op), ctx))[0]
    assert "Neighbour" not in page.get_text()
    assert has(page, G3_BAR) and has(page, (100.0, 241.4, 100.4, 241.7))


def test_a_page_with_its_own_pending_redactions_keeps_its_marks(ctx):
    """The decoration pass would apply the PDF's own unapplied redaction annotations in its mode (line art they cover
    goes): on such a page it does not run, the marks stay (as before decorations were moved)."""
    doc = pymupdf.open(stream=make_decor_pdf(), filetype="pdf")
    doc[0].add_redact_annot(pymupdf.Rect(400, 500, 450, 520))
    op = g0_edit([run("Alpha "), run("underlined ", **UL)],
                 [{"x": 0, "text": "Alpha ", "runIndex": 0}, {"x": HELV.text_length("Alpha ", 12), "text": "underlined", "runIndex": 1}],
                 run(DECOR_G0[1], **UL))
    page = reload(bake(doc.tobytes(), ops(op), ctx))[0]
    assert has(page, G0_LINE1) and has(page, G0_LINE2)
    for r in NEIGHBOURS:
        assert has(page, r), r


def test_a_line_kept_with_its_underline_keeps_it_and_is_not_redrawn(ctx):
    data = make_decor_pdf()
    p = extract_paragraphs(pymupdf.open(stream=data, filetype="pdf")[0], lambda s: {"name": s["font"]})[0]
    box = TextBox.model_validate(g0_edit([run("Alpha ")], [{"x": 0, "text": "Alpha", "runIndex": 0}],
                                         run(DECOR_G0[1], **UL))["box"])
    assert kept_lines(box, p, lambda f: frozenset()) == {1: 1}
    other = TextBox.model_validate(g0_edit([run("Alpha ")], [{"x": 0, "text": "Alpha", "runIndex": 0}],
                                           run(DECOR_G0[1], **{**UL, "underlineTop": 0.2}))["box"])
    assert kept_lines(other, p, lambda f: frozenset()) == {}  # another underline: redrawn


def test_a_kept_prefix_loses_its_mark_but_gets_its_decoration_drawn_again(ctx):
    # Line 2 keeps "second line" (its glyphs) and redraws the rest; its bar spans the whole line, so it goes and is
    # drawn again under the kept words and the new ones.
    rest_x = HELV.text_length("second line ", 12)
    runs = [run("Alpha beta "), run("underlined", **UL), run(" gamma delta "), run("second line ", **UL), run("changed", **UL)]
    line1 = [{"x": 0, "text": "Alpha beta ", "runIndex": 0}, {"x": HELV.text_length("Alpha beta ", 12), "text": "underlined", "runIndex": 1},
             {"x": HELV.text_length("Alpha beta underlined", 12), "text": " gamma delta", "runIndex": 2}]
    line2 = [{"x": 0, "text": "second line ", "runIndex": 3}, {"x": rest_x, "text": "changed", "runIndex": 4}]
    op = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0",
          "box": {"rect": {"x": 72, "y": 88, "w": 300, "h": 30}, "align": "left", "lineHeight": 14, "paragraphs": [runs],
                  "layout": [{"baseline": 12.0, "segments": line1, "source": 0},
                             {"baseline": 26.0, "segments": line2, "prefix": {"source": 1, "segments": 1}}]}}
    page = reload(bake(make_decor_pdf(), ops(op), ctx))[0]
    assert has(page, G0_LINE1)          # line 1 kept whole
    assert not has(page, G0_LINE2)      # line 2's bar went …
    end = 72 + rest_x + HELV.text_length("changed", 12)
    assert has(page, (72.0, 115.2, round(end, 1), 116.0))  # … and one bar runs under the kept words and the new one
    words = {w[4]: w for w in page.get_text("words") if 105 < w[3] < 118}
    assert "underlined" not in words and words["changed"][0] == pytest.approx(72 + rest_x, abs=0.5)
    assert words["second"][0] == pytest.approx(72, abs=0.5)  # the prefix's own glyphs


def test_decor_bands_use_the_originals_geometry_and_colour():
    r = Run.model_validate(run("x", underline=True, strike=True, underlineTop=0.12, strikeTop=-0.35, decorThickness=0.1,
                               decorColor="#ff0000", bgColor="#00ff00"))
    bands = {k: (rect, c) for k, rect, c in decor_bands(10, 100, 50, r)}
    assert bands["underline"] == (pymupdf.Rect(10, 101.44, 60, 102.64), "#ff0000")
    assert bands["strike"][0] == pymupdf.Rect(10, 95.8, 60, 97.0)
    assert bands["bg"][1] == "#00ff00"
    plain = {k: rect for k, rect, _ in decor_bands(10, 100, 50, Run.model_validate(run("x", underline=True)))}
    assert plain["underline"] == pymupdf.Rect(10, 100.9, 60, 101.62)  # the defaults: 0.075 / 0.06 × size


def test_decor_fixture_is_current():
    """apps/web/src/lib/fixtures/decor.json (regenerate: cd apps/api && uv run python -m scripts.decor_fixture)."""
    import json

    from scripts.decor_fixture import OUT, build
    assert json.loads(OUT.read_text()) == json.loads(json.dumps(build()))


def test_a_cropped_page_moves_the_right_marks(ctx):
    """Marks are found on the bake's page in the coordinates the paragraphs use (a CropBox off the origin)."""
    doc = pymupdf.open(stream=make_decor_pdf(), filetype="pdf")
    doc[0].set_cropbox(pymupdf.Rect(20, 30, 575, 800))
    data = doc.tobytes()
    ps = paragraphs(data)
    g0 = ps[0]
    bar = g0["lines"][0]["decor"][0]
    assert bar["x"] == pytest.approx(132.71 - 20, abs=0.05) and bar["y"] == pytest.approx(101.2 - 30, abs=0.05)
    op = {"id": "e", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0",
          "box": {"rect": {"x": 52, "y": 58, "w": 300, "h": 30}, "align": "left", "lineHeight": 14,
                  "paragraphs": [[run("")]], "layout": [{"baseline": 12.0, "segments": []}]}}
    page = reload(bake(data, ops(op), ctx))[0]
    left = drawn(page)
    assert not any(abs(r[1] - (101.2 - 30)) < 0.2 and abs(r[0] - (132.71 - 20)) < 0.2 for r in left)
    assert has(page, (40.0, 88.8, 520.0, 89.2))  # the table border, cropbox-relative
