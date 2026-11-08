# Task 4: Reuse cmap-less CID TrueType subsets; lock paragraphs in symbol fonts that can't be reused

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Owner feedback 2 ("saat edit teks fontnya malah berubah"): every embedded font of the reference (Dotum, DotumChe, Haansoft Batang, Times, Wingdings) is a Type0/CID TrueType subset without a cmap (as MS Word and Hancom export them), so `load_font` said not reusable and edits fell back to Arimo → Noto Sans → a MuPDF builtin for Hangul. The PDF still says which glyph shows which character: `edith/cid_fonts.py` parses the ToUnicode CMap (bfchar, bfrange incl. arrays), follows the CIDToGIDMap (Identity or stream) and rebuilds a Unicode cmap with fontTools (plus the `name`, `OS/2` and `post` tables browsers require; glyphs a subset emptied are left out; U+00A0/U+00AD also map U+0020/U+002D). `font_bytes`/`load_font` return the rebuilt program, so the same bytes are served by GET /fonts/{ref} (FontFace + fontkit) and used by TextWriter in the bake: same glyphs, same advances (they equal the PDF's /W widths), per-character coverage exactly the subset's. Symbol fonts (Wingdings, Symbol, ZapfDingbats …) are never substituted: reused when possible, otherwise their paragraph is `editable: false`. fontTools becomes a runtime dependency. Spike on the reference: GET /fonts serves all six programs, Chrome's FontFace and fontkit accept them; an unchanged edit in the fixture re-renders pixel-identical (< 1 % pixels differ).

**Files:**
- Create: `apps/api/edith/cid_fonts.py`
- Modify: `apps/api/edith/doc_fonts.py`
- Modify: `apps/api/edith/extract.py`
- Modify: `apps/api/edith/paragraphs.py`
- Modify: `apps/api/pyproject.toml`
- Modify: `apps/api/tests/pdfs.py`
- Modify: `apps/api/tests/test_bake_text_edit.py`
- Create: `apps/api/tests/test_cid_fonts.py`
- Modify: `apps/api/tests/test_doc_fonts.py`
- Modify: `apps/api/tests/test_text.py`
- Modify: `apps/api/uv.lock` (generated — see Step 3)

**Interfaces:**
- Consumes: M2 `doc_fonts.load_font`/`font_bytes`, `SourcePages.font`, `extract_text`.
- Produces: `edith.cid_fonts`: `parse_to_unicode(data) -> dict[int, str]`, `char_to_glyph(doc, xref) -> dict[int, int]`, `add_cmap(buf, mapping, family, bold=False, italic=False) -> bytes | None`; `doc_fonts.font_bytes` rebuilds when needed; `DocFont.symbolic`, `doc_fonts.is_symbolic(name)`; `extract_paragraphs(page, resolve=None, locked=None)` (`locked(span) -> bool` makes the paragraph non-editable); `tests.pdfs.make_cid_subset_pdf()`, `CID_TEXT`, `_renamed(buf, family)`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/pdfs.py`:

```diff
diff --git a/apps/api/tests/pdfs.py b/apps/api/tests/pdfs.py
index 9cee223..cacfc96 100644
--- a/apps/api/tests/pdfs.py
+++ b/apps/api/tests/pdfs.py
@@ -1,3 +1,4 @@
+import io
 from pathlib import Path
 
 import pymupdf
@@ -316,3 +317,36 @@ def make_form_table_pdf() -> bytes:
         for i, line in enumerate(lines):
             page.insert_text((x, 420 + 14 * i), line, fontname=font_name, fontsize=10)
     return doc.tobytes(garbage=3, deflate=True)
+
+
+CID_TEXT = "신청서 작성 방법 Visa Form"
+
+
+def _renamed(buf: bytes, family: str) -> bytes:
+    """A copy of TrueType `buf` whose name table says `family` (two copies of one program stay two fonts)."""
+    from fontTools.ttLib import TTFont
+    font = TTFont(io.BytesIO(buf))
+    for rec in font["name"].names:
+        if rec.nameID in (1, 3, 4, 6, 16):
+            rec.string = family.replace(" ", "") if rec.nameID in (3, 6) else family
+    out = io.BytesIO()
+    font.save(out)
+    return out.getvalue()
+
+
+def make_cid_subset_pdf() -> bytes:
+    """Text in cmap-less CID TrueType subsets, as MS Word and Hancom export them: Korean + Latin in a gothic font
+    named "Dotum" (line 1), the same in "Batang" (line 2) and two characters in "Wingdings" (line 3). All three
+    are Droid Sans Fallback (built into MuPDF) embedded by insert_font, then subset by PyMuPDF, which drops the
+    cmap and keeps ToUnicode and CIDToGIDMap; the BaseFont names are set afterwards."""
+    doc = pymupdf.open()
+    page = doc.new_page(width=595, height=842)
+    droid = pymupdf.Font("korea").buffer
+    for i, (tag, name, text) in enumerate([("DO", "Dotum", CID_TEXT), ("BA", "Batang", CID_TEXT), ("WI", "Wingdings", "èô")]):
+        page.insert_font(fontname=tag, fontbuffer=_renamed(droid, name))  # short: MuPDF cuts span font names
+        page.insert_text((72, 100 + 30 * i), text, fontname=tag, fontsize=12)
+    doc.subset_fonts()
+    for xref, _ext, _type, basefont, *_rest in page.get_fonts(full=True):
+        name = next(n for n in ("Dotum", "Batang", "Wingdings") if n in basefont)
+        doc.xref_set_key(xref, "BaseFont", f"/EDITHA+{name}")
+    return doc.tobytes(garbage=3, deflate=True)
```

Modify `apps/api/tests/test_bake_text_edit.py`:

```diff
diff --git a/apps/api/tests/test_bake_text_edit.py b/apps/api/tests/test_bake_text_edit.py
index 2b6b2c1..fd6256e 100644
--- a/apps/api/tests/test_bake_text_edit.py
+++ b/apps/api/tests/test_bake_text_edit.py
@@ -4,11 +4,11 @@ import pytest
 from edith.bake import bake
 from edith.bake.context import BakeContext
 from edith.doc_fonts import collect_fonts
-from edith.errors import InvalidOp
+from edith.errors import BakeFailed, InvalidOp
 from edith.fonts import FontRegistry
 from edith.ops import ExportRequest
 from edith.settings import Settings
-from tests.pdfs import SUBSET_TTF, make_edit_pdf, make_fonts_pdf
+from tests.pdfs import CID_TEXT, SUBSET_TTF, make_cid_subset_pdf, make_edit_pdf, make_fonts_pdf
 
 DOC = "D" * 22
 ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}
