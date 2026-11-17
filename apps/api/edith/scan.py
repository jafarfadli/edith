"""Photos of paper documents (taken with a phone) as clean scanned pages: the sheet found in the photo, its corners pulled
straight (perspective), the table around it cut off, and the page evened out as a scanner would give it: shadows and
the grey cast of room light taken away, the paper white, the ink dark. Then one PDF page per photo.

Everything here works on numpy arrays in OpenCV's BGR order; `scan_pdf` is what the tool route calls (POST /tools/scan)."""
from dataclasses import dataclass

import cv2
import numpy as np
import pymupdf

from edith.errors import BadOptions, TooLarge

MODES = ("color", "gray", "bw", "original")
# Longest side of a scanned page, px: about A4 at 300 dpi; bigger photos are scaled down to it.
MAX_SIDE = 3000
# A photo larger than this (pixels) is refused before it is decoded in full.
MAX_PIXELS = 50_000_000
# Longest side the sheet is looked for at (px): fast, and enough for its edges.
DETECT_SIDE = 800
# The sheet must cover at least this share of the photo, else the whole photo is taken.
MIN_SHEET_AREA = 0.18


@dataclass
class Page:
    data: bytes
    extension: str  # "jpg" or "png"
    found: bool  # whether a sheet was found (else the whole photo was used)


def decode(data: bytes, name: str) -> np.ndarray:
    """The photo upright (a phone photo's EXIF orientation applied, by MuPDF) as BGR, at most MAX_SIDE on its longest
    side."""
    try:
        img = pymupdf.open(stream=data, filetype=name.rsplit(".", 1)[-1].lower() if "." in name else None)
        raw = pymupdf.Pixmap(data)
        if raw.width * raw.height > MAX_PIXELS:
            raise TooLarge(f"{name}: more than {MAX_PIXELS} pixels", max_pixels=MAX_PIXELS)
        longest = max(raw.width, raw.height)
        one = pymupdf.open("pdf", img.convert_to_pdf())
    except TooLarge:
        raise
    except Exception as exc:  # noqa: BLE001 - not a picture MuPDF reads
        raise BadOptions(f"{name}: not a picture", field="files", file=name) from exc
    page = one[0]
    side = min(longest, MAX_SIDE)
    zoom = side / max(page.rect.width, page.rect.height)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False, colorspace=pymupdf.csRGB)
    rgb = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def order(pts: np.ndarray) -> np.ndarray:
    """Four points as top-left, top-right, bottom-right, bottom-left."""
    pts = pts.astype(np.float32).reshape(4, 2)
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()  # x + y, y - x
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def _quad(mask: np.ndarray, min_area: float) -> np.ndarray | None:
    """The biggest four-cornered convex outline in a binary picture, if it is big enough."""
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
        hull = cv2.convexHull(c)
        if cv2.contourArea(hull) < min_area:
            break
        peri = cv2.arcLength(hull, True)
        for eps in (0.02, 0.03, 0.05):
            approx = cv2.approxPolyDP(hull, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx) and cv2.contourArea(approx) >= min_area:
                return approx.reshape(4, 2)
    return None


def _support(quad: np.ndarray, edges: np.ndarray) -> float:
    """How much of the outline `quad` runs along edges of the picture (0 to 1): a real sheet's border does all round."""
    hits = total = 0
    for a, b in zip(quad, np.roll(quad, -1, axis=0)):
        n = max(2, int(np.linalg.norm(b - a) / 3))
        xs = np.clip(np.linspace(a[0], b[0], n).round().astype(int), 0, edges.shape[1] - 1)
        ys = np.clip(np.linspace(a[1], b[1], n).round().astype(int), 0, edges.shape[0] - 1)
        hits += int((edges[ys, xs] > 0).sum())
        total += n
    return hits / total


