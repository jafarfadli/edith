"""OCR of text that is a picture (M5d): on request, one page at a time, with Tesseract.

The images GET /text reports as `imageText` (a scanned form, a pasted screenshot of a letter) are rendered at 300 dpi
and read by the `tesseract` command (word boxes and confidences, TSV). The words become paragraphs in the same JSON
shape as GET /text's, grouped by the same code: they are handed to `extract_paragraphs` as the text of a stand-in page
(`_OcrPage`), with the straight lines found in the picture as its rules. Each run gets a bundled font (sans or serif,
bold, from the strokes' thickness), a size from the words' heights in that font, and the colour of the ink. Each
paragraph adds `ocr`, `confidence` (0–1, mean of its words) and what an edit paints over the old picture of it:
`cover` (the words' ink, padded a little, never across a line of the picture or out of the image) and `coverColor`
(the picture's own background there; `coverUniform` false when it is not plain: a photo, a gradient).

Nothing is written into the stored PDF and nothing is kept on the server: the client keeps the result. Skewed scans
(more than MAX_SKEW degrees) and unreadable ones are reported as such (`quality`), without paragraphs."""
import logging
import math
import os
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from statistics import median

import numpy as np
import pymupdf
from fontTools.ttLib import TTFont

from edith.errors import OcrFailed, OcrTimeout, OcrTooComplex, OcrUnavailable
from edith.fonts import FontRegistry
from edith.imagetext import Budget, image_text_regions
from edith.paragraphs import JOIN_EM, ROOM_PAD, extract_paragraphs

BAND = 8.0                # pt: height of the bands paragraph lines are looked up in (ocr_page)
logger = logging.getLogger("edith")

DPI = 300                 # what Tesseract reads print best at
MIN_DPI = 150             # a larger image is rendered coarser to stay within MAX_PIXELS, but not below this
MAX_PIXELS = 12_000_000   # pixels one page's OCR may render (A4 at 300 dpi: 8.7 M)
TIMEOUT = 30.0            # seconds one page's OCR may take (all its images together)
LANGS = ("ind", "eng")
MAX_SKEW = 1.5            # degrees: a more skewed scan is reported ("skewed"), not read into slanted boxes
MIN_CONFIDENCE = 45       # median word confidence (0–100) under which a page is "unreadable"
CHAIN_EM = 1.8           # lines further apart (× size) are not one column of text (form rows are 2–3 em apart)
SPLIT_EM = 1.0            # a gap this wide (× size) inside a Tesseract line starts another piece (columns, form rows)
SERIF_CONTRAST = 1.6      # vertical stems this many times as thick as horizontal strokes: a serif face (see _measure)
BOLD_STEM, BOLD_RATIO = 0.11, 1.3  # bold: stems at least this thick (× size) and this many times the page's usual …
BOLD_ALONE = 0.16         # … or this thick whatever the page (measured: regular 0.08–0.13, bold 0.14–0.19)
COVER_PAD_EM, COVER_PAD = 0.15, (1.0, 2.5)  # the cover reaches this far (× size, clamped in pt) past the words' ink
RULE_PT, RULE_THICK = 24.0, 3.0  # a straight dark run at least this long and at most this thick (pt) is a drawn line
UNIFORM = 40              # luminance spread (p90 − p10) of a cover's background above which it is not plain
JUNK_CONFIDENCE = 0.3     # a paragraph this unsure with at most two characters is noise (a box edge, a speck)
DENSE = 0.35              # a word's rows with this share of its busiest row's ink are its x-height band (_word_ink)
TINY = 0.4                # a word less than this share of the page's usual word height: dots of a leader, specks
LEADER = 0.7              # a word whose inked columns are this often short (≤ TINY × usual height): a dot leader
BOX_EDGE, BOX_HOLLOW = 0.7, 0.15  # a checkbox: each side this much ink, its inside at most this much
LEADING_EDGE = 0.9        # … sides this straight for a box at the start of a word (round capitals O, D: less)
MAX_IMAGES = 64           # pictures on one page OCR looks at: judging each renders the ones under it (cost ~ n²)
MAX_WORDS = 4000          # words one page may hold (a dense A4 page: ~600); more is noise or a crafted image
FIND_SECONDS = 5.0        # of the page's time, at most this long to find its pictures of print
MAX_RESCUES, RESCUE_TIME = 40, 3.0  # stretches read again (_rescue) at most, and only with this many seconds left


@dataclass
class Word:
    text: str
    conf: float                           # 0–100
    box: tuple[float, float, float, float]  # pixels of the rendered image
    line: tuple[int, int, int]            # Tesseract (block, paragraph, line)


def parse_tsv(tsv: str) -> list[Word]:
    """The words (level 5 rows with text) of Tesseract's TSV output."""
    out = []
    for row in tsv.splitlines()[1:]:
        cols = row.split("\t")
        if len(cols) < 12 or cols[0] != "5":
            continue
        text = cols[11].strip()
        try:
            conf = float(cols[10])
            left, top, width, height = (int(c) for c in cols[6:10])
            key = (int(cols[2]), int(cols[3]), int(cols[4]))
        except ValueError:
            continue
        if text and conf >= 0 and width > 0 and height > 0:
            out.append(Word(text, conf, (left, top, left + width, top + height), key))
    return out


def tesseract_cmd(configured: str | None = None) -> str | None:
    return configured or shutil.which("tesseract")


_LANGS: dict[str, frozenset[str]] = {}


def _languages(cmd: str) -> frozenset[str]:
    """The language data `cmd` has. Only an answer is kept: a failure (Tesseract installed after the server started,
    a slow first start) is asked again next time."""
    if cmd in _LANGS:
        return _LANGS[cmd]
    try:
        out = subprocess.run([cmd, "--list-langs"], capture_output=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return frozenset()
    lines = out.stdout.decode("utf-8", "replace").splitlines()
    found = frozenset(line.strip() for line in lines[1:] if line.strip())
    if out.returncode == 0 and found:
        _LANGS[cmd] = found
    return found


def available(configured: str | None = None) -> bool:
    """Tesseract is installed with the Indonesian and English language data."""
    cmd = tesseract_cmd(configured)
    return cmd is not None and set(LANGS) <= _languages(cmd)


def run_tesseract(png: bytes, dpi: int, timeout: float, cmd: str, psm: int = 3) -> list[Word]:
    """Words Tesseract reads in `png` (`psm` 3: a page, 7: one line). No shell and no temporary files: the image goes
    in on stdin, the TSV comes out on stdout; the process is killed when `timeout` (s) passes. One thread
    (OMP_THREAD_LIMIT): concurrent requests must not each take every core."""
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}
    try:
        out = subprocess.run([cmd, "stdin", "stdout", "-l", "+".join(LANGS), "--dpi", str(dpi), "--psm", str(psm),
                              "tsv"],
                             input=png, capture_output=True, timeout=max(timeout, 0.1), env=env, check=False)
    except subprocess.TimeoutExpired:
        raise OcrTimeout("OCR took longer than the time allowed") from None
    except OSError:
        logger.exception("cannot run tesseract")  # the path and the system's message stay in the server's log
        raise OcrUnavailable("cannot run tesseract") from None
    if out.returncode != 0:
        logger.error("tesseract failed (%s): %s", out.returncode, out.stderr.decode("utf-8", "replace")[-500:])
        raise OcrFailed("tesseract failed")
    return parse_tsv(out.stdout.decode("utf-8", "replace"))