@@ -125,3 +125,29 @@ def test_links_over_the_edited_paragraph_survive(ctx):
                    (pymupdf.LINK_URI, "https://contoh.id/a(b)", None, (72, 88, 250, 104)),
                    (pymupdf.LINK_URI, "https://lain.id", None, (400, 700, 450, 720))]
     assert "Teks baru" in text(out[0])
+
+
+def cid_font_ref(data: bytes, name: str) -> dict:
+    fonts = collect_fonts(pymupdf.open(stream=data, filetype="pdf")).values()
+    return {"kind": "original", "ref": next(f.ref for f in fonts if f.name == name)}
+
+
+def test_unchanged_edit_in_a_cmapless_cid_subset_redraws_the_line_like_the_original(ctx):
+    """MS Word / Hancom subsets have no cmap: the bake reuses them with one rebuilt from ToUnicode, so the same
+    text at the same place renders the same glyphs with the same advances."""
+    data = make_cid_subset_pdf()
+    clip = pymupdf.Rect(60, 84, 320, 106)
+    before = pymupdf.open(stream=data, filetype="pdf")[0].get_pixmap(dpi=144, clip=clip)
+    out = reload(bake(data, ops(edit(text=CID_TEXT, font=cid_font_ref(data, "Dotum"), y=88)), ctx))
+    after = out[0].get_pixmap(dpi=144, clip=clip)
+    changed = sum(a != b for a, b in zip(before.samples, after.samples))
+    assert changed / len(before.samples) < 0.01
+    span = next(s for s in spans(out[0]) if round(s["origin"][1]) == 100)
+    assert span["text"] == CID_TEXT and "Dotum" in span["font"]
+    assert text(out[0]).count(CID_TEXT) == 2  # the edited line and the Batang line below it
+
+
+def test_characters_missing_from_a_reused_subset_fail_the_bake(ctx):
+    data = make_cid_subset_pdf()
+    with pytest.raises(BakeFailed):  # the client sends them in a fallback font, never in the subset
+        bake(data, ops(edit(text="가나다", font=cid_font_ref(data, "Dotum"), y=88)), ctx)
```

Create `apps/api/tests/test_cid_fonts.py`:

```python
import io

