import pymupdf

from edith.doc_fonts import collect_fonts, fill_substitutes, name_key, span_fonts
from edith.errors import PdfCorrupt, PdfEncrypted, TooLarge
from edith.fonts import FontRegistry
from edith.paragraphs import extract_paragraphs


def open_pdf(data: bytes, max_pages: int) -> pymupdf.Document:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 - any parse failure means corrupt
        raise PdfCorrupt("cannot parse PDF") from exc
    try:
        if doc.needs_pass or doc.is_encrypted:
            raise PdfEncrypted()
        if doc.page_count == 0:
            raise PdfCorrupt("PDF has no pages")
        if doc.page_count > max_pages:
            raise TooLarge(f"more than {max_pages} pages", max_pages=max_pages)
    except Exception:
        doc.close()
        raise
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


def extract_text(doc: pymupdf.Document, registry: FontRegistry) -> dict:
    """Paragraphs of every page plus the fonts they use. A run whose font is reusable gets
    `{"kind": "original", "ref"}`; any other run gets its bundled substitute."""
    fonts = collect_fonts(doc)
    pages = []
    for page in doc:
        by_name = span_fonts(page, fonts)

        def resolve(span: dict, by_name=by_name) -> dict:
            font = by_name.get(name_key(span["font"]))
            if font is None:
                return registry.substitute(span["font"], span["flags"])
            if font.substitute is None:  # BaseFont names map better than program names
                font.substitute = registry.substitute(font.name, span["flags"])
            return {"kind": "original", "ref": font.ref} if font.reusable else dict(font.substitute)

        pages.append({"index": page.number, "paragraphs": extract_paragraphs(page, resolve)})
    fill_substitutes(fonts, registry)
    return {"pages": pages, "fonts": [f.to_json() for f in fonts.values()]}