# --- what the pixels say -----------------------------------------------------------------------------------------

def _otsu(grey: np.ndarray) -> float:
    """The grey level that best separates ink from paper."""
    hist = np.bincount(grey.ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    if total == 0:
        return 128.0
    levels = np.arange(256)
    w0 = np.cumsum(hist)
    m0 = np.cumsum(hist * levels)
    mean = m0[-1] / total
    w1 = total - w0
    with np.errstate(divide="ignore", invalid="ignore"):
        between = (mean * w0 - m0) ** 2 / (w0 * w1)
    between[~np.isfinite(between)] = 0
    return float(np.argmax(between)) + 0.5


def _run_lengths(mask: np.ndarray) -> np.ndarray:
    """Lengths of the runs of True along each row of `mask`."""
    if mask.size == 0:
        return np.zeros(0, dtype=np.int64)
    d = np.diff(np.pad(mask, ((0, 0), (1, 1))).astype(np.int8), axis=1)
    return np.nonzero(d == -1)[1] - np.nonzero(d == 1)[1]


def _typical(runs: np.ndarray) -> float | None:
    """The most common run length, refined by its neighbours (sub-pixel: ±1 px around the mode)."""
    if runs.size < 20:
        return None
    counts = np.bincount(runs)
    mode = int(np.argmax(counts))
    lo, hi = max(mode - 1, 1), min(mode + 2, counts.size)
    near = counts[lo:hi]
    return float((near * np.arange(lo, hi)).sum() / near.sum()) if near.sum() else float(mode)


def _strokes(ink: np.ndarray, em_px: float) -> tuple[float, float] | None:
    """(stem thickness × size, stem / horizontal stroke) of the glyphs in `ink`: vertical stems are the commonest
    horizontal run, horizontal strokes (bars, serifs) the commonest short vertical one."""
    stem = _typical(_run_lengths(ink))
    vertical = _run_lengths(ink.T)
    hair = _typical(vertical[vertical < 0.25 * em_px])
    if stem is None or hair is None or em_px <= 0:
        return None
    return stem / em_px, stem / max(hair, 0.5)


def _hex(rgb) -> str:
    return "#" + "".join(f"{int(round(min(max(v, 0), 255))):02x}" for v in rgb)


def _segments(mask: np.ndarray, min_len: int) -> list[tuple[int, int, int]]:
    """(row, start, end) of the runs of True at least `min_len` long in each row."""
    d = np.diff(np.pad(mask, ((0, 0), (1, 1))).astype(np.int8), axis=1)
    rows, starts = np.nonzero(d == 1)
    ends = np.nonzero(d == -1)[1]
    keep = ends - starts >= min_len
    return list(zip(rows[keep].tolist(), starts[keep].tolist(), ends[keep].tolist()))


def _rules(ink: np.ndarray, min_len: int, max_thick: int) -> tuple[list, list]:
    """Horizontal and vertical lines drawn in the picture, as (at, lo, hi, thickness) in pixels: long straight runs of
    ink in adjacent rows (columns) that overlap, at most `max_thick` rows thick (a dark block is not a line)."""
    out: tuple[list, list] = ([], [])
    for axis, mask in ((0, ink), (1, ink.T)):
        done: list[list] = []
        open_: list[list] = []  # [first row, last row, lo, hi] of the groups that reached the row before
        for row, a, b in _segments(mask, min_len):
            if open_ and open_[0][1] < row - 1:  # segments come row by row: close the groups left behind
                done += [g for g in open_ if g[1] < row - 1]
                open_ = [g for g in open_ if g[1] >= row - 1]
            for g in open_:
                if a < g[3] and b > g[2]:
                    g[1], g[2], g[3] = row, min(g[2], a), max(g[3], b)
                    break
            else:
                open_.append([row, row, a, b])
        for first, last, lo, hi in done + open_:
            thick = last - first + 1
            if thick <= max_thick:
                out[axis].append(((first + last + 1) / 2, lo, hi, thick))
    return out


# --- fonts ---------------------------------------------------------------------------------------------------------

@lru_cache(maxsize=16)
def _ink_extents(path: Path) -> tuple[dict[int, tuple[float, float]], float]:
    """Per character: (bottom, top) of its glyph's ink, in ems (y up from the baseline); and the font's units/em."""
    font = TTFont(str(path), lazy=True)
    upm = float(font["head"].unitsPerEm)
    glyf = font["glyf"] if "glyf" in font else None
    out: dict[int, tuple[float, float]] = {}
    if glyf is not None:
        for cp, name in font.getBestCmap().items():
            if cp > 0x24F:
                continue
            g = glyf[name]
            if getattr(g, "numberOfContours", 0) != 0 and hasattr(g, "yMin"):
                out[cp] = (g.yMin / upm, g.yMax / upm)
    font.close()
    return out, upm


@dataclass
class _Face:
    family: str
    bold: bool
    font: pymupdf.Font
    extents: dict[int, tuple[float, float]]

    def word_extent(self, text: str) -> tuple[float, float] | None:
        """(bottom, top) of the ink of `text` in ems; None when no character of it is known."""
        known = [self.extents[ord(c)] for c in text if ord(c) in self.extents]
        if not known:
            return None
        return min(b for b, _ in known), max(t for _, t in known)


class _Faces:
    def __init__(self, registry: FontRegistry):
        self.registry = registry
        self._faces: dict[tuple[str, bool], _Face] = {}

    def get(self, family: str, bold: bool) -> _Face:
        key = (family, bold)
        if key not in self._faces:
            extents, _upm = _ink_extents(self.registry.path(family, bold, False))
            self._faces[key] = _Face(family, bold, self.registry.font(family, bold, False), extents)
        return self._faces[key]


# --- lines ---------------------------------------------------------------------------------------------------------

@dataclass
class _Line:
    region: int
    key: tuple[int, int, int]
    words: list[Word]                         # left to right
    boxes: list[pymupdf.Rect]                 # their boxes in page points
    size: float = 0.0
    baseline: float = 0.0
    slope: float | None = None
    stem: float | None = None                 # stem thickness × size
    contrast: float | None = None
    rgb: tuple[float, float, float] = (0.0, 0.0, 0.0)
    bold: bool = False
    pieces: list[list[int]] = field(default_factory=list)  # word indexes per piece (split at wide gaps)

    @property
    def chars(self) -> int:
        return sum(len(w.text) for w in self.words)


@dataclass
class _Region:
    rect: pymupdf.Rect
    dpi: int
    rgb: np.ndarray       # h × w × 3
    grey: np.ndarray      # h × w
    threshold: float      # Otsu: ink is darker
    mid: float = 0.0      # halfway between the paper and the ink's core: where a blurred edge truly is
    rules: tuple[list, list] = ((), ())   # pixels, see _rules

    @property
    def scale(self) -> float:
        return 72.0 / self.dpi

    def to_page(self, box) -> pymupdf.Rect:
        s = self.scale
        return pymupdf.Rect(self.rect.x0 + box[0] * s, self.rect.y0 + box[1] * s,
                            self.rect.x0 + box[2] * s, self.rect.y0 + box[3] * s)

    def to_px(self, r: pymupdf.Rect) -> tuple[int, int, int, int]:
        s = self.scale
        h, w = self.grey.shape
        return (max(int(math.floor((r.x0 - self.rect.x0) / s)), 0), max(int(math.floor((r.y0 - self.rect.y0) / s)), 0),
                min(int(math.ceil((r.x1 - self.rect.x0) / s)), w), min(int(math.ceil((r.y1 - self.rect.y0) / s)), h))


def _word_ink(word: Word, region: _Region) -> tuple[float, float] | None:
    """(top, baseline) of a word in pixels, from its own pixels at the 50 % level (blur makes Tesseract's boxes grow):
    the top of its ink, and the bottom of its dense rows (at least DENSE of the busiest row: the x-height band where
    every letter has ink; descenders of g, p, J, / and brackets only add a few strokes below it). Rows of ink across
    nearly the whole word (an underline, a strike) are left out."""
    x0, y0, x1, y1 = (int(v) for v in word.box)
    top = max(y0 - 2, 0)
    crop = region.grey[top:y1 + 2, x0:x1] < region.mid
    if crop.size == 0:
        return None
    rows = crop.sum(axis=1)
    rows[rows >= 0.85 * crop.shape[1]] = 0
    lit = np.nonzero(rows)[0]
    if lit.size == 0:
        return None
    dense = np.nonzero(rows >= DENSE * rows.max())[0]
    return top + float(lit[0]), top + float(dense[-1]) + 1


def _measure(line: _Line, region: _Region, face: _Face) -> None:
    """Size, baseline, slope, strokes and ink colour of `line`. The baseline is the median of its words' (_word_ink);
    the size is the words' height above it over their glyphs' height in `face`, from capitals and ascenders when the
    line has them (their height varies least between faces: 0.64–0.75 em; the x-height 0.45–0.55)."""
    s = region.scale
    inks = [_word_ink(w, region) for w in line.words]
    bases = [(region.rect.y0 + ink[1] * s, (b.x0 + b.x1) / 2) for ink, b in zip(inks, line.boxes) if ink]
    line.baseline = median(y for y, _ in bases) if bases else max(b.y1 for b in line.boxes)
    tall, short = [], []
    for word, ink in zip(line.words, inks):
        ext = face.word_extent(word.text)
        if ext is None or ink is None or not any(c.isalnum() for c in word.text):
            continue
        above = line.baseline - (region.rect.y0 + ink[0] * s)
        if ext[1] >= 0.6 and above > 0:
            tall.append(above / ext[1])
        elif ext[1] > 0.3 and above > 0:
            short.append(above / ext[1])
    sizes = tall or short or [max(b.height for b in line.boxes) / 0.9]
    line.size = round(median(sizes) * 2) / 2 or 1.0
    if len(bases) >= 3 and max(x for _, x in bases) - min(x for _, x in bases) > 4 * line.size:
        line.slope = float(np.polyfit([x for _, x in bases], [y for y, _ in bases], 1)[0])
    x0, y0, x1, y1 = region.to_px(pymupdf.Rect(min(b.x0 for b in line.boxes), min(b.y0 for b in line.boxes),
                                                max(b.x1 for b in line.boxes), max(b.y1 for b in line.boxes)))
    grey = region.grey[y0:y1, x0:x1]
    ink = grey < region.threshold
    if not ink.any():
        return
    em_px = line.size / region.scale
    strokes = _strokes(ink, em_px)
    if strokes:
        line.stem = strokes[0]
    # Contrast on the darker half of the strokes: blur widens thin strokes more than thick ones (measured: blurred
    # Times at 200 dpi 1.46 at Otsu's threshold, 2.0 here; Arial at most 1.42 here).
    dark = (region.threshold + np.percentile(grey[ink], 30)) / 2
    strokes = _strokes(grey < dark, em_px)
    if strokes:
        line.contrast = strokes[1]
    core = ink & (grey <= np.percentile(grey[ink], 20))  # the middle of the strokes, not their (blurred) edges
    line.rgb = tuple(float(v) for v in np.median(region.rgb[y0:y1, x0:x1][core], axis=0))


def _snap_colours(lines: list[_Line]) -> None:
    """Near-black ink is one colour for the whole page, other colours join the closest one seen (measured colours
    jitter from line to line; a colour change splits paragraphs)."""
    def grey_dark(rgb):
        return max(rgb) - min(rgb) < 40 and sum(rgb) / 3 < 110
    dark = [ln for ln in lines if grey_dark(ln.rgb)]
    if dark:
        ref = tuple(float(np.median([ln.rgb[i] for ln in dark for _ in range(ln.chars)])) for i in range(3))
        for ln in dark:
            ln.rgb = ref
    seen: list[tuple[float, float, float]] = []
    for ln in sorted((ln for ln in lines if not grey_dark(ln.rgb)), key=lambda ln: -ln.chars):
        near = next((c for c in seen if max(abs(a - b) for a, b in zip(c, ln.rgb)) < 48), None)
        if near is None:
            seen.append(ln.rgb)
        else:
            ln.rgb = near


def _snap_sizes(lines: list[_Line]) -> None:
    """Lines of one Tesseract block within 8 % of its median size take that size (estimates jitter by a few %)."""
    blocks: dict[tuple, list[_Line]] = {}
    for ln in lines:
        blocks.setdefault((ln.region, ln.key[0]), []).append(ln)
    for group in blocks.values():
        mid = median(ln.size for ln in group for _ in range(ln.chars))
        for ln in group:
            if abs(ln.size - mid) <= 0.08 * mid:
                ln.size = round(mid * 2) / 2


def _checkbox(word: Word, region: _Region, edge: float = BOX_EDGE) -> bool:
    """A box drawn in the picture that Tesseract read as a letter ("O", "U", "D", "o"): a square-ish word of at most two
    characters whose four sides are ink and whose inside is paper. Left out of the text, so an edit neither paints it
    over nor redraws it as a letter."""
    if len(word.text) > 2:
        return False
    x0, y0, x1, y1 = (int(v) for v in word.box)
    w, h = x1 - x0, y1 - y0
    if h < 5 or not 0.7 <= w / h <= 1.4:
        return False
    ink = region.grey[y0:y1, x0:x1] < region.threshold
    t = max(1, round(0.15 * min(w, h)))
    sides = (ink[:t].any(axis=0).mean(), ink[-t:].any(axis=0).mean(),
             ink[:, :t].any(axis=1).mean(), ink[:, -t:].any(axis=1).mean())
    inside = ink[t + 1:h - t - 1, t + 1:w - t - 1]
    # A drawn box has ink in its four corners; a round letter (O, o, D) has none there.
    corners = (ink[:t, :t].any(), ink[:t, -t:].any(), ink[-t:, :t].any(), ink[-t:, -t:].any())
    return all(corners) and min(sides) >= edge and (inside.size == 0 or inside.mean() <= BOX_HOLLOW)


def _leader(word: Word, region: _Region, usual: float) -> bool:
    """A dot leader, a row of underscores or a dash read as letters ("Aam ain", "NANA"), maybe after a colon: most of
    the word's inked columns hold only a short mark (at most TINY × the page's usual word height, in pixels)."""
    x0, y0, x1, y1 = (int(v) for v in word.box)
    crop = region.grey[y0:y1, x0:x1] < region.mid
    inked = crop.any(axis=0)
    if inked.sum() < 3:
        return False
    rows = np.arange(crop.shape[0])[:, None]
    first = np.where(crop, rows, crop.shape[0]).min(axis=0)
    last = np.where(crop, rows, -1).max(axis=0)
    extent = (last - first + 1)[inked]
    return float((extent <= TINY * usual).mean()) >= LEADER


def _usual(words: list[tuple[Word, int]]) -> float:
    """The page's usual word height (pixels): sure words of two letters or more."""
    heights = [w.box[3] - w.box[1] for w, _ in words if sum(c.isalnum() for c in w.text) >= 2 and w.conf >= 60]
    return median(heights or [w.box[3] - w.box[1] for w, _ in words])


def _usable(words: list[tuple[Word, int]], regions: list[_Region], usual: float) -> tuple[list, list, list]:
    """(text, boxes, leaders): the words without specks and leader dots read as letters (far smaller than the page's
    `usual` word height, or mostly short marks: _leader) and without checkboxes read as letters (_checkbox), which are
    returned apart (they start an item of a list: see ocr_page), as are the long leaders (they may hold words: _rescue)."""
    text, boxes, leaders = [], [], []
    for w, i in words:
        if w.box[3] - w.box[1] < TINY * usual or _leader(w, regions[i], usual):
            if w.box[2] - w.box[0] >= 3 * usual:
                leaders.append((w, i))
        elif _checkbox(w, regions[i]):
            boxes.append((w, i))
        elif (split := _leading_box(w, regions[i])) is not None:
            boxes.append((split[0], i))
            text.append((split[1], i))
        else:
            text.append((w, i))
    return text, boxes, leaders


BOX_LETTERS = frozenset("OoUuDd0QaC□■[|")  # what Tesseract reads a checkbox as, at the start of a word


def _leading_box(word: Word, region: _Region) -> tuple[Word, Word] | None:
    """(checkbox, the rest) when a word begins with a checkbox Tesseract read as its first letter ("OMengikuti") or
    swallowed: the word's first stretch of ink, up to a blank column, is a checkbox (_checkbox). The rest starts at the
    next ink; it loses its first character only when that is what a checkbox reads as."""
    if len(word.text) < 2:
        return None
    x0, y0, x1, y1 = (int(v) for v in word.box)
    ink = region.grey[y0:y1, x0:x1] < region.threshold
    cols = ink.any(axis=0)
    if cols.size < 4 or not cols[0:max(2, cols.size // 20)].any():
        return None
    first = int(np.argmax(cols))
    blank = np.nonzero(~cols[first:])[0]
    if blank.size == 0:
        return None
    end = first + int(blank[0])  # the first stretch: columns first … end-1
    rows = np.nonzero(ink[:, first:end].any(axis=1))[0]
    if rows.size == 0:
        return None
    box = (x0 + first, y0 + int(rows[0]), x0 + end, y0 + int(rows[-1]) + 1)
    candidate = Word(word.text[:1], word.conf, box, word.line)
    rest = np.nonzero(cols[end:])[0]
    # A clear gap after it (a box stands apart from the word, a first letter touches or nearly touches the next), as tall
    # as a capital (a small round "o" is not), with straight sides.
    side = box[3] - box[1]
    if (rest.size == 0 or rest[0] < max(2, 0.15 * side) or side < 0.6 * (word.box[3] - word.box[1])
            or not _checkbox(candidate, region, edge=LEADING_EDGE)):
        return None
    text = word.text[1:] if word.text[0] in BOX_LETTERS else word.text
    return candidate, Word(text.lstrip(), word.conf, (x0 + end + int(rest[0]), word.box[1], word.box[2], word.box[3]), word.line)


def _tall_runs(word: Word, region: _Region, usual: float) -> list[tuple[int, int]]:
    """Stretches (pixel columns) of a leader "word" where glyphs of full height stand: words Tesseract swallowed into
    the dots ("…… (…) Aktif atau (…) Pensiun" read as one word of junk). Separate stretches at least 2 × `usual` apart."""
    x0, y0, x1, y1 = (int(v) for v in word.box)
    crop = region.grey[y0:y1, x0:x1] < region.mid
    rows = np.arange(crop.shape[0])[:, None]
    first = np.where(crop, rows, crop.shape[0]).min(axis=0)
    last = np.where(crop, rows, -1).max(axis=0)
    tall = np.nonzero(last - first + 1 > 0.45 * usual)[0]
    runs: list[list[int]] = []
    for c in tall.tolist():
        if runs and c - runs[-1][1] <= 2 * usual:
            runs[-1][1] = c
        else:
            runs.append([c, c])
    return [(x0 + a, x0 + b + 1) for a, b in runs if b - a + 1 >= 0.8 * usual]


def _overlap(a: tuple, b: tuple) -> float:
    """Shared area of two boxes over the smaller one's."""
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    return w * h / max(min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])), 1e-9)