import pymupdf
import pytest
from fontTools.ttLib import TTFont

from edith.cid_fonts import add_cmap, char_to_glyph, parse_to_unicode
from tests.pdfs import CID_TEXT, make_cid_subset_pdf, make_fonts_pdf

CMAP = b"""/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
3 beginbfchar
<0003> <0041>
<0004> <c2e0>
<0005> <00660069>
endbfchar
2 beginbfrange
<0010> <0012> <0061>
<0020> <0021> [<ac00> <zz>]
endbfrange
endcmap"""


def test_parse_to_unicode():
    assert parse_to_unicode(CMAP) == {3: "A", 4: "신", 5: "fi", 0x10: "a", 0x11: "b", 0x12: "c", 0x20: "가"}


def doc_and_font(name: str) -> tuple[pymupdf.Document, int]:
    doc = pymupdf.open(stream=make_cid_subset_pdf(), filetype="pdf")
    xref = next(e[0] for e in doc[0].get_fonts(full=True) if e[3].endswith(name))
    return doc, xref


def test_char_to_glyph_reads_tounicode_and_identity_gids():
    doc, xref = doc_and_font("Dotum")
    mapping = char_to_glyph(doc, xref)
    # PyMuPDF keeps the whole ToUnicode of the subset font (its dropped glyphs are empty, see add_cmap).
    assert {ord(c) for c in CID_TEXT} <= set(mapping)
    assert all(gid > 0 for gid in mapping.values())
    helvetica = pymupdf.open(stream=make_fonts_pdf(), filetype="pdf")
    assert char_to_glyph(helvetica, helvetica[0].get_fonts(full=True)[0][0]) == {}  # not Type0


def test_char_to_glyph_follows_a_cidtogidmap_stream():
    doc, xref = doc_and_font("Dotum")
    identity = char_to_glyph(doc, xref)
    cid_font = int(doc.xref_get_key(xref, "DescendantFonts")[1].strip("[]").split()[0])
    a, b = identity[ord("V")], identity[ord("F")]
    table = bytearray(b"".join(i.to_bytes(2, "big") for i in range(max(identity.values()) + 1)))
    table[2 * a:2 * a + 2], table[2 * b:2 * b + 2] = b.to_bytes(2, "big"), a.to_bytes(2, "big")  # swap V and F
    stream = doc.get_new_xref()
    doc.update_object(stream, "<<>>")
    doc.update_stream(stream, bytes(table))
    doc.xref_set_key(cid_font, "CIDToGIDMap", f"{stream} 0 R")
    swapped = char_to_glyph(doc, xref)
    assert (swapped[ord("V")], swapped[ord("F")]) == (b, a)


