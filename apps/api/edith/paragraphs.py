"""Original text of a page as editable paragraphs (spec: Ekstraksi paragraf)."""
import re
import unicodedata
from dataclasses import dataclass
from statistics import median
from typing import Callable

import pymupdf

from edith.rules import Rules, page_rules

# Version of the segmentation: paragraph ids (g0, g1, …) of a page change when it does. Shared contract with
# apps/web/src/lib/paragraphs.ts (drafts and exports carry it; 1 = M1–M4, 2 = rule/hard-break aware, M5; 3 = M5b: cells, rows, lists, ink rects).
PARAGRAPHS_VERSION = 3
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
ROOM_PAD = 2.0       # pt left free before whatever ends a single line's room (a rule, other text)
UNIFORM = 0.9        # bold / colour changes only split lines that are (nearly) entirely in one style
TAB_GAP = "   "      # a line with this many spaces in a row is laid out with spaces (form rows, columns), not prose
LEADER = re.compile(r"(?:\.\s?){5,}|…{2,}|_{4,}")  # so is a dot leader or a blank to fill in ("Nama : ……", "____")
ROOM_EM = 0.5        # a line ended early when the next line's first word fits in its own room with this much to spare …
ROOM_SHARE = 0.25    # … and its room is this share of the paragraph's measure (a gutter alone is not room)

FontResolver = Callable[[dict], dict]  # pymupdf span → FontRef JSON
SpanCheck = Callable[[dict], bool]     # pymupdf span → True when the paragraph holding it can't be edited


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
    uniform: bool = True     # that style covers nearly every character (no inline bold phrase or link in the line)
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


def _style(spans: list[dict]) -> tuple[tuple, bool]:
    """Dominant (size, bold, color) of a line and whether it covers at least UNIFORM of its characters."""
    weight: dict[tuple, int] = {}
    for s in spans:
        key = (round(s["size"], 1), bool(s["flags"] & pymupdf.TEXT_FONT_BOLD), s["color"])
        weight[key] = weight.get(key, 0) + len(s["text"].strip())
    top = max(weight, key=weight.get)
    return top, weight[top] >= UNIFORM * sum(weight.values())


def _spans(raw: dict) -> list[dict]:
    """The raw line's spans with cleaned text; each keeps its characters under "chars" (so a line can be cut)."""
    out = []
    for s in raw["spans"]:
        chars = [dict(c, c=_clean(c["c"])) for c in s["chars"]]
        text = "".join(c["c"] for c in chars)
        if text:
            out.append({k: v for k, v in s.items() if k != "chars"} | {"text": text, "chars": chars})
    return out


def _build(spans: list[dict], horizontal: bool, bbox: tuple | None = None) -> _Line | None:
    chars = [c for s in spans for c in s["chars"]]
    ink = [c for c in chars if not c["c"].isspace()]
    if not ink:
        return None
    main = max(spans, key=lambda s: (s["size"], len(s["text"].strip())))
    if bbox is None:  # a piece of a raw line: its own extent
        bbox = (chars[0]["bbox"][0], min(s["bbox"][1] for s in spans),
                chars[-1]["bbox"][2], max(s["bbox"][3] for s in spans))
    x0, y0, x1, y1 = bbox
    style, uniform = _style(spans)
    text = "".join(c["c"] for c in chars).strip()
    return _Line(spans=spans, x0=x0, y0=y0, x1=x1, y1=y1, baseline=main["origin"][1], size=main["size"],
                 horizontal=horizontal, ink_x0=ink[0]["bbox"][0], ink_x1=ink[-1]["bbox"][2],
                 first_word=_first_word(chars), style=style, uniform=uniform,
                 tabular=TAB_GAP in text or LEADER.search(text) is not None)


def _piece(spans: list[dict], lo: int, hi: int) -> list[dict]:
    """Characters lo … hi-1 (over all spans) as spans."""
    out, k = [], 0
    for s in spans:
        n = len(s["chars"])
        a, b = max(lo - k, 0), min(hi - k, n)
        if a < b:
            chars = s["chars"][a:b]
            out.append(dict(s, chars=chars, text="".join(c["c"] for c in chars)))
        k += n
    return out


