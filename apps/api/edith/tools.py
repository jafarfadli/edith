"""The PDF tools beside the editor (the start page's "Alat PDF"): each takes PDFs or images and gives back a file. They are
pure functions of their inputs; routes/tools.py serves them and the export applies the ones that make sense after an
edit (pictures of the pages, compression, a password).

Every PDF input may be locked: `open_input` opens it with the password given, and refuses it without the right one."""
import io
import math
import re
import secrets
import zipfile
from dataclasses import dataclass

import pymupdf

from edith.errors import BadOptions, PdfCorrupt, PdfEncrypted, PdfPasswordWrong, TooLarge

IMAGE_TYPES = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg"}
DPIS = (72, 150, 300)
MAX_IMAGE_PIXELS = 60_000_000  # the pictures of one request together, at the chosen resolution
A4 = pymupdf.paper_rect("a4")
COMPRESS = {  # level: images above `threshold` dpi are resampled to `target` dpi at JPEG `quality`
    "low": {"threshold": 220, "target": 200, "quality": 85},
    "medium": {"threshold": 160, "target": 144, "quality": 75},
    "high": {"threshold": 110, "target": 96, "quality": 60},
}


@dataclass
class Output:
    data: bytes
    media_type: str
    extension: str  # without the dot


def needs_password(data: bytes) -> bool:
    """True when the PDF `data` opens only with a password (False when it does not parse: open_input says why)."""
    try:
        with pymupdf.open(stream=data, filetype="pdf") as doc:
            return bool(doc.needs_pass)
    except Exception:  # noqa: BLE001
        return False


def open_input(data: bytes, max_pages: int, password: str | None = None) -> pymupdf.Document:
    """A PDF given to a tool, unlocked with `password` when it needs one. PdfEncrypted without a password,
    PdfPasswordWrong with a wrong one. Never read `needs_pass` of the document it returns: once a PDF is
    authenticated, reading it makes PyMuPDF save its streams still encrypted (unreadable); use needs_password."""
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 - any parse failure means corrupt
        raise PdfCorrupt("cannot parse PDF") from exc
    try:
        if doc.needs_pass:
            if not password:
                raise PdfEncrypted()
            if not doc.authenticate(password):
                raise PdfPasswordWrong()
        if doc.page_count == 0:
            raise PdfCorrupt("PDF has no pages")
        if doc.page_count > max_pages:
            raise TooLarge(f"more than {max_pages} pages", max_pages=max_pages)
    except Exception:
        doc.close()
        raise
    return doc


def plain_bytes(doc: pymupdf.Document) -> bytes:
    """`doc` saved without any encryption or restriction (an unlocked copy)."""
    return doc.tobytes(garbage=3, deflate=True, encryption=pymupdf.PDF_ENCRYPT_NONE)


def pdf(data: bytes) -> Output:
    return Output(data, "application/pdf", "pdf")


def parse_pages(spec: str | None, count: int) -> list[int]:
    """Page numbers "1-3, 5, 8-" (1-based, as people write them) as 0-based indexes in that order; all pages when empty.
    BadOptions for anything else, or a page past the end."""
    if not spec or not spec.strip():
        return list(range(count))
    out: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        m = re.fullmatch(r"(\d+)?\s*(-)?\s*(\d+)?", part)
        if not part or not m or (m.group(1) is None and m.group(3) is None) or (m.group(2) is None and m.group(3)):
            raise BadOptions(f"pages: cannot read {part!r}", field="pages")
        a = int(m.group(1)) if m.group(1) else 1
        b = (int(m.group(3)) if m.group(3) else count) if m.group(2) else a
        if a < 1 or b > count or a > b:
            raise BadOptions(f"pages: {part!r} is outside 1-{count}", field="pages")
        out.extend(range(a - 1, b))
    return out


def unlock(doc: pymupdf.Document) -> Output:
    """The opened (so unlocked) PDF without its password or restrictions."""
    return pdf(plain_bytes(doc))


