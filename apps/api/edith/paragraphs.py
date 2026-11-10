"""Original text of a page as editable paragraphs (spec: Ekstraksi paragraf)."""
import math
import re
import unicodedata
from dataclasses import dataclass
from statistics import median
from typing import Callable

import pymupdf

from edith.decor import Decor, PageMarks, decorate, to_json as decor_json
from edith.doc_fonts import name_key
from edith.rules import Rules, page_rules

# Version of the segmentation: paragraph ids (g0, g1, …) of a page change when it does. Shared contract with
# apps/web/src/lib/paragraphs.ts (drafts and exports carry it; 1 = M1–M4, 2 = rule/hard-break aware, M5; 3 = M5b: cells, rows, lists, ink rects).
# Bump it on ANY change to how lines are split or measured (line start/end, rects, baselines), not only to ids: drafts
# store LayoutLine.source indexes into a paragraph's lines, and the bake checks kept lines against those lines.
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
# A list item starts with a bullet or a number/letter marker ("1.", "2)", "a.", "(i)", "IV.") and a gap.
MARKER = (r"(?:[•‣▪■□○●◦※►▶➢✓√·∙]|\(?\d{1,2}(?:\.\d{1,2})*[.)]|\(?[a-z][.)]|\([A-Za-z]\)|[A-Z]\)"
          r"|\(?[ivx]{1,4}[.)]|[IVX]{1,4}\.)")
ITEM = re.compile(MARKER + r"(?=\s|$)")
# What may stand left of a tab stop: a marker, or a section number ("4.1", "Bab IV", "Chapter 3").
TAB_LEFT = re.compile(MARKER + r"|\d{1,2}(?:\.\d{1,2})*|\w+ (?:[IVX]{1,4}|\d{1,2}(?:\.\d{1,2})*)")
TAB_EM = 0.6         # a tab gap is at least this wide (ink to ink) …
TAB_WORD = 2.0       # … and this many times the line's usual word gap (under WIDE_EM); WIDE_EM wide without one
WIDE_EM = 0.8

# Whitespace between words: exactly what JavaScript's \s matches (ECMAScript WhiteSpace and LineTerminator), which the
# client splits words and drops line-end spaces by. Shared contract with SPACE_CHARS in apps/web/src/lib/keepLines.ts.
# Not str.isspace(): that also takes U+001C–U+001F and U+0085, and not U+FEFF.
SPACE_CHARS = frozenset("\t\n\x0b\x0c\r \xa0 " + "".join(map(chr, range(0x2000, 0x200B)))
                        + "    　﻿")

FontResolver = Callable[[dict], dict]  # pymupdf span → FontRef JSON
SpanCheck = Callable[[dict], bool]     # pymupdf span → True when the paragraph holding it can't be edited
Program = Callable[[dict], "pymupdf.Font | None"]  # run FontRef JSON → the font program clients measure it with

# Spacing of the original text (Run.hScale / charSpacing / wordSpacing), fitted per span from its pen advances
# (next glyph origin − this one) against the program advances clients lay out with (see _fit).
H_TOL = 0.004        # a horizontal scale this close to 1 is 1 (rounding of sizes and box widths)
H_SUBSTITUTE = (0.8, 1.25)  # a bundled substitute is scaled to the original widths only within these bounds
SPACING_MIN = 0.02   # pt: smaller character / word spacing is 0
FIT_GLYPHS = 3       # glyph advances a span needs before its scale and spacing are measured
OUTLIER_EM = 0.25    # an advance this far (× size) from the median extra is a jump, not spacing
MERGE_H, MERGE_TC, MERGE_TW = 0.003, 0.03, 0.15  # spans this close in scale / spacing (pt) share a run
# What ops.Run accepts: a measurement outside it (an invisible OCR layer at Tz 450, a squashed or degenerate text
# matrix) leaves the span unmeasured (hScale 1, the reported size, no spacing) rather than an op the export rejects.
H_RANGE = (0.25, 4.0)
SIZE_RANGE = (1.0, 500.0)  # pt: a true size outside it is a degenerate matrix, not text to measure
SPACING_MAX = 100.0        # pt: |charSpacing|, |wordSpacing|


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
    gaps: tuple = ()         # word gaps (ink to ink between words), in ems
    body_x: float | None = None  # a list item's text: x of its first character after the marker
    stretch: tuple = ()      # per word gap: how much wider it is than its space characters, in ems (justified text)

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
    sizes = [s["size"] for s in spans for _ in s["chars"]]
    word_gaps = _word_gaps(chars)
    gaps = tuple(g / sizes[a] for a, b, g in word_gaps)
    stretch = tuple((g - sum(chars[k]["bbox"][2] - chars[k]["bbox"][0] for k in range(a + 1, b))) / sizes[a]
                    for a, b, g in word_gaps)
    body_x = None
    marker = ITEM.match(text)
    if marker:
        lead = len("".join(c["c"] for c in chars)) - len("".join(c["c"] for c in chars).lstrip())
        body = [c for c in chars[lead + marker.end():] if not c["c"].isspace()]
        body_x = body[0]["bbox"][0] if body else None
    return _Line(spans=spans, x0=x0, y0=y0, x1=x1, y1=y1, baseline=main["origin"][1], size=main["size"],
                 horizontal=horizontal, ink_x0=ink[0]["bbox"][0], ink_x1=ink[-1]["bbox"][2],
                 first_word=_first_word(chars), style=style, uniform=uniform,
                 tabular=TAB_GAP in text or LEADER.search(text) is not None, gaps=gaps, body_x=body_x,
                 stretch=stretch)


