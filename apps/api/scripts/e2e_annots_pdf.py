"""Writes apps/web/e2e/fixtures/annots.pdf for the annotations & forms E2E test.

Page 1: one Helvetica 12 pt line containing "penting" (baseline y = 80), a text field `nama` and a
checkbox `setuju` (on-state `Yes`). Page 2: "Halaman kedua" (the target of a link).
"""
import pymupdf

from edith.settings import REPO_ROOT

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "annots.pdf"
LINE = "Perjanjian ini memuat kata penting yang perlu ditandai."


def build() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 80), LINE, fontname="helv", fontsize=12)
    for kind, name, rect in ((pymupdf.PDF_WIDGET_TYPE_TEXT, "nama", (72, 100, 272, 120)),
                             (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, "setuju", (72, 130, 86, 144))):
        w = pymupdf.Widget()
        w.field_type, w.field_name, w.rect = kind, name, pymupdf.Rect(rect)
        w.field_value = "" if kind == pymupdf.PDF_WIDGET_TYPE_TEXT else False
        page.add_widget(w)
    doc.new_page(width=595, height=842).insert_text((72, 80), "Halaman kedua", fontname="helv", fontsize=12)
    return doc.tobytes(garbage=3, deflate=True)


if __name__ == "__main__":
    OUT.write_bytes(build())
    print("wrote", OUT)