def test_add_cmap_covers_exactly_the_subset_and_keeps_advances():
    doc, xref = doc_and_font("Dotum")
    buf = doc.extract_font(xref)[3]
    rebuilt = TTFont(io.BytesIO(add_cmap(buf, char_to_glyph(doc, xref), "Edith Original 5")))
    drawn = {cp for cp in rebuilt.getBestCmap() if not chr(cp).isspace()}
    assert drawn == {ord(c) for c in CID_TEXT if c != " "}  # glyphs the subset kept (+ spaces, which are empty)
    assert {"name", "OS/2", "post"} <= set(rebuilt.keys())
    original = TTFont(io.BytesIO(buf))
    assert ([rebuilt["hmtx"][g] for g in rebuilt.getGlyphOrder()]
            == [original["hmtx"][g] for g in original.getGlyphOrder()])  # same advances, glyph for glyph
    font = pymupdf.Font(fontbuffer=add_cmap(buf, char_to_glyph(doc, xref), "Edith Original 5"))
    # Glyph advances are the ones the PDF shows the original text with.
    chars = [c for b in doc[0].get_text("rawdict")["blocks"] for ln in b["lines"][:1] for s in ln["spans"]
             for c in s["chars"]][:len(CID_TEXT)]
    for c in chars:
        assert font.text_length(c["c"], 12) == pytest.approx(c["bbox"][2] - c["bbox"][0], abs=0.01)


def test_add_cmap_needs_a_glyph_and_a_readable_program():
    doc, xref = doc_and_font("Dotum")
    assert add_cmap(doc.extract_font(xref)[3], {}, "X") is None
    assert add_cmap(b"not a font", {65: 1}, "X") is None
```

Modify `apps/api/tests/test_doc_fonts.py`:

```diff
diff --git a/apps/api/tests/test_doc_fonts.py b/apps/api/tests/test_doc_fonts.py
index 9975c86..553afe6 100644
--- a/apps/api/tests/test_doc_fonts.py
+++ b/apps/api/tests/test_doc_fonts.py
@@ -3,7 +3,7 @@ import pymupdf
 from edith.doc_fonts import collect_fonts, fill_substitutes, load_font, name_key, span_fonts
 from edith.fonts import FontRegistry
 from edith.settings import Settings
-from tests.pdfs import make_fonts_pdf, make_pymupdf_subset_pdf, rename_font
+from tests.pdfs import make_cid_subset_pdf, make_fonts_pdf, make_pymupdf_subset_pdf, rename_font
 
 
 def fonts_of(data: bytes):
@@ -33,10 +33,18 @@ def test_font_table_per_kind():
     assert f["Courier"].family == "courier"
 
 
-def test_pymupdf_subset_has_no_cmap():
-    _, fonts = fonts_of(make_pymupdf_subset_pdf())
+def test_pymupdf_subset_gets_a_rebuilt_cmap():
+    doc, fonts = fonts_of(make_pymupdf_subset_pdf())
     (font,) = fonts.values()
-    assert (font.name, font.format, font.reusable) == ("Cousine Regular", "ttf", False)
+    assert (font.name, font.format, font.reusable) == ("Cousine Regular", "ttf", True)
+    rebuilt = load_font(doc, font.xref)
+    assert all(rebuilt.has_glyph(ord(c)) for c in "Cousine subset")
+    assert not rebuilt.has_glyph(ord("X"))  # only what the subset kept
+
+
+def test_symbol_fonts_are_flagged():
+    _, fonts = fonts_of(make_cid_subset_pdf())
+    assert {f.name: f.symbolic for f in fonts.values()} == {"Dotum": False, "Batang": False, "Wingdings": True}
 
 
 def test_every_span_maps_to_its_font():
@@ -56,7 +64,7 @@ def test_load_font_only_for_reusable_programs():
     assert load_font(doc, f["Courier"].xref) is None
     assert load_font(doc, f["Helvetica"].xref) is None
     doc, fonts = fonts_of(make_pymupdf_subset_pdf())
-    assert load_font(doc, next(iter(fonts))) is None
+    assert load_font(doc, next(iter(fonts))).has_glyph(ord("C"))  # cmap rebuilt from ToUnicode
 
 
 def test_ambiguous_names_map_to_none():
