import pymupdf

from edith.doc_fonts import load_font
from edith.paragraphs import extract_paragraphs


class SourcePages:
    """Read-only view of the uploaded PDF, for ops that refer to its original content: paragraphs
    (`text.edit`) and embedded fonts (`FontRef` kind "original"). Paragraph ids come from the same
    extraction GET /documents/{id}/text uses, run on the untouched source file."""

    def __init__(self, source: bytes, page_src: dict[str, int | None]):
        self._doc = pymupdf.open(stream=source, filetype="pdf")
        self._page_src = page_src  # pageKey → source page index (None for blank pages)
        self._paragraphs: dict[int, dict[str, dict]] = {}
        self._fonts: dict[str, pymupdf.Font] = {}

    def paragraph(self, page_key: str, paragraph_id: str) -> dict | None:
        index = self._page_src.get(page_key)
        if index is None:
            return None
        if index not in self._paragraphs:
            self._paragraphs[index] = {p["id"]: p for p in extract_paragraphs(self._doc[index])}
        return self._paragraphs[index].get(paragraph_id)

    def font(self, ref: str) -> pymupdf.Font:
        if ref not in self._fonts:
            font = load_font(self._doc, int(ref[1:])) if self._is_font(int(ref[1:])) else None
            if font is None:
                raise ValueError(f"font {ref} is not a reusable font of this document")
            self._fonts[ref] = font
        return self._fonts[ref]

    def _is_font(self, xref: int) -> bool:
        return any(entry[0] == xref for page in self._doc for entry in page.get_fonts(full=True))

    def close(self) -> None:
        self._doc.close()