def _word_gaps(chars: list[dict]) -> list[tuple[int, int, float]]:
    """(a, b, width) for every pair of ink characters a < b with only whitespace between them."""
    ink = [i for i, c in enumerate(chars) if not c["c"].isspace()]
    return [(a, b, chars[b]["bbox"][0] - chars[a]["bbox"][2]) for a, b in zip(ink, ink[1:]) if b > a + 1]


def _tab_gap(gap: float, gaps: list[float], left: str, right: str) -> bool:
    """A gap (ems) between `left` and `right` on one line is a tab stop, not a space: wide, and wider than the
    line's other word gaps (a justified line stretches them all alike), after a list marker or section number,
    or on either side of a colon ("Nama⇥:⇥……", ": value"). Not inside brackets ("[   ]")."""
    left, right = left.strip(), right.strip()
    if not left or not right or left[-1] in "([" or right[0] in ")]":
        return False
    usual = [g for g in gaps if g < WIDE_EM]
    if gap < (max(TAB_EM, TAB_WORD * median(usual)) if usual else WIDE_EM):
        return False
    return TAB_LEFT.fullmatch(left) is not None or left.endswith(":") or right.startswith(":")


def _piece(spans: list[dict], lo: int, hi: int) -> list[dict]:
    """Characters lo … hi-1 (over all spans) as spans; a synthetic space (_join) inside the range stays."""
    out, k = [], 0
    for s in spans:
        n = len(s["chars"])
        a, b = max(lo - k, 0), min(hi - k, n)
        if n == 0 and lo < k < hi:
            out.append(s)
        elif a < b:
            chars = s["chars"][a:b]
            out.append(dict(s, chars=chars, text="".join(c["c"] for c in chars)))
        k += n
    return out


def _cuts(spans: list[dict], rules: Rules) -> list[tuple[int, int]]:
    """(lo, hi) character ranges of a raw line cut where a vertical rule passes between two of its characters
    (MuPDF sometimes puts the text of two table cells in one line: "23/5/2026 Pengenalan") or at a tab stop
    (_tab_gap: "1.⇥Pada saat …", "Nama⇥:⇥……"). Each piece keeps its own position, so the gap survives an edit
    and a list item's text keeps its hanging indent."""
    chars = [c for s in spans for c in s["chars"]]
    sizes = [s["size"] for s in spans for _ in s["chars"]]
    ink = [i for i, c in enumerate(chars) if not c["c"].isspace()]
    y0, y1 = min(s["bbox"][1] for s in spans), max(s["bbox"][3] for s in spans)
    gaps = {a: g / sizes[a] for a, _b, g in _word_gaps(chars)}
    text = "".join(c["c"] for c in chars)
    out, lo = [], 0
    for a, b in zip(ink, ink[1:]):
        tab = a in gaps and _tab_gap(gaps[a], [g for k, g in gaps.items() if k != a], text[lo:a + 1], text[b:])
        if tab or rules.v_between(chars[a]["bbox"][2], chars[b]["bbox"][0], y0, y1):
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
    gap = (b.ink_x0 - a.ink_x1) / max(a.size, b.size)
    return (a.horizontal and b.horizontal and abs(a.baseline - b.baseline) <= 0.5
            and -0.5 <= b.x0 - a.x1 <= JOIN_EM * max(a.size, b.size)
            and not rules.v_between(a.ink_x1, b.ink_x0, min(a.y0, b.y0), max(a.y1, b.y1))
            and not _tab_gap(gap, list(a.gaps + b.gaps), a.text, b.text))


def _join(a: _Line, b: _Line) -> _Line:
    spans = list(a.spans)
    if not (a.text.endswith(" ") or b.text.startswith(" ")):
        spans.append(dict(a.spans[-1], text=" ", chars=[]))  # a synthetic space: no character of the page
    spans.extend(b.spans)
    style, uniform = _style(spans)
    return _Line(spans=spans, x0=min(a.x0, b.x0), y0=min(a.y0, b.y0), x1=max(a.x1, b.x1), y1=max(a.y1, b.y1),
                 baseline=a.baseline, size=max(a.size, b.size), horizontal=True, ink_x0=a.ink_x0,
                 ink_x1=b.ink_x1, first_word=a.first_word, style=style, uniform=uniform,
                 tabular=a.tabular or b.tabular,
                 gaps=a.gaps + ((b.ink_x0 - a.ink_x1) / max(a.size, b.size),) + b.gaps,
                 stretch=a.stretch + ((b.ink_x0 - a.ink_x1) / max(a.size, b.size) - SPACE_EM,) + b.stretch,
                 body_x=a.body_x if a.body_x is not None or not ITEM.fullmatch(a.text.strip()) else b.ink_x0)


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
            and line.ink_x0 < prev.ink_x1 and line.ink_x1 > prev.ink_x0 and not _ruled(prev, line, rules))


