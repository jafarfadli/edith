# Task 3: Document fonts — table, reusability, span → font

**Files:**
- Create: `apps/api/edith/doc_fonts.py`, `apps/api/tests/test_doc_fonts.py`, `apps/api/tests/fixtures/TinosSubset.ttf` (generated, committed)
- Modify: `apps/api/tests/pdfs.py` (font fixtures)

**Interfaces:**
- Consumes: Task 1 `FontRegistry.substitute`, `base_font_name`, `parse_font_name`.
- Produces (`edith.doc_fonts`):
  ```python
  @dataclass
  class DocFont:
      xref: int; name: str; embedded: bool; format: str | None  # ttf|otf|cff|type1|type3|None
      reusable: bool; family: str; bold: bool; italic: bool
      keys: frozenset[str]          # name_key() of BaseFont and of the embedded program name
      substitute: dict | None       # bundled FontRef JSON, filled during text extraction
      ref: str  (property, f"f{xref}")
      def to_json(self) -> dict     # {ref, name, embedded, format, reusable, family, bold, italic, substitute}
  def name_key(name: str) -> str
  def load_font(doc, xref: int) -> pymupdf.Font | None        # only reusable programs
  def font_bytes(doc, xref: int) -> tuple[bytes, str] | None  # (bytes, "ttf"|"otf") of a reusable font
  def collect_fonts(doc) -> dict[int, DocFont]
  def span_fonts(page, fonts: dict[int, DocFont]) -> dict[str, DocFont | None]  # name_key(span font) → font; None = ambiguous
  def fill_substitutes(fonts: dict[int, DocFont], registry: FontRegistry) -> None
  ```
- Produces (`tests.pdfs`): `FONT_FILES`, `FIXTURES`, `SUBSET_TTF`, `make_fonts_pdf()`, `make_pymupdf_subset_pdf()`, `rename_font(data, old, new)`.

- [ ] **Step 1: Subset font fixture**

