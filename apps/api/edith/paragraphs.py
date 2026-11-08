"""Original text of a page as editable paragraphs (spec: Ekstraksi paragraf)."""
import unicodedata
from dataclasses import dataclass
from statistics import median
from typing import Callable

import pymupdf

from edith.rules import Rules, page_rules

# No TEXT_PRESERVE_LIGATURES: "ﬁ" comes out as "fi", which every font can draw.
FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
GAP_FACTOR = 1.5     # a gap larger than this × the block's usual line spacing starts a paragraph
SIZE_CHANGE = 0.08   # so does a dominant font size change larger than 8 %
INDENT_EM = 0.5      # and a first-line indent of at least half an em
JOIN_EM = 2.0        # pieces on one baseline closer than this many ems are one line (MuPDF splits wide justified gaps)
SPACE_EM = 0.25      # assumed width of the space before a wrapped word
UNDERLINE_EM = 0.15  # a rule this close below a baseline underlines it rather than separating lines
CAP_EM = 0.6         # a rule must lie this far above the next line's baseline to separate it
BULLETS = frozenset("•‣▪■□○●◦※►▶➢✓√·∙")
HANG_EM = 0.3       # a list item's next line must start this far right of its bullet to continue it
TAB_GAP = "   "      # a line with this many spaces in a row is laid out with spaces (form rows, columns), not prose

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
    ink_x0: float = 0.0      # left edge of the first non-space character
    ink_x1: float = 0.0      # right edge of the last non-space character
    first_word: float = 0.0  # width of the first word (CJK: first character), see _first_word()
    style: tuple = ()        # (size, bold, color) of the span style with the most characters
    tabular: bool = False    # spaced out with runs of spaces (see TAB_GAP): never part of a wrapped paragraph

    @property
    def text(self) -> str:
        return "".join(s["text"] for s in self.spans)


def _clean(text: str) -> str:
    return text.replace("\xa0", " ").replace("\t", " ")


def _num(v: float) -> float:
    return round(v, 2)


def _hangul(c: str) -> bool:
    return "가" <= c <= "힣" or "ᄀ" <= c <= "ᇿ" or "㄰" <= c <= "㆏"


def _wide(c: str) -> bool:
    """CJK ideographs, kana and full-width forms: lines may wrap after any of them (no spaces between words).
    Not Hangul: Korean puts spaces between words (eojeol)."""
    return bool(c) and unicodedata.east_asian_width(c) in ("W", "F") and not _hangul(c)


def _first_word(chars: list[dict]) -> float:
    """Width of the line's first word: its characters up to the first space; for a line starting with a
    CJK ideograph or kana, only that character (plus punctuation right after it)."""
    i = 0
    while i < len(chars) and chars[i]["c"].isspace():
        i += 1
    if i == len(chars):
        return 0.0
    j = i + 1
    if _wide(chars[i]["c"]):
        while j < len(chars) and unicodedata.category(chars[j]["c"]) in ("Pe", "Pf", "Po"):
            j += 1
    else:
        while j < len(chars) and not chars[j]["c"].isspace() and not _wide(chars[j]["c"]):
            j += 1
    return chars[j - 1]["bbox"][2] - chars[i]["bbox"][0]


def _style(spans: list[dict]) -> tuple:
    weight: dict[tuple, int] = {}
    for s in spans:
        key = (round(s["size"], 1), bool(s["flags"] & pymupdf.TEXT_FONT_BOLD), s["color"])
        weight[key] = weight.get(key, 0) + len(s["text"].strip())
    return max(weight, key=weight.get)


def _line(raw: dict) -> _Line | None:
    spans, chars = [], []
    for s in raw["spans"]:
        text = _clean("".join(c["c"] for c in s["chars"]))
        if text:
            spans.append({k: v for k, v in s.items() if k != "chars"} | {"text": text})
            chars.extend(dict(c, c=_clean(c["c"])) for c in s["chars"])
    ink = [c for c in chars if not c["c"].isspace()]
    if not ink:
        return None
    main = max(spans, key=lambda s: (s["size"], len(s["text"].strip())))
    dx, dy = raw["dir"]
    x0, y0, x1, y1 = raw["bbox"]
    return _Line(spans=spans, x0=x0, y0=y0, x1=x1, y1=y1, baseline=main["origin"][1], size=main["size"],
                 horizontal=abs(dx - 1) < 1e-3 and abs(dy) < 1e-3, ink_x0=ink[0]["bbox"][0],
                 ink_x1=ink[-1]["bbox"][2], first_word=_first_word(chars), style=_style(spans),
                 tabular=TAB_GAP in "".join(c["c"] for c in chars).strip())


def _ruled(a: _Line, b: _Line, rules: Rules) -> bool:
    """A drawn rule separates line `a` from the line `b` below it: a horizontal one between them under both
    (not an underline of `a`), or a vertical one between their columns."""
    if rules.h_between(a.baseline + UNDERLINE_EM * a.size, b.baseline - CAP_EM * b.size,
                       max(a.ink_x0, b.ink_x0), min(a.ink_x1, b.ink_x1)):
        return True
    top, bottom = min(a.y0, b.y0), max(a.y1, b.y1)
    if b.ink_x0 >= a.ink_x1:
        return rules.v_between(a.ink_x1, b.ink_x0, top, bottom)
    if a.ink_x0 >= b.ink_x1:
        return rules.v_between(b.ink_x1, a.ink_x0, top, bottom)
    return False


