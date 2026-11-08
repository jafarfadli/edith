"""Fonts used by the uploaded PDF: what they are, whether they can be reused for new text, and
which bundled family substitutes them."""
import re
from dataclasses import dataclass

import pymupdf

from edith.cid_fonts import add_cmap, char_to_glyph
from edith.fonts import FontRegistry, base_font_name, parse_font_name

# pymupdf extract_font() extensions → spec font formats.
_FORMATS = {"ttf": "ttf", "otf": "otf", "cff": "cff", "cid": "cff", "pfa": "type1", "pfb": "type1"}
_SAMPLE = [ord(c) for c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"]
# Symbol and dingbat fonts: their characters only look right in the font itself (never substituted).
_SYMBOL_NAMES = ("wingdings", "webdings", "symbol", "zapfdingbats", "dingbats", "marlett", "mtextra")


@dataclass
class DocFont:
    xref: int
    name: str          # BaseFont without subset prefix
    embedded: bool
    format: str | None  # ttf | otf | cff | type1 | type3 | None (not embedded)
    reusable: bool
    family: str        # normalized family key, e.g. "calibri"
    bold: bool
    italic: bool
    keys: frozenset[str] = frozenset()  # name_key() of the BaseFont and of the embedded program's name
    symbolic: bool = False  # a symbol / dingbat font (Wingdings, Symbol, ZapfDingbats …)
    substitute: dict | None = None  # bundled FontRef JSON; filled by the text extraction

    @property
    def ref(self) -> str:
        return f"f{self.xref}"

    def to_json(self) -> dict:
        return {
            "ref": self.ref, "name": self.name, "embedded": self.embedded, "format": self.format,
            "reusable": self.reusable, "family": self.family, "bold": self.bold, "italic": self.italic,
            "substitute": self.substitute,
        }


def is_symbolic(name: str) -> bool:
    key = name_key(name)
    return any(w in key for w in _SYMBOL_NAMES)


def name_key(name: str) -> str:
    """Comparable form of a font name: span names come from the font program (`Arimo-Regular`)
    while BaseFont may differ in punctuation (`ABCDEF+Arimo Regular`)."""
    return re.sub(r"[^a-z0-9]", "", base_font_name(name).lower())


def font_bytes(doc: pymupdf.Document, xref: int) -> tuple[bytes, str] | None:
    """(bytes, "ttf"|"otf") of the embedded program of font `xref` if it can draw new text, else None: as
    embedded when it has a Unicode cmap; a CID TrueType subset without one gets a cmap rebuilt from the PDF's
    ToUnicode and CIDToGIDMap (edith.cid_fonts), which covers exactly the characters the subset has."""
    try:
        _name, ext, _type, buf = doc.extract_font(xref)
    except Exception:  # noqa: BLE001 - unreadable font object
        return None
    if ext not in ("ttf", "otf") or not buf:
        return None
    try:
        font = pymupdf.Font(fontbuffer=buf)
    except Exception:  # noqa: BLE001
        return None
    if any(font.has_glyph(c) for c in _SAMPLE):
        return buf, ext
    if ext == "ttf":
        try:
            _family, bold, italic = parse_font_name(base_font_name(doc.xref_get_key(xref, "BaseFont")[1].lstrip("/")))
            rebuilt = add_cmap(buf, char_to_glyph(doc, xref), f"Edith Original {xref}", bold, italic)
        except Exception:  # noqa: BLE001 - damaged font objects or CMaps: not reusable, as without a rebuild
            rebuilt = None
        if rebuilt is not None:
            return rebuilt, "ttf"
    return None


def load_font(doc: pymupdf.Document, xref: int) -> pymupdf.Font | None:
    """The program font_bytes() returns, loaded, else None."""
    found = font_bytes(doc, xref)
    return pymupdf.Font(fontbuffer=found[0]) if found else None


def _doc_font(doc: pymupdf.Document, entry: tuple) -> DocFont:
    xref, ext, ftype, basefont = entry[0], entry[1], entry[2], entry[3]
    name = base_font_name(basefont)
    family, bold, italic = parse_font_name(name)
    embedded = ext not in ("n/a", "")
    fmt = "type3" if ftype == "Type3" else (_FORMATS.get(ext) if embedded else None)
    keys = {name_key(name)}
    if embedded:
        try:
            buf = doc.extract_font(xref)[3]
            keys.add(name_key(pymupdf.Font(fontbuffer=buf).name))
        except Exception:  # noqa: BLE001 - unreadable program: match by BaseFont only
            pass
    reusable = fmt in ("ttf", "otf") and load_font(doc, xref) is not None
    return DocFont(xref=xref, name=name, embedded=embedded, format=fmt, reusable=reusable,
                   family=family, bold=bold, italic=italic, keys=frozenset(keys), symbolic=is_symbolic(name))


def collect_fonts(doc: pymupdf.Document) -> dict[int, DocFont]:
    """All fonts referenced by the document's pages, by xref."""
    fonts: dict[int, DocFont] = {}
    for page in doc:
        for entry in page.get_fonts(full=True):
            if entry[0] and entry[0] not in fonts:
                fonts[entry[0]] = _doc_font(doc, entry)
    return fonts


def span_fonts(page: pymupdf.Page, fonts: dict[int, DocFont]) -> dict[str, DocFont | None]:
    """name_key(span font) → the page's font with that name; None when two of the page's fonts share it."""
    out: dict[str, DocFont | None] = {}
    for entry in page.get_fonts(full=True):
        font = fonts.get(entry[0])
        if font is None:
            continue
        for key in font.keys:
            out[key] = None if key in out and out[key] is not font else font
    return out


def fill_substitutes(fonts: dict[int, DocFont], registry: FontRegistry) -> None:
    for font in fonts.values():
        if font.substitute is None:
            font.substitute = registry.substitute(font.name)
