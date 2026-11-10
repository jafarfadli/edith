"""Text that is a picture whose words are known: invisible text laid over a picture of the same text (an OCR layer, a
letterhead exported by iLovePDF). GET /text locks such paragraphs ("hidden", M5c): removing the invisible text changes
nothing a reader sees. This makes them editable the way OCR paragraphs are (M5d), without OCR: the words are the
invisible text's, and where they show is measured in the picture under it.

Per line of a hidden paragraph, the picture is rendered under it and its ink found: the band of ink rows the invisible
line sits on, then the stretch of ink columns that starts where the invisible text starts (the picture's print is
often wider: another font). The ink gives the line's box, its size (the ink's height over the height the words' glyphs
have in the bundled sans face) and baseline, and its colour; around it, `covers` (one rect per line, padded a little,
inside the picture, clear of other text) and `coverColor` (the picture's background there). An edit is a
text.ocr_edit op (paragraph id `h` + the hidden paragraph's id: `hg1` replaces `g1`): the covers are painted over the
picture and the new text drawn; the bake removes the invisible text under the covers.

A paragraph stays locked when its geometry cannot be established safely: no picture under a line, no ink found where
its text is, ink far wider or taller than the text could be, two lines on one band of ink, other text in the way, a
rotated page or line."""
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from statistics import median

import numpy as np
import pymupdf
from fontTools.ttLib import TTFont

from edith.fonts import FontRegistry, parse_font_name
from edith.paragraphs import FLAGS, ROOM_PAD, extract_paragraphs, invisible_check

DPI = 288                  # renders the picture under the lines at this resolution …
MIN_DPI = 96               # … or coarser, down to this, to stay within MAX_PIXELS
MAX_PIXELS = 12_000_000    # pixels one page's measurement may render
REACH_EM = 0.6             # the picture's print is looked for this far (× size) above and below the invisible line
ROW_SHARE = 0.01           # a pixel row with this share of the line's columns inked is a row of print
WORD_GAP = 0.9             # ink stretches closer than this × the ink band's height are one line of print
START_EM = 1.0             # the print starts at most this far (× band height) right of where the invisible text does
WIDTH_RANGE = (0.6, 1.6)   # the print's width over the invisible text's
SIZE_RANGE = (0.5, 2.0)    # the measured size over the invisible text's
H_RANGE = (0.7, 1.45)      # the print's width over the bundled face's at the measured size (else: not that text)
H_SCALE = (0.8, 1.25)      # the horizontal scale a line is drawn with to keep the print's width, within these bounds
CONTRAST = 40              # grey levels between ink and paper, at least
COVER_PAD_EM, COVER_PAD = 0.15, (1.0, 2.5)  # the cover reaches this far (× size, clamped in pt) past the ink
UNIFORM = 40               # luminance spread (p90 − p10) of a cover's background above which it is not plain
SIZE_SNAP = 0.08           # lines of a paragraph within this share of its median size take that size


@lru_cache(maxsize=16)
def _extents(path: Path) -> dict[int, tuple[float, float]]:
    """Per character: (bottom, top) of its glyph's ink in ems (y up from the baseline)."""
    font = TTFont(str(path), lazy=True)
    upm = float(font["head"].unitsPerEm)
    glyf = font["glyf"] if "glyf" in font else None
    out: dict[int, tuple[float, float]] = {}
    if glyf is not None:
        for cp, name in font.getBestCmap().items():
            g = glyf[name]
            if getattr(g, "numberOfContours", 0) != 0 and hasattr(g, "yMin"):
                out[cp] = (g.yMin / upm, g.yMax / upm)
    font.close()
    return out


def _text_extent(text: str, extents: dict[int, tuple[float, float]]) -> tuple[float, float] | None:
    known = [extents[ord(c)] for c in text if not c.isspace() and ord(c) in extents]
    if not known:
        return None
    return min(b for b, _ in known), max(t for _, t in known)


