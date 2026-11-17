"""Paper size and margins: a PDF's pages put onto another paper (A4, F4, Letter, Legal), the whole page scaled to fit, or
its content (found by looking at the page) laid inside the margins asked for, such as a thesis's 4-3-3-3 cm. Text and
drawings stay vectors: each new page shows the old one (MuPDF show_pdf_page), only placed and scaled.

The content of a page is where it is not white: the page is rendered small in grey and the box of its darker pixels
taken, so it works the same for text, pictures and scanned pages."""
import numpy as np
import pymupdf

from edith.errors import BadOptions

MM = 72 / 25.4
PAPERS = {  # portrait width × height, pt
    "a4": (210 * MM, 297 * MM),
    "f4": (215 * MM, 330 * MM),  # the Indonesian folio
    "letter": (8.5 * 72, 11 * 72),
    "legal": (8.5 * 72, 14 * 72),
}
CM = 72 / 2.54
MARGINS = {  # left, top, right, bottom, pt
    "none": (0, 0, 0, 0),
    "narrow": (1 * CM,) * 4,
    "normal": (2.5 * CM,) * 4,
    "thesis": (4 * CM, 4 * CM, 3 * CM, 3 * CM),  # skripsi: left and top 4 cm, right and bottom 3 cm
}
# Resolution the content is looked for at, and how dark a pixel counts as content (0-255).
LOOK_DPI = 50
INK = 235


def content_box(page: pymupdf.Page) -> pymupdf.Rect | None:
    """The box of what is printed on `page` (in its own points, as shown, rotation applied), or None for a blank page."""
    pix = page.get_pixmap(dpi=LOOK_DPI, colorspace=pymupdf.csGRAY, alpha=False)
    g = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    dark = g < INK
    # A lone speck (dust on a scan) is not content: a row or column needs two dark pixels.
    rows = np.flatnonzero(dark.sum(axis=1) >= 2)
    cols = np.flatnonzero(dark.sum(axis=0) >= 2)
    if not rows.size or not cols.size:
        return None
    k = 72 / LOOK_DPI
    r = page.rect
    box = pymupdf.Rect(cols[0] * k - 2, rows[0] * k - 2, (cols[-1] + 1) * k + 2, (rows[-1] + 1) * k + 2)
    return box & pymupdf.Rect(0, 0, r.width, r.height)


def upright(doc: pymupdf.Document) -> pymupdf.Document:
    """A copy of `doc` with every turned page (/Rotate) made unturned and drawn as a viewer shows it, so placing and
    clipping work in one space (show_pdf_page draws a page unturned). `doc` itself when no page is turned."""
    if not any(p.rotation for p in doc):
        return doc
    flat = pymupdf.open("pdf", doc.tobytes())
    for page in flat:
        if page.rotation:
            page.remove_rotation()
    return flat


def resize(doc: pymupdf.Document, paper: str, fit: str, margins: str) -> bytes:
    """`doc` on `paper` (landscape pages stay landscape). `fit` "page": each whole page scaled to fit inside the
    margins, centred. `fit` "content": what is printed on each page laid inside the margins, from the top, centred
    across; one scale for the whole document (the one its fullest page needs, never above 1), so the text keeps one
    size from page to page."""
    if paper not in PAPERS:
        raise BadOptions(f"paper {paper!r}", field="paper")
    if fit not in ("page", "content"):
        raise BadOptions(f"fit {fit!r}", field="fit")
    if margins not in MARGINS:
        raise BadOptions(f"margins {margins!r}", field="margins")
    left, top, right, bottom = MARGINS[margins]
    doc = upright(doc)
    pw, ph = PAPERS[paper]

    def sheet(page: pymupdf.Page) -> tuple[float, float]:
        return (ph, pw) if page.rect.width > page.rect.height else (pw, ph)

    clips = [(content_box(p) if fit == "content" else None) for p in doc]
    scale = 1.0
    if fit == "content":
        for page, clip in zip(doc, clips):
            if clip is not None:
                w, h = sheet(page)
                scale = min(scale, (w - left - right) / clip.width, (h - top - bottom) / clip.height)

    out = pymupdf.open()
    for i, (page, clip) in enumerate(zip(doc, clips)):
        w, h = sheet(page)
        new = out.new_page(width=w, height=h)
        room = pymupdf.Rect(left, top, w - right, h - bottom)
        if fit == "content" and clip is None:
            continue  # a blank page stays blank
        src = clip if clip is not None else pymupdf.Rect(0, 0, page.rect.width, page.rect.height)
        s = scale if fit == "content" else min(room.width / src.width, room.height / src.height)
        cw, ch = src.width * s, src.height * s
        x0 = room.x0 + (room.width - cw) / 2
        y0 = room.y0 if fit == "content" else room.y0 + (room.height - ch) / 2
        new.show_pdf_page(pymupdf.Rect(x0, y0, x0 + cw, y0 + ch), doc, i, clip=src)
    return out.tobytes(garbage=3, deflate=True)
