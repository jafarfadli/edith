"""Kartu ke A4: photos of ID cards (KTP, SIM, NPWP, BPJS, a student or bank card: the ID-1 size, 85.6 × 53.98 mm) put on
one sheet at their real size, ready to print, as people are asked for "fotokopi KTP" with front and back on one page.

Each photo's card is found (scan.find_sheet, looking for a smaller outline with a card's proportions), pulled straight,
turned the right way up (Tesseract's orientation detection reads the card's writing; without Tesseract a card is only
laid landscape), and placed: two photos (front, back) one above the other at the top of the sheet; more in two columns,
one row per pair, on as many sheets as they need."""
import re
import subprocess

import cv2
import numpy as np
import pymupdf

from edith.errors import BadOptions, TooLarge
from edith.paper import PAPERS
from edith.scan import decode, find_sheet, order, straighten
from edith.tools import Output, pdf

MM = 72 / 25.4
CARD = (85.6, 53.98)  # ID-1, mm
DPI = 300
MODES = ("color", "gray")
SCALES = {"real": 1.0, "large": 1.5}
MAX_CARDS = 16
# The card may cover this little of the photo (a card held at arm's length on a table).
MIN_CARD_AREA = 0.04
# Long side over short side a found outline may have: a card's 1.59, give or take what a slanted photo does to it.
RATIO = (1.3, 1.95)
# The sheet: margin to its sides, the first row this far from the top, the room between cards (mm).
MARGIN, TOP, GAP = 15.0, 20.0, 8.0
OSD_TIMEOUT = 15.0


def _card_shaped(quad: np.ndarray) -> bool:
    tl, tr, br, bl = order(quad)
    w = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    h = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    long, short = max(w, h), min(w, h)
    return short > 0 and RATIO[0] <= long / short <= RATIO[1]


def find_card(img: np.ndarray) -> np.ndarray | None:
    """The card's corners in the photo, or None when no card-shaped outline stands out."""
    return find_sheet(img, MIN_CARD_AREA, _card_shaped, biggest=True)


def upright(card: np.ndarray, tesseract: str | None) -> np.ndarray:
    """The card the right way up: landscape first (most cards are), then as Tesseract's orientation detection reads its
    writing, when it is sure."""
    if card.shape[0] > card.shape[1]:
        card = cv2.rotate(card, cv2.ROTATE_90_CLOCKWISE)
    if not tesseract:
        return card
    turn = _osd_rotate(card, tesseract)
    return {90: cv2.rotate(card, cv2.ROTATE_90_CLOCKWISE), 180: cv2.rotate(card, cv2.ROTATE_180),
            270: cv2.rotate(card, cv2.ROTATE_90_COUNTERCLOCKWISE)}.get(turn, card)