def _restyled(a: _Line, b: _Line) -> bool:
    """The style changes between two lines (a heading above body text, a coloured label). Bold and colour only
    count when both lines are uniform: a wrapped line that is mostly an inline bold phrase or link is still prose."""
    (size_a, bold_a, color_a), (size_b, bold_b, color_b) = a.style, b.style
    if abs(size_a - size_b) > SIZE_CHANGE * max(size_a, size_b):
        return True
    return a.uniform and b.uniform and (bold_a != bold_b or color_a != color_b)


def _bulleted(line: _Line) -> bool:
    """`line` starts a list item: a bullet, or a number/letter marker followed by a gap (see ITEM)."""
    return line.text.lstrip()[:1] in BULLETS or ITEM.match(line.text.lstrip()) is not None


def _ends_item(item: _Line, line: _Line) -> bool:
    """`line` does not continue the list item `item` starts: continuation lines hang past the marker."""
    return line.ink_x0 < item.ink_x0 + HANG_EM * item.size


def _hangs(item: _Line, line: _Line) -> bool:
    """`line` starts at the item's text, right of its marker: a continuation line, however wide."""
    return item.body_x is not None and abs(line.ink_x0 - item.body_x) <= 1.0


def _apart(a: _Line, b: _Line) -> bool:
    """No horizontal overlap: a wrapped line always overlaps the line above it, a cell or form row beside it doesn't."""
    return min(a.ink_x1, b.ink_x1) - max(a.ink_x0, b.ink_x0) < 0


def _split(lines: list[_Line], rules: Rules, room_end: "RoomEnd | None" = None) -> list[list[_Line]]:
    spacing = _spacing(lines)
    left = min(line.ink_x0 for line in lines)
    tol = max(1.0, 0.1 * max(line.size for line in lines))
    # In right-aligned text every line moves its left edge: that is not a first-line indent.
    right_aligned = len(lines) >= 2 and _spread([ln.ink_x1 for ln in lines]) <= tol < _spread([ln.ink_x0 for ln in lines])
    groups: list[list[_Line]] = []
    for line in lines:
        if not groups:
            groups.append([line])
            continue
        prev = groups[-1][-1]
        item = groups[-1][0] if _bulleted(groups[-1][0]) else None
        gap = line.baseline - prev.baseline
        new = (
            not line.horizontal or not prev.horizontal
            or gap <= 0
            or (spacing is not None and gap > GAP_FACTOR * spacing)
            or _restyled(prev, line)
            or _bulleted(line) or (item is not None and _ends_item(item, line))
            or prev.tabular or line.tabular
            or _ruled(prev, line, rules)
            or _apart(prev, line)
            or (not right_aligned and not (item is not None and _hangs(item, line))
                and line.ink_x0 > left + INDENT_EM * line.size         # indented first line …
                and line.ink_x0 > prev.ink_x0 + INDENT_EM * line.size  # … more than the line before …
                and line.ink_x1 >= prev.ink_x1 - INDENT_EM * line.size)        # … whose right edge doesn't move in (not centered)
        )
        if new:
            groups.append([line])
        else:
            groups[-1].append(line)
    return _hung([part for group in groups for part in _hard_breaks(group, room_end)])


def _hung(groups: list[list[_Line]]) -> list[list[_Line]]:
    """A list item whose continuation lines hang right of its marker becomes two paragraphs, the marker and the
    text: each keeps its left edge when edited (a paragraph has one). Hancom hangs the lines a little left of
    the text; the text's first line then keeps that small indent."""
    out = []
    for group in groups:
        first, rest = group[0], group[1:]
        if (rest and _bulleted(first) and first.body_x is not None and _spread([line.ink_x0 for line in rest]) <= 1.0
                and first.ink_x0 + HANG_EM * first.size <= rest[0].ink_x0 <= first.body_x + 1.0):
            parts = _cut_marker(first)
            if parts:
                out += [[parts[0]], [parts[1], *group[1:]]]
                continue
        out.append(group)
    return out


def _cut_marker(line: _Line) -> tuple[_Line, _Line] | None:
    chars = [c for s in line.spans for c in s["chars"]]
    text = "".join(c["c"] for c in chars)
    lead = len(text) - len(text.lstrip())
    marker = ITEM.match(text[lead:])
    if not marker:
        return None
    end = lead + marker.end()
    start = next((i for i in range(end, len(chars)) if not chars[i]["c"].isspace()), None)
    if start is None:
        return None
    head = _build(_piece(line.spans, 0, end), line.horizontal)
    body = _build(_piece(line.spans, start, len(chars)), line.horizontal)
    return (head, body) if head and body else None


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


STRETCH_EM = 0.06     # justified: the word gaps of every line but the last are this much wider than the last line's
STRETCH_ALONE = 0.15  # … or than their space characters, when the last line has no word gap


def _stretched(lines: list[_Line]) -> bool:
    """Every line but the last has stretched word gaps: justified text (two lines are enough to tell)."""
    last = lines[-1].stretch
    base, least = (median(last), STRETCH_EM) if last else (0.0, STRETCH_ALONE)
    return all(line.stretch and median(line.stretch) - base > least for line in lines[:-1])