def _cuts(spans: list[dict], rules: Rules) -> list[tuple[int, int]]:
    """(lo, hi) character ranges of a raw line cut where a vertical rule passes between two of its characters:
    MuPDF sometimes puts the text of two table cells in one line ("23/5/2026 Pengenalan")."""
    chars = [c for s in spans for c in s["chars"]]
    ink = [i for i, c in enumerate(chars) if not c["c"].isspace()]
    y0, y1 = min(s["bbox"][1] for s in spans), max(s["bbox"][3] for s in spans)
    out, lo = [], 0
    for a, b in zip(ink, ink[1:]):
        if rules.v_between(chars[a]["bbox"][2], chars[b]["bbox"][0], y0, y1):
            out.append((lo, a + 1))
            lo = b
    out.append((lo, len(chars)))
    return out


def _lines(raw: dict, rules: Rules) -> list[_Line]:
    """The raw MuPDF line as one _Line, or several when a column rule crosses it; none when it has no ink."""
    spans = _spans(raw)
    if not spans:
        return []
    dx, dy = raw["dir"]
    horizontal = abs(dx - 1) < 1e-3 and abs(dy) < 1e-3
    cuts = _cuts(spans, rules) if horizontal else [(0, 0)]
    if len(cuts) == 1:
        line = _build(spans, horizontal, tuple(raw["bbox"]))
        return [line] if line else []
    pieces = (_build(_piece(spans, lo, hi), horizontal) for lo, hi in cuts)
    return [p for p in pieces if p is not None]


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
        spans.append(dict(a.spans[-1], text=" ", chars=[]))  # a synthetic space: no character of the page
    spans.extend(b.spans)
    style, uniform = _style(spans)
    return _Line(spans=spans, x0=min(a.x0, b.x0), y0=min(a.y0, b.y0), x1=max(a.x1, b.x1), y1=max(a.y1, b.y1),
                 baseline=a.baseline, size=max(a.size, b.size), horizontal=True, ink_x0=a.ink_x0,
                 ink_x1=b.ink_x1, first_word=a.first_word, style=style, uniform=uniform,
                 tabular=a.tabular or b.tabular)


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
    """The style changes between two lines (a heading above body text, a coloured label). Bold and colour only
    count when both lines are uniform: a wrapped line that is mostly an inline bold phrase or link is still prose."""
    (size_a, bold_a, color_a), (size_b, bold_b, color_b) = a.style, b.style
    if abs(size_a - size_b) > SIZE_CHANGE * max(size_a, size_b):
        return True
    return a.uniform and b.uniform and (bold_a != bold_b or color_a != color_b)


def _bulleted(line: _Line) -> bool:
    return line.text.lstrip()[:1] in BULLETS


def _ends_item(prev: _Line, line: _Line) -> bool:
    """`line` does not continue the list item `prev` starts: continuation lines hang past the bullet."""
    return _bulleted(prev) and line.ink_x0 < prev.ink_x0 + HANG_EM * prev.size


def _apart(a: _Line, b: _Line) -> bool:
    """No horizontal overlap: a wrapped line always overlaps the line above it, a cell or form row beside it doesn't."""
    return min(a.ink_x1, b.ink_x1) - max(a.ink_x0, b.ink_x0) < 0


def _split(lines: list[_Line], rules: Rules, room_end: "RoomEnd | None" = None) -> list[list[_Line]]:
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
            or _apart(prev, line)
            or (not right_aligned
                and line.ink_x0 > left + INDENT_EM * line.size         # indented first line …
                and line.ink_x0 > prev.ink_x0 + INDENT_EM * line.size  # … more than the line before …
                and line.x1 >= prev.x1 - INDENT_EM * line.size)        # … whose right edge doesn't move in (not centered)
        )
        if new:
            groups.append([line])
        else:
            groups[-1].append(line)
    return [part for group in groups for part in _hard_breaks(group, room_end)]


RoomEnd = Callable[[_Line, float], float]  # (line, its paragraph's left edge) → x where the line's room ends


def _hard_breaks(lines: list[_Line], room_end: RoomEnd | None = None) -> list[list[_Line]]:
    """Splits after every line that ended early: the next line's first word (plus a space) would have fit in
    the room left before the group's widest line. Wrapped text, ragged or justified, has no such line; lists,
    form rows, addresses and short lines do. Lines of similar length (table of contents entries, form rows)
    are told apart by their own room (`room_end`: up to the next rule or other text, and no further than the
    text of the column reaches): the next first word fits there with ROOM_EM to spare, and that room is a real
    share of the measure, not a gutter. Centred and right-aligned lines end early by design: only the
    widest-line test applies to them."""
    if len(lines) < 2:
        return [lines]
    widest = max(line.ink_x1 for line in lines)
    left = min(line.ink_x0 for line in lines)
    own_room = room_end is not None and _align(lines) in ("left", "justify")
    out = [[lines[0]]]
    for line, nxt in zip(lines, lines[1:]):
        need = nxt.first_word + (0.0 if _wide(nxt.text.lstrip()[:1]) else SPACE_EM * nxt.size)
        end = room_end(line, left) if own_room else line.ink_x1
        room = end - line.ink_x1
        if widest - line.ink_x1 > need or (room > need + ROOM_EM * line.size and room > ROOM_SHARE * (end - left)):
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