```

Modify `apps/api/tests/test_text.py`:

```diff
diff --git a/apps/api/tests/test_text.py b/apps/api/tests/test_text.py
index 2def836..c77729c 100644
--- a/apps/api/tests/test_text.py
+++ b/apps/api/tests/test_text.py
@@ -1,6 +1,10 @@
+import io
+
 import pymupdf
+from fontTools.ttLib import TTFont
 
-from tests.pdfs import make_fonts_pdf, make_paragraphs_pdf, make_pdf, make_pymupdf_subset_pdf, rename_font
+from tests.pdfs import (CID_TEXT, make_cid_subset_pdf, make_fonts_pdf, make_paragraphs_pdf, make_pdf,
+                        make_pymupdf_subset_pdf, rename_font)
 from tests.test_documents import upload
 
 ARIMO = {"kind": "bundled", "family": "Arimo", "bold": False, "italic": False}
@@ -44,11 +48,35 @@ def test_runs_use_original_fonts_only_when_reusable(client):
     assert run_font(body, "Courier CFF")["family"] == "Cousine"
 
 
-def test_pymupdf_subset_without_cmap_is_not_reusable(client):
+def test_pymupdf_subset_without_cmap_is_reusable(client):
     body = text_of(client, make_pymupdf_subset_pdf())
     font = by_name(body)["Cousine Regular"]
-    assert (font["format"], font["reusable"]) == ("ttf", False)
-    assert body["pages"][0]["paragraphs"][0]["runs"][0]["text"] == "Cousine subset"  # nbsp → space
+    assert (font["format"], font["reusable"]) == ("ttf", True)  # cmap rebuilt from ToUnicode
+    run = body["pages"][0]["paragraphs"][0]["runs"][0]
+    assert run == run | {"text": "Cousine subset", "font": {"kind": "original", "ref": font["ref"]}}  # nbsp → space
+
+
+def test_cid_subsets_are_reused_and_served_with_a_cmap(client):
+    body = text_of(client, make_cid_subset_pdf())
+    f = by_name(body)
+    assert [f[n]["reusable"] for n in ("Dotum", "Batang", "Wingdings")] == [True, True, True]
+    paragraphs = body["pages"][0]["paragraphs"]
+    assert [p["runs"][0]["font"] for p in paragraphs] == [
+        {"kind": "original", "ref": f[n]["ref"]} for n in ("Dotum", "Batang", "Wingdings")]
+    assert all(p["editable"] for p in paragraphs)  # Wingdings too: its own glyphs are reused
+    r = client.get(f"/documents/{body['doc_id']}/fonts/{f['Dotum']['ref']}")
+    assert r.status_code == 200 and r.headers["content-type"] == "font/ttf"
+    cmap = TTFont(io.BytesIO(r.content)).getBestCmap()
+    assert {ord(c) for c in CID_TEXT} <= set(cmap)
+
+
+def test_text_in_a_symbol_font_that_cant_be_reused_is_not_editable(client):
+    doc = pymupdf.open()
+    page = doc.new_page()
+    page.insert_text((72, 100), "abc", fontname="zadb", fontsize=12)  # ZapfDingbats, not embedded
+    page.insert_text((72, 140), "Teks biasa", fontname="helv", fontsize=12)
+    body = text_of(client, doc.tobytes())
+    assert [p["editable"] for p in body["pages"][0]["paragraphs"]] == [False, True]
 
 
 def test_calibri_maps_to_carlito(client):
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_cid_fonts.py tests/test_doc_fonts.py tests/test_text.py tests/test_bake_text_edit.py`

Expected: FAIL — `edith.cid_fonts` is missing and the subsets are not reusable. Spike output (last lines):

```
==================================== ERRORS ====================================
___________________ ERROR collecting tests/test_cid_fonts.py ___________________
ImportError while importing test module '<repo>/apps/api/tests/test_cid_fonts.py'.
E   ModuleNotFoundError: No module named 'edith.cid_fonts'
ERROR tests/test_cid_fonts.py
```

- [ ] **Step 3: Implement**

First make fontTools a runtime dependency (it was dev-only): `cd apps/api && uv remove --dev fonttools && uv add "fonttools>=4.50"`, then keep the dev group on one line as in the diff below (`uv.lock` changes by two lines).

Create `apps/api/edith/cid_fonts.py`:

```python
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
```

Modify `apps/api/edith/doc_fonts.py`:

```diff
diff --git a/apps/api/edith/doc_fonts.py b/apps/api/edith/doc_fonts.py
index 40ae1ce..5bb7dbe 100644
--- a/apps/api/edith/doc_fonts.py
+++ b/apps/api/edith/doc_fonts.py
@@ -5,11 +5,14 @@ from dataclasses import dataclass
 
 import pymupdf
 