def _align(lines: list[_Line]) -> str:
    """Alignment of a multi-line paragraph from its lines' ink edges (single lines: see _single)."""
    if len(lines) < 2:
        return "left"
    tol = max(1.0, 0.1 * max(line.size for line in lines))
    x0, x1 = [line.ink_x0 for line in lines], [line.ink_x1 for line in lines]
    # Centred before left: in a 2-line centred paragraph whose first line is shorter, "the rest" is one line.
    if _spread(x0) > tol and _spread(x1) > tol and _spread([(a + b) / 2 for a, b in zip(x0, x1)]) <= tol:
        return "center"
    if _spread(x0[1:]) <= tol and x0[0] >= x0[1] - tol:
        body = x1[:-1]
        if _spread(body) <= tol and x1[-1] < body[0] + tol and (
                (len(lines) >= 3 and x1[-1] < body[0] - tol) or _stretched(lines)):
            return "justify"
        return "left"
    if _spread(x1) <= tol:
        return "right"
    return "left"


def _color(c: int) -> str:
    return f"#{c & 0xFFFFFF:06x}"


@dataclass
class _Fit:
    """Measured spacing of a span: `scale` = pen advance per em of program advance (size · hScale), `tc` = extra pt
    per glyph, `tw` = extra pt per space (None: not measured), `n` = glyph advances measured."""
    scale: float
    tc: float
    tw: float | None
    n: int


def _quantized(font: "pymupdf.Font", c: str) -> float:
    """Program advance in ems, in whole thousandths as the bake (bake/text.py quantized_width) and the web use it."""
    return math.floor(round(font.glyph_advance(ord(c)) * 1000, 3)) / 1000


def _scale(a: float, size: float, original: bool) -> tuple[float, float] | None:
    """(true size, hScale) of a span whose glyphs advance `a` pt per em. MuPDF reports the size of horizontally
    scaled text (Tz) as size · √hScale (the square root of its matrix's determinant): for an original font, whose
    program widths are the PDF's, the scale is therefore (a / reported size)². A bundled substitute keeps the
    reported size and is scaled to the original widths (within H_SUBSTITUTE). None: no usable measurement (a scale
    outside H_RANGE, a size outside SIZE_RANGE): the span stays unmeasured."""
    if not (a > 0 and SIZE_RANGE[0] <= size <= SIZE_RANGE[1]):
        return None
    if original:
        h = (a / size) ** 2
        if abs(h - 1) <= H_TOL:
            return size, 1.0
        true = round(size / math.sqrt(h), 2)
        if not SIZE_RANGE[0] <= true <= SIZE_RANGE[1]:
            return None
        h = round(a / true, 4)
        return (true, h) if H_RANGE[0] <= h <= H_RANGE[1] else None
    h = round(a / size, 4)
    return size, (h if abs(h - 1) > H_TOL and H_SUBSTITUTE[0] <= h <= H_SUBSTITUTE[1] else 1.0)


def _fit(span: dict, prog: "pymupdf.Font", original: bool, spaces: bool) -> _Fit | None:
    """What harness/probe_widths.py measures, per span: the glyph boxes' width against the program advance gives the
    scale (Tz); the median pen advance beyond it gives the character spacing (Tc, TJ condensing); the median space
    advance beyond that gives the word spacing (Tw, or Hancom's per-word placement: gaps ≈ 1.4 × the space glyph).
    `spaces` False: the gaps are not natural (a justified line) and are not measured. None: too few glyphs."""
    chars, size = span.get("chars") or [], span["size"]
    ratios = [(c["bbox"][2] - c["bbox"][0]) / q for c in chars if not c["c"].isspace()
              and (q := _quantized(prog, c["c"])) > 0.05 and c["bbox"][2] > c["bbox"][0]]
    if len(ratios) < FIT_GLYPHS:
        return None
    scaled = _scale(median(ratios), size, original)
    if scaled is None:
        return None
    true, h = scaled
    a = true * h
    glyph, space = [], []
    for c, nxt in zip(chars, chars[1:]):
        pen = nxt["origin"][0] - c["origin"][0]
        if not 0 < pen < 3 * size:
            continue  # a tab or a jump: not an advance
        if c["c"].isspace():
            space.append(pen - _quantized(prog, " ") * a)
        elif (q := _quantized(prog, c["c"])) > 0.05:
            glyph.append(pen - q * a)
    if len(glyph) < FIT_GLYPHS - 1:
        return None
    tc = _mean(glyph, OUTLIER_EM * true)
    if not original and abs(tc) > 0.25 * true:  # a substitute far off the original widths: no spacing makes it fit
        tc = 0.0
    tw = _mean(space, OUTLIER_EM * true) - tc if spaces and space else None
    if abs(tc) > SPACING_MAX or (tw is not None and abs(tw) > SPACING_MAX):
        return None
    return _Fit(a, tc, tw, len(glyph))


def _mean(values: list[float], spread: float) -> float:
    """Mean of the values within `spread` of their median: the line keeps its length (the mean extra), while a
    tab-like jump or a kerned pair does not pull the spacing."""
    mid = median(values)
    kept = [v for v in values if abs(v - mid) <= spread]
    return sum(kept) / len(kept)