Run (repo root): `mkdir -p apps/api/tests/fixtures && uvx --from fonttools pyftsubset packages/fonts/files/Tinos-Regular.ttf --text="Subset paragraph lorem ipsum dolor sit amet" --output-file=apps/api/tests/fixtures/TinosSubset.ttf`
Expected: a ~8 KB `TinosSubset.ttf` (fontTools keeps the cmap, unlike PyMuPDF's own subsetting).

- [ ] **Step 2: Fixture PDFs**

In `apps/api/tests/pdfs.py` add `from pathlib import Path` above `import pymupdf` (blank line between) and append:
```python


FONT_FILES = Path(__file__).resolve().parents[3] / "packages" / "fonts" / "files"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SUBSET_TTF = FIXTURES / "TinosSubset.ttf"  # fontTools subset of Tinos-Regular: keeps its cmap


def make_fonts_pdf() -> bytes:
    """One line per font kind: standard-14 (not embedded), embedded full TTF, embedded subset TTF
    with a cmap, embedded bare CFF."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Standard Helvetica line", fontname="helv", fontsize=12)
    page.insert_text((72, 140), "Standard Times line", fontname="tiro", fontsize=12)
    page.insert_font(fontname="FA", fontfile=str(FONT_FILES / "Arimo-Regular.ttf"))
    page.insert_text((72, 180), "Embedded Arimo line", fontname="FA", fontsize=12)
    page.insert_font(fontname="FS", fontfile=str(SUBSET_TTF))
    page.insert_text((72, 220), "Subset lorem ipsum", fontname="FS", fontsize=12)
    writer = pymupdf.TextWriter(page.rect)
    writer.append((72, 260), "Courier CFF line", font=pymupdf.Font("cour"), fontsize=12)
    writer.write_text(page)
    return doc.tobytes(garbage=3, deflate=True)


def make_pymupdf_subset_pdf() -> bytes:
    """An embedded TTF subset by PyMuPDF: it has no cmap, so it can't be reused."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname="FC", fontfile=str(FONT_FILES / "Cousine-Regular.ttf"))
    page.insert_text((72, 100), "Cousine subset", fontname="FC", fontsize=12)
    doc.subset_fonts()
    return doc.tobytes(garbage=3, deflate=True)


def rename_font(data: bytes, old: str, new: str) -> bytes:
    """Rename the BaseFont of the font called `old` (e.g. make a standard-14 Helvetica look like Calibri)."""
    doc = pymupdf.open(stream=data, filetype="pdf")
    for xref, *_rest in doc[0].get_fonts(full=True):
        if doc.xref_get_key(xref, "BaseFont")[1] == f"/{old}":
            doc.xref_set_key(xref, "BaseFont", f"/{new}")
    return doc.tobytes()
```

- [ ] **Step 3: Failing tests**

`apps/api/tests/test_doc_fonts.py`:
```python
import pymupdf

from edith.doc_fonts import collect_fonts, fill_substitutes, load_font, name_key, span_fonts
from edith.fonts import FontRegistry
from edith.settings import Settings
from tests.pdfs import make_fonts_pdf, make_pymupdf_subset_pdf, rename_font


def fonts_of(data: bytes):
    doc = pymupdf.open(stream=data, filetype="pdf")
    return doc, collect_fonts(doc)


def by_name(fonts) -> dict:
    return {f.name: f for f in fonts.values()}


def test_name_key():
    assert name_key("ABCDEF+Arimo Regular") == name_key("Arimo-Regular") == "arimoregular"


def test_font_table_per_kind():
    _, fonts = fonts_of(make_fonts_pdf())
    f = by_name(fonts)
    assert [(n, f[n].embedded, f[n].format, f[n].reusable) for n in f] == [
        ("Helvetica", False, None, False),
        ("Times-Roman", False, None, False),
        ("Arimo Regular", True, "ttf", True),
        ("Tinos Regular", True, "ttf", True),   # subset with a cmap
        ("Courier", True, "cff", False),        # bare CFF
    ]
    assert f["Helvetica"].ref == f"f{f['Helvetica'].xref}"
    assert f["Courier"].family == "courier"


def test_pymupdf_subset_has_no_cmap():
    _, fonts = fonts_of(make_pymupdf_subset_pdf())
    (font,) = fonts.values()
    assert (font.name, font.format, font.reusable) == ("Cousine Regular", "ttf", False)


def test_every_span_maps_to_its_font():
    doc, fonts = fonts_of(make_fonts_pdf())
    by_key = span_fonts(doc[0], fonts)
    spans = [s for b in doc[0].get_text("dict")["blocks"] for ln in b["lines"] for s in ln["spans"]]
    got = {s["text"]: by_key[name_key(s["font"])].name for s in spans}
    assert got == {"Standard Helvetica line": "Helvetica", "Standard Times line": "Times-Roman",
                   "Embedded Arimo line": "Arimo Regular", "Subset lorem ipsum": "Tinos Regular",
                   "Courier CFF line": "Courier"}  # the CFF span is named after its program (NimbusMonoPS)


def test_load_font_only_for_reusable_programs():
    doc, fonts = fonts_of(make_fonts_pdf())
    f = by_name(fonts)
    assert load_font(doc, f["Tinos Regular"].xref).has_glyph(ord("S"))
    assert load_font(doc, f["Courier"].xref) is None
    assert load_font(doc, f["Helvetica"].xref) is None
    doc, fonts = fonts_of(make_pymupdf_subset_pdf())
    assert load_font(doc, next(iter(fonts))) is None


def test_ambiguous_names_map_to_none():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "a", fontname="helv")
    writer = pymupdf.TextWriter(page.rect)
    writer.append((72, 100), "b", font=pymupdf.Font("helv"))  # embedded NimbusSans, BaseFont "Helvetica" too
    writer.write_text(page)
    doc = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    assert span_fonts(doc[0], collect_fonts(doc))["helvetica"] is None


def test_substitutes_from_base_font_names():
    _, fonts = fonts_of(rename_font(make_fonts_pdf(), "Helvetica", "Calibri"))
    fill_substitutes(fonts, FontRegistry(Settings().fonts_dir))
    f = by_name(fonts)
    assert f["Calibri"].substitute == {"kind": "bundled", "family": "Carlito", "bold": False, "italic": False}
    assert f["Courier"].substitute["family"] == "Cousine"
    assert f["Calibri"].to_json()["substitute"]["family"] == "Carlito"
```

Run: `cd apps/api && uv run pytest tests/test_doc_fonts.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'edith.doc_fonts'`.

- [ ] **Step 4: Implement**

`apps/api/edith/doc_fonts.py`:
```python
"""Fonts used by the uploaded PDF: what they are, whether they can be reused for new text, and
which bundled family substitutes them."""
import re
from dataclasses import dataclass

import pymupdf

from edith.fonts import FontRegistry, base_font_name, parse_font_name

# pymupdf extract_font() extensions → spec font formats.
_FORMATS = {"ttf": "ttf", "otf": "otf", "cff": "cff", "cid": "cff", "pfa": "type1", "pfb": "type1"}
_SAMPLE = [ord(c) for c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"]


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


def name_key(name: str) -> str:
    """Comparable form of a font name: span names come from the font program (`Arimo-Regular`)
    while BaseFont may differ in punctuation (`ABCDEF+Arimo Regular`)."""
    return re.sub(r"[^a-z0-9]", "", base_font_name(name).lower())


def load_font(doc: pymupdf.Document, xref: int) -> pymupdf.Font | None:
    """The embedded TTF/OTF program of font `xref` if it can draw new text (has a Unicode cmap), else None."""
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
    return font if any(font.has_glyph(c) for c in _SAMPLE) else None


def font_bytes(doc: pymupdf.Document, xref: int) -> tuple[bytes, str] | None:
    """(bytes, "ttf"|"otf") of a reusable font, else None."""
    if load_font(doc, xref) is None:
        return None
    _name, ext, _type, buf = doc.extract_font(xref)
    return buf, ext


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
                   family=family, bold=bold, italic=italic, keys=frozenset(keys))


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
```

Run: `cd apps/api && uv run pytest -q`
Expected: all pass, no warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/doc_fonts.py apps/api/tests/test_doc_fonts.py apps/api/tests/pdfs.py apps/api/tests/fixtures/TinosSubset.ttf
git commit -m "feat(api): document font table with reusability and span mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