def protect(doc: pymupdf.Document, password: str, allow_print: bool = True, allow_copy: bool = True) -> Output:
    """`doc` locked with `password` (AES-256) to open it, printing and copying text as allowed. The owner password
    (which lifts the restrictions) is a random one nobody keeps: with the same password as owner, whoever opens the
    PDF could do anything, and the restrictions would mean nothing."""
    if not password:
        raise BadOptions("password is empty", field="password")
    perms = pymupdf.PDF_PERM_ACCESSIBILITY | pymupdf.PDF_PERM_FORM | pymupdf.PDF_PERM_ANNOTATE
    if allow_print:
        perms |= pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ
    if allow_copy:
        perms |= pymupdf.PDF_PERM_COPY
    data = doc.tobytes(garbage=3, deflate=True, encryption=pymupdf.PDF_ENCRYPT_AES_256,
                       owner_pw=secrets.token_urlsafe(24), user_pw=password, permissions=perms)
    return pdf(data)


def to_images(doc: pymupdf.Document, fmt: str, dpi: int, pages: list[int], stem: str) -> Output:
    """Pictures of `pages` (PNG or JPG at `dpi`): one file for one page, else a ZIP of `stem`-1.png …"""
    if fmt not in IMAGE_TYPES:
        raise BadOptions(f"format {fmt!r}", field="format")
    if dpi not in DPIS:
        raise BadOptions(f"dpi {dpi}", field="dpi")
    zoom = dpi / 72
    pixels = sum(doc[i].rect.width * zoom * doc[i].rect.height * zoom for i in pages)
    if pixels > MAX_IMAGE_PIXELS:
        raise TooLarge("pictures too large at this resolution", max_pixels=MAX_IMAGE_PIXELS)
    ext = "jpg" if fmt in ("jpg", "jpeg") else "png"
    media = f"image/{IMAGE_TYPES[fmt]}"

    def picture(i: int) -> bytes:
        pix = doc[i].get_pixmap(dpi=dpi, alpha=False)
        return pix.tobytes("jpeg", jpg_quality=90) if ext == "jpg" else pix.tobytes("png")

    if len(pages) == 1:
        return Output(picture(pages[0]), media, ext)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:  # pictures are compressed already
        for i in pages:
            z.writestr(f"{stem}-{i + 1}.{ext}", picture(i))
    return Output(buf.getvalue(), "application/zip", "zip")


def to_text(doc: pymupdf.Document) -> Output:
    """The text of every page in reading order, pages apart by a form feed."""
    text = "\f".join(page.get_text("text", sort=True) for page in doc)
    return Output(text.encode("utf-8"), "text/plain; charset=utf-8", "txt")


def compress(doc: pymupdf.Document, level: str) -> Output:
    """`doc` smaller: its pictures resampled as `level` says (COMPRESS), unused objects dropped, streams deflated, objects
    packed. Never bigger than it was: then the original comes back as is."""
    if level not in COMPRESS:
        raise BadOptions(f"level {level!r}", field="level")
    before = plain_bytes(doc)
    c = COMPRESS[level]
    doc.rewrite_images(dpi_threshold=c["threshold"], dpi_target=c["target"], quality=c["quality"],
                       lossless=True, bitonal=False)
    after = doc.tobytes(garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, use_objstms=True,
                        encryption=pymupdf.PDF_ENCRYPT_NONE)
    return pdf(after if len(after) < len(before) else before)


# Compressing to a size: steps from mild to strong (images above `threshold` dpi resampled to `target` dpi at JPEG
# `quality`), the weakest one that reaches the size is taken.
TARGET_STEPS = [
    (220, 200, 85), (160, 144, 75), (130, 120, 68), (110, 96, 60), (96, 84, 52), (84, 72, 45), (72, 60, 38), (60, 50, 32),
]


def _rewritten(data: bytes, threshold: int, target: int, quality: int) -> bytes:
    doc = pymupdf.open("pdf", data)
    try:
        doc.rewrite_images(dpi_threshold=threshold, dpi_target=target, quality=quality, lossless=True, bitonal=False)
        return doc.tobytes(garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, use_objstms=True,
                           encryption=pymupdf.PDF_ENCRYPT_NONE)
    finally:
        doc.close()


