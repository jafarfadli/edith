import pymupdf

from edith.errors import PdfCorrupt, PdfEncrypted, TooLarge


def open_pdf(data: bytes, max_pages: int) -> pymupdf.Document:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 - any parse failure means corrupt
        raise PdfCorrupt("cannot parse PDF") from exc
    if doc.needs_pass or doc.is_encrypted:
        raise PdfEncrypted()
    if doc.page_count == 0:
        raise PdfCorrupt("PDF has no pages")
    if doc.page_count > max_pages:
        raise TooLarge(f"more than {max_pages} pages", max_pages=max_pages)
    return doc


def _num(v: float) -> float | int:
    r = round(v, 2)
    return int(r) if r == int(r) else r


def extract_structure(doc: pymupdf.Document) -> dict:
    pages = []
    for page in doc:
        box = page.cropbox
        pages.append({
            "index": page.number,
            "width": _num(box.width),
            "height": _num(box.height),
            "rotation": page.rotation,
            "hasText": bool(page.get_text("text").strip()),
        })
    return {"page_count": doc.page_count, "pages": pages}
