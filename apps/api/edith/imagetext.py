"""Images that most likely hold text (a scanned or rasterised form, a pasted screenshot of a letter), so the client
can say why nothing there is editable (M5c) and offer to read it (OCR, M5d). No OCR: this only looks at how the image's
pixels are laid out — a light background with several separate rows of dark marks — which a paragraph of print shows
and a photo, a logo or a signature does not.

Two tiers: "print" (several rows of print on a plain background: what page OCR reads) and, looser, "maybe" (a smaller
picture, or a single row, of marks the size and spacing of letters on a plain background, dark or light: a logo with
its name, a banner of logos with captions, one pictured line). Pictures with text over them are neither: visible text
is what gets edited, and invisible text over its picture is edited as such (edith.hiddentext)."""
import time
from dataclasses import dataclass, field

import pymupdf

from edith.paragraphs import FLAGS, invisible_check

DPI = 72              # 1 px = 1 pt: lines of 8 pt print still show the gap between them
MIN_SIDE = 36.0       # pt: smaller images are icons, stamps or a single word
MIN_AREA = 0.01       # share of the page an image must cover
ROW_INK = 0.003       # a pixel row with at least this share of ink pixels is a row of print
MIN_ROWS = 3          # separate rows of print a text block shows (a logo or one line of a letterhead: fewer)
MIN_ROW_GAP = 1       # px: blank rows between two rows of print
INK = 80              # grey levels from the background that make a pixel ink
BACKGROUND = 24       # grey levels from the background that still count as background
MIN_BACKGROUND = 0.6  # share of background pixels: paper, not a photo
INK_RANGE = (0.01, 0.35)  # share of ink pixels: print, not an empty box or a dark picture
MAX_PIXELS = 20_000_000   # pixels one document's analysis may render (≈ 40 full A4 pages at 72 dpi)
MAX_SECONDS = 1.0         # wall-clock time one document's analysis may take (GET /text waits for it)

# The "maybe" tier: looser, rendered finer (small print in a small picture).
MAYBE_DPI = 144
MAYBE_SIDES = (8.0, 24.0)       # pt: the picture's shorter side at least the first, its longer the second
MAYBE_BACKGROUND = 0.3          # share of background pixels (a logo with its name: little)
MAYBE_INK = (0.004, 0.7)        # share of ink pixels
GLYPH_WIDTH = (0.08, 1.6)       # a letter's width (one stretch of inked columns) × its row's height
GLYPH_GAP = 1.2                 # letters of one word or line stand at most this × the row's height apart
GLYPHS = 4                      # letter-like marks in a row, at least
ROW_PX = (5, 160)               # px: the height of a row of print (at MAYBE_DPI: 2.5–80 pt)

MIN_IMAGE = (4.0, 12.0)   # pt: pictures listed for the client (`images`): shorter side, longer side at least
MAX_IMAGES = 200          # pictures listed per page at most


def page_words(page: pymupdf.Page) -> tuple[list[pymupdf.Rect], list[pymupdf.Rect]]:
    """Rects of the page's visible (painted) and invisible characters."""
    invisible = invisible_check(page)
    shown, hidden = [], []
    for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                out = hidden if invisible(span) else shown
                for c in span["chars"]:
                    if not c["c"].isspace():
                        out.append(pymupdf.Rect(c["bbox"]))
    return shown, hidden


def _visible_words(page: pymupdf.Page) -> list[pymupdf.Rect]:
    """Rects of the page's visible (painted) characters."""
    return page_words(page)[0]