+from edith.cid_fonts import add_cmap, char_to_glyph
 from edith.fonts import FontRegistry, base_font_name, parse_font_name
 
 # pymupdf extract_font() extensions → spec font formats.
 _FORMATS = {"ttf": "ttf", "otf": "otf", "cff": "cff", "cid": "cff", "pfa": "type1", "pfb": "type1"}
 _SAMPLE = [ord(c) for c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"]
+# Symbol and dingbat fonts: their characters only look right in the font itself (never substituted).
+_SYMBOL_NAMES = ("wingdings", "webdings", "symbol", "zapfdingbats", "dingbats", "marlett", "mtextra")
 
 
 @dataclass
@@ -23,6 +26,7 @@ class DocFont:
     bold: bool
     italic: bool
     keys: frozenset[str] = frozenset()  # name_key() of the BaseFont and of the embedded program's name
+    symbolic: bool = False  # a symbol / dingbat font (Wingdings, Symbol, ZapfDingbats …)
     substitute: dict | None = None  # bundled FontRef JSON; filled by the text extraction
 
     @property
@@ -37,14 +41,21 @@ class DocFont:
         }
 
 
+def is_symbolic(name: str) -> bool:
+    key = name_key(name)
+    return any(w in key for w in _SYMBOL_NAMES)
+
+
 def name_key(name: str) -> str:
     """Comparable form of a font name: span names come from the font program (`Arimo-Regular`)
     while BaseFont may differ in punctuation (`ABCDEF+Arimo Regular`)."""
     return re.sub(r"[^a-z0-9]", "", base_font_name(name).lower())
 
 
-def load_font(doc: pymupdf.Document, xref: int) -> pymupdf.Font | None:
-    """The embedded TTF/OTF program of font `xref` if it can draw new text (has a Unicode cmap), else None."""
+def font_bytes(doc: pymupdf.Document, xref: int) -> tuple[bytes, str] | None:
+    """(bytes, "ttf"|"otf") of the embedded program of font `xref` if it can draw new text, else None: as
+    embedded when it has a Unicode cmap; a CID TrueType subset without one gets a cmap rebuilt from the PDF's
+    ToUnicode and CIDToGIDMap (edith.cid_fonts), which covers exactly the characters the subset has."""
     try:
         _name, ext, _type, buf = doc.extract_font(xref)
     except Exception:  # noqa: BLE001 - unreadable font object
@@ -55,15 +66,20 @@ def load_font(doc: pymupdf.Document, xref: int) -> pymupdf.Font | None:
         font = pymupdf.Font(fontbuffer=buf)
     except Exception:  # noqa: BLE001
         return None
