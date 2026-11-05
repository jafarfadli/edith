# Task 4: Paragraph extraction

**Files:**
- Create: `apps/api/edith/paragraphs.py`, `apps/api/tests/test_paragraphs.py`
- Modify: `apps/api/tests/pdfs.py` (paragraph fixtures)

**Interfaces:**
- Consumes: nothing new (pure PyMuPDF).
- Produces (`edith.paragraphs`):
  ```python
  FLAGS: int            # TEXT_PRESERVE_WHITESPACE | TEXT_MEDIABOX_CLIP (ligatures expanded)
  FontResolver = Callable[[dict], dict]   # pymupdf span → FontRef JSON
  def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None) -> list[dict]
  ```
  Each paragraph (JSON, coordinates in unrotated-CropBox points, numbers rounded to 0.01):
  ```
  { "id": "g0", "rect": {x,y,w,h},
    "lines": [{ "rect": {x,y,w,h}, "baseline": float, "size": float, "start": int, "end": int }],
    "runs": [{ "text", "font": FontRef JSON | None, "size", "color": "#rrggbb" }],
    "align": "left"|"center"|"right"|"justify", "lineHeight": float, "editable": bool }
  ```
  `runs` concatenated = the paragraph text; a soft line break becomes one space appended to the previous run (none after a trailing space or `-`); `lines[i].start/end` index that text (`end` excludes trailing spaces). `lineHeight` = median baseline step (single line: 1.2 × size). `editable` is false when any line is not horizontal. U+00A0 and tabs become spaces. Ids `g0, g1, …` in content order; the same file always yields the same ids.
- Produces (`tests.pdfs`): `LOREM`, `make_paragraphs_pdf()` (paragraphs `g0`…`g7`, see docstring), `make_edit_pdf()` (two Helvetica paragraphs at 12 pt leading over a red line and a blue image).

- [ ] **Step 1: Fixtures**

Append to `apps/api/tests/pdfs.py`:
```python


LOREM = ("Edith menyunting paragraf asli dengan rapi. Teks mengalir ulang di dalam kotak selebar tetap, "
         "dan gaya bisa diatur per kata tanpa merusak baris lain di halaman yang sama.")


def make_paragraphs_pdf() -> bytes:
    """Paragraph layouts for extraction tests (all standard-14 fonts):
    A left 3 lines (Helvetica 12/14.4) · B justified (Times 11) · C1/C2 split by a first-line indent ·
    D heading 18 pt + body 12 pt · E centered · F rotated 90°."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    for i, text in enumerate(["Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A", "baris tiga akhir A."]):
        page.insert_text((72, 100 + i * 14.4), text, fontname="helv", fontsize=12)
    page.insert_textbox(pymupdf.Rect(72, 180, 372, 260), LOREM, fontname="tiro", fontsize=11,
                        align=pymupdf.TEXT_ALIGN_JUSTIFY)
    c = [(72, "Paragraf C1 baris pertama yang panjang sekali"), (72, "akhir C1."),
         (90, "Paragraf C2 dimulai dengan indentasi baris"), (72, "pertama lalu berlanjut.")]
    for i, (x, text) in enumerate(c):
        page.insert_text((x, 320 + i * 14.4), text, fontname="helv", fontsize=12)
    page.insert_text((72, 420), "Judul Besar", fontname="hebo", fontsize=18)
    page.insert_text((72, 440), "Isi di bawah judul.", fontname="helv", fontsize=12)
    for i, text in enumerate(["Baris tengah pertama yang lebar", "lebih pendek", "tengah"]):
        w = pymupdf.get_text_length(text, fontname="helv", fontsize=12)
        page.insert_text((297.5 - w / 2, 500 + i * 14.4), text, fontname="helv", fontsize=12)
    page.insert_text((500, 700), "Teks diputar", fontname="helv", fontsize=12, rotate=90)
    return doc.tobytes(garbage=3, deflate=True)


def make_edit_pdf() -> bytes:
    """Two Helvetica 12 pt paragraphs at a tight 12 pt leading (glyph boxes of neighbouring lines
    overlap), split by a first-line indent, over a red vertical line and a blue image:
    g0 = "Paragraf yang diedit baris satu" / "baris dua.", g1 = the two lines below it."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    lines = [(72, "Paragraf yang diedit baris satu"), (72, "baris dua."),
             (90, "Paragraf tetangga tetap utuh di sini"), (72, "sampai akhir.")]
    for i, (x, text) in enumerate(lines):
        page.insert_text((x, 100 + 12 * i), text, fontname="helv", fontsize=12)
    page.draw_line((80, 85), (80, 150), color=(1, 0, 0), width=1)
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
    pix.set_rect(pix.irect, (0, 0, 255))
    page.insert_image(pymupdf.Rect(300, 90, 340, 115), pixmap=pix)
    return doc.tobytes(garbage=3, deflate=True)
```