def find_sheet(img: np.ndarray) -> np.ndarray | None:
    """The corners of the sheet in the photo (ordered, in its pixels), or None when no sheet stands out. Outlines come
    from two looks, the paper as the bright region (on a darker table) and the edges in the photo (on a light table, or
    under a shadow), and the one whose border runs along edges best wins."""
    h, w = img.shape[:2]
    s = min(1.0, DETECT_SIDE / max(h, w))
    small = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else img
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    # Close over the writing so the sheet reads as one surface.
    gray = cv2.morphologyEx(cv2.GaussianBlur(gray, (5, 5), 0), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8), iterations=2)
    min_area = MIN_SHEET_AREA * gray.shape[0] * gray.shape[1]

    median = float(np.median(gray))
    grow = np.ones((3, 3), np.uint8)
    # Faint edges (light paper on a light table, a shadow over the border) and only the strong ones (a busy table).
    faint = cv2.dilate(cv2.Canny(gray, 20, 60), grow, iterations=2)
    strong = cv2.dilate(cv2.Canny(gray, int(max(20, 0.66 * median)), int(max(60, min(255, 1.33 * median)))), grow, iterations=2)
    _, bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edges = faint
    best, score = None, 0.6  # an outline less than this much on edges is no sheet
    for mask in (bright, strong, faint):
        quad = _quad(mask, min_area)
        if quad is not None and (sup := _support(quad.astype(np.float32), edges)) > score:
            best, score = quad, sup
    if best is None:
        return None
    corners = order(best / s)
    # Not the whole frame: an outline along the photo's own border is no sheet found.
    if cv2.contourArea(corners) > 0.97 * h * w:
        return None
    return corners


def straighten(img: np.ndarray, corners: np.ndarray) -> np.ndarray:
    """The sheet inside `corners` pulled into a rectangle the size of its longer edges."""
    tl, tr, br, bl = corners
    width = int(round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))))
    height = int(round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))))
    target = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(corners.astype(np.float32), target)
    return cv2.warpPerspective(img, m, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _odd(n: float, least: int) -> int:
    n = max(least, int(n))
    return n if n % 2 else n + 1


def _flatten(channel: np.ndarray) -> np.ndarray:
    """One channel divided by its own background (the paper with the writing taken out: dilated, then a wide median),
    so the paper comes out white wherever the light fell and the ink keeps its darkness."""
    h, w = channel.shape
    f = min(1.0, 600 / max(h, w))  # the background is smooth: work it out small
    small = cv2.resize(channel, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    k = max(small.shape)
    bg = cv2.medianBlur(cv2.dilate(small, np.ones((_odd(k / 100, 3),) * 2, np.uint8)), _odd(k / 10, 31))
    bg = cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)
    return cv2.divide(channel, np.maximum(bg, 1), scale=255)


def enhance(img: np.ndarray, mode: str) -> np.ndarray:
    """The page as `mode` says: color (shadows and cast evened out, colours kept), gray, bw (black ink on white), or
    original (only straightened)."""
    if mode == "original":
        return img
    if mode == "color":
        flat = cv2.merge([_flatten(c) for c in cv2.split(img)])
        # A little more contrast for the ink, the paper left white.
        return cv2.convertScaleAbs(flat, alpha=1.15, beta=-38)
    gray = _flatten(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    if mode == "gray":
        return cv2.convertScaleAbs(gray, alpha=1.2, beta=-50)
    # The paper is even now, so one threshold between ink and paper serves the whole page (solid areas stay solid).
    level, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.threshold(gray, min(level, 200), 255, cv2.THRESH_BINARY)[1]


def scan_page(data: bytes, name: str, mode: str, crop: bool) -> Page:
    if mode not in MODES:
        raise BadOptions(f"mode {mode!r}", field="mode")
    img = decode(data, name)
    corners = find_sheet(img) if crop else None
    page = enhance(straighten(img, corners) if corners is not None else img, mode)
    if mode == "bw":
        ok, buf = cv2.imencode(".png", page, [cv2.IMWRITE_PNG_COMPRESSION, 9, cv2.IMWRITE_PNG_BILEVEL, 1])
        ext = "png"
    else:
        ok, buf = cv2.imencode(".jpg", page, [cv2.IMWRITE_JPEG_QUALITY, 82, cv2.IMWRITE_JPEG_OPTIMIZE, 1])
        ext = "jpg"
    if not ok:
        raise BadOptions(f"{name}: could not be encoded", field="files", file=name)
    return Page(buf.tobytes(), ext, corners is not None)


def scan_pdf(images: list[tuple[bytes, str]], mode: str, crop: bool, size: str, max_pages: int):
    """One scanned page per photo (`images`: bytes and file name), in the order given, as a PDF: on A4 (`size` "a4",
    no margin, turned for a wide page) or each page its own size ("fit")."""
    from edith import tools
    if not images:
        raise BadOptions("no pictures", field="files")
    if len(images) > max_pages:
        raise TooLarge(f"more than {max_pages} pages", max_pages=max_pages)
    pages = []
    for i, (data, name) in enumerate(images, 1):
        p = scan_page(data, name, mode, crop)
        pages.append((p.data, f"scan-{i}.{p.extension}"))
    return tools.images_to_pdf(pages, size, 0, max_pages)
