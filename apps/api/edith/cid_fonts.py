"""Embedded CID TrueType subsets without a cmap (MS Word and Hancom exports, e.g. Dotum or Batang in Korean
forms) can't draw new text as they are: nothing maps a character to a glyph. The PDF still says which glyph
shows which character: the CIDToGIDMap maps a code to a glyph and the ToUnicode CMap maps it to text. This
module rebuilds a Unicode cmap from them (plus the name, OS/2 and post tables browsers require), so the font
can be served to the browser and used by TextWriter like any embedded TrueType font with a cmap."""
import io
import re
import unicodedata

import pymupdf
from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib import TTFont

_BFCHAR = re.compile(rb"beginbfchar(.*?)endbfchar", re.S)
_BFRANGE = re.compile(rb"beginbfrange(.*?)endbfrange", re.S)
_HEX = re.compile(rb"<([0-9A-Fa-f]*)>")
# A glyph whose ToUnicode says no-break space or soft hyphen (MuPDF writes those for the space and hyphen of
# many fonts, see edith.bake.tounicode) also draws the plain character.
_ALIASES = {0xA0: 0x20, 0xAD: 0x2D}
_RANGE = re.compile(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])")


def _text(hex_digits: bytes) -> str | None:
    """A ToUnicode destination (UTF-16BE hex) as a string; None when it is not valid UTF-16."""
    try:
        return bytes.fromhex(hex_digits.decode()).decode("utf-16-be")
    except (ValueError, UnicodeDecodeError):
        return None


def parse_to_unicode(data: bytes) -> dict[int, str]:
    """code → text of a ToUnicode CMap (bfchar and bfrange entries; ranges with a destination array too)."""
    out: dict[int, str] = {}
    for block in _BFCHAR.findall(data):
        codes = _HEX.findall(block)
        for src, dst in zip(codes[0::2], codes[1::2]):
            text = _text(dst)
            if src and text:
                out[int(src, 16)] = text
    for block in _BFRANGE.findall(data):
        for lo, hi, dst in _RANGE.findall(block):
            start, end = int(lo, 16), int(hi, 16)
            if end < start or end - start > 0xFFFF:
                continue
            if dst.startswith(b"["):
                for code, item in zip(range(start, end + 1), _HEX.findall(dst)):
                    text = _text(item)
                    if text:
                        out[code] = text
                continue
            base = _text(dst[1:-1])
            if not base:
                continue
            for i in range(end - start + 1):
                out[start + i] = base[:-1] + chr(ord(base[-1]) + i)
    return out


def _stream_of(doc: pymupdf.Document, xref: int, key: str) -> bytes | None:
    kind, value = doc.xref_get_key(xref, key)
    return doc.xref_stream(int(value.split()[0])) if kind == "xref" else None


def _descendant(doc: pymupdf.Document, xref: int) -> int | None:
    kind, value = doc.xref_get_key(xref, "DescendantFonts")
    if kind == "xref":  # an indirect array
        value = doc.xref_object(int(value.split()[0]), compressed=True)
    m = re.search(r"(\d+) 0 R", value or "")
    return int(m.group(1)) if m else None


def char_to_glyph(doc: pymupdf.Document, xref: int) -> dict[int, int]:
    """Unicode code point → glyph id of Type0 font `xref` (Identity-H/V encoding: codes are CIDs), from its
    ToUnicode CMap and CIDToGIDMap. Codes mapping to more than one character (ligatures), to control
    characters or to noncharacters are left out; when several codes map to one character the first wins."""
    if doc.xref_get_key(xref, "Subtype")[1] != "/Type0" or doc.xref_get_key(xref, "Encoding")[1] not in (
            "/Identity-H", "/Identity-V"):
        return {}
    to_unicode = _stream_of(doc, xref, "ToUnicode")
    cid_font = _descendant(doc, xref)
    if not to_unicode or cid_font is None or doc.xref_get_key(cid_font, "Subtype")[1] != "/CIDFontType2":
        return {}
    gid_map = _stream_of(doc, cid_font, "CIDToGIDMap")  # None: /Identity (or absent, which means the same)
    out: dict[int, int] = {}
    for cid, text in sorted(parse_to_unicode(to_unicode).items()):
        if len(text) != 1:
            continue
        cp = ord(text)
        if cp < 0x20 or 0x7F <= cp < 0xA0 or cp in (0xFFFE, 0xFFFF) or 0xD800 <= cp <= 0xDFFF:
            continue
        if gid_map is not None:
            if 2 * cid + 2 > len(gid_map):
                continue
            gid = int.from_bytes(gid_map[2 * cid:2 * cid + 2], "big")
        else:
            gid = cid
        if gid and cp not in out:
            out[cp] = gid
    return out


def add_cmap(buf: bytes, mapping: dict[int, int], family: str, bold: bool = False, italic: bool = False) -> bytes | None:
    """The TrueType program `buf` with a Unicode cmap built from `mapping` (code point → glyph id; empty glyphs
    left out, but spaces) and the name, OS/2 and post tables it lacks. None when the program can't be read or no
    glyph is left."""
    try:
        font = TTFont(io.BytesIO(buf))
        order = font.getGlyphOrder()
    except Exception:  # noqa: BLE001 - not a TrueType program fontTools can read
        return None
    glyf = font["glyf"] if "glyf" in font else None

    def drawn(cp: int, name: str) -> bool:
        # A subset that keeps glyph ids empties the glyphs it dropped; their ToUnicode entries may remain.
        return glyf is None or glyf[name].numberOfContours != 0 or unicodedata.category(chr(cp)) == "Zs"
    cmap = {cp: order[gid] for cp, gid in mapping.items() if 0 < gid < len(order) and drawn(cp, order[gid])}
    for alias, cp in _ALIASES.items():  # text read back as U+00A0 / U+00AD was typed as a space / hyphen
        if alias in cmap and cp not in cmap:
            cmap[cp] = cmap[alias]
    if not cmap:
        return None
    fb = FontBuilder(font=font)
    fb.setupCharacterMap(cmap)
    style = {(False, False): "Regular", (True, False): "Bold", (False, True): "Italic", (True, True): "Bold Italic"}[(bold, italic)]
    if "name" not in font:
        fb.setupNameTable({"familyName": family, "styleName": style})
    if "OS/2" not in font:
        hhea = font["hhea"]
        fb.setupOS2(sTypoAscender=hhea.ascent, sTypoDescender=hhea.descent, sTypoLineGap=hhea.lineGap,
                    usWinAscent=max(hhea.ascent, 0), usWinDescent=max(-hhea.descent, 0),
                    usWeightClass=700 if bold else 400, fsType=0,
                    fsSelection=(0x20 if bold else 0) | (0x01 if italic else 0) or 0x40)
        font["OS/2"].recalcAvgCharWidth(font)
        font["OS/2"].recalcUnicodeRanges(font)
        font["OS/2"].recalcCodePageRanges(font)
    if "post" not in font:
        fb.setupPost(keepGlyphNames=False)
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()