def _unread(words: list[tuple[Word, int]], regions: list[_Region], usual: float) -> list[tuple[Word, int]]:
    """Stretches after each Tesseract line up to the next word on its row (or the picture's edge), as stand-in words
    for _rescue: Tesseract sometimes reads nothing of a row's rest after a long leader."""
    lines: dict[tuple, list[Word]] = {}
    for w, i in words:
        lines.setdefault((i, *w.line), []).append(w)
    out = []
    for (i, *key), ws in lines.items():
        x_end, y0, y1 = max(w.box[2] for w in ws), min(w.box[1] for w in ws), max(w.box[3] for w in ws)
        stop = min([w.box[0] for w, j in words if j == i and w.box[0] > x_end and w.line != tuple(key)
                    and min(w.box[3], y1) - max(w.box[1], y0) > 0.5 * (y1 - y0)] + [regions[i].grey.shape[1]])
        if stop - x_end > 3 * usual:
            out.append((Word("", 0, (x_end + 0.5 * usual, y0, stop, y1), tuple(key)), i))
    return out


def _rescue(leaders: list[tuple[Word, int]], regions: list[_Region], usual: float, cmd: str,
            time_left) -> list[tuple[Word, int]]:
    """The words inside long leaders (_tall_runs), each stretch read again on its own as one line."""
    out = []
    runs = [(w, i, a, b) for w, i in leaders for a, b in _tall_runs(w, regions[i], usual)]
    for w, i, a, b in runs[:MAX_RESCUES]:
        if time_left() < RESCUE_TIME:
            break  # what was read so far is kept: no stretch is worth timing the page out
        region = regions[i]
        h, wd = region.grey.shape
        pad = int(0.4 * usual)
        x0, y0, x1, y1 = max(a - pad, 0), max(int(w.box[1]) - pad, 0), min(b + pad, wd), min(int(w.box[3]) + pad, h)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        crop = np.ascontiguousarray(region.grey[y0:y1, x0:x1])
        pix = pymupdf.Pixmap(pymupdf.csGRAY, x1 - x0, y1 - y0, crop.tobytes(), False)
        pix.set_dpi(region.dpi, region.dpi)
        for v in run_tesseract(pix.tobytes("png"), region.dpi, time_left(), cmd, psm=7):
            box = (v.box[0] + x0, v.box[1] + y0, v.box[2] + x0, v.box[3] + y0)
            out.append((Word(v.text, v.conf, box, w.line), i))
    return out