-    return font if any(font.has_glyph(c) for c in _SAMPLE) else None
+    if any(font.has_glyph(c) for c in _SAMPLE):
+        return buf, ext
+    if ext == "ttf":
+        _family, bold, italic = parse_font_name(base_font_name(doc.xref_get_key(xref, "BaseFont")[1].lstrip("/")))
+        rebuilt = add_cmap(buf, char_to_glyph(doc, xref), f"Edith Original {xref}", bold, italic)
+        if rebuilt is not None:
+            return rebuilt, "ttf"
+    return None
 
 
-def font_bytes(doc: pymupdf.Document, xref: int) -> tuple[bytes, str] | None:
-    """(bytes, "ttf"|"otf") of a reusable font, else None."""
-    if load_font(doc, xref) is None:
-        return None
-    _name, ext, _type, buf = doc.extract_font(xref)
-    return buf, ext
+def load_font(doc: pymupdf.Document, xref: int) -> pymupdf.Font | None:
+    """The program font_bytes() returns, loaded, else None."""
+    found = font_bytes(doc, xref)
+    return pymupdf.Font(fontbuffer=found[0]) if found else None
 
 
 def _doc_font(doc: pymupdf.Document, entry: tuple) -> DocFont:
@@ -81,7 +97,7 @@ def _doc_font(doc: pymupdf.Document, entry: tuple) -> DocFont:
             pass
     reusable = fmt in ("ttf", "otf") and load_font(doc, xref) is not None
     return DocFont(xref=xref, name=name, embedded=embedded, format=fmt, reusable=reusable,
-                   family=family, bold=bold, italic=italic, keys=frozenset(keys))
+                   family=family, bold=bold, italic=italic, keys=frozenset(keys), symbolic=is_symbolic(name))
 
 
 def collect_fonts(doc: pymupdf.Document) -> dict[int, DocFont]:
```

Modify `apps/api/edith/extract.py`:

```diff
diff --git a/apps/api/edith/extract.py b/apps/api/edith/extract.py
index 54112cf..effee5a 100644
--- a/apps/api/edith/extract.py
+++ b/apps/api/edith/extract.py
@@ -1,6 +1,6 @@
 import pymupdf
 
-from edith.doc_fonts import collect_fonts, fill_substitutes, name_key, span_fonts
+from edith.doc_fonts import collect_fonts, fill_substitutes, is_symbolic, name_key, span_fonts
 from edith.errors import PdfCorrupt, PdfEncrypted, TooLarge
 from edith.fonts import FontRegistry
 from edith.forms import extract_fields
@@ -46,7 +46,8 @@ def extract_structure(doc: pymupdf.Document) -> dict:
 
 def extract_text(doc: pymupdf.Document, registry: FontRegistry) -> dict:
     """Paragraphs of every page plus the fonts they use. A run whose font is reusable gets
-    `{"kind": "original", "ref"}`; any other run gets its bundled substitute."""
+    `{"kind": "original", "ref"}`; any other run gets its bundled substitute. A paragraph with text in a
+    symbol font that can't be reused is not editable: no other font draws its characters."""
     fonts = collect_fonts(doc)
     pages = []
     for page in doc:
@@ -60,6 +61,10 @@ def extract_text(doc: pymupdf.Document, registry: FontRegistry) -> dict:
                 font.substitute = registry.substitute(font.name, span["flags"])
             return {"kind": "original", "ref": font.ref} if font.reusable else dict(font.substitute)
 
-        pages.append({"index": page.number, "paragraphs": extract_paragraphs(page, resolve)})
+        def locked(span: dict, by_name=by_name) -> bool:
+            font = by_name.get(name_key(span["font"]))
+            return not font.reusable and font.symbolic if font is not None else is_symbolic(span["font"])
+
+        pages.append({"index": page.number, "paragraphs": extract_paragraphs(page, resolve, locked)})
     fill_substitutes(fonts, registry)
     return {"pages": pages, "fonts": [f.to_json() for f in fonts.values()]}
