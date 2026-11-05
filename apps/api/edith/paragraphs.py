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