- [ ] **Step 2: Failing tests**

`apps/api/tests/test_paragraphs.py`:
```python
import pymupdf
import pytest

from edith.paragraphs import extract_paragraphs
from tests.pdfs import LOREM, make_edit_pdf, make_paragraphs_pdf


def paragraphs(data: bytes, resolve=None) -> list[dict]:
    return extract_paragraphs(pymupdf.open(stream=data, filetype="pdf")[0], resolve)


def text(p: dict) -> str:
    return "".join(r["text"] for r in p["runs"])


def page_with(draw) -> bytes:
    doc = pymupdf.open()
    draw(doc.new_page(width=595, height=842))
    return doc.tobytes()


def test_boundaries_and_text():
    ps = paragraphs(make_paragraphs_pdf())
    assert [text(p) for p in ps] == [
        "Paragraf A baris satu yang cukup panjang baris dua lanjutan paragraf A baris tiga akhir A.",
        LOREM,
        "Paragraf C1 baris pertama yang panjang sekali akhir C1.",            # split from C2 by its indent
        "Paragraf C2 dimulai dengan indentasi baris pertama lalu berlanjut.",
        "Judul Besar",                                                        # split by the size change
        "Isi di bawah judul.",
        "Baris tengah pertama yang lebar lebih pendek tengah",
        "Teks diputar",
    ]
    assert [p["id"] for p in ps] == [f"g{i}" for i in range(8)]


def test_align_line_height_and_editable():
    ps = paragraphs(make_paragraphs_pdf())
    assert [p["align"] for p in ps] == ["left", "justify", "left", "left", "left", "left", "center", "left"]
    assert ps[0]["lineHeight"] == 14.4
    assert ps[4]["lineHeight"] == pytest.approx(21.6)  # single line: 1.2 × size
    assert [p["editable"] for p in ps] == [True] * 7 + [False]  # rotated text is shown, not edited


def test_lines_index_the_joined_text():
    p = paragraphs(make_paragraphs_pdf())[0]
    t = text(p)
    assert [t[ln["start"]:ln["end"]] for ln in p["lines"]] == [
        "Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A", "baris tiga akhir A."]
    assert [ln["baseline"] for ln in p["lines"]] == [100, 114.4, 128.8]
    assert p["lines"][0]["size"] == 12
    assert p["rect"]["x"] == 72 and p["lines"][0]["rect"]["x"] == 72


@pytest.mark.parametrize("align", [pymupdf.TEXT_ALIGN_CENTER, pymupdf.TEXT_ALIGN_RIGHT, pymupdf.TEXT_ALIGN_JUSTIFY])
def test_textbox_alignments_stay_one_paragraph(align):
    """MuPDF splits the last line of centered/right text and wide justified gaps into extra blocks."""
    data = page_with(lambda pg: pg.insert_textbox(pymupdf.Rect(300, 100, 500, 300), LOREM, fontname="helv",
                                                  fontsize=12, align=align))
    ps = paragraphs(data)
    assert len(ps) == 1 and text(ps[0]) == LOREM
    assert ps[0]["align"] == {pymupdf.TEXT_ALIGN_CENTER: "center", pymupdf.TEXT_ALIGN_RIGHT: "right",
                              pymupdf.TEXT_ALIGN_JUSTIFY: "justify"}[align]


def test_tight_leading_still_splits_on_indent():
    ps = paragraphs(make_edit_pdf())
    assert [text(p) for p in ps] == ["Paragraf yang diedit baris satu baris dua.",
                                     "Paragraf tetangga tetap utuh di sini sampai akhir."]
    assert ps[0]["lineHeight"] == 12


def test_runs_merge_same_style_and_split_on_color():
    def draw(pg):
        w = pymupdf.get_text_length("Merah ", fontname="helv", fontsize=12)
        pg.insert_text((72, 100), "Merah ", fontname="helv", fontsize=12, color=(1, 0, 0))
        pg.insert_text((72 + w, 100), "biru", fontname="helv", fontsize=12, color=(0, 0, 1))
    runs = paragraphs(page_with(draw), resolve=lambda span: {"kind": "bundled", "family": "Arimo"})[0]["runs"]
    assert [(r["text"], r["color"], r["size"]) for r in runs] == [("Merah ", "#ff0000", 12), ("biru", "#0000ff", 12)]
    assert runs[0]["font"] == {"kind": "bundled", "family": "Arimo"}
```