def _fits_with(fits: list[_Fit | None], fit: _Fit | None) -> bool:
    """A span with `fit` may join a run whose spans measured `fits` (unmeasured spans join any run)."""
    known = [f for f in fits if f is not None]
    if fit is None or not known:
        return True
    a, tc, tw = _merged(known)
    return (abs(fit.scale / a - 1) <= MERGE_H and abs(fit.tc - tc) <= MERGE_TC
            and (fit.tw is None or tw is None or abs(fit.tw - tw) <= MERGE_TW))


def _merged(fits: list[_Fit]) -> tuple[float, float, float | None]:
    n = sum(f.n for f in fits)
    words = [f for f in fits if f.tw is not None]
    tw = sum(f.tw * f.n for f in words) / max(1, sum(f.n for f in words)) if words else None
    return sum(f.scale * f.n for f in fits) / n, sum(f.tc * f.n for f in fits) / n, tw


def _finish(run: dict, fits: list[_Fit | None]) -> None:
    """Sets the run's measured size, hScale, charSpacing and wordSpacing (only those that are not the default)."""
    known = [f for f in fits if f is not None]
    if not known:
        return
    a, tc, tw = _merged(known)
    scaled = _scale(a, run["size"], (run["font"] or {}).get("kind") == "original")
    if scaled is None:
        return  # unmeasured: the reported size, no scale or spacing
    run["size"], h = scaled
    if h != 1.0:
        run["hScale"] = h
    if SPACING_MIN <= abs(tc) <= SPACING_MAX:
        run["charSpacing"] = round(tc, 3)
    if tw is not None and SPACING_MIN <= abs(tw) <= SPACING_MAX:
        run["wordSpacing"] = round(tw, 3)


def _decor_fields(decors: list[Decor]) -> dict:
    """Run fields of a character's decorations, geometry in pt (see _finish_decor): underline / strike with their bar's
    top (relative to the baseline) and thickness, the bars' colour, a highlight's colour."""
    out: dict = {}
    for d in decors:
        if d.kind == "bg":
            out.setdefault("bgColor", d.mark.color)
            continue
        if d.kind in out:
            continue
        out[d.kind] = True
        out[f"_{d.kind}"] = (round(d.top, 2), round(d.thickness, 2))
        out.setdefault("_decorColor", d.mark.color)
    return out


DECOR_KEYS = ("bgColor", "underline", "strike", "_underline", "_strike", "_decorColor")


def _finish_decor(run: dict) -> None:
    """The run's bar geometry in ems of its (final) size: underlineTop / strikeTop and decorThickness (the underline's,
    else the strike's), and decorColor when the bars are not in the text colour."""
    size = run["size"]
    thickness = None
    for kind in ("underline", "strike"):
        geo = run.pop(f"_{kind}", None)
        if geo is not None:
            run[f"{kind}Top"] = round(geo[0] / size, 3)
            thickness = thickness if thickness is not None else round(geo[1] / size, 3)
    if thickness is not None:
        run["decorThickness"] = thickness
    color = run.pop("_decorColor", None)
    if color is not None and color != run["color"]:
        run["decorColor"] = color


def _line_decor(line: _Line, marks: "PageMarks | None") -> tuple[dict[tuple[int, int], list[Decor]], list[dict]]:
    """(id(span), index of the character in the span) → its decorations, and the marks the line's decorations are
    (their painted rects: what an edit of the line removes)."""
    if marks is None or not line.horizontal:
        return {}, []
    keys = [(id(s), k) for s in line.spans for k in range(len(s["chars"]))]
    chars = [(c, s["origin"][1], s["size"]) for s in line.spans for c in s["chars"]]
    found = decorate(chars, marks.marks, marks)
    out = {keys[i]: d for i, d in found.items()}
    used: dict[tuple, dict] = {}
    for ds in found.values():
        for d in ds:
            used.setdefault(tuple(d.mark.rect), decor_json(d.mark.rect))
    return out, sorted(used.values(), key=lambda r: (r["y"], r["x"]))


