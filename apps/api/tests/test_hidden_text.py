"""Invisible text over a picture of it (a letterhead from iLovePDF, a scan with an OCR layer) is edited like an OCR
paragraph: its words are the invisible text's, its lines are measured in the picture (edith.hiddentext), and an edit is
a text.ocr_edit op whose covers hide the old print and whose bake removes the invisible words under them."""
import numpy as np
import pymupdf
import pytest

from edith.bake import bake
from edith.bake.context import BakeContext
from edith.fonts import FontRegistry
from edith.hiddentext import hidden_text
from edith.ops import ExportRequest
from edith.paragraphs import extract_paragraphs
from edith.settings import Settings
from tests.pdfs import (KOP_BODY, KOP_INK, KOP_LINES, SCAN_RECT, make_clip_text_pdf, make_hidden_text_pdf,
                        make_kop_pdf, make_picture_text_pdf)
from tests.test_documents import upload

DOC = "D" * 22
DPI = 144
NEW = "KEMENTERIAN BARU"


@pytest.fixture(scope="module")
def registry() -> FontRegistry:
    return FontRegistry(Settings().fonts_dir)


@pytest.fixture
def ctx(registry) -> BakeContext:
    return BakeContext(doc_id=DOC, asset_path=lambda a: None, fonts=registry)


def page_of(data: bytes) -> pymupdf.Page:
    return pymupdf.open(stream=data, filetype="pdf")[0]


def text(p: dict) -> str:
    return "".join(r["text"] for r in p["runs"])


def R(r: dict) -> pymupdf.Rect:
    return pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])