Run: `cd apps/api && uv run pytest tests/test_paragraphs.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'edith.paragraphs'`.

- [ ] **Step 3: Implement**

`apps/api/edith/paragraphs.py`:
```python
"""Original text of a page as editable paragraphs (spec: Ekstraksi paragraf)."""
from dataclasses import dataclass
from statistics import median
from typing import Callable

import pymupdf

# No TEXT_PRESERVE_LIGATURES: "ﬁ" comes out as "fi", which every font can draw.
FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
GAP_FACTOR = 1.5     # a gap larger than this × the block's usual line spacing starts a paragraph
SIZE_CHANGE = 0.2    # so does a dominant font size change larger than 20 %
INDENT_EM = 0.5      # and a first-line indent of at least half an em
JOIN_EM = 2.0        # pieces on one baseline closer than this many ems are one line (MuPDF splits wide justified gaps)

FontResolver = Callable[[dict], dict]  # pymupdf span → FontRef JSON


@dataclass
class _Line:
    spans: list[dict]
    x0: float
    y0: float
    x1: float
    y1: float
    baseline: float
    size: float
    horizontal: bool

    @property
    def text(self) -> str:
        return "".join(s["text"] for s in self.spans)


def _clean(text: str) -> str:
    return text.replace("\xa0", " ").replace("\t", " ")


def _num(v: float) -> float:
    return round(v, 2)


def _line(raw: dict) -> _Line | None:
    spans = [dict(s, text=_clean(s["text"])) for s in raw["spans"] if s["text"]]
    if not spans or not "".join(s["text"] for s in spans).strip():
        return None
    main = max(spans, key=lambda s: (s["size"], len(s["text"].strip())))
    dx, dy = raw["dir"]
    x0, y0, x1, y1 = raw["bbox"]
    return _Line(spans=spans, x0=x0, y0=y0, x1=x1, y1=y1, baseline=main["origin"][1], size=main["size"],
                 horizontal=abs(dx - 1) < 1e-3 and abs(dy) < 1e-3)


def _same_row(a: _Line, b: _Line) -> bool:
    return (a.horizontal and b.horizontal and abs(a.baseline - b.baseline) <= 0.5
            and -0.5 <= b.x0 - a.x1 <= JOIN_EM * max(a.size, b.size))


def _join(a: _Line, b: _Line) -> _Line:
    spans = list(a.spans)
    if not (a.text.endswith(" ") or b.text.startswith(" ")):
        spans.append(dict(a.spans[-1], text=" "))
    spans.extend(b.spans)
    return _Line(spans=spans, x0=min(a.x0, b.x0), y0=min(a.y0, b.y0), x1=max(a.x1, b.x1), y1=max(a.y1, b.y1),
                 baseline=a.baseline, size=max(a.size, b.size), horizontal=True)


def _spacing(lines: list[_Line]) -> float | None:
    deltas = [b.baseline - a.baseline for a, b in zip(lines, lines[1:]) if b.baseline - a.baseline > 0]
    return median(deltas) if deltas else None


def _spread(values: list[float]) -> float:
    return max(values) - min(values)


def _continues(block: list[_Line], line: _Line) -> bool:
    """MuPDF often puts the last line of a centered or right-aligned paragraph in a block of its own:
    `line` continues `block` when it sits right below it, overlapping horizontally, at the same size."""
    prev = block[-1]
    gap = line.baseline - prev.baseline
    spacing = _spacing(block) or 1.2 * prev.size
    return (prev.horizontal and line.horizontal and 0 < gap <= GAP_FACTOR * spacing
            and abs(line.size - prev.size) <= SIZE_CHANGE * prev.size
            and line.x0 < prev.x1 and line.x1 > prev.x0)


def _split(lines: list[_Line]) -> list[list[_Line]]:
    spacing = _spacing(lines)
    left = min(line.x0 for line in lines)
    tol = max(1.0, 0.1 * max(line.size for line in lines))
    # In right-aligned text every line moves its left edge: that is not a first-line indent.
    right_aligned = len(lines) >= 2 and _spread([ln.x1 for ln in lines]) <= tol < _spread([ln.x0 for ln in lines])
    groups: list[list[_Line]] = []
    for line in lines:
        if not groups:
            groups.append([line])
            continue
        prev = groups[-1][-1]
        gap = line.baseline - prev.baseline
        new = (
            not line.horizontal or not prev.horizontal
            or gap <= 0
            or (spacing is not None and gap > GAP_FACTOR * spacing)
            or abs(line.size - prev.size) > SIZE_CHANGE * prev.size
            or (not right_aligned
                and line.x0 > left + INDENT_EM * line.size      # indented first line …
                and line.x0 > prev.x0 + INDENT_EM * line.size   # … more than the line before …
                and line.x1 >= prev.x1 - INDENT_EM * line.size)  # … whose right edge doesn't move in (not centered text)
        )
        if new:
            groups.append([line])
        else:
            groups[-1].append(line)
    return groups


def _align(lines: list[_Line]) -> str:
    if len(lines) < 2:
        return "left"
    tol = max(1.0, 0.1 * max(line.size for line in lines))
    rest = lines[1:]
    if _spread([line.x0 for line in rest]) <= tol and lines[0].x0 >= rest[0].x0 - tol:
        body = lines[:-1]
        if len(lines) >= 3 and _spread([line.x1 for line in body]) <= tol and lines[-1].x1 < body[0].x1 - tol:
            return "justify"
        return "left"
    if _spread([line.x1 for line in lines]) <= tol:
        return "right"
    if _spread([(line.x0 + line.x1) / 2 for line in lines]) <= tol:
        return "center"
    return "left"


def _color(c: int) -> str:
    return f"#{c & 0xFFFFFF:06x}"


def _paragraph(pid: str, lines: list[_Line], resolve: FontResolver | None) -> dict:
    runs: list[dict] = []
    out_lines: list[dict] = []
    offset = 0

    def add(text: str, span: dict) -> None:
        nonlocal offset
        font = resolve(span) if resolve else None
        size, color = _num(span["size"]), _color(span["color"])
        last = runs[-1] if runs else None
        if last and last["font"] == font and last["size"] == size and last["color"] == color:
            last["text"] += text
        else:
            runs.append({"text": text, "font": font, "size": size, "color": color})
        offset += len(text)

    for i, line in enumerate(lines):
        if i > 0:
            prev_text = lines[i - 1].text
            if not (prev_text.endswith((" ", "-")) or line.text.startswith(" ")):
                runs[-1]["text"] += " "  # the soft line break becomes a space in the previous run
                offset += 1
        start = offset
        for span in line.spans:
            add(span["text"], span)
        end, joined = offset, _flat(runs)
        while end > start and joined[end - 1] == " ":
            end -= 1
        out_lines.append({
            "rect": _rect(line.x0, line.y0, line.x1, line.y1),
            "baseline": _num(line.baseline), "size": _num(line.size), "start": start, "end": end,
        })

    baselines = [line.baseline for line in lines]
    deltas = [b - a for a, b in zip(baselines, baselines[1:])]
    line_height = _num(median(deltas)) if deltas else _num(1.2 * max(line.size for line in lines))
    return {
        "id": pid,
        "rect": _rect(min(ln.x0 for ln in lines), min(ln.y0 for ln in lines),
                      max(ln.x1 for ln in lines), max(ln.y1 for ln in lines)),
        "lines": out_lines,
        "runs": runs,
        "align": _align(lines),
        "lineHeight": line_height,
        "editable": all(line.horizontal for line in lines),
    }


def _flat(runs: list[dict]) -> str:
    return "".join(r["text"] for r in runs)


def _rect(x0: float, y0: float, x1: float, y1: float) -> dict:
    return {"x": _num(x0), "y": _num(y0), "w": _num(x1 - x0), "h": _num(y1 - y0)}


def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None) -> list[dict]:
    """Paragraphs of `page` in content order, ids `g0`, `g1`, … (stable for a given file). Coordinates
    are unrotated-CropBox points. `resolve` maps a span to its run FontRef (None → runs get font None)."""
    blocks: list[list[_Line]] = []
    for block in page.get_text("dict", flags=FLAGS)["blocks"]:
        if block.get("type", 0) != 0:
            continue
        starts_block = True
        for raw in block.get("lines", []):
            line = _line(raw)
            if line is None:
                continue
            if blocks and _same_row(blocks[-1][-1], line):
                blocks[-1][-1] = _join(blocks[-1][-1], line)
            elif blocks and (not starts_block or _continues(blocks[-1], line)):
                blocks[-1].append(line)
            else:
                blocks.append([line])
            starts_block = False
    paragraphs: list[dict] = []
    for lines in blocks:
        for group in _split(lines):
            paragraphs.append(_paragraph(f"g{len(paragraphs)}", group, resolve))
    return paragraphs
```

Run: `cd apps/api && uv run pytest -q`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/edith/paragraphs.py apps/api/tests/test_paragraphs.py apps/api/tests/pdfs.py
git commit -m "feat(api): extract original text as paragraphs with runs, lines and alignment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