def _chains(pieces: list[tuple[_Line, list[int]]]) -> list[list[tuple[_Line, list[int]]]]:
    """Pieces of lines in columns: each joins the column whose last piece sits right above it (within CHAIN_EM × size,
    overlapping it), as MuPDF puts a column of text in a block of its own; Tesseract may interleave two columns'
    lines, and extract_paragraphs only groups consecutive lines of a block."""
    def span(p):
        ln, idx = p
        return ln.boxes[idx[0]].x0, ln.boxes[idx[-1]].x1

    chains: list[list] = []
    for p in sorted(pieces, key=lambda p: (p[0].region, p[0].baseline, span(p)[0])):
        ln, (x0, x1) = p[0], span(p)
        best = None
        for chain in chains:
            q = chain[-1][0]
            qx0, qx1 = span(chain[-1])
            gap = ln.baseline - q.baseline
            if q.region == ln.region and 0 < gap <= CHAIN_EM * max(ln.size, q.size) and x0 < qx1 and x1 > qx0:
                if best is None or gap < best[0]:
                    best = (gap, chain)
        if best is None:
            chains.append([p])
        else:
            best[1].append(p)
    return chains


def _pieces(line: _Line) -> list[list[int]]:
    out = [[0]]
    for i in range(1, len(line.words)):
        if line.boxes[i].x0 - line.boxes[i - 1].x1 > SPLIT_EM * line.size:
            out.append([i])
        else:
            out[-1].append(i)
    return out