def compress_to(doc: pymupdf.Document, target_bytes: int) -> tuple[Output, bool]:
    """`doc` at most `target_bytes` long, as little changed as that allows: the weakest of TARGET_STEPS that gets there,
    found by halving (each try is a full rewrite). When none does (a PDF of text, or a size too small), the smallest
    it got, and False."""
    if target_bytes < 10_000:
        raise BadOptions("target below 10 KB", field="target_kb")
    before = plain_bytes(doc)
    tried: dict[int, bytes] = {}

    def at(i: int) -> bytes:
        if i not in tried:
            out = _rewritten(before, *TARGET_STEPS[i])
            tried[i] = out if len(out) < len(before) else before
        return tried[i]

    if len(before) <= target_bytes and len(at(0)) <= target_bytes:
        return pdf(at(0)), True
    lo, hi, best = 0, len(TARGET_STEPS) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if len(at(mid)) <= target_bytes:
            best, hi = mid, mid - 1
        else:
            lo = mid + 1
    if best is not None:
        return pdf(at(best)), True
    smallest = min([before, *tried.values()], key=len)
    return pdf(smallest), False


def merge(docs: list[pymupdf.Document], max_pages: int) -> Output:
    """The PDFs one after the other, in the order given."""
    if len(docs) < 2:
        raise BadOptions("merge needs two PDFs or more", field="files")
    if sum(d.page_count for d in docs) > max_pages:
        raise TooLarge(f"more than {max_pages} pages", max_pages=max_pages)
    out = pymupdf.open()
    for d in docs:
        out.insert_pdf(d)
    return pdf(plain_bytes(out))


def split(doc: pymupdf.Document, mode: str, stem: str, every: int = 1, ranges: str | None = None) -> Output:
    """Parts of `doc` as PDFs in a ZIP: every `every` pages, or one part per comma-separated range ("1-3, 4, 5-")."""
    if mode == "every":
        if every < 1:
            raise BadOptions("every must be 1 or more", field="every")
        parts = [list(range(a, min(a + every, doc.page_count))) for a in range(0, doc.page_count, every)]
    elif mode == "ranges":
        if not ranges or not ranges.strip():
            raise BadOptions("ranges are empty", field="ranges")
        parts = [parse_pages(r, doc.page_count) for r in ranges.split(",")]
    else:
        raise BadOptions(f"mode {mode!r}", field="mode")
    if len(parts) == 1 and mode == "ranges":
        return pdf(_pages_pdf(doc, parts[0]))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, part in enumerate(parts, 1):
            label = f"{part[0] + 1}" if len(part) == 1 else f"{part[0] + 1}-{part[-1] + 1}"
            z.writestr(f"{stem}-{n:02d}_hal-{label}.pdf", _pages_pdf(doc, part))
    return Output(buf.getvalue(), "application/zip", "zip")


def extract(doc: pymupdf.Document, pages: list[int]) -> Output:
    """Only `pages`, in the order given, as one PDF."""
    return pdf(_pages_pdf(doc, pages))


def _pages_pdf(doc: pymupdf.Document, pages: list[int]) -> bytes:
    out = pymupdf.open()
    for i in pages:
        out.insert_pdf(doc, from_page=i, to_page=i)
    return plain_bytes(out)


def images_to_pdf(images: list[tuple[bytes, str]], size: str, margin: float, max_pages: int) -> Output:
    """One page per picture (`images`: bytes and file name), in the order given: the page the picture's own size
    (`size` "fit"), or A4 with the picture fitted inside a `margin` (pt), turned to landscape for a wide picture."""
    if not images:
        raise BadOptions("no pictures", field="files")
    if len(images) > max_pages:
        raise TooLarge(f"more than {max_pages} pages", max_pages=max_pages)
    if size not in ("a4", "fit"):
        raise BadOptions(f"size {size!r}", field="size")
    if not 0 <= margin <= 72:
        raise BadOptions("margin outside 0-72 pt", field="margin")
    out = pymupdf.open()
    for data, name in images:
        try:
            img = pymupdf.open(stream=data, filetype=name.rsplit(".", 1)[-1].lower() if "." in name else None)
            # The picture as a one-page PDF: MuPDF applies its orientation (a phone photo's EXIF) and resolution.
            one = pymupdf.open("pdf", img.convert_to_pdf())
        except Exception as exc:  # noqa: BLE001 - not a picture MuPDF reads
            raise BadOptions(f"{name}: not a picture", field="files", file=name) from exc
        r = one[0].rect
        if size == "fit":
            page = out.new_page(width=r.width, height=r.height)
            page.show_pdf_page(page.rect, one, 0)
            continue
        paper = pymupdf.Rect(0, 0, A4.height, A4.width) if r.width > r.height else A4
        page = out.new_page(width=paper.width, height=paper.height)
        room = paper + (margin, margin, -margin, -margin)
        scale = min(room.width / r.width, room.height / r.height)
        w, h = r.width * scale, r.height * scale
        x0, y0 = room.x0 + (room.width - w) / 2, room.y0 + (room.height - h) / 2
        page.show_pdf_page(pymupdf.Rect(x0, y0, x0 + w, y0 + h), one, 0)
    return pdf(out.tobytes(garbage=3, deflate=True))


