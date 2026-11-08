"""Fonts a form needs whole.

`Document.subset_fonts()` shrinks every embedded font to the glyphs its pages draw, but a viewer filling a field later
draws other glyphs with the AcroForm /DR font (or the one in the widget's appearance stream), so those programs must
survive the export unchanged. `protect()` records the font programs reachable from /DR and from widget appearances;
`restore()` puts them back after the subsetter replaced them (it rewrites the FontFile stream in place).
"""

import re

import pymupdf

_REF = re.compile(r"(\d+) 0 R")
_SKIP = {"Length", "Filter", "DecodeParms"}
_PROGRAMS = ("FontFile", "FontFile2", "FontFile3")


def _refs(doc: pymupdf.Document, xref: int, key: str, container: bool = False) -> list[int]:
    """The objects `key` of `xref` refers to. `container`: the value is an array or dictionary of references
    (inline, or one indirect object holding them), else a single reference. A stream is returned itself."""
    kind, value = doc.xref_get_key(xref, key)
    if kind == "null":
        return []
    found = [int(n) for n in _REF.findall(value)]
    if container and kind == "xref" and found and not doc.xref_is_stream(found[0]):
        return [int(n) for n in _REF.findall(doc.xref_object(found[0]))]
    return found if container else found[:1]


def _programs(doc: pymupdf.Document, font: int) -> set[int]:
    """FontFile streams of font object `font` (a simple font, or a Type0 font through its descendants)."""
    out: set[int] = set()
    for f in [font, *_refs(doc, font, "DescendantFonts", container=True)]:
        for descriptor in _refs(doc, f, "FontDescriptor"):
            for key in _PROGRAMS:
                out.update(_refs(doc, descriptor, key))
    return out


def _appearance_streams(doc: pymupdf.Document, widget: int) -> list[int]:
    out: list[int] = []
    for state in ("N", "D", "R"):
        for xref in _refs(doc, widget, f"AP/{state}", container=True):  # a stream, or a dictionary of states
            if doc.xref_is_stream(xref):
                out.append(xref)
            else:
                out += [int(n) for n in _REF.findall(doc.xref_object(xref))]
    return out


def protect(doc: pymupdf.Document) -> dict[int, tuple[bytes, dict[str, str]]]:
    """font program xref → (decoded stream, its other dictionary entries) for every font the form uses."""
    fonts: set[int] = set()
    catalog = doc.pdf_catalog()
    fonts.update(_refs(doc, catalog, "AcroForm/DR/Font", container=True))
    for page in doc:
        for widget in page.widgets():
            for stream in _appearance_streams(doc, widget.xref):
                fonts.update(_refs(doc, stream, "Resources/Font", container=True))
    saved: dict[int, tuple[bytes, dict[str, str]]] = {}
    for font in fonts:
        for program in _programs(doc, font):
            if program not in saved and doc.xref_is_stream(program):
                keys = {k: doc.xref_get_key(program, k)[1] for k in doc.xref_get_keys(program) if k not in _SKIP}
                saved[program] = (doc.xref_stream(program), keys)
    return saved


def restore(doc: pymupdf.Document, saved: dict[int, tuple[bytes, dict[str, str]]]) -> None:
    for xref, (data, keys) in saved.items():
        doc.update_stream(xref, data)
        for key, value in keys.items():
            doc.xref_set_key(xref, key, value)