# --- the stand-in page ---------------------------------------------------------------------------------------------

class _OcrPage:
    """Just enough of a pymupdf.Page for extract_paragraphs (and the rules and invisible-text checks it runs): the OCR
    lines as its "rawdict" text, the lines drawn in the picture as its drawings, and no fonts."""

    def __init__(self, width: float, height: float, blocks: list[dict], drawings: list[dict]):
        self.cropbox = pymupdf.Rect(0, 0, width, height)
        self.rect = self.cropbox
        self.rotation = 0
        self._blocks, self._drawings = blocks, drawings

    def get_text(self, kind: str, flags: int = 0, **_) -> dict:
        assert kind == "rawdict", kind
        return {"width": self.cropbox.width, "height": self.cropbox.height, "blocks": self._blocks}

    def get_cdrawings(self, **_) -> list[dict]:
        return self._drawings

    def get_fonts(self, full: bool = False) -> list:
        return []


def _span(line: _Line, idx: list[int], face: _Face, colour: int) -> dict:
    """One piece of an OCR line as a MuPDF span: its words' characters spread over each word's box in proportion to
    the face's advances, a space between words spanning the gap."""
    size, base = line.size, line.baseline
    top, bottom = base - face.font.ascender * size, base - face.font.descender * size
    chars = []
    for n, i in enumerate(idx):
        word, box = line.words[i], line.boxes[i]
        if n:
            prev = chars[-1]["bbox"][2]
            chars.append({"c": " ", "origin": (prev, base), "bbox": (prev, top, max(box.x0, prev), bottom)})
        advances = [max(face.font.glyph_advance(ord(c)), 0.05) for c in word.text]
        scale = box.width / sum(advances)
        x = box.x0
        for c, a in zip(word.text, advances):
            chars.append({"c": c, "origin": (x, base), "bbox": (x, top, x + a * scale, bottom)})
            x += a * scale
    x0, x1 = line.boxes[idx[0]].x0, line.boxes[idx[-1]].x1
    return {"size": size, "flags": pymupdf.TEXT_FONT_BOLD if face.bold else 0,
            "font": f"{face.family}-{'Bold' if face.bold else 'Regular'}", "color": colour, "alpha": 255,
            "char_flags": 16, "ascender": face.font.ascender, "descender": face.font.descender,
            "origin": (x0, base), "bbox": (x0, top, x1, bottom), "chars": chars,
            "ocr_font": {"kind": "bundled", "family": face.family, "bold": face.bold, "italic": False}}


GHOST = {"ghost": True}


def _ghost_span(text: str, x0: float, x1: float, line: _Line, face: _Face, colour: int) -> dict:
    """A stand-in span (GHOST) for something left out of the text that still shapes it (see ocr_page)."""
    size, base = line.size, line.baseline
    top, bottom = base - face.font.ascender * size, base - face.font.descender * size
    step = (x1 - x0) / len(text)
    chars = [{"c": c, "origin": (x0 + k * step, base), "bbox": (x0 + k * step, top, x0 + (k + 1) * step, bottom)}
             for k, c in enumerate(text)]
    return {"size": size, "flags": 0, "font": "ghost", "color": colour, "alpha": 255, "char_flags": 16,
            "origin": (x0, base), "bbox": (x0, top, x1, bottom), "chars": chars, "ocr_font": GHOST}


def _unghost(p: dict, leaders: dict[tuple[float, float], tuple[float, float]]) -> dict | None:
    """`p` without the stand-ins (_ghost_span): None when it is one (a checkbox mark, a leader alone); a form row's
    piece loses the leader after it, ends at its own last character and may grow up to that leader (`maxWidth`)."""
    runs = [r for r in p["runs"] if r["font"] != GHOST]
    if not runs:
        return None
    if len(runs) == len(p["runs"]):
        return p
    runs[-1] = dict(runs[-1], text=runs[-1]["text"].rstrip())
    n = sum(len(r["text"]) for r in runs)
    if len(p["lines"]) != 1 or p["runs"][-1]["font"] != GHOST:  # not a form row's piece (never seen): text only
        return dict(p, runs=runs, lines=[dict(ln, start=min(ln["start"], n), end=min(ln["end"], n)) for ln in p["lines"]])
    (line,) = p["lines"]  # a form row is a paragraph of its own (LEADER)
    r = line["rect"]
    x0 = r["x"]
    found = leaders.get((line["baseline"], x0)) or next(
        (v for (b, x), v in leaders.items() if abs(b - line["baseline"]) < 0.01 and abs(x - x0) < 0.6), None)
    out = dict(p, runs=runs, align="left")
    rect = dict(r)
    if found is not None:
        end, start = found
        rect["w"] = round(end - x0, 2)
        out["maxWidth"] = round(max(start - ROOM_PAD - x0, rect["w"]), 2)
    out["lines"] = [dict(line, end=min(line["end"], n), rect=rect)]
    out["rect"] = dict(p["rect"], x=rect["x"], w=rect["w"])
    return out