def _same_row(a: _Line, b: _Line, rules: Rules) -> bool:
    return (a.horizontal and b.horizontal and abs(a.baseline - b.baseline) <= 0.5
            and -0.5 <= b.x0 - a.x1 <= JOIN_EM * max(a.size, b.size)
            and not rules.v_between(a.ink_x1, b.ink_x0, min(a.y0, b.y0), max(a.y1, b.y1)))


def _join(a: _Line, b: _Line) -> _Line:
    spans = list(a.spans)
    if not (a.text.endswith(" ") or b.text.startswith(" ")):
        spans.append(dict(a.spans[-1], text=" "))
    spans.extend(b.spans)
    return _Line(spans=spans, x0=min(a.x0, b.x0), y0=min(a.y0, b.y0), x1=max(a.x1, b.x1), y1=max(a.y1, b.y1),
                 baseline=a.baseline, size=max(a.size, b.size), horizontal=True, ink_x0=a.ink_x0,
                 ink_x1=b.ink_x1, first_word=a.first_word, style=_style(spans), tabular=a.tabular or b.tabular)


def _spacing(lines: list[_Line]) -> float | None:
    deltas = [b.baseline - a.baseline for a, b in zip(lines, lines[1:]) if b.baseline - a.baseline > 0]
    return median(deltas) if deltas else None


def _spread(values: list[float]) -> float:
    return max(values) - min(values)


def _continues(block: list[_Line], line: _Line, rules: Rules) -> bool:
    """MuPDF often puts the last line of a centered or right-aligned paragraph in a block of its own:
    `line` continues `block` when it sits right below it, overlapping horizontally, at the same size,
    with no rule in between."""
    prev = block[-1]
    gap = line.baseline - prev.baseline
    spacing = _spacing(block) or 1.2 * prev.size
    return (prev.horizontal and line.horizontal and 0 < gap <= GAP_FACTOR * spacing
            and abs(line.size - prev.size) <= SIZE_CHANGE * prev.size
            and line.x0 < prev.x1 and line.x1 > prev.x0 and not _ruled(prev, line, rules))


def _restyled(a: _Line, b: _Line) -> bool:
    """The dominant style changes between two lines (a heading above body text, a coloured label)."""
    (size_a, bold_a, color_a), (size_b, bold_b, color_b) = a.style, b.style
    return bold_a != bold_b or color_a != color_b or abs(size_a - size_b) > SIZE_CHANGE * max(size_a, size_b)


def _bulleted(line: _Line) -> bool:
    return line.text.lstrip()[:1] in BULLETS


def _ends_item(prev: _Line, line: _Line) -> bool:
    """`line` does not continue the list item `prev` starts: continuation lines hang past the bullet."""
    return _bulleted(prev) and line.ink_x0 < prev.ink_x0 + HANG_EM * prev.size


def _split(lines: list[_Line], rules: Rules) -> list[list[_Line]]:
    spacing = _spacing(lines)
    left = min(line.ink_x0 for line in lines)
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
            or _restyled(prev, line)
            or _bulleted(line) or _ends_item(prev, line)
            or prev.tabular or line.tabular
            or _ruled(prev, line, rules)
            or (not right_aligned
                and line.ink_x0 > left + INDENT_EM * line.size         # indented first line …
                and line.ink_x0 > prev.ink_x0 + INDENT_EM * line.size  # … more than the line before …
                and line.x1 >= prev.x1 - INDENT_EM * line.size)        # … whose right edge doesn't move in (not centered)
        )
        if new:
            groups.append([line])
        else:
            groups[-1].append(line)
    return [part for group in groups for part in _hard_breaks(group)]


def _hard_breaks(lines: list[_Line]) -> list[list[_Line]]:
    """Splits after every line that ended early: the next line's first word (plus a space) would have fit in
    the room left before the group's widest line. Wrapped text, ragged or justified, has no such line; lists,
    form rows, addresses and short lines do."""
    if len(lines) < 2:
        return [lines]
    widest = max(line.ink_x1 for line in lines)
    out = [[lines[0]]]
    for line, nxt in zip(lines, lines[1:]):
        need = nxt.first_word + (0.0 if _wide(nxt.text.lstrip()[:1]) else SPACE_EM * nxt.size)
        if widest - line.ink_x1 > need:
            out.append([nxt])
        else:
            out[-1].append(nxt)
    return out


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
            if not (prev_text.endswith((" ", "-")) or line.text.startswith(" ")
                    or _wide(prev_text[-1:]) or _wide(line.text[:1])):  # CJK wraps between characters
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
    """Paragraphs of `page` in content order, ids `g0`, `g1`, … (stable for a given file and extraction
    version). Coordinates are unrotated-CropBox points. `resolve` maps a span to its run FontRef (None →
    runs get font None). Text is never merged across a drawn rule (table borders, separators)."""
    rules = page_rules(page)
    blocks: list[list[_Line]] = []
    for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
        if block.get("type", 0) != 0:
            continue
        starts_block = True
        for raw in block.get("lines", []):
            line = _line(raw)
            if line is None:
                continue
            if blocks and _same_row(blocks[-1][-1], line, rules):
                blocks[-1][-1] = _join(blocks[-1][-1], line)
            elif blocks and (not starts_block or _continues(blocks[-1], line, rules)):
                blocks[-1].append(line)
            else:
                blocks.append([line])
            starts_block = False
    paragraphs: list[dict] = []
    for lines in blocks:
        for group in _split(lines, rules):
            paragraphs.append(_paragraph(f"g{len(paragraphs)}", group, resolve))
    return paragraphs