def _background(samples: bytes) -> int:
    """The most common of 16 grey bands (bytes.count per value runs at C speed), as a grey level."""
    bands = [0] * 16
    for v in range(256):
        bands[v // 16] += samples.count(v)
    return max(range(16), key=lambda i: bands[i]) * 16 + 8


def _text_like(pix: pymupdf.Pixmap) -> bool:
    w, h, samples = pix.width, pix.height, pix.samples  # grey, no alpha: one byte per pixel, rows of w bytes
    if w * h == 0:
        return False
    bg = _background(samples)
    ink_table = bytes(1 if abs(v - bg) > INK else 0 for v in range(256))
    paper_table = bytes(1 if abs(v - bg) <= BACKGROUND else 0 for v in range(256))
    ink = samples.translate(ink_table)
    total = w * h
    if samples.translate(paper_table).count(1) < MIN_BACKGROUND * total:
        return False
    if not INK_RANGE[0] <= ink.count(1) / total <= INK_RANGE[1]:
        return False
    rows, blank = 0, MIN_ROW_GAP  # rows of print, blank pixel rows since the last one
    for y in range(h):
        if ink[y * w:(y + 1) * w].count(1) >= max(1, ROW_INK * w):
            rows += blank >= MIN_ROW_GAP
            blank = 0
        else:
            blank += 1
    return rows >= MIN_ROWS


def _maybe_text(pix: pymupdf.Pixmap) -> bool:
    """A row of marks shaped and spaced like letters on a plain background (light or dark: ink is whatever stands out
    from it): at least GLYPHS stretches of inked columns in one row of ink, each about as wide as a letter of that row's
    height, close to the next. A photo has no plain background; a logo, a signature or a rule has fewer, wider or
    farther apart marks."""
    w, h, samples = pix.width, pix.height, pix.samples
    if w * h == 0:
        return False
    bg = _background(samples)
    ink = samples.translate(bytes(1 if abs(v - bg) > INK else 0 for v in range(256)))
    total = w * h
    if samples.translate(bytes(1 if abs(v - bg) <= BACKGROUND else 0 for v in range(256))).count(1) < MAYBE_BACKGROUND * total:
        return False
    if not MAYBE_INK[0] <= ink.count(1) / total <= MAYBE_INK[1]:
        return False
    rows = [ink[y * w:(y + 1) * w].count(1) > 0 for y in range(h)]
    y = 0
    while y < h:
        if not rows[y]:
            y += 1
            continue
        top = y
        while y < h and rows[y]:
            y += 1
        height = y - top
        if not ROW_PX[0] <= height <= ROW_PX[1]:
            continue
        acc = 0  # the row's inked columns: its pixel rows OR-ed (as big integers: C speed)
        for r in range(top, y):
            acc |= int.from_bytes(ink[r * w:(r + 1) * w], "big")
        cols = acc.to_bytes(w, "big")
        glyphs, run, prev_end, best = 0, 0, None, 0
        for x in range(w + 1):
            if x < w and cols[x]:
                run += 1
                continue
            if run:
                if GLYPH_WIDTH[0] * height <= run <= GLYPH_WIDTH[1] * height:
                    start = x - run
                    glyphs = glyphs + 1 if prev_end is not None and start - prev_end <= GLYPH_GAP * height else 1
                    prev_end = x
                    best = max(best, glyphs)
                else:
                    glyphs, prev_end = 0, None
                run = 0
        if best >= GLYPHS:
            return True
    return False


@dataclass
class Budget:
    """What one document's analysis may still spend: `pixels` to render (decremented) and wall-clock time (`deadline`,
    time.monotonic()). An image that would exceed either is not analysed (nor the page's text read for it)."""
    pixels: int = MAX_PIXELS
    deadline: float = field(default_factory=lambda: time.monotonic() + MAX_SECONDS)


def _same(a: pymupdf.Rect, b: pymupdf.Rect) -> bool:
    return abs(a.x0 - b.x0) < 0.5 and abs(a.y0 - b.y0) < 0.5 and abs(a.x1 - b.x1) < 0.5 and abs(a.y1 - b.y1) < 0.5


def _json(r: pymupdf.Rect) -> dict:
    return {"x": round(r.x0, 2), "y": round(r.y0, 2), "w": round(r.width, 2), "h": round(r.height, 2)}


def page_images(page: pymupdf.Page) -> list[dict]:
    """Rects (unrotated-CropBox points) of the pictures on `page` (each once, at least MIN_IMAGE, at most MAX_IMAGES):
    where the client offers to read any picture (OCR of its rect), whatever the analysis says."""
    bounds = pymupdf.Rect(0, 0, page.cropbox.width, page.cropbox.height)
    seen: list[pymupdf.Rect] = []
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & bounds
        if r.is_empty or min(r.width, r.height) < MIN_IMAGE[0] or max(r.width, r.height) < MIN_IMAGE[1]:
            continue
        if not any(_same(r, s) for s in seen):
            seen.append(r)
        if len(seen) >= MAX_IMAGES:
            break
    return [_json(r) for r in seen]


def image_text_regions(page: pymupdf.Page, budget: Budget | None = None,
                       visible: list[pymupdf.Rect] | None = None, hidden: list[pymupdf.Rect] | None = None,
                       maybe: bool = False) -> list[dict]:
    """Rects (unrotated-CropBox points) of the images on `page` that look like print with no text over them, each with
    its `tier`: "print"; with `maybe`, also "maybe" (see the module). `budget`: what the document's analysis may still
    spend (see Budget; none: no limit). `visible` / `hidden`: rects of the page's visible text and of its invisible
    text when the caller has them (extract_text: its paragraphs' lines); else the page's text is read."""
    # Image and text boxes are unrotated-CropBox points (as paragraphs are); page.rect is rotated at 90/270.
    bounds = pymupdf.Rect(0, 0, page.cropbox.width, page.cropbox.height)
    area = bounds.width * bounds.height
    words = None if visible is None else list(visible) + list(hidden or [])
    out: list[dict] = []
    seen: list[pymupdf.Rect] = []
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & bounds
        if r.is_empty:
            continue
        large = min(r.width, r.height) >= MIN_SIDE and r.width * r.height >= MIN_AREA * area
        if not large and not (maybe and min(r.width, r.height) >= MAYBE_SIDES[0]
                              and max(r.width, r.height) >= MAYBE_SIDES[1]):
            continue
        if any(_same(r, s) for s in seen):
            continue
        seen.append(r)
        dpi = DPI if large else MAYBE_DPI
        pixels = int(r.width * r.height * (dpi / 72) ** 2)
        if budget is not None and (budget.pixels < pixels or time.monotonic() > budget.deadline):
            continue
        if words is None:
            shown, invisible = page_words(page)
            words = shown + invisible
        # Real text on it (a form printed over a scanned background): the text is what gets edited. Invisible text
        # over it: the picture's own words, edited as such (edith.hiddentext).
        if any(r.contains((w.tl + w.br) / 2) for w in words):
            continue
        if budget is not None:
            budget.pixels -= pixels
        # The page as shown inside the image's rect: what a reader sees there, masks and overlapping images included.
        pix = page.get_pixmap(dpi=dpi, clip=r * page.rotation_matrix, colorspace=pymupdf.csGRAY, annots=False)
        if large and _text_like(pix):
            out.append(_json(r) | {"tier": "print"})
        elif maybe and _maybe_text(pix):
            out.append(_json(r) | {"tier": "maybe"})
    return out