def _row_goes_on(line: _Line, after: float, stop: float, region: _Region) -> tuple[float, float] | None:
    """Where ink goes on to the right of a line's piece (ending at `after`) before the next text on its row (`stop`),
    in page points: dots or a blank to fill in after "Nama :", which Tesseract mostly does not read at all. Ink of the
    lines drawn in the picture (a table's border) does not count. None: the row ends there."""
    s = region.scale
    band = pymupdf.Rect(after + 0.5 * line.size, line.baseline - 0.6 * line.size, stop, line.baseline + 0.15 * line.size)
    if band.width < line.size:
        return None
    x0, y0, x1, y1 = region.to_px(band)
    ink = (region.grey[y0:y1, x0:x1] < region.mid).any(axis=0)
    for at, lo, hi, t in region.rules[1]:
        if lo <= y0 and hi >= y1:
            a, b = int(at - t / 2 - 2) - x0, int(at + t / 2 + 2) - x0 + 1
            ink[max(a, 0):max(b, 0)] = False
    cols = np.nonzero(ink)[0]
    if cols.size * s < 0.5 * line.size:
        return None
    return region.rect.x0 + (x0 + cols[0]) * s, region.rect.x0 + (x0 + cols[-1] + 1) * s


# --- the page ------------------------------------------------------------------------------------------------------

def _dpi(rects: list[pymupdf.Rect], max_pixels: int, dpi: int = DPI) -> int | None:
    """`dpi`, or coarser so that all of `rects` together stay within `max_pixels`; None when even MIN_DPI is too many."""
    area = sum(r.width * r.height for r in rects)
    while dpi > MIN_DPI and area * (dpi / 72) ** 2 > max_pixels:
        dpi = max(MIN_DPI, int(dpi * 0.9))
    return dpi if area * (dpi / 72) ** 2 <= max_pixels else None


def _render(page: pymupdf.Page, rect: pymupdf.Rect, dpi: int) -> _Region:
    """The page as shown inside `rect`, at `dpi`, with its thresholds and drawn lines."""
    pix = page.get_pixmap(clip=rect, dpi=dpi, colorspace=pymupdf.csRGB, alpha=False, annots=False)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, :pix.width * 3]
    rgb = rgb.reshape(pix.height, pix.width, 3)
    # Integer luminance (×256 weights, 16-bit sums): no float64 copy of a 12-megapixel picture.
    grey = ((rgb[:, :, 0].astype(np.uint16) * 77 + rgb[:, :, 1].astype(np.uint16) * 150
             + rgb[:, :, 2].astype(np.uint16) * 29) >> 8).astype(np.uint8)
    region = _Region(rect=pymupdf.Rect(rect), dpi=dpi, rgb=rgb, grey=grey, threshold=_otsu(grey))
    cum = np.cumsum(np.bincount(grey.ravel(), minlength=256))
    cut = int(region.threshold)
    if 0 < cum[cut] < cum[-1]:
        core = int(np.searchsorted(cum, 0.1 * cum[cut]))                       # 10th percentile of the ink
        paper = int(np.searchsorted(cum, cum[cut] + 0.5 * (cum[-1] - cum[cut])))  # median of the paper
        region.mid = (core + paper) / 2
    else:
        region.mid = region.threshold
    ink = grey < region.threshold
    region.rules = _rules(ink, int(RULE_PT * dpi / 72), max(1, int(RULE_THICK * dpi / 72)))
    return region


def _png(region: _Region) -> bytes:
    h, w = region.grey.shape
    pix = pymupdf.Pixmap(pymupdf.csGRAY, w, h, region.grey.tobytes(), False)
    pix.set_dpi(region.dpi, region.dpi)
    return pix.tobytes("png")


def _drawings(regions: list[_Region]) -> list[dict]:
    out = []
    for region in regions:
        s, ox, oy = region.scale, region.rect.x0, region.rect.y0
        for at, lo, hi, _t in region.rules[0]:
            out.append({"type": "s", "items": [("l", (ox + lo * s, oy + at * s), (ox + hi * s, oy + at * s))]})
        for at, lo, hi, _t in region.rules[1]:
            out.append({"type": "s", "items": [("l", (ox + at * s, oy + lo * s), (ox + at * s, oy + hi * s))]})
    return out


def _cover(words: list[tuple[Word, _Region]], lines: list[dict], size: float) -> tuple[pymupdf.Rect, _Region]:
    """What an edit paints over: the words' ink padded by COVER_PAD_EM × size (clamped), inside the image, stopping
    short of the lines drawn in the picture (a table border, the line of a form field under the text)."""
    region = words[0][1]
    ink = pymupdf.Rect()
    for w, r in words:
        if r is region:
            ink |= r.to_page(w.box)
    pad = min(max(COVER_PAD_EM * size, COVER_PAD[0]), COVER_PAD[1])
    cover = pymupdf.Rect(ink.x0 - pad, ink.y0 - pad, ink.x1 + pad, ink.y1 + pad) & region.rect
    s, ox, oy = region.scale, region.rect.x0, region.rect.y0
    last_base = max(ln["baseline"] for ln in lines)
    gap = 0.5 * s  # half a pixel clear of the line
    for at, lo, hi, t in region.rules[0]:
        y, x0, x1, half = oy + at * s, ox + lo * s, ox + hi * s, t * s / 2
        if x1 <= cover.x0 or x0 >= cover.x1:
            continue
        if cover.y0 <= y < ink.y0 + 0.25 * size:            # above the text
            cover.y0 = max(cover.y0, y + half + gap)
        elif last_base < y <= cover.y1:                     # under the last baseline: a field's line, an underline
            cover.y1 = min(cover.y1, y - half - gap)
    for at, lo, hi, t in region.rules[1]:
        x, y0, y1, half = ox + at * s, oy + lo * s, oy + hi * s, t * s / 2
        if y1 <= cover.y0 or y0 >= cover.y1:
            continue
        if cover.x0 <= x < ink.x0:
            cover.x0 = max(cover.x0, x + half + gap)
        elif ink.x1 < x <= cover.x1:
            cover.x1 = min(cover.x1, x - half - gap)
    return cover, region


def _ink_box(words: list[Word]) -> tuple[float, float, float, float]:
    return (min(w.box[0] for w in words), min(w.box[1] for w in words),
            max(w.box[2] for w in words), max(w.box[3] for w in words))


def _clear_of(cover: pymupdf.Rect, ink: pymupdf.Rect, others: list[pymupdf.Rect], px: float) -> pymupdf.Rect:
    """`cover` pulled back from other text's ink that its padding reaches (a line set tight above or below, a word
    close beside): the padding only ever takes paper, never another paragraph's letters. `ink`: the paragraph's own."""
    c = pymupdf.Rect(cover)
    for o in others:
        if not o.intersects(c):
            continue
        if o.y1 <= ink.y0 + px:            # above the paragraph's ink
            c.y0 = max(c.y0, o.y1 + px)
        elif o.y0 >= ink.y1 - px:          # below it
            c.y1 = min(c.y1, o.y0 - px)
        elif o.x1 <= ink.x0 + px:          # left of it
            c.x0 = max(c.x0, o.x1 + px)
        elif o.x0 >= ink.x1 - px:          # right of it
            c.x1 = min(c.x1, o.x0 - px)
    return c