```

Modify `apps/api/edith/paragraphs.py`:

```diff
diff --git a/apps/api/edith/paragraphs.py b/apps/api/edith/paragraphs.py
index c0edc1f..c4f1c15 100644
--- a/apps/api/edith/paragraphs.py
+++ b/apps/api/edith/paragraphs.py
@@ -25,6 +25,7 @@ HANG_EM = 0.3       # a list item's next line must start this far right of its b
 TAB_GAP = "   "      # a line with this many spaces in a row is laid out with spaces (form rows, columns), not prose
 
 FontResolver = Callable[[dict], dict]  # pymupdf span → FontRef JSON
+SpanCheck = Callable[[dict], bool]     # pymupdf span → True when the paragraph holding it can't be edited
 
 
 @dataclass
@@ -248,7 +249,7 @@ def _color(c: int) -> str:
     return f"#{c & 0xFFFFFF:06x}"
 
 
-def _paragraph(pid: str, lines: list[_Line], resolve: FontResolver | None) -> dict:
+def _paragraph(pid: str, lines: list[_Line], resolve: FontResolver | None, locked: SpanCheck | None = None) -> dict:
     runs: list[dict] = []
     out_lines: list[dict] = []
     offset = 0
@@ -293,7 +294,8 @@ def _paragraph(pid: str, lines: list[_Line], resolve: FontResolver | None) -> di
         "runs": runs,
         "align": _align(lines),
         "lineHeight": line_height,
-        "editable": all(line.horizontal for line in lines),
+        "editable": all(line.horizontal for line in lines)
+                    and not (locked and any(locked(s) for line in lines for s in line.spans)),
     }
 
 
@@ -305,10 +307,12 @@ def _rect(x0: float, y0: float, x1: float, y1: float) -> dict:
     return {"x": _num(x0), "y": _num(y0), "w": _num(x1 - x0), "h": _num(y1 - y0)}
 
 
-def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None) -> list[dict]:
+def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None,
+                       locked: SpanCheck | None = None) -> list[dict]:
     """Paragraphs of `page` in content order, ids `g0`, `g1`, … (stable for a given file and extraction
     version). Coordinates are unrotated-CropBox points. `resolve` maps a span to its run FontRef (None →
-    runs get font None). Text is never merged across a drawn rule (table borders, separators)."""
+    runs get font None); a paragraph with a span `locked` accepts is not editable. Text is never merged
+    across a drawn rule (table borders, separators)."""
     rules = page_rules(page)
     blocks: list[list[_Line]] = []
     for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
@@ -329,5 +333,5 @@ def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None)
     paragraphs: list[dict] = []
     for lines in blocks:
         for group in _split(lines, rules):
-            paragraphs.append(_paragraph(f"g{len(paragraphs)}", group, resolve))
+            paragraphs.append(_paragraph(f"g{len(paragraphs)}", group, resolve, locked))
     return paragraphs
```

Modify `apps/api/pyproject.toml`:

```diff
diff --git a/apps/api/pyproject.toml b/apps/api/pyproject.toml
index 1508636..1965737 100644
--- a/apps/api/pyproject.toml
+++ b/apps/api/pyproject.toml
@@ -9,10 +9,11 @@ dependencies = [
   "pymupdf>=1.26",
   "pydantic>=2.8",
   "pydantic-settings>=2.4",
+  "fonttools>=4.50",
 ]
 
 [dependency-groups]
-dev = ["pytest>=8", "httpx2>=2.16", "fonttools>=4.50"]
+dev = ["pytest>=8", "httpx2>=2.16"]
 
 [tool.uv]
 package = false
```

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q` → 395 passed.

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add apps/api/edith/cid_fonts.py apps/api/edith/doc_fonts.py apps/api/edith/extract.py apps/api/edith/paragraphs.py apps/api/pyproject.toml apps/api/tests/pdfs.py apps/api/tests/test_bake_text_edit.py apps/api/tests/test_cid_fonts.py apps/api/tests/test_doc_fonts.py apps/api/tests/test_text.py apps/api/uv.lock
git commit -m "feat(api): reuse cmap-less CID TrueType subsets via a cmap rebuilt from ToUnicode; lock symbol-font paragraphs" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