def print_box(line: str, size: float, x: float, base: float) -> pymupdf.Rect:
    """The ink of `line` printed in Helvetica Bold at (x, base), as the fixtures picture it."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=200)
    page.insert_text((x, base), line, fontname="hebo", fontsize=size)
    pix = page.get_pixmap(dpi=288, colorspace=pymupdf.csGRAY)
    g = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width) < 128
    ys, xs = np.nonzero(g)
    s = 72 / 288
    return pymupdf.Rect(xs.min() * s, ys.min() * s, (xs.max() + 1) * s, (ys.max() + 1) * s)


def test_the_kop_lines_are_measured_in_their_pictures(registry):
    """One picture per line, the invisible text in Times Bold one point smaller and 2.5 pt lower: each line's box is the
    print's ink, its baseline the print's, its size the bundled sans face's that gives the print's height."""
    page = page_of(make_kop_pdf())
    locked = {p["id"]: text(p) for p in extract_paragraphs(page) if p.get("lock") == "hidden"}
    found = hidden_text(page, registry)
    assert [(p["id"], p["replaces"], text(p)) for p in found] == [
        ("hg1", "g1", locked["g1"]), ("hg2", "g2", locked["g2"])]
    lines = [ln for p in found for ln in p["lines"]]
    for ln, (line, size, rect, base) in zip(lines, KOP_LINES):
        ink = print_box(line, size, rect[0] + 2, base)
        got = R(ln["rect"])
        assert abs(got.x0 - ink.x0) < 0.6 and abs(got.x1 - ink.x1) < 0.6, (line, got, ink)  # the print, not the narrower text
        assert abs(got.y0 - ink.y0) < 0.6 and abs(got.y1 - ink.y1) < 0.6, (line, got, ink)
        assert abs(ln["baseline"] - base) < 0.5
        # The bundled face at the measured size stands as tall as the print (its capitals are a little shorter).
        assert size < ln["size"] < size * 1.12
    for p in found:
        assert p["source"] == "hidden" and p["ocr"] is True and p["confidence"] == 1.0 and p["editable"] is True
        assert p["align"] == "left" and p["coverColor"] == "#ffffff" and p["coverUniform"] is True
        assert len(p["covers"]) == len(p["lines"])
        for run in p["runs"]:
            assert run["font"] == {"kind": "bundled", "family": "Arimo", "bold": True, "italic": False}
            ink = [int(run["color"][i:i + 2], 16) for i in (1, 3, 5)]
            assert all(abs(v - 255 * c) <= 12 for v, c in zip(ink, KOP_INK))  # the print's grey, not the text's black


def test_covers_hold_the_print_and_never_another_line(registry):
    found = hidden_text(page_of(make_kop_pdf()), registry)
    covers = [R(c) for p in found for c in p["covers"]]
    inks = [R(ln["rect"]) for p in found for ln in p["lines"]]
    for cover, ink in zip(covers, inks):
        assert cover.contains(ink)
        assert all(not cover.intersects(other) for other in inks if other is not ink)
    for a, b in zip(covers, covers[1:]):
        assert not a.intersects(b) or (a & b).height < 0.5
    # Inside the pictures: never over the logo at the left (x < 112) or the rule below (y 115).
    assert all(c.x0 >= 140 and c.y1 < 115 for c in covers)


def ocr_edit(p: dict, new: str, op_id: str = "e") -> dict:
    """The text.ocr_edit the client sends for hidden paragraph `p` rewritten as one line of `new` in its first run's
    style (as the web lays it out: at its first line's baseline, from its left edge)."""
    run = dict(p["runs"][0], text=new)
    box = R(p["rect"])
    base = p["lines"][0]["baseline"] - box.y0
    return {"id": op_id, "type": "text.ocr_edit", "pageKey": "o0", "paragraphId": p["id"], "cover": p["cover"],
            "covers": p["covers"], "coverColor": p["coverColor"],
            "box": {"rect": {"x": box.x0, "y": box.y0, "w": p["maxWidth"], "h": box.height}, "align": "left",
                    "lineHeight": p["lineHeight"], "paragraphs": [[run]],
                    "layout": [{"baseline": base, "segments": [{"x": 0, "text": new, "runIndex": 0}]}]}}


def pixels(data_or_doc) -> np.ndarray:
    doc = data_or_doc if isinstance(data_or_doc, pymupdf.Document) else pymupdf.open(stream=data_or_doc, filetype="pdf")
    pix = doc[0].get_pixmap(dpi=DPI, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(int)


def mask(rects: list[pymupdf.Rect], shape: tuple, grow: int = 1) -> np.ndarray:
    m = np.zeros(shape[:2], dtype=bool)
    s = DPI / 72
    for r in rects:
        m[max(int(r.y0 * s) - grow, 0):int(np.ceil(r.y1 * s)) + grow,
          max(int(r.x0 * s) - grow, 0):int(np.ceil(r.x1 * s)) + grow] = True
    return m


def test_an_edited_kop_line_covers_its_print_draws_the_new_text_once_and_drops_the_old_words(registry, ctx):
    source = make_kop_pdf()
    p = hidden_text(page_of(source), registry)[0]
    op = ocr_edit(p, NEW)
    out = bake(source, ExportRequest.model_validate({"ops": [op]}).ops, ctx)
    before, after = pixels(source), pixels(out)
    covers = [R(c) for c in p["covers"]]
    # Outside the covers (and the new text's line) the page is as it was: the logo, the next paragraph, the rule.
    new_line = pymupdf.Rect(p["rect"]["x"], p["lines"][0]["baseline"] - 14, p["rect"]["x"] + 200,
                            p["lines"][0]["baseline"] + 4)
    changed = np.any(before != after, axis=2)
    assert not (changed & ~mask(covers + [new_line], before.shape)).any()
    # Inside the second line's cover, where nothing new is drawn: paper only.
    second = covers[1]
    s = DPI / 72
    region = after[int(second.y0 * s) + 1:int(second.y1 * s) - 1, int(second.x0 * s) + 1:int(second.x1 * s) - 1]
    assert (region >= 250).all()
    page = pymupdf.open(stream=out.tobytes(), filetype="pdf")[0]
    words = page.get_text()
    assert words.count(NEW) == 1
    assert "SEKRETARIAT" not in words and "DIGITAL" not in words  # the invisible words under the covers went
    assert "BIRO UMUM DAN ORGANISASI" in words and KOP_BODY in words  # the next hidden paragraph, the visible line
    # The new text is the picture's grey, in the bundled sans face, on the print's baseline.
    span = next(s for b in page.get_text("dict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"]
                if NEW in s["text"])
    assert "Arimo" in span["font"] and abs(span["origin"][1] - p["lines"][0]["baseline"]) < 0.05
    assert abs(span["bbox"][0] - p["rect"]["x"]) < 1.5


def test_e2e_kop_fixture_is_current():
    """apps/web/e2e/fixtures/kop.pdf (regenerate: cd apps/api && uv run python -m scripts.e2e_kop_pdf)."""
    from pathlib import Path
    fixture = Path(__file__).resolve().parents[2] / "web" / "e2e" / "fixtures" / "kop.pdf"
    assert fixture.read_bytes() == make_kop_pdf()


def test_hidden_text_of_the_e2e_fixtures(registry):
    for data in (make_picture_text_pdf(), make_hidden_text_pdf(), make_hidden_text_pdf("opacity")):
        found = hidden_text(page_of(data), registry)
        assert [p["id"] for p in found] == ["hg1", "hg2"]
        assert all(R(c).x0 >= SCAN_RECT[0] and R(c).x1 <= SCAN_RECT[2] for p in found for c in p["covers"])


def test_without_a_picture_under_it_invisible_text_stays_locked(registry):
    page = page_of(make_clip_text_pdf(3, clip_first=True))
    assert [p.get("lock") for p in extract_paragraphs(page)] == [None, "hidden"]
    assert hidden_text(page, registry) == []


def hidden_over(pixmap: pymupdf.Pixmap | None, line: str, size: float = 13, rotation: int = 0) -> bytes:
    """`line` as invisible text at (76, 80) over `pixmap` in (72, 60)–(432, 100), or over nothing."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    if pixmap is not None:
        page.insert_image(pymupdf.Rect(72, 60, 432, 100), pixmap=pixmap)
    writer = pymupdf.TextWriter(page.rect)
    writer.append((76, 80), line, font=pymupdf.Font("tiro"), fontsize=size)
    writer.write_text(page, render_mode=3)
    if rotation:
        page.set_rotation(rotation)
    return doc.tobytes()


def picture(lines: list[tuple[str, float, float]], scale: float = 3) -> pymupdf.Pixmap:
    doc = pymupdf.open()
    page = doc.new_page(width=360, height=40)
    for line, size, base in lines:
        page.insert_text((4, base), line, fontname="hebo", fontsize=size)
    return page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)


@pytest.mark.parametrize("case", ["blank", "much wider", "much taller", "rotated page"])
def test_print_that_cannot_be_measured_safely_stays_locked(registry, case):
    if case == "blank":
        data = hidden_over(picture([]), "KEMENTERIAN CONTOH")
    elif case == "much wider":  # a short word over a long line of print
        data = hidden_over(picture([("KEMENTERIAN CONTOH REPUBLIK INDONESIA RAYA", 14, 20)]), "RI")
    elif case == "much taller":  # print three times the size the text says
        data = hidden_over(picture([("KOP", 30, 32)]), "KOP", size=8)
    else:
        data = hidden_over(picture([("KEMENTERIAN CONTOH", 14, 20)]), "KEMENTERIAN CONTOH", rotation=90)
    page = page_of(data)
    assert [p.get("lock") for p in extract_paragraphs(page)] == ["hidden"]
    assert hidden_text(page, registry) == []


def test_visible_text_on_the_print_keeps_the_paragraph_locked(registry):
    doc = pymupdf.open(stream=hidden_over(picture([("KEMENTERIAN CONTOH", 14, 20)]), "KEMENTERIAN CONTOH"))
    doc[0].insert_text((150, 78), "STEMPEL", fontname="helv", fontsize=9)  # typed over the print
    page = page_of(doc.tobytes())
    assert hidden_text(page, registry) == []


def test_endpoint_serves_a_page_and_says_when_there_is_none(client):
    doc_id = upload(client, make_kop_pdf()).json()["doc_id"]
    r = client.get(f"/documents/{doc_id}/pages/0/hidden-text")
    assert r.status_code == 200
    body = r.json()
    assert body["doc_id"] == doc_id and body["index"] == 0
    assert [p["id"] for p in body["paragraphs"]] == ["hg1", "hg2"]
    # GET /text still locks them (drafts' text.edit ops of them are dropped as before).
    page = client.get(f"/documents/{doc_id}/text").json()["pages"][0]
    assert [p.get("lock") for p in page["paragraphs"]] == [None, "hidden", "hidden"]
    assert client.get(f"/documents/{doc_id}/pages/1/hidden-text").json()["error"]["code"] == "page_not_found"


def test_a_page_is_measured_once_and_a_few_at_a_time(client, monkeypatch):
    import edith.routes.text as text_routes
    calls = []
    real = text_routes.hidden_text
    monkeypatch.setattr(text_routes, "hidden_text", lambda page, reg: calls.append(page.number) or real(page, reg))
    doc_id = upload(client, make_kop_pdf()).json()["doc_id"]
    first = client.get(f"/documents/{doc_id}/pages/0/hidden-text").json()
    assert client.get(f"/documents/{doc_id}/pages/0/hidden-text").json() == first
    assert calls == [0]  # the second answer came from the cache
    # Every slot taken: "busy" at once, not queued.
    cache = client.app.state.hidden_text
    cache._pages.clear()
    taken = [cache._slots.acquire(blocking=False) for _ in range(8)]
    try:
        r = client.get(f"/documents/{doc_id}/pages/0/hidden-text")
        assert r.status_code == 429 and r.json()["error"]["code"] == "hidden_text_busy"
    finally:
        for ok in taken:
            if ok:
                cache._slots.release()
    # A document that is gone loses its pages (the storage cleanup prunes), and is never served from the cache.
    client.get(f"/documents/{doc_id}/pages/0/hidden-text")
    cache.prune(lambda d: d != doc_id)
    assert cache.cached(doc_id, 0) is None


def test_a_page_of_too_many_pictures_is_refused_at_once(registry):
    import time
    from edith.ocr import MAX_IMAGES
    doc = pymupdf.open(stream=hidden_over(picture([("KEMENTERIAN CONTOH", 14, 20)]), "KEMENTERIAN CONTOH"))
    page = doc[0]
    tiny = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
    for i in range(MAX_IMAGES + 1):
        page.insert_image(pymupdf.Rect(10 + i, 700, 14 + i, 704), pixmap=tiny)
    page = pymupdf.open(stream=doc.tobytes())[0]
    start = time.monotonic()
    assert hidden_text(page, registry) == []
    assert time.monotonic() - start < 1


def test_covers_keep_to_the_pictures_never_the_gap_between_strips(registry):
    """A line pictured in two strips with a 6 pt gap between them: a line that crosses the gap stays locked, a line on
    one strip gets a cover inside that strip."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    left, right = (72, 60, 240, 84), (246, 60, 432, 84)
    for rect, line in ((left, "KEMENTERIAN"), (right, "CONTOH RAYA")):
        x0, y0, x1, y1 = rect
        page.insert_image(pymupdf.Rect(*rect), pixmap=_strip(line, x1 - x0, y1 - y0))
    writer = pymupdf.TextWriter(page.rect)
    writer.append((76, 78), "KEMENTERIAN", font=pymupdf.Font("tiro"), fontsize=13)
    writer.append((250, 78), "CONTOH RAYA", font=pymupdf.Font("tiro"), fontsize=13)
    writer.write_text(page, render_mode=3)
    found = hidden_text(page_of(doc.tobytes()), registry)
    covers = [R(c) for p in found for c in p["covers"]]
    assert covers, found
    for c in covers:
        assert pymupdf.Rect(*left).contains(c) or pymupdf.Rect(*right).contains(c), c
    # One line over both strips (the gap crosses its print): locked.
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(pymupdf.Rect(*left), pixmap=_strip("KEMENTERIAN CONT", 168, 24))
    page.insert_image(pymupdf.Rect(*right), pixmap=_strip("OH RAYA", 186, 24, x=-4))
    writer = pymupdf.TextWriter(page.rect)
    writer.append((76, 78), "KEMENTERIAN CONTOH RAYA", font=pymupdf.Font("tiro"), fontsize=13)
    writer.write_text(page, render_mode=3)
    assert hidden_text(page_of(doc.tobytes()), registry) == []


def _strip(line: str, w: float, h: float, x: float = 4) -> pymupdf.Pixmap:
    doc = pymupdf.open()
    page = doc.new_page(width=w, height=h)
    page.insert_text((x, 18), line, fontname="hebo", fontsize=14)
    return page.get_pixmap(matrix=pymupdf.Matrix(3, 3), alpha=False)


def test_export_of_a_hidden_paragraph_rewrite(client, registry):
    source = make_kop_pdf()
    doc_id = upload(client, source).json()["doc_id"]
    p = client.get(f"/documents/{doc_id}/pages/0/hidden-text").json()["paragraphs"][1]
    version = client.get(f"/documents/{doc_id}/text").json()["paragraphsVersion"]
    r = client.post(f"/documents/{doc_id}/export", json={"ops": [ocr_edit(p, "BIRO BARU")], "paragraphs_version": version})
    assert r.status_code == 200, r.text
    words = pymupdf.open(stream=r.content, filetype="pdf")[0].get_text()
    assert words.count("BIRO BARU") == 1 and "ORGANISASI" not in words and "SEKRETARIAT JENDERAL" in words
