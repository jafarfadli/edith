"""Writes apps/web/e2e/fixtures/text.pdf for the text-editing E2E test.

Paragraph 1: standard Helvetica (not embedded → edited with Arimo), contains "penting" and "lama".
Paragraph 2: embedded copy of Tinos renamed to "EdithDoc-Regular" (reusable → edited with the PDF's own font; the
name differs from every bundled family, so the E2E can tell reuse from the bundled Tinos), contains "lama".
"""
import io

import pymupdf
from fontTools.ttLib import TTFont

from edith.settings import REPO_ROOT

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "text.pdf"
FONTS = REPO_ROOT / "packages" / "fonts" / "files"
FIRST = ("Paragraf pertama berisi kata penting yang akan ditebalkan, lalu kata lama yang nanti diganti "
         "lewat fitur cari dan ganti di editor.")
SECOND = "Paragraf kedua memakai font asli yang tertanam dan juga menyimpan kata lama."


def renamed_tinos() -> bytes:
    font = TTFont(FONTS / "Tinos-Regular.ttf")
    for rec in font["name"].names:
        if rec.nameID in (1, 3, 4, 6, 16, 17):
            rec.string = {4: "EdithDoc Regular", 3: "EdithDoc-Regular", 6: "EdithDoc-Regular"}.get(rec.nameID, "EdithDoc")
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def build() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    assert page.insert_textbox(pymupdf.Rect(72, 90, 372, 160), FIRST, fontname="helv", fontsize=12) >= 0
    page.insert_font(fontname="TN", fontbuffer=renamed_tinos())
    assert page.insert_textbox(pymupdf.Rect(72, 290, 372, 360), SECOND, fontname="TN", fontsize=12) >= 0
    return doc.tobytes(garbage=3, deflate=True)


if __name__ == "__main__":
    OUT.write_bytes(build())
    print("wrote", OUT)
