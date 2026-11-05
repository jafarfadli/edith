from pathlib import Path

import pymupdf


def make_pdf(pages: int = 2, text: bool = True, password: str | None = None,
             size: tuple[float, float] = (595, 842), rotation: int = 0,
             crop: tuple[float, float, float, float] | None = None) -> bytes:
    """`crop` is a CropBox in top-left MediaBox coordinates; text is placed crop-relative."""
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=size[0], height=size[1])
        if crop:
            page.set_cropbox(pymupdf.Rect(*crop))
        if text:
            page.insert_text((72, 72), f"Page {i}", fontsize=14)
        if rotation:
            page.set_rotation(rotation)
    if password:
        return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password)
    return doc.tobytes()


def unrotated(doc: pymupdf.Document, index: int = 0) -> pymupdf.Page:
    """A reloaded copy of a baked page with /Rotate removed: its coordinates are then the
    unrotated-CropBox-relative points the ops were expressed in."""
    copy = pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    page = copy[index]
    page.set_rotation(0)
    return page


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