def _paragraph(pid: str, lines: list[_Line], resolve: FontResolver | None, locked: SpanCheck | None = None) -> dict:
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
        "editable": all(line.horizontal for line in lines)
                    and not (locked and any(locked(s) for line in lines for s in line.spans)),
    }


def _flat(runs: list[dict]) -> str:
    return "".join(r["text"] for r in runs)


def _rect(x0: float, y0: float, x1: float, y1: float) -> dict:
    return {"x": _num(x0), "y": _num(y0), "w": _num(x1 - x0), "h": _num(y1 - y0)}


def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None,
                       locked: SpanCheck | None = None) -> list[dict]:
    """Paragraphs of `page` in content order, ids `g0`, `g1`, … (stable for a given file and extraction
    version). Coordinates are unrotated-CropBox points. `resolve` maps a span to its run FontRef (None →
    runs get font None); a paragraph with a span `locked` accepts is not editable. Text is never merged
    across a drawn rule (table borders, separators). A single-line paragraph also gets `maxWidth`: how wide
    it may grow when edited (see _room)."""
    rules = page_rules(page)
    blocks: list[list[_Line]] = []
    for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
        if block.get("type", 0) != 0:
            continue
        starts_block = True
        for raw in block.get("lines", []):
            for line in _lines(raw, rules):
                if blocks and _same_row(blocks[-1][-1], line, rules):
                    blocks[-1][-1] = _join(blocks[-1][-1], line)
                elif blocks and (not starts_block or _continues(blocks[-1], line, rules)):
                    blocks[-1].append(line)
                else:
                    blocks.append([line])
                starts_block = False
    every = [line for lines in blocks for line in lines]
    # The left margin, mirrored; the cropbox is unrotated like the lines (page.rect swaps width and height at 90/270).
    right_margin = page.cropbox.width - min((line.ink_x0 for line in every), default=0.0)
    flat = [line for line in every if line.horizontal]

    def room_end(line: _Line, left: float) -> float:
        # No further than the page's text reaches in this column: the lines that start at (or left of) the
        # paragraph's left edge and run past it. A column of text with nothing beside it is no room to grow into.
        column = max((o.ink_x1 for o in flat if o.ink_x0 <= left + INDENT_EM * o.size and o.ink_x1 > left),
                     default=line.ink_x1)
        return min(_room_end(line, every, rules, right_margin), column)

    paragraphs: list[dict] = []
    for lines in blocks:
        for group in _split(lines, rules, room_end):
            paragraph = _paragraph(f"g{len(paragraphs)}", group, resolve, locked)
            if len(group) == 1 and group[0].horizontal:
                paragraph["maxWidth"] = _room(group[0], every, rules, right_margin)
            paragraphs.append(paragraph)
    return paragraphs


def _room(line: _Line, every: list[_Line], rules: Rules, right_margin: float) -> float:
    """Width a single-line paragraph may grow to when edited (from its left edge): up to the first vertical rule
    or other text to its right on its height, or the right margin, less ROOM_PAD; at least its own width."""
    return _num(max(line.x1 - line.x0, _room_end(line, every, rules, right_margin) - line.x0))


def _room_end(line: _Line, every: list[_Line], rules: Rules, right_margin: float) -> float:
    """Where the room right of `line` ends: the first vertical rule or other text on its height, or the right
    margin, less ROOM_PAD."""
    mid = (line.y0 + line.y1) / 2
    ends = [right_margin]
    ends += [s.at for s in rules.vertical if s.at > line.ink_x1 - 0.5 and s.lo <= mid <= s.hi]
    ends += [o.ink_x0 for o in every if o is not line and o.ink_x0 > line.ink_x1 - 0.5
             and min(o.y1, line.y1) - max(o.y0, line.y0) > 0.5 * min(o.y1 - o.y0, line.y1 - line.y0)]
    return min(ends) - ROOM_PAD