@dataclass
class _Render:
    rect: pymupdf.Rect
    dpi: int
    rgb: np.ndarray   # h × w × 3
    grey: np.ndarray  # h × w

    @property
    def scale(self) -> float:
        return 72.0 / self.dpi

    def px(self, r: pymupdf.Rect) -> tuple[int, int, int, int]:
        s, (h, w) = self.scale, self.grey.shape
        return (min(max(int(np.floor((r.x0 - self.rect.x0) / s)), 0), w),
                min(max(int(np.floor((r.y0 - self.rect.y0) / s)), 0), h),
                min(max(int(np.ceil((r.x1 - self.rect.x0) / s)), 0), w),
                min(max(int(np.ceil((r.y1 - self.rect.y0) / s)), 0), h))

    def pt(self, x: float, y: float) -> tuple[float, float]:
        return self.rect.x0 + x * self.scale, self.rect.y0 + y * self.scale


def _render(page: pymupdf.Page, rect: pymupdf.Rect) -> _Render | None:
    area = rect.width * rect.height
    dpi = DPI
    while dpi > MIN_DPI and area * (dpi / 72) ** 2 > MAX_PIXELS:
        dpi = max(MIN_DPI, int(dpi * 0.85))
    if area * (dpi / 72) ** 2 > MAX_PIXELS:
        return None
    pix = page.get_pixmap(clip=rect, dpi=dpi, colorspace=pymupdf.csRGB, alpha=False, annots=False)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, :pix.width * 3]
    rgb = rgb.reshape(pix.height, pix.width, 3)
    grey = ((rgb[:, :, 0].astype(np.uint16) * 77 + rgb[:, :, 1].astype(np.uint16) * 150
             + rgb[:, :, 2].astype(np.uint16) * 29) >> 8).astype(np.uint8)
    # pix.irect may be a pixel off the clip: the render's own rect in points.
    s = 72.0 / dpi
    return _Render(pymupdf.Rect(rect.x0, rect.y0, rect.x0 + pix.width * s, rect.y0 + pix.height * s), dpi, rgb, grey)


def _otsu(grey: np.ndarray) -> float:
    hist = np.bincount(grey.ravel(), minlength=256).astype(np.float64)
    total = hist.sum()
    levels = np.arange(256)
    w0 = np.cumsum(hist)
    m0 = np.cumsum(hist * levels)
    w1 = total - w0
    with np.errstate(divide="ignore", invalid="ignore"):
        between = (m0[-1] / total * w0 - m0) ** 2 / (w0 * w1)
    between[~np.isfinite(between)] = 0
    return float(np.argmax(between)) + 0.5


def _runs(flags: np.ndarray, gap: int = 0) -> list[tuple[int, int]]:
    """(start, end) of the runs of True in a 1-D array, runs at most `gap` apart joined."""
    idx = np.nonzero(flags)[0]
    if idx.size == 0:
        return []
    out = [[int(idx[0]), int(idx[0]) + 1]]
    for i in idx[1:].tolist():
        if i - out[-1][1] <= gap:
            out[-1][1] = i + 1
        else:
            out.append([i, i + 1])
    return [(a, b) for a, b in out]


@dataclass
class _LineGeom:
    ink: pymupdf.Rect      # the print's ink box (points)
    size: float
    baseline: float
    colour: str
    h_scale: float
    window: pymupdf.Rect   # the pictures under the line: no cover reaches past them
    cover: pymupdf.Rect    # the ink padded over paper only (see _measure)


def _hex(rgb) -> str:
    return "#" + "".join(f"{int(round(min(max(float(v), 0), 255))):02x}" for v in rgb)


