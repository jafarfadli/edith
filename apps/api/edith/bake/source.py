from collections.abc import Callable

import pymupdf

from edith.doc_fonts import load_font, name_key
from edith.errors import BakeFailed, DocExpired, DocNotFound
from edith.paragraphs import extract_paragraphs


def _span_font(span: dict) -> dict:
    return {"name": span["font"]}


class SourcePages:
    """Read-only views of the uploaded PDFs a layout uses — the edited one and imported ones — for ops that
    refer to their original content: paragraphs (`text.edit`) and embedded fonts (`FontRef` kind "original",
    whose `doc` names an imported PDF; none = the edited one). Paragraph ids come from the same extraction
    GET /documents/{id}/text uses, run on the untouched source file."""

    def __init__(self, main_id: str, source: bytes, page_src: dict[str, tuple[str, int] | None],
                 load: Callable[[str], bytes] | None = None):
        self._main = main_id
        self._docs: dict[str, pymupdf.Document | None] = {main_id: pymupdf.open(stream=source, filetype="pdf")}
        self._load = load
        self._page_src = page_src  # pageKey → (doc id, source page index); None for blank pages
        self._paragraphs: dict[tuple[str, int], dict[str, dict]] = {}
        self._fonts: dict[tuple[str, str], pymupdf.Font] = {}
        self._font_keys: dict[tuple[str, str], frozenset[str]] = {}

    def _doc(self, doc_id: str) -> pymupdf.Document | None:
        """The document, opened on first use; None when it is unknown. An expired one raises DocExpired naming it."""
        if doc_id not in self._docs:
            doc = None
            if self._load is not None:
                try:
                    data = self._load(doc_id)
                    try:
                        doc = pymupdf.open(stream=data, filetype="pdf")
                    except Exception as exc:  # noqa: BLE001
                        raise BakeFailed(f"cannot read imported document {doc_id}: {exc}") from exc
                except DocNotFound:
                    doc = None
                except DocExpired:
                    raise DocExpired(f"imported document {doc_id} expired", doc_id=doc_id) from None
            self._docs[doc_id] = doc
        return self._docs[doc_id]

    def paragraph(self, page_key: str, paragraph_id: str) -> dict | None:
        src = self._page_src.get(page_key)
        if src is None:
            return None
        doc = self._doc(src[0])
        if doc is None or src[1] >= doc.page_count:
            return None
        if src not in self._paragraphs:
            # Runs name the span's font (not a FontRef): text.edit checks a kept line against it (see kept_lines).
            self._paragraphs[src] = {p["id"]: p for p in extract_paragraphs(doc[src[1]], _span_font)}
        return self._paragraphs[src].get(paragraph_id)

    def font_keys(self, ref: str, doc_id: str | None = None) -> frozenset[str]:
        """name_key()s of font `ref` of a document (its BaseFont and its program's name), as span font names
        compare to them; empty when the font is unknown."""
        key = (doc_id or self._main, ref)
        if key not in self._font_keys:
            doc = self._doc(key[0])
            keys: set[str] = set()
            xref = int(ref[1:])
            if doc is not None and 0 < xref < doc.xref_length():
                kind, base = doc.xref_get_key(xref, "BaseFont")
                if kind == "name":
                    keys.add(name_key(base.lstrip("/")))
                try:
                    keys.add(name_key(self.font(ref, doc_id).name))
                except Exception:  # noqa: BLE001 - not reusable: the BaseFont name alone
                    pass
            self._font_keys[key] = frozenset(keys)
        return self._font_keys[key]

    def font(self, ref: str, doc_id: str | None = None) -> pymupdf.Font:
        key = (doc_id or self._main, ref)
        if key not in self._fonts:
            doc = self._doc(key[0])
            xref = int(ref[1:])
            font = load_font(doc, xref) if doc is not None and self._is_font(doc, xref) else None
            if font is None:
                raise ValueError(f"font {ref} is not a reusable font of document {key[0]}")
            self._fonts[key] = font
        return self._fonts[key]

    @staticmethod
    def _is_font(doc: pymupdf.Document, xref: int) -> bool:
        return any(entry[0] == xref for page in doc for entry in page.get_fonts(full=True))

    def close(self) -> None:
        for doc in self._docs.values():
            if doc is not None:
                doc.close()