def _paragraph(pid: str, lines: list[_Line], resolve: FontResolver | None, locked: SpanCheck | None = None,
               invisible: SpanCheck | None = None,
               program: Program | None = None, marks: "PageMarks | None" = None) -> dict:
    """`program` (a run's FontRef → the font program clients measure it with): when given, runs carry the
    original's measured hScale / charSpacing / wordSpacing (see _fit), and their size is the true size. `marks` (the
    page's drawn decorations, see edith/decor.py): runs carry the underlines, strikethroughs and highlights drawn for
    their characters (Run.underline / strike / bgColor, with the bars' geometry), and lines the rects of those marks
    (`decor`)."""
    runs: list[dict] = []
    fits: list[list[_Fit | None]] = []  # per run: the fits of its spans
    measured: dict[int, _Fit | None] = {}
    out_lines: list[dict] = []
    offset = 0
    justified = _align(lines) == "justify"
    natural: set[int] = set()  # spans whose word gaps are natural (not stretched by justification)
    flat = {id(s) for line in lines if line.horizontal for s in line.spans}  # rotated text: no pen advances in x

    def fit_of(span: dict, font: dict | None) -> _Fit | None:
        if program is None or font is None or id(span) not in flat:
            return None
        if id(span) not in measured:
            prog = program(font)
            measured[id(span)] = (None if prog is None else
                                  _fit(span, prog, font.get("kind") == "original", id(span) in natural))
        return measured[id(span)]

    def add(text: str, span: dict, decor: dict | None = None) -> None:
        nonlocal offset
        font = resolve(span) if resolve else None
        size, color = _num(span["size"]), _color(span["color"])
        fit = fit_of(span, font)
        decor = decor or {}
        last = runs[-1] if runs else None
        if (last and last["font"] == font and last["size"] == size and last["color"] == color
                and all(last.get(k) == decor.get(k) for k in DECOR_KEYS) and _fits_with(fits[-1], fit)):
            last["text"] += text
            fits[-1].append(fit)
        else:
            runs.append({"text": text, "font": font, "size": size, "color": color, **decor})
            fits.append([fit])
        offset += len(text)

    for i, line in enumerate(lines):
        if not justified or i == len(lines) - 1:
            natural.update(id(s) for s in line.spans)
    for i, line in enumerate(lines):
        if i > 0:
            prev, cur = lines[i - 1].text, line.text
            spaced = prev[-1:].isspace() or cur[:1].isspace()
            # CJK wraps between characters; a hyphenated word continues on the next line.
            if spaced or not (prev.endswith("-") or _wide(prev[-1:]) or _wide(cur[:1])):
                runs[-1]["text"] += " "  # the soft line break becomes a space in the previous run
                offset += 1
        start = offset
        decor, used = _line_decor(line, marks)
        for text, span, at in _trimmed(line.spans):  # leading spaces are geometry (the line's x), not text
            # Split where the decorations change (an underlined word in a span).
            piece, key = "", None
            for k, ch in enumerate(text):
                fields = _decor_fields(decor.get((id(span), at + k), []))
                if piece and fields != key:
                    add(piece, span, key)
                    piece = ""
                piece, key = piece + ch, fields
            if piece:
                add(piece, span, key)
        x0, x1 = _xs(line)
        out_lines.append({
            "rect": _rect(x0, line.y0, x1, line.y1),
            "baseline": _num(line.baseline), "size": _num(line.size), "start": start, "end": offset,
            **({"wordX": xs} if line.horizontal and (xs := _word_xs(line.spans)) is not None else {}),
            **({"decor": used} if used else {}),
        })
    for run, run_fits in zip(runs, fits):
        _finish(run, run_fits)
        _finish_decor(run)

    baselines = [line.baseline for line in lines]
    deltas = [b - a for a, b in zip(baselines, baselines[1:])]
    line_height = _num(median(deltas)) if deltas else _num(1.2 * max(line.size for line in lines))
    lock = _lock(lines, locked, invisible)
    return {
        "id": pid,
        "rect": _rect(min(_xs(ln)[0] for ln in lines), min(ln.y0 for ln in lines),
                      max(_xs(ln)[1] for ln in lines), max(ln.y1 for ln in lines)),
        "lines": out_lines,
        "runs": runs,
        "align": _align(lines),
        "lineHeight": line_height,
        "editable": lock is None,
        **({"lock": lock} if lock else {}),
    }


# How MuPDF reports a span's paint: `alpha` is its fill opacity (0 also for render mode 3, invisible), `char_flags`
# says whether its glyphs are filled and/or stroked (neither: render mode 3) and whether they are a clip (render modes
# 4–7: MuPDF reports the clip as its own span with alpha 0 and CHAR_FILLED | CHAR_CLIPPED).
CHAR_FILLED, CHAR_STROKED, CHAR_CLIPPED = 16, 32, 64


def invisible_check(page: pymupdf.Page) -> SpanCheck:
    """span → True when it paints nothing: render mode 3 (an OCR layer) or a fill opacity of 0 without a stroke.
    Whatever the reader sees there is something else, usually an image of the same text. Never text used as a clip
    (render modes 4–7: a gradient or pattern painted through it shows; text inside some other clip is not flagged so).
    Never a Type 3 font: its glyphs are procedures MuPDF may report so (alpha 0, neither filled nor stroked: glyphs
    painted with B) while they show ("VISA APPLICATION FORM" of a reference visa form)."""
    type3 = {name_key(name) for f in page.get_fonts(full=True) if f[2] == "Type3" for name in (f[3], f[4]) if name}

    def invisible(span: dict) -> bool:
        flags = span.get("char_flags", CHAR_FILLED)
        if flags & (CHAR_STROKED | CHAR_CLIPPED):
            return False
        return ((span.get("alpha", 255) == 0 or not flags & CHAR_FILLED)
                and name_key(span["font"]) not in type3
                and not span["font"].startswith("Type3"))  # MuPDF's name of a Type 3 font with no name of its own
    return invisible


def _lock(lines: list[_Line], locked: SpanCheck | None, invisible: SpanCheck | None) -> str | None:
    """Why the paragraph can't be edited (None: it can). "hidden": some of its text is invisible (see invisible_check):
    what shows is an image the bake can't rewrite, so an edit would draw the new text over the old picture of it (M5c).
    "font": a symbol font no other font can stand in for. "rotated": text that isn't horizontal."""
    spans = [s for line in lines for s in line.spans]
    # An invisible space next to visible text is harmless.
    if invisible and any(invisible(s) for s in spans if s["text"].strip()):
        return "hidden"
    if locked and any(locked(s) for s in spans):
        return "font"
    if not all(line.horizontal for line in lines):
        return "rotated"
    return None