def finish(doc: pymupdf.Document, stem: str, *, fmt: str = "pdf", dpi: int = 150, pages: str | None = None,
           compress_level: str | None = None, password: str | None = None, allow_print: bool = True,
           allow_copy: bool = True) -> Output:
    """An edited document as the editor's "Unduh" asks for it: only `pages`, then pictures of them (`fmt` png/jpg), or a
    PDF compressed and/or locked."""
    chosen = parse_pages(pages, doc.page_count) if pages and pages.strip() else None
    if fmt != "pdf":
        return to_images(doc, fmt, dpi, chosen or list(range(doc.page_count)), stem)
    if chosen is not None:
        doc = pymupdf.open("pdf", _pages_pdf(doc, chosen))
    data = compress(doc, compress_level).data if compress_level else plain_bytes(doc)
    if password:
        return protect(pymupdf.open("pdf", data), password, allow_print, allow_copy)
    return pdf(data)


# ---- Tahap 2: searchable scans, watermark, page numbers ----------------------------------------------------------

OCR_DPI = 300


def searchable(doc: pymupdf.Document, cmd: str, langs: str, timeout: float, max_pages: int) -> tuple[Output, int]:
    """`doc` with an invisible text layer on every page that has no text (a scan): tesseract reads a picture of the
    page and its text-only PDF is laid over the page, which keeps everything it showed (as ocrmypdf does). Pages with
    text are left alone. With the number of pages read. TooLarge past `max_pages` pages to read."""
    import subprocess

    from edith.errors import OcrFailed, OcrTimeout, OcrUnavailable
    todo = [p.number for p in doc if not p.get_text("text").strip()]
    if len(todo) > max_pages:
        raise TooLarge(f"more than {max_pages} pages to read", max_pages=max_pages)
    for i in todo:
        page = doc[i]
        turned = page.rotation
        if turned:
            page.set_rotation(0)  # read and lay the text in the page's own frame
        png = page.get_pixmap(dpi=OCR_DPI, alpha=False).tobytes("png")
        try:
            out = subprocess.run([cmd, "stdin", "stdout", "-l", langs, "--dpi", str(OCR_DPI), "-c", "textonly_pdf=1", "pdf"],
                                 input=png, capture_output=True, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            raise OcrTimeout(f"page {i + 1} took too long") from None
        except OSError:
            raise OcrUnavailable("cannot run tesseract") from None
        if out.returncode != 0 or not out.stdout.startswith(b"%PDF"):
            raise OcrFailed(f"tesseract failed on page {i + 1}")
        layer = pymupdf.open("pdf", out.stdout)
        page.show_pdf_page(page.rect, layer, 0, overlay=True)
        if turned:
            page.set_rotation(turned)
    return pdf(plain_bytes(doc)), len(todo)


def _hex_colour(value: str, field: str) -> tuple[float, float, float]:
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", value or "")
    if not m:
        raise BadOptions(f"colour {value!r}", field=field)
    h = m.group(1)
    return tuple(int(h[k:k + 2], 16) / 255 for k in (0, 2, 4))  # type: ignore[return-value]


def _write(page: pymupdf.Page, text: str, at: tuple[float, float], size: float, colour: tuple, opacity: float,
           font: pymupdf.Font, fontname: str, angle: float = 0) -> None:
    """`text` whose baseline starts at `at` (a point of the page as shown, rotation included), turned `angle` degrees
    counter-clockwise as seen."""
    p = pymupdf.Point(at) * page.derotation_matrix
    # The page's own rotation turns what is drawn: turn the text back by it, plus the angle asked.
    turn = angle + page.rotation
    morph = (p, pymupdf.Matrix(turn)) if turn % 360 else None  # (positive: counter-clockwise as seen)
    page.insert_text(p, text, fontsize=size, fontname=fontname, fontfile=None, color=colour, fill_opacity=opacity,
                     morph=morph)


def _face(page: pymupdf.Page, path: str, bold: bool) -> tuple[pymupdf.Font, str]:
    name = "EdithB" if bold else "EdithR"
    page.insert_font(fontname=name, fontfile=path)
    return pymupdf.Font(fontfile=path), name


def watermark(doc: pymupdf.Document, text: str, pages: list[int], font_path: str, size: float = 48,
              colour: str = "#9ca3af", opacity: float = 0.35, diagonal: bool = True, bold: bool = True) -> Output:
    """`text` across the middle of `pages` (diagonal, or level), see-through. Its size shrinks to fit a page."""
    text = (text or "").strip()
    if not text or len(text) > 120:
        raise BadOptions("text is empty or longer than 120", field="text")
    if not 8 <= size <= 200:
        raise BadOptions("size outside 8-200", field="size")
    if not 0.05 <= opacity <= 1:
        raise BadOptions("opacity outside 0.05-1", field="opacity")
    rgb = _hex_colour(colour, "colour")
    for i in pages:
        page = doc[i]
        font, name = _face(page, font_path, bold)
        r = page.rect
        reach = (r.width ** 2 + r.height ** 2) ** 0.5 * 0.8 if diagonal else r.width * 0.85
        s = min(size, size * reach / max(font.text_length(text, fontsize=size), 1))
        w = font.text_length(text, fontsize=s)
        angle = math.degrees(math.atan2(r.height, r.width)) if diagonal else 0
        a = math.radians(angle)
        # Start where the text's middle falls on the page's centre: half its width back along its direction (cos a,
        # -sin a: y grows downwards), and its baseline half the cap height below the middle (sin a, cos a).
        cx, cy = r.width / 2, r.height / 2
        half, drop = w / 2, s * 0.35
        x = cx - half * math.cos(a) + drop * math.sin(a)
        y = cy + half * math.sin(a) + drop * math.cos(a)
        _write(page, text, (x, y), s, rgb, opacity, font, name, angle)
    return pdf(plain_bytes(doc))


NUMBER_FORMATS = {"n": "{n}", "n_of": "{n} / {total}", "page_n": "Halaman {n}", "page_n_of": "Halaman {n} dari {total}"}
POSITIONS = {"bottom-center", "bottom-right", "bottom-left", "top-center", "top-right", "top-left"}


def page_numbers(doc: pymupdf.Document, pages: list[int], font_path: str, position: str = "bottom-center",
                 fmt: str = "n", start: int = 1, size: float = 10, margin: float = 28, colour: str = "#000000") -> Output:
    """A number on each of `pages`: `start` on the first of them, counting on; `{total}` is how many are numbered
    (from `start`). Placed at `position` of the page as shown, `margin` pt from its edges."""
    if position not in POSITIONS:
        raise BadOptions(f"position {position!r}", field="position")
    if fmt not in NUMBER_FORMATS:
        raise BadOptions(f"format {fmt!r}", field="format")
    if not 0 <= start <= 100000:
        raise BadOptions("start outside 0-100000", field="start")
    if not 6 <= size <= 48:
        raise BadOptions("size outside 6-48", field="size")
    if not 0 <= margin <= 144:
        raise BadOptions("margin outside 0-144", field="margin")
    rgb = _hex_colour(colour, "colour")
    total = start + len(pages) - 1
    for k, i in enumerate(sorted(pages)):
        page = doc[i]
        font, name = _face(page, font_path, False)
        label = NUMBER_FORMATS[fmt].format(n=start + k, total=total)
        w = font.text_length(label, fontsize=size)
        r = page.rect
        vert, horiz = position.split("-")
        x = {"left": margin, "center": (r.width - w) / 2, "right": r.width - margin - w}[horiz]
        y = margin + size * 0.75 if vert == "top" else r.height - margin
        _write(page, label, (x, y), size, rgb, 1.0, font, name)
    return pdf(plain_bytes(doc))