def _measure(line: dict, text: str, picture: pymupdf.Rect, render: _Render, face: pymupdf.Font,
             extents: dict[int, tuple[float, float]], blocked: list[pymupdf.Rect]) -> _LineGeom | None:
    """The print of one invisible line in the picture (`picture`: the images under it, as one rect), or None."""
    r, size = line["rect"], line["size"]
    inv = pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
    if inv.width <= 0 or size <= 0:
        return None
    ext = _text_extent(text, extents)
    if ext is None or ext[1] - ext[0] <= 0.1:
        return None
    window = picture & pymupdf.Rect(picture.x0, inv.y0 - REACH_EM * size, picture.x1, inv.y1 + REACH_EM * size)
    x0, y0, x1, y1 = render.px(window)
    grey = render.grey[y0:y1, x0:x1]
    if grey.shape[0] < 4 or grey.shape[1] < 4:
        return None
    t = _otsu(grey)
    dark = grey < t
    ink = ~dark if dark.mean() > 0.5 else dark  # ink is the fewer pixels: dark print on paper, or light on dark
    if not ink.any() or ink.all():
        return None
    if abs(float(grey[ink].mean()) - float(grey[~ink].mean())) < CONTRAST:
        return None
    # Other text drawn over the picture is not its print.
    for b in blocked:
        bx0, by0, bx1, by1 = render.px(b)
        ink[max(by0 - y0, 0):max(by1 - y0, 0), max(bx0 - x0, 0):max(bx1 - x0, 0)] = False
    s = render.scale

    def col(x: float) -> int:
        return int(round((x - render.rect.x0) / s)) - x0

    def row(y: float) -> int:
        return int(round((y - render.rect.y0) / s)) - y0

    # The band of ink rows under the invisible text's columns that best matches where its letters stand.
    c0, c1 = max(col(inv.x0), 0), min(col(inv.x1), ink.shape[1])
    if c1 - c0 < 2:
        return None
    rows = ink[:, c0:c1].sum(axis=1) >= max(2, ROW_SHARE * (c1 - c0))
    bands = _runs(rows, gap=1)
    want = (row(line["baseline"] - 0.75 * size), row(line["baseline"] + 0.1 * size))
    scored = [(min(b, want[1]) - max(a, want[0]), a, b) for a, b in bands]
    scored = [x for x in scored if x[0] > 0]
    if not scored:
        return None
    overlap, a, b = max(scored)
    if overlap < 0.25 * (b - a):
        return None
    band_h = b - a
    # The stretch of ink columns on that band that starts where the invisible text does, as far as the print goes on.
    cols = ink[a:b].any(axis=0)
    stretches = _runs(cols, gap=int(WORD_GAP * band_h))
    start = next((st for st in stretches if st[0] <= c0 + START_EM * band_h and st[1] > c0 - START_EM * band_h), None)
    if start is None:
        return None
    ix0, ix1 = start
    # The rows of that stretch (taller letters further right: the whole stretch counts).
    rows = ink[:, ix0:ix1].any(axis=1)
    near = [(p, q) for p, q in _runs(rows, gap=1) if q > a and p < b]
    top, bottom = min(p for p, _ in near), max(q for _, q in near)
    ink_pt = pymupdf.Rect(*render.pt(ix0 + x0, top + y0), *render.pt(ix1 + x0, bottom + y0))
    if not WIDTH_RANGE[0] <= ink_pt.width / inv.width <= WIDTH_RANGE[1]:
        return None
    measured = ink_pt.height / (ext[1] - ext[0])
    if not SIZE_RANGE[0] <= measured / size <= SIZE_RANGE[1]:
        return None
    natural = face.text_length(text, fontsize=measured)
    h = ink_pt.width / natural if natural > 0 else 0
    if not H_RANGE[0] <= h <= H_RANGE[1]:
        return None
    # The colour of the print: the core of its strokes (the fifth of its pixels farthest from the paper).
    box = ink[top:bottom, ix0:ix1]
    g = grey[top:bottom, ix0:ix1]
    paper = float(np.median(grey[~ink])) if (~ink).any() else 255.0
    far = np.abs(g.astype(np.int16) - int(paper))
    core = box & (far >= np.percentile(far[box], 80))
    rgb = render.rgb[y0 + top:y0 + bottom, x0 + ix0:x0 + ix1][core]
    colour = _hex(np.median(rgb, axis=0)) if rgb.size else "#000000"
    # The cover: the ink padded, and as wide as the invisible text (so all of it goes), inside the picture; a side whose
    # padding would take other ink of the picture (a logo, a rule beside or above the line) stops short of it.
    pad = round(min(max(COVER_PAD_EM * measured, COVER_PAD[0]), COVER_PAD[1]) / s)
    cx0, cx1 = max(min(ix0, c0) - pad, 0), min(max(ix1, c1) + pad, ink.shape[1])
    cy0, cy1 = max(top - pad, 0), min(bottom + pad, ink.shape[0])
    above = np.nonzero(ink[cy0:top, cx0:cx1].any(axis=1))[0]
    if above.size:
        cy0 += int(above[-1]) + 2
    below = np.nonzero(ink[bottom:cy1, cx0:cx1].any(axis=1))[0]
    if below.size:
        cy1 = bottom + int(below[0]) - 1
    left = np.nonzero(ink[cy0:cy1, cx0:ix0].any(axis=0))[0]
    if left.size:
        cx0 += int(left[-1]) + 2
    right = np.nonzero(ink[cy0:cy1, ix1:cx1].any(axis=0))[0]
    if right.size:
        cx1 = ix1 + int(right[0]) - 1
    cover = pymupdf.Rect(*render.pt(cx0 + x0, cy0 + y0), *render.pt(cx1 + x0, cy1 + y0)) & picture
    if cover.x0 > inv.x0 + 0.5 or cover.x1 < inv.x1 - 0.5 or not cover.contains(ink_pt):
        return None  # other ink of the picture right at the line's ends: the invisible text would not all go
    return _LineGeom(ink=ink_pt, size=measured, baseline=ink_pt.y0 + ext[1] * measured, colour=colour,
                     h_scale=min(max(h, H_SCALE[0]), H_SCALE[1]), window=picture, cover=cover)


