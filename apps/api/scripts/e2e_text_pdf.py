"""Writes apps/web/e2e/fixtures/text.pdf for the text-editing E2E test.

Paragraph 1: standard Helvetica (not embedded → edited with Arimo), contains "penting" and "lama".
Paragraph 2: embedded full Tinos (reusable → edited with the PDF's own font), contains "lama".
"""
import pymupdf

from edith.settings import REPO_ROOT

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "text.pdf"
FONTS = REPO_ROOT / "packages" / "fonts" / "files"
FIRST = ("Paragraf pertama berisi kata penting yang akan ditebalkan, lalu kata lama yang nanti diganti "
         "lewat fitur cari dan ganti di editor.")
SECOND = "Paragraf kedua memakai font asli yang tertanam dan juga menyimpan kata lama."


def build() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    assert page.insert_textbox(pymupdf.Rect(72, 90, 372, 160), FIRST, fontname="helv", fontsize=12) >= 0
    page.insert_font(fontname="TN", fontfile=str(FONTS / "Tinos-Regular.ttf"))
    assert page.insert_textbox(pymupdf.Rect(72, 290, 372, 360), SECOND, fontname="TN", fontsize=12) >= 0
    return doc.tobytes(garbage=3, deflate=True)


if __name__ == "__main__":
    OUT.write_bytes(build())
    print("wrote", OUT)
