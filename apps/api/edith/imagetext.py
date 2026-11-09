"""Images that most likely hold text (a scanned or rasterised form, a pasted screenshot of a letter), so the client
can say why nothing there is editable (M5c). No OCR: this only looks at how the image's pixels are laid out — a light
background with several separate rows of dark marks — which a paragraph of print shows and a photo, a logo or a
signature does not."""
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


def _visible_words(page: pymupdf.Page) -> list[pymupdf.Rect]:
    """Rects of the page's visible (painted) characters."""
    invisible = invisible_check(page)
    out = []
    for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                if invisible(span):
                    continue
                for c in span["chars"]:
                    if not c["c"].isspace():
                        out.append(pymupdf.Rect(c["bbox"]))
    return out


def _text_like(pix: pymupdf.Pixmap) -> bool:
    w, h, samples = pix.width, pix.height, pix.samples  # grey, no alpha: one byte per pixel, rows of w bytes
    if w * h == 0:
        return False
    # The background: the most common of 16 grey bands (bytes.count per value runs at C speed).
    bands = [0] * 16
    for v in range(256):
        bands[v // 16] += samples.count(v)
    bg = max(range(16), key=lambda i: bands[i]) * 16 + 8
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


@dataclass
class Budget:
    """What one document's analysis may still spend: `pixels` to render (decremented) and wall-clock time (`deadline`,
    time.monotonic()). An image that would exceed either is not analysed (nor the page's text read for it)."""
    pixels: int = MAX_PIXELS
    deadline: float = field(default_factory=lambda: time.monotonic() + MAX_SECONDS)


def image_text_regions(page: pymupdf.Page, budget: Budget | None = None,
                       visible: list[pymupdf.Rect] | None = None) -> list[dict]:
    """Rects (unrotated-CropBox points) of the images on `page` that look like print with no visible text over them.
    `budget`: what the document's analysis may still spend (see Budget; none: no limit). `visible`: rects of the page's
    visible text when the caller has them (extract_text: its visible paragraphs' lines); else the page's text is read."""
    # Image and text boxes are unrotated-CropBox points (as paragraphs are); page.rect is rotated at 90/270.
    bounds = pymupdf.Rect(0, 0, page.cropbox.width, page.cropbox.height)
    area = bounds.width * bounds.height
    words = visible
    out: list[dict] = []
    seen: list[pymupdf.Rect] = []
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & bounds
        if r.is_empty or min(r.width, r.height) < MIN_SIDE or r.width * r.height < MIN_AREA * area:
            continue
        if any(abs(r.x0 - s.x0) < 0.5 and abs(r.y0 - s.y0) < 0.5 and abs(r.x1 - s.x1) < 0.5 and abs(r.y1 - s.y1) < 0.5
               for s in seen):
            continue
        seen.append(r)
        pixels = int(r.width * r.height * (DPI / 72) ** 2)
        if budget is not None and (budget.pixels < pixels or time.monotonic() > budget.deadline):
            continue
        if words is None:
            words = _visible_words(page)
        if any(r.contains((w.tl + w.br) / 2) for w in words):
            continue  # real text on it (a form printed over a scanned background): the text is what gets edited
        if budget is not None:
            budget.pixels -= pixels
        # The page as shown inside the image's rect: what a reader sees there, masks and overlapping images included.
        pix = page.get_pixmap(dpi=DPI, clip=r * page.rotation_matrix, colorspace=pymupdf.csGRAY, annots=False)
        if _text_like(pix):
            out.append({"x": round(r.x0, 2), "y": round(r.y0, 2), "w": round(r.width, 2), "h": round(r.height, 2)})
    return out