def _clear_of(cover: pymupdf.Rect, ink: pymupdf.Rect, others: list[pymupdf.Rect], gap: float) -> pymupdf.Rect:
    """`cover` pulled back from the other rects its padding reaches (a line set tight above or below, a word close
    beside): it only ever takes paper, never other text."""
    c = pymupdf.Rect(cover)
    for o in others:
        if not o.intersects(c):
            continue
        if o.y1 <= ink.y0 + gap:
            c.y0 = max(c.y0, o.y1 + gap)
        elif o.y0 >= ink.y1 - gap:
            c.y1 = min(c.y1, o.y0 - gap)
        elif o.x1 <= ink.x0 + gap:
            c.x0 = max(c.x0, o.x1 + gap)
        elif o.x0 >= ink.x1 - gap:
            c.x1 = min(c.x1, o.x0 - gap)
    return c


def _background(covers: list[pymupdf.Rect], render: _Render) -> tuple[str, bool]:
    """The median colour of the picture's pixels inside `covers` away from its print (2 px), and whether it is plain."""
    rgbs, lums = [], []
    for c in covers:
        x0, y0, x1, y1 = render.px(c)
        grey = render.grey[y0:y1, x0:x1]
        if grey.size == 0:
            continue
        t = _otsu(grey)
        dark = grey < t
        ink = ~dark if dark.mean() > 0.5 else dark
        near = ink.copy()
        for d in (-2, -1, 1, 2):
            near |= np.roll(ink, d, axis=0) | np.roll(ink, d, axis=1)
        paper = ~near if (~near).sum() >= 20 else ~ink
        rgbs.append(render.rgb[y0:y1, x0:x1][paper])
        lums.append(grey[paper])
    rgb = np.concatenate(rgbs) if rgbs else np.zeros((0, 3), dtype=np.uint8)
    lum = np.concatenate(lums) if lums else np.zeros(0, dtype=np.uint8)
    if lum.size < 20:
        return "#ffffff", False
    return _hex(np.median(rgb, axis=0)), float(np.percentile(lum, 90) - np.percentile(lum, 10)) <= UNIFORM


