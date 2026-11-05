"""ToUnicode CMaps for the fonts the bake adds with TextWriter.

MuPDF builds a font's ToUnicode by inverting the font's cmap, and when several code points share a
glyph the last one wins: Tinos/Cousine/Source Sans 3/Source Serif 4 map U+0020 and U+00A0 to one
`space` glyph, so their spaces extract as U+00A0; Arimo/Tinos/Cousine hyphens extract as U+00AD (a
soft hyphen, which pdf.js drops), PT Serif semicolons as U+037E. The bundled fonts can't simply be
edited (the OFL Reserved Font Names of Source and PT Serif forbid modified copies under those names)
and fonts reused from the uploaded PDF can't be edited at all, so the bake rewrites the CMap of every
font it embeds: same mapping, except a printable ASCII code point wins over the others of its glyph.
"""

import pymupdf

_MARK = b"%edith-tounicode\n"
_HEADER = b"""/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <ffff>
endcodespacerange
"""
_FOOTER = b"""endcmap
CMapName currentdict /CMap defineresource pop
end
end
"""


def _ascii(cp: int) -> bool:
    return 0x20 <= cp <= 0x7E


def glyph_to_unicode(font: pymupdf.Font) -> dict[int, int]:
    """glyph id → the code point text extraction should read for it."""
    out: dict[int, int] = {}
    for cp in sorted(font.valid_codepoints()):
        if 0xD800 <= cp <= 0xDFFF:
            continue  # not a character
        gid = font.has_glyph(cp)
        if gid and not (gid in out and _ascii(out[gid]) and not _ascii(cp)):
            out[gid] = cp  # ascending order: the last (highest) wins, like MuPDF, unless ASCII came first
    return out


def to_unicode_cmap(mapping: dict[int, int]) -> bytes:
    """A ToUnicode CMap for an Identity-H font (2-byte codes = glyph ids)."""
    items = sorted(mapping.items())
    parts = [_MARK, _HEADER]
    for start in range(0, len(items), 100):  # a bfchar block holds at most 100 entries
        chunk = items[start:start + 100]
        parts.append(b"%d beginbfchar\n" % len(chunk))
        for gid, cp in chunk:
            parts.append(b"<%04x> <%s>\n" % (gid, chr(cp).encode("utf-16-be").hex().encode()))
        parts.append(b"endbfchar\n")
    parts.append(_FOOTER)
    return b"".join(parts)


def fix_to_unicode(doc: pymupdf.Document, font_xref: int) -> None:
    """Rewrite the ToUnicode of a Type0/Identity-H font that TextWriter added (no-op otherwise, or
    when already done)."""
    if doc.xref_get_key(font_xref, "Subtype")[1] != "/Type0":
        return
    kind, value = doc.xref_get_key(font_xref, "ToUnicode")
    if kind != "xref":
        return
    cmap_xref = int(value.split()[0])
    if doc.xref_stream(cmap_xref).startswith(_MARK):
        return
    buffer = doc.extract_font(font_xref)[3]
    if not buffer:
        return
    doc.update_stream(cmap_xref, to_unicode_cmap(glyph_to_unicode(pymupdf.Font(fontbuffer=buffer))))