def _xs(line: _Line) -> tuple[float, float]:
    """Left and right edge of a line's ink (spaces before and after it excluded); rotated lines: their box."""
    return (line.ink_x0, line.ink_x1) if line.horizontal else (line.x0, line.x1)


def _trimmed(spans: list[dict]) -> list[tuple[str, dict, int]]:
    """(text, span, offset of the text in the span's) of a line without its leading and trailing whitespace."""
    full = "".join(s["text"] for s in spans)
    lo, hi = len(full) - len(full.lstrip()), len(full.rstrip())
    out, k = [], 0
    for s in spans:
        n = len(s["text"])
        a, b = max(lo - k, 0), min(hi - k, n)
        if a < b:
            out.append((s["text"][a:b], s, a))
        k += n
    return out


def _word_xs(spans: list[dict]) -> list[float] | None:
    """Origin x of the first glyph of every word of the line's text (as _trimmed gives it; a word: characters between
    SPACE_CHARS), left to right: where an edit keeps the words it leaves alone (M5d). None when a word starts on a
    character with no position (never expected: synthetic characters are spaces) or the words do not run left to
    right (right-to-left text)."""
    # A synthetic space (_join) has no character: it only separates words, which the next real character shows.
    seq: list[tuple[str, float | None]] = []
    for s in spans:
        seq += [(c["c"], c["origin"][0]) for c in s["chars"]] if s["chars"] else [(ch, None) for ch in s["text"]]
    full = "".join(c for c, _ in seq)
    lo, hi = len(full) - len(full.lstrip()), len(full.rstrip())  # as _trimmed cuts the line's text
    out, prev = [], True
    for c, x in seq[lo:hi]:
        space = c in SPACE_CHARS
        if not space and prev:
            if x is None:
                return None
            out.append(_num(x))
        prev = space
    return out if all(b > a for a, b in zip(out, out[1:])) else None


def _rect(x0: float, y0: float, x1: float, y1: float) -> dict:
    return {"x": _num(x0), "y": _num(y0), "w": _num(x1 - x0), "h": _num(y1 - y0)}


def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None,
                       locked: SpanCheck | None = None, program: Program | None = None) -> list[dict]:
    """Paragraphs of `page` in content order, ids `g0`, `g1`, … (stable for a given file and extraction
    version). Coordinates are unrotated-CropBox points. `resolve` maps a span to its run FontRef (None →
    runs get font None); a paragraph with a span `locked` accepts, invisible text or rotated text is not editable
    (`lock`: "font", "hidden", "rotated"; see _lock). Text is never merged
    across a drawn rule (table borders, separators). Rects and line rects are the ink (no leading or trailing
    spaces). A single-line paragraph gets its alignment from where it sits (see _single) and `maxWidth`: how
    wide it may grow when edited, from its left edge (left), around its centre (center) or from its right
    edge (right). A left-aligned, centred or right-aligned multi-line paragraph gets `maxWidth` too: the room beside
    all its lines, with the same meaning (justified text never grows: its lines compress their spaces). Each
    horizontal line gives `wordX`: the x of every word of its text (see _word_xs). With `program` (see _paragraph),
    runs carry the original's measured scale and spacing."""
    rules = page_rules(page)
    marks = PageMarks(page)
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
    left_margin = min((line.ink_x0 for line in every), default=0.0)
    right_margin = page.cropbox.width - left_margin
    flat = [line for line in every if line.horizontal]

    def room_end(line: _Line, left: float) -> float:
        # No further than the page's text reaches in this column: the lines that start at (or left of) the
        # paragraph's left edge and run past it. A column of text with nothing beside it is no room to grow into.
        column = max((o.ink_x1 for o in flat if o.ink_x0 <= left + INDENT_EM * o.size and o.ink_x1 > left),
                     default=line.ink_x1)
        return min(_room_end(line, every, rules, right_margin), column)

    paragraphs: list[dict] = []
    invisible = invisible_check(page)
    for lines in blocks:
        for group in _split(lines, rules, room_end):
            paragraph = _paragraph(f"g{len(paragraphs)}", group, resolve, locked, invisible, program, marks)
            if len(group) == 1 and group[0].horizontal:
                paragraph["align"], paragraph["maxWidth"] = _single(group[0], every, rules, left_margin, right_margin,
                                                                    page.cropbox.width)
            elif paragraph["align"] in ("left", "center", "right") and all(line.horizontal for line in group):
                # The room beside every line (M5b F2; centred and right-aligned: M5d): an edited line may grow into it
                # before it wraps, so a small edit does not re-wrap a paragraph that fit its column by a hair.
                left = min(line.ink_x0 for line in group)
                right = max(line.ink_x1 for line in group)
                end = min(_room_end(line, every, rules, right_margin) for line in group)
                start = max(_room_start(line, every, rules, left_margin) for line in group)
                if paragraph["align"] == "left":
                    room = end - left
                elif paragraph["align"] == "right":
                    room = right - start
                else:  # around the paragraph's centre, as far as the nearer side allows
                    centre = (left + right) / 2
                    room = 2 * min(centre - start, end - centre)
                paragraph["maxWidth"] = _num(max(room, right - left))
            paragraphs.append(paragraph)
    return paragraphs