def _num(v: float) -> float:
    return round(v, 2)


def _rect(r: pymupdf.Rect) -> dict:
    return {"x": _num(r.x0), "y": _num(r.y0), "w": _num(r.width), "h": _num(r.height)}


def _restyled(p: dict, geoms: list[_LineGeom]) -> list[dict]:
    """The paragraph's runs cut at its lines, each piece in its line's measured size, colour and scale."""
    text = "".join(r["text"] for r in p["runs"])
    starts = [ln["start"] for ln in p["lines"]] + [len(text)]
    starts[0] = 0
    out: list[dict] = []
    k = 0
    for run in p["runs"]:
        a, b = k, k + len(run["text"])
        k = b
        for j, g in enumerate(geoms):
            lo, hi = max(a, starts[j]), min(b, starts[j + 1])
            if lo >= hi:
                continue
            piece = {"text": text[lo:hi], "font": run["font"], "size": _num(g.size), "color": g.colour}
            if abs(g.h_scale - 1) > 0.02:
                piece["hScale"] = round(g.h_scale, 3)
            last = out[-1] if out else None
            if last and all(last.get(key) == piece.get(key) for key in ("font", "size", "color", "hScale")):
                last["text"] += piece["text"]
            else:
                out.append(piece)
    return out


def hidden_text(page: pymupdf.Page, registry: FontRegistry) -> list[dict]:
    """The hidden paragraphs of `page` (GET /text's ids, lock "hidden") whose print could be measured, in the shape of
    an OCR paragraph: id `h` + the paragraph's id, `replaces` (that id), `source` "hidden", `ocr`, `confidence` 1, runs
    in the bundled sans face (bold and italic as the invisible text's), the lines' boxes, sizes and baselines measured
    in the picture, `cover`, `covers`, `coverColor`, `coverUniform`. Paragraphs whose print can't be measured are left
    out (they stay locked)."""
    if page.rotation:
        return []
    sans = registry.fallback("sans")

    def resolve(span: dict) -> dict:
        _, bold, italic = parse_font_name(span["font"])
        return {"kind": "bundled", "family": sans, "bold": bold or bool(span["flags"] & pymupdf.TEXT_FONT_BOLD),
                "italic": italic or bool(span["flags"] & pymupdf.TEXT_FONT_ITALIC)}

    paragraphs = [p for p in extract_paragraphs(page, resolve) if p.get("lock") == "hidden"]
    if not paragraphs:
        return []
    bounds = pymupdf.Rect(0, 0, page.cropbox.width, page.cropbox.height)
    images = [r for info in page.get_image_info() if not (r := pymupdf.Rect(info["bbox"]) & bounds).is_empty]
    invisible = invisible_check(page)
    visible: list[pymupdf.Rect] = []
    slanted: list[pymupdf.Rect] = []
    for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
        for raw in block.get("lines", []):
            flat = abs(raw["dir"][0] - 1) < 1e-3 and abs(raw["dir"][1]) < 1e-3
            for span in raw["spans"]:
                hidden = invisible(span)
                for c in span["chars"]:
                    if c["c"].isspace():
                        continue
                    box = pymupdf.Rect(c["bbox"])
                    if not hidden:
                        visible.append(box)
                    elif not flat:
                        slanted.append(box)

    # Each line's pictures and the window its print is looked for in; one render for them all.
    jobs: list[tuple[dict, dict, str, pymupdf.Rect]] = []
    area = pymupdf.Rect()
    for p in paragraphs:
        text = "".join(r["text"] for r in p["runs"])
        for ln in p["lines"]:
            r = ln["rect"]
            inv = pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
            picture = pymupdf.Rect()
            for im in images:
                if im.intersects(inv):
                    picture |= im
            jobs.append((p, ln, text[ln["start"]:ln["end"]], picture))
            if not picture.is_empty:
                area |= picture & pymupdf.Rect(picture.x0, inv.y0 - REACH_EM * ln["size"], picture.x1,
                                               inv.y1 + REACH_EM * ln["size"])
    if area.is_empty:
        return []
    render = _render(page, area)
    if render is None:
        return []
    out: list[dict] = []
    measured: dict[int, list[_LineGeom | None]] = {}
    for p, ln, text, picture in jobs:
        bold = any(r["font"]["bold"] for r in p["runs"])
        italic = any(r["font"]["italic"] for r in p["runs"])
        geom = None
        if not picture.is_empty:
            path = registry.path(sans, bold, italic)
            geom = _measure(ln, text, picture, render, registry.font(sans, bold, italic), _extents(path), visible)
        measured.setdefault(id(p), []).append(geom)
    # Every line's ink: a cover never takes another line's print.
    inks = [g.ink for gs in measured.values() for g in gs if g is not None]
    for p in paragraphs:
        geoms = measured.get(id(p), [])
        if not geoms or any(g is None for g in geoms):
            continue
        rect = pymupdf.Rect(p["rect"]["x"], p["rect"]["y"], p["rect"]["x"] + p["rect"]["w"],
                            p["rect"]["y"] + p["rect"]["h"])
        if any(rect.intersects(s) for s in slanted):
            continue
        if any(b.y1 - a.y0 <= 0 for a, b in zip([g.ink for g in geoms], [g.ink for g in geoms[1:]])) or any(
                b.baseline <= a.baseline for a, b in zip(geoms, geoms[1:])):
            continue  # two lines on one band of print, or out of order
        # Sizes jitter by a few %: lines of one paragraph close to its median take it.
        mid = median(g.size for g in geoms)
        for g in geoms:
            if abs(g.size - mid) <= SIZE_SNAP * mid:
                g.size = mid
        covers: list[pymupdf.Rect] = []
        safe = True
        for g, ln in zip(geoms, p["lines"]):
            r = ln["rect"]
            if any(g.ink.intersects(v) for v in visible):
                safe = False  # visible text on the print: covering it would take that text's letters
                break
            others = [i for i in inks if i is not g.ink] + visible
            cover = _clear_of(g.cover, g.ink, others, render.scale)
            if (not cover.contains(g.ink) or cover.x0 > r["x"] + 0.5 or cover.x1 < r["x"] + r["w"] - 0.5
                    or any(cover.intersects(i) for i in inks if i is not g.ink)):
                safe = False  # another line's print in the way: the cover would take it, or leave this one's
                break
            covers.append(cover)
        if not safe:
            continue
        colour, uniform = _background(covers, render)
        bound = pymupdf.Rect()
        for c in covers:
            bound |= c
        x0 = min(g.ink.x0 for g in geoms)
        x1 = max(g.ink.x1 for g in geoms)
        baselines = [g.baseline for g in geoms]
        deltas = [b - a for a, b in zip(baselines, baselines[1:])]
        lines = [{"rect": _rect(g.ink), "baseline": _num(g.baseline), "size": _num(g.size), "start": ln["start"],
                  "end": ln["end"]} for g, ln in zip(geoms, p["lines"])]
        right = max(g.window.x1 for g in geoms)
        out.append({
            "id": f"h{p['id']}", "replaces": p["id"], "source": "hidden",
            "rect": _rect(pymupdf.Rect(x0, min(g.ink.y0 for g in geoms), x1, max(g.ink.y1 for g in geoms))),
            "lines": lines, "runs": _restyled(p, geoms), "align": "left",
            "lineHeight": _num(median(deltas)) if deltas else _num(1.2 * geoms[0].size),
            "editable": True, "maxWidth": _num(max(x1 - x0, right - ROOM_PAD - x0)),
            "ocr": True, "confidence": 1.0,
            "cover": _rect(bound), "covers": [_rect(c) for c in covers],
            "coverColor": colour, "coverUniform": uniform,
        })
    return out