def _paper(cover: pymupdf.Rect, region: _Region) -> tuple[np.ndarray, np.ndarray]:
    """(RGB, luminance) of the picture's pixels inside `cover` away from ink (2 px; all non-ink when that leaves
    too few)."""
    x0, y0, x1, y1 = region.to_px(cover)
    grey = region.grey[y0:y1, x0:x1]
    if grey.size == 0:
        return np.zeros((0, 3), dtype=np.uint8), np.zeros(0, dtype=np.uint8)
    ink = grey < region.threshold
    near = ink.copy()
    for dy in (-2, -1, 1, 2):
        near |= np.roll(ink, dy, axis=0)
    for dx in (-2, -1, 1, 2):
        near |= np.roll(ink, dx, axis=1)
    paper = ~near if (~near).sum() >= 20 else ~ink
    return region.rgb[y0:y1, x0:x1][paper], grey[paper]


def _background(covers: list[pymupdf.Rect], region: _Region) -> tuple[str, bool]:
    """The picture's background inside `covers` (one paragraph's): the median colour of its pixels away from ink, and
    whether it is plain (luminance p90 − p10 ≤ UNIFORM)."""
    parts = [_paper(c, region) for c in covers]
    rgb = np.concatenate([p[0] for p in parts]) if parts else np.zeros((0, 3), dtype=np.uint8)
    lum = np.concatenate([p[1] for p in parts]) if parts else np.zeros(0, dtype=np.uint8)
    if lum.size < 20:
        return "#ffffff", lum.size == 0
    spread = float(np.percentile(lum, 90) - np.percentile(lum, 10))
    return _hex(np.median(rgb, axis=0)), spread <= UNIFORM


def _num(v: float) -> float:
    return round(v, 2)


def _merged(rects: list[pymupdf.Rect]) -> list[pymupdf.Rect]:
    """Pictures that touch (within 2 pt) as one: a scan stored as strips would cut the lines on their seams in two."""
    out = [pymupdf.Rect(r) for r in rects]
    merged = True
    while merged:
        merged = False
        for a in range(len(out)):
            for b in range(a + 1, len(out)):
                if pymupdf.Rect(out[a].x0 - 2, out[a].y0 - 2, out[a].x1 + 2, out[a].y1 + 2).intersects(out[b]):
                    out[a] |= out.pop(b)
                    merged = True
                    break
            if merged:
                break
    return out