CELL_PAD = 3.0      # a line centred in its cell keeps at least this much room on both sides …
CELL_CENTRE = 3.0   # … and the two differ by at most this much (or 5 % of their sum in a wide cell)
PAGE_CENTRE = 3.0   # a line without a cell is centred when its centre is this close to the page's …
AWAY = 0.08         # … and it starts this share of the text width away from the left margin
RIGHT_EDGE = 1.5    # right-aligned: ends this close to the right margin, the page's rightmost text or a neighbour's end


def _single(line: _Line, every: list[_Line], rules: Rules, left_margin: float, right_margin: float,
            page_width: float) -> tuple[str, float]:
    """(align, maxWidth) of a single-line paragraph. Centred: in its cell (the vertical rules around it, nothing
    else between them) or, with no rule and no text beside it, on the page well away from the left margin; the
    box may grow symmetrically. Right-aligned: alone on its height, far from the left margin and ending at the
    right margin (the mirrored left one), at the page's rightmost text, or where a line just above or below that
    starts elsewhere ends too ("FRM/…" over "Tanggal …"); the box may grow to the left. Else left-aligned, growing
    to the right (_room)."""
    x0, x1 = line.ink_x0, line.ink_x1
    mid = (line.y0 + line.y1) / 2
    beside = [o for o in every if o is not line and o.horizontal
              and min(o.y1, line.y1) - max(o.y0, line.y0) > 0.5 * min(o.y1 - o.y0, line.y1 - line.y0)]
    lrule = max((s.at for s in rules.vertical if s.at < x0 + 0.5 and s.lo <= mid <= s.hi), default=None)
    rrule = min((s.at for s in rules.vertical if s.at > x1 - 0.5 and s.lo <= mid <= s.hi), default=None)
    ltext = max((o.ink_x1 for o in beside if o.ink_x1 < x0 + 0.5), default=None)
    rtext = min((o.ink_x0 for o in beside if o.ink_x0 > x1 - 0.5), default=None)
    width = x1 - x0
    if lrule is not None and rrule is not None:
        gl, gr = x0 - lrule, rrule - x1
        alone = (ltext is None or ltext <= lrule) and (rtext is None or rtext >= rrule)
        if alone and min(gl, gr) >= CELL_PAD and abs(gl - gr) <= max(CELL_CENTRE, 0.05 * (gl + gr)):
            return "center", _num(max(width, rrule - lrule - 2 * ROOM_PAD))
    elif lrule is None and rrule is None and ltext is None and rtext is None:
        c, span = (x0 + x1) / 2, right_margin - left_margin
        if abs(c - page_width / 2) <= PAGE_CENTRE and x0 > left_margin + max(2 * line.size, AWAY * span):
            return "center", _num(max(width, 2 * (min(c - left_margin, right_margin - c) - ROOM_PAD)))
        rightmost = max(o.ink_x1 for o in every if o.horizontal)
        paired = any(abs(o.ink_x1 - x1) <= RIGHT_EDGE and abs(o.ink_x0 - x0) > RIGHT_EDGE
                     and 0 < abs(o.baseline - line.baseline) <= 2.5 * line.size for o in every if o.horizontal)
        if x0 > left_margin + 0.25 * span and (
                min(abs(x1 - right_margin), abs(x1 - rightmost)) <= RIGHT_EDGE or paired):
            return "right", _num(max(width, x1 - left_margin))
    return "left", _room(line, every, rules, right_margin)


def _room(line: _Line, every: list[_Line], rules: Rules, right_margin: float) -> float:
    """Width a single-line paragraph may grow to when edited (from its left edge): up to the first vertical rule
    or other text to its right on its height, or the right margin, less ROOM_PAD; at least its own width."""
    return _num(max(line.ink_x1 - line.ink_x0, _room_end(line, every, rules, right_margin) - line.ink_x0))


def _room_end(line: _Line, every: list[_Line], rules: Rules, right_margin: float) -> float:
    """Where the room right of `line` ends: the first vertical rule or other text on its height, or the right
    margin, less ROOM_PAD."""
    mid = (line.y0 + line.y1) / 2
    ends = [right_margin]
    ends += [s.at for s in rules.vertical if s.at > line.ink_x1 - 0.5 and s.lo <= mid <= s.hi]
    ends += [o.ink_x0 for o in every if o is not line and o.ink_x0 > line.ink_x1 - 0.5
             and min(o.y1, line.y1) - max(o.y0, line.y0) > 0.5 * min(o.y1 - o.y0, line.y1 - line.y0)]
    return min(ends) - ROOM_PAD


def _room_start(line: _Line, every: list[_Line], rules: Rules, left_margin: float) -> float:
    """Where the room left of `line` ends (mirrors _room_end): the first vertical rule or other text on its height, or
    the left margin, plus ROOM_PAD."""
    mid = (line.y0 + line.y1) / 2
    starts = [left_margin]
    starts += [s.at for s in rules.vertical if s.at < line.ink_x0 + 0.5 and s.lo <= mid <= s.hi]
    starts += [o.ink_x1 for o in every if o is not line and o.ink_x1 < line.ink_x0 + 0.5
               and min(o.y1, line.y1) - max(o.y0, line.y0) > 0.5 * min(o.y1 - o.y0, line.y1 - line.y0)]
    return max(starts) + ROOM_PAD