def _osd_rotate(card: np.ndarray, cmd: str) -> int:
    """How far (degrees, clockwise) Tesseract says to turn the card to read it; 0 when it cannot tell."""
    h, w = card.shape[:2]
    k = 1400 / max(h, w)
    gray = cv2.cvtColor(cv2.resize(card, None, fx=k, fy=k, interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC), cv2.COLOR_BGR2GRAY)
    ok, png = cv2.imencode(".png", gray)
    if not ok:
        return 0
    try:
        out = subprocess.run([cmd, "stdin", "stdout", "--psm", "0", "-l", "osd"], input=png.tobytes(),
                             capture_output=True, timeout=OSD_TIMEOUT, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return 0
    text = out.stdout.decode("utf-8", "replace")
    turn = re.search(r"Rotate:\s*(\d+)", text)
    sure = re.search(r"Orientation confidence:\s*([\d.]+)", text)
    if not turn or not sure or float(sure.group(1)) < 1.5:
        return 0
    return int(turn.group(1)) % 360


def card_image(data: bytes, name: str, mode: str, tesseract: str | None) -> tuple[np.ndarray, tuple[float, float]]:
    """The card in a photo, straight and upright, and its size on paper (mm, before scaling). A photo with no card
    found is taken whole (already cut out, or a scan), its longer side a card's."""
    img = decode(data, name)
    corners = find_card(img)
    card = upright(straighten(img, corners) if corners is not None else img, tesseract if corners is not None else None)
    if corners is None and card.shape[0] > card.shape[1]:
        size = (CARD[0] * card.shape[1] / card.shape[0], CARD[0])
    elif corners is None:
        size = (CARD[0], CARD[0] * card.shape[0] / card.shape[1])
    else:
        size = CARD if card.shape[1] >= card.shape[0] else (CARD[1], CARD[0])
    if mode == "gray":
        card = cv2.cvtColor(cv2.cvtColor(card, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    return card, size


def _jpeg(img: np.ndarray, size_mm: tuple[float, float], gray: bool) -> bytes:
    px = (max(1, round(size_mm[0] / 25.4 * DPI)), max(1, round(size_mm[1] / 25.4 * DPI)))
    fit = cv2.resize(img, px, interpolation=cv2.INTER_AREA if img.shape[1] > px[0] else cv2.INTER_CUBIC)
    if gray:
        fit = cv2.cvtColor(fit, cv2.COLOR_BGR2GRAY)
    ok, buf = cv2.imencode(".jpg", fit, [cv2.IMWRITE_JPEG_QUALITY, 88, cv2.IMWRITE_JPEG_OPTIMIZE, 1])
    if not ok:
        raise BadOptions("a card could not be encoded", field="files")
    return buf.tobytes()


def layout(sizes: list[tuple[float, float]], paper: tuple[float, float]) -> list[list[tuple[float, float]]]:
    """Where each card goes (its top-left, mm), sheet by sheet. Two cards or fewer: one column, centred, from the top.
    More: rows of two (a pair, front and back, side by side) when two fit across, else one."""
    pw, ph = paper
    room = pw - 2 * MARGIN
    two = len(sizes) > 2 and all(w + GAP + w2 <= room for (w, _), (w2, _) in zip(sizes[::2], sizes[1::2]))
    rows = [sizes[i:i + 2] for i in range(0, len(sizes), 2)] if two else [[s] for s in sizes]
    sheets: list[list[tuple[float, float]]] = [[]]
    y = TOP
    for row in rows:
        h = max(c[1] for c in row)
        if y + h > ph - MARGIN and sheets[-1]:
            sheets.append([])
            y = TOP
        width = sum(c[0] for c in row) + GAP * (len(row) - 1)
        x = (pw - width) / 2
        for w, _ in row:
            sheets[-1].append((x, y))
            x += w + GAP
        y += h + GAP
    return sheets


def cards_to_pdf(images: list[tuple[bytes, str]], paper: str, mode: str, scale: str, tesseract: str | None) -> Output:
    """The cards of `images` (front, back, front, back…) at their real size (`scale` "real") or half again as big
    ("large"), on A4 or F4 (`paper`), in colour or grey (`mode`)."""
    if not images:
        raise BadOptions("no pictures", field="files")
    if len(images) > MAX_CARDS:
        raise TooLarge(f"more than {MAX_CARDS} cards", max_files=MAX_CARDS)
    if paper not in ("a4", "f4"):
        raise BadOptions(f"paper {paper!r}", field="paper")
    if mode not in MODES:
        raise BadOptions(f"mode {mode!r}", field="mode")
    if scale not in SCALES:
        raise BadOptions(f"scale {scale!r}", field="scale")
    k = SCALES[scale]
    cards = []
    for data, name in images:
        img, (w, h) = card_image(data, name, mode, tesseract)
        cards.append((img, (w * k, h * k)))
    pw, ph = (v / MM for v in PAPERS[paper])
    out = pymupdf.open()
    i = 0
    for sheet in layout([s for _, s in cards], (pw, ph)):
        page = out.new_page(width=pw * MM, height=ph * MM)
        for x, y in sheet:
            img, (w, h) = cards[i]
            i += 1
            rect = pymupdf.Rect(x * MM, y * MM, (x + w) * MM, (y + h) * MM)
            page.insert_image(rect, stream=_jpeg(img, (w, h), mode == "gray"))
            page.draw_rect(rect, color=(0.75, 0.75, 0.75), width=0.3)  # where to cut
    return pdf(out.tobytes(garbage=3, deflate=True))