def ocr_page(page: pymupdf.Page, registry: FontRegistry, cmd: str, *, timeout: float = TIMEOUT,
             max_pixels: int = MAX_PIXELS, dpi: int = DPI, clock=None, words_out: list | None = None,
             area: pymupdf.Rect | None = None) -> dict:
    """OCR of the pictures of print on `page` (imagetext.image_text_regions), or of `area` (unrotated-CropBox points:
    a picture the user picked, any part of the page) instead. `quality`: "ok"; "none" (no picture of
    print); "empty" (nothing read); "rotated" (the page has /Rotate: its text would not be horizontal in page
    coordinates); "skewed" (`angle`, degrees, beyond MAX_SKEW); "unreadable" (median confidence under
    MIN_CONFIDENCE); "too_large" (a picture over max_pixels at MIN_DPI). Only "ok" has paragraphs. `words_out`
    (diagnostics): receives every word read as (text, confidence 0–100, page rect)."""
    clock = clock or time.monotonic
    deadline = clock() + timeout

    def in_time() -> None:  # between the phases: the time limit holds for the whole page, not only for Tesseract
        if clock() > deadline:
            raise OcrTimeout("OCR took longer than the time allowed")

    result = {"quality": "none", "angle": 0.0, "dpi": dpi, "regions": [], "paragraphs": []}
    if page.rotation:
        return {**result, "quality": "rotated"}
    if len(page.get_image_info()) > MAX_IMAGES:
        raise OcrTooComplex(f"more than {MAX_IMAGES} pictures on the page", max_images=MAX_IMAGES)
    if area is not None:
        rects = [] if area.is_empty else [pymupdf.Rect(area)]
    else:
        # Finding the pictures renders each one (with what lies under it): within the page's time, and the pixel budget.
        found = image_text_regions(page, Budget(deadline=time.monotonic() + max(min(FIND_SECONDS, deadline - clock()), 0)))
        in_time()
        rects = _merged([pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]) for r in found])
    if not rects:
        return result
    regions: list[_Region] = []
    words: list[tuple[Word, int]] = []
    dpi_used = _dpi(rects, max_pixels, dpi)
    if dpi_used is None:
        return {**result, "quality": "too_large"}
    for rect in rects:
        region = _render(page, rect, dpi_used)
        regions.append(region)
        in_time()
        for w in run_tesseract(_png(region), region.dpi, deadline - clock(), cmd):
            words.append((w, len(regions) - 1))
        in_time()
        if len(words) > MAX_WORDS:
            raise OcrTooComplex(f"more than {MAX_WORDS} words on the page", max_words=MAX_WORDS)
    result["regions"] = [{"x": _num(r.x0), "y": _num(r.y0), "w": _num(r.width), "h": _num(r.height)} for r in rects]
    result["dpi"] = min(r.dpi for r in regions)
    boxes: list[tuple[Word, int]] = []
    if words:
        usual = _usual(words)
        words, boxes, leaders = _usable(words, regions, usual)
        # Words Tesseract swallowed into a leader, or did not read at all after one, read again on their own.
        stretches = leaders + _unread(words, regions, usual)
        found, more_boxes, _ = _usable(_rescue(stretches, regions, usual, cmd, lambda: deadline - clock()), regions, usual)
        for w, i in found:  # a word found twice (in a leader and after it) or read already: once
            if not any(j == i and _overlap(w.box, v.box) > 0.5 for v, j in words):
                words.append((w, i))
        boxes += more_boxes
        in_time()
    if words_out is not None:
        words_out.extend((w.text, w.conf, regions[i].to_page(w.box)) for w, i in words)
    if not words:
        return {**result, "quality": "empty"}

    by_line: dict[tuple, list[Word]] = {}
    for w, i in words:
        by_line.setdefault((i, *w.line), []).append(w)
    lines = []
    for (i, *key), ws in by_line.items():
        ws.sort(key=lambda w: w.box[0])
        lines.append(_Line(region=i, key=tuple(key), words=ws, boxes=[regions[i].to_page(w.box) for w in ws]))

    faces = _Faces(registry)
    sans, serif = registry.fallback("sans"), registry.fallback("serif")
    for ln in lines:
        _measure(ln, regions[ln.region], faces.get(sans, False))
    slopes = [ln.slope for ln in lines if ln.slope is not None]
    angle = math.degrees(math.atan(median(slopes))) if slopes else 0.0
    result["angle"] = round(angle, 2)
    confs = [w.conf for w, _ in words if any(c.isalnum() for c in w.text)]
    if abs(angle) > MAX_SKEW:
        return {**result, "quality": "skewed"}
    if not confs or median(confs) < MIN_CONFIDENCE:
        return {**result, "quality": "unreadable"}

    # The face: serif or sans for the whole page (scans rarely mix them; per line the guess would flicker), bold per line.
    weighted = [ln.contrast for ln in lines if ln.contrast is not None for _ in range(ln.chars)]
    family = serif if weighted and median(weighted) >= SERIF_CONTRAST else sans
    stems = [ln.stem for ln in lines if ln.stem is not None for _ in range(ln.chars)]
    usual = median(stems) if stems else BOLD_STEM
    for ln in lines:
        # Bold: stems well over the page's usual ones (blur and resolution thicken every stem alike), or very thick.
        ln.bold = ln.stem is not None and (ln.stem >= max(BOLD_STEM, BOLD_RATIO * usual) or ln.stem >= BOLD_ALONE)
        if family != sans or ln.bold:
            _measure(ln, regions[ln.region], faces.get(family, ln.bold))  # sizes and baselines in the face drawn with
    _snap_sizes(lines)
    _snap_colours(lines)
    in_time()

    # Stand-ins (GHOST) for what was left out of the text but shapes it, as a PDF's own text would: a checkbox before a
    # piece starts an item of a list ("□", a line of its own, kept JOIN_EM clear); ink going on after a piece (dots, a
    # blank to fill in) makes its row a form row: "   ……" after the piece in its line (TAB_GAP, LEADER), which never
    # joins other lines. The stand-ins are taken out of the paragraphs again (_unghost).
    starts: dict[tuple[int, int], pymupdf.Rect] = {}
    marks: list[tuple[int, pymupdf.Rect]] = []
    for w, i in boxes:
        box = regions[i].to_page(w.box)
        marks.append((i, box))
        for ln in lines:
            if ln.region == i and box.y0 <= ln.baseline <= box.y1 + 0.3 * ln.size:
                for p in _pieces(ln):
                    if 0 <= ln.boxes[p[0]].x0 - box.x1 <= 2 * ln.size:
                        starts[(id(ln), p[0])] = box
    rows = [(ln.region, ln.baseline, ln.boxes[0].x0, ln) for ln in lines] + [(i, b.y1, b.x0, None) for i, b in marks]
    leaders: dict[tuple[float, float], tuple[float, float]] = {}  # (baseline, piece x0) → (its end, the leader's start)
    raw = []
    for chain in _chains([(ln, idx) for ln in lines for idx in _pieces(ln)]):
        block: list[dict] = []
        for ln, idx in chain:
            face = faces.get(family, ln.bold)
            colour = (int(round(ln.rgb[0])) << 16) | (int(round(ln.rgb[1])) << 8) | int(round(ln.rgb[2]))
            x0, x1 = ln.boxes[idx[0]].x0, ln.boxes[idx[-1]].x1
            if (id(ln), idx[0]) in starts:
                end = x0 - JOIN_EM * ln.size - 0.5
                mark = _ghost_span("□", end - ln.size * 0.7, end, ln, face, colour)
                block.append({"dir": (1.0, 0.0), "wmode": 0, "bbox": mark["bbox"], "spans": [mark]})
            spans = [_span(ln, idx, face, colour)]
            region = regions[ln.region]
            stop = min([ox0 for i, base, ox0, o in rows if o is not ln and i == ln.region and ox0 > x1
                        and abs(base - ln.baseline) < 0.6 * ln.size]
                       + [ln.boxes[k].x0 for k in range(idx[-1] + 1, len(ln.words))] + [region.rect.x1])
            more = _row_goes_on(ln, x1, stop, region)
            if more:
                spans.append(_ghost_span("   ", x1, more[0], ln, face, colour))
                spans.append(_ghost_span("……", more[0], max(more[1], more[0] + ln.size), ln, face, colour))
                leaders[(round(ln.baseline, 2), round(x0, 2))] = (x1, more[0])
            bbox = (x0, spans[0]["bbox"][1], spans[-1]["bbox"][2], spans[0]["bbox"][3])
            block.append({"dir": (1.0, 0.0), "wmode": 0, "bbox": bbox, "spans": spans})
        raw.append({"type": 0, "bbox": (0, 0, 0, 0), "lines": block})
    stand_in = _OcrPage(page.rect.width, page.rect.height, raw, _drawings(regions))
    in_time()
    paragraphs = [q for p in extract_paragraphs(stand_in, lambda span: dict(span["ocr_font"]))
                  if (q := _unghost(p, leaders)) is not None]
    in_time()

    # Words to paragraphs: the paragraph line whose box holds the word's centre (lines looked up by height, in bands of
    # BAND pt: no pass over every line for every word).
    band: dict[int, list[tuple[int, int, dict]]] = {}
    for k, p in enumerate(paragraphs):
        for j, ln in enumerate(p["lines"]):
            r = ln["rect"]
            for b in range(int((r["y"] - 0.5) // BAND), int((r["y"] + r["h"] + 0.5) // BAND) + 1):
                band.setdefault(b, []).append((k, j, r))
    placed: list[list[tuple[Word, _Region, int]]] = [[] for _ in paragraphs]
    for w, i in words:
        r = regions[i].to_page(w.box)
        cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        for k, j, lr in band.get(int(cy // BAND), ()):
            if lr["x"] - 0.5 <= cx <= lr["x"] + lr["w"] + 0.5 and lr["y"] - 0.5 <= cy <= lr["y"] + lr["h"] + 0.5:
                placed[k].append((w, regions[i], j))
                break
    out = []
    for p, ws in zip(paragraphs, placed):
        if not ws:
            continue
        confidence = sum(w.conf for w, _, _ in ws) / len(ws) / 100
        text = "".join(r["text"] for r in p["runs"])
        if confidence < JUNK_CONFIDENCE and len(text.replace(" ", "")) <= 2:
            continue
        if not any(c.isalnum() for c in text) and confidence < 0.6:
            continue
        # One cover per line, from that line's words: a short last line leaves the corner beside it alone (another
        # paragraph, a checkbox, a stamp may stand there). Each stops short of other text and of checkboxes; a line
        # with another paragraph's word inside its own ink gets none (that word's letters would go).
        region = ws[0][1]
        mine = {id(w) for w, _, _ in ws}
        others = [regions[i].to_page(w.box) for w, i in words if id(w) not in mine and regions[i] is region]
        others += [b for i, b in marks if regions[i] is region]
        size = max(r["size"] for r in p["runs"])
        covers = []
        for j, line in enumerate(p["lines"]):
            own = [(w, r) for w, r, k in ws if k == j and r is region]
            if not own:
                continue
            ink = region.to_page(_ink_box([w for w, _ in own]))
            if any(ink.contains((o.tl + o.br) / 2) for o in others):
                continue
            cover, _ = _cover(own, [line], size)
            cover = _clear_of(cover, ink, others, region.scale)
            if not cover.is_empty:
                covers.append(cover)
        if not covers:
            continue
        colour, uniform = _background(covers, region)
        bound = pymupdf.Rect()
        for c in covers:
            bound |= c
        p = dict(p, id=f"ocr{len(out)}", ocr=True, confidence=round(confidence, 2),
                 cover={"x": _num(bound.x0), "y": _num(bound.y0), "w": _num(bound.width), "h": _num(bound.height)},
                 covers=[{"x": _num(c.x0), "y": _num(c.y0), "w": _num(c.width), "h": _num(c.height)} for c in covers],
                 coverColor=colour, coverUniform=uniform)
        out.append(p)
    return {**result, "quality": "ok" if out else "empty", "paragraphs": out}
