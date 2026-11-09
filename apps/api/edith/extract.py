from collections.abc import Callable

import pymupdf

from edith.doc_fonts import (collect_fonts, fill_substitutes, font_candidates, is_symbolic, load_font, name_key,
                              pick_font, span_fonts)
from edith.errors import PdfCorrupt, PdfEncrypted, TooLarge
from edith.fonts import FontRegistry
from edith.forms import extract_fields
from edith.imagetext import Budget, image_text_regions
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
    return {"page_count": doc.page_count, "pages": pages, "fields": extract_fields(doc)}


class TextFonts:
    """How a document's text maps to fonts, shared by GET /text and the bake's own extraction (SourcePages): a span's
    run FontRef (`resolve`: the reusable original, else its bundled substitute), whether its paragraph is locked, and
    the program a client measures a run in (`program`), from which the runs' scale and spacing are measured."""

    def __init__(self, doc: pymupdf.Document, registry: FontRegistry):
        self.doc, self.registry = doc, registry
        self.fonts = collect_fonts(doc)
        self._programs: dict[str, pymupdf.Font | None] = {}

    def program(self, ref: dict) -> pymupdf.Font | None:
        """The program a client measures a run in (the served original, or the bundled substitute file)."""
        key = repr(sorted((k, v) for k, v in ref.items() if k != "name"))
        if key not in self._programs:
            try:
                self._programs[key] = (
                    load_font(self.doc, int(ref["ref"][1:])) if ref.get("kind") == "original"
                    else self.registry.font(ref["family"], ref.get("bold", False), ref.get("italic", False)))
            except Exception:  # noqa: BLE001 - unknown family or unreadable program: no spacing measured
                self._programs[key] = None
        return self._programs[key]

    def page(self, page: pymupdf.Page) -> tuple[Callable[[dict], dict], Callable[[dict], bool]]:
        """(resolve, locked) for the spans of `page`."""
        doc, fonts, registry = self.doc, self.fonts, self.registry
        by_name = span_fonts(page, fonts)
        by_key = font_candidates(page, fonts)

        def resolve(span: dict) -> dict:
            key = name_key(span["font"])
            font = by_name.get(key)
            if font is None and len(by_key.get(key, ())) > 1:  # two subsets share the name: the one that draws it
                font = pick_font(doc, by_key[key], key, span)
            if font is None:
                return registry.substitute(span["font"], span["flags"])
            if font.substitute is None:  # BaseFont names map better than program names
                font.substitute = registry.substitute(font.name, span["flags"])
            return {"kind": "original", "ref": font.ref} if font.reusable else dict(font.substitute)

        page_fonts = list({e[0]: fonts[e[0]] for e in page.get_fonts(full=True) if e[0] in fonts}.values())

        def locked(span: dict) -> bool:
            key = name_key(span["font"])
            candidates = [f for f in page_fonts if key in f.keys]  # several when the name is ambiguous
            if not candidates:
                return is_symbolic(span["font"])
            if len(candidates) == 1:
                return candidates[0].symbolic and not candidates[0].reusable
            return is_symbolic(span["font"]) and not any(f.reusable for f in candidates)

        return resolve, locked


def extract_text(doc: pymupdf.Document, registry: FontRegistry) -> dict:
    """Paragraphs of every page plus the fonts they use. A run whose font is reusable gets
    `{"kind": "original", "ref"}`; any other run gets its bundled substitute. A paragraph with text in a
    symbol font that can't be reused is not editable: no other font draws its characters (`lock` says why a paragraph
    is not editable). `imageText`: the rects of images that look like print with no text over them (see imagetext)."""
    text_fonts = TextFonts(doc, registry)
    pages = []
    budget = Budget()
    for page in doc:
        resolve, locked = text_fonts.page(page)
        paragraphs = extract_paragraphs(page, resolve, locked, text_fonts.program)
        # The page's visible text, from its paragraphs (the page's text is not read again): every line of a paragraph
        # that is not invisible text.
        visible = [pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
                   for p in paragraphs if p.get("lock") != "hidden" for r in (ln["rect"] for ln in p["lines"])]
        pages.append({"index": page.number, "paragraphs": paragraphs,
                      "imageText": image_text_regions(page, budget, visible)})
    fill_substitutes(text_fonts.fonts, registry)
    return {"pages": pages, "fonts": [f.to_json() for f in text_fonts.fonts.values()]}
