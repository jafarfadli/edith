"""Writes apps/web/e2e/fixtures/pages.pdf and import.pdf for the pages & polish E2E test.

pages.pdf: three A4 pages reading "Halaman satu", "Halaman dua", "Halaman tiga" (Helvetica 14 pt at (72, 72));
page 1 has a text field `nama` at (72, 100)–(272, 120).
import.pdf: two 400 × 500 pt pages reading "Impor A" and "Impor B" (the PDF imported into the first); page 1 also
has the line "kata penting di sini" (Helvetica 12, baseline 200; a paragraph of its own) and its own text field `nama` at (72, 230)–(272, 250)
— the same name as the main PDF's, so the export renames it.
"""
import pymupdf

from edith.settings import REPO_ROOT

FIXTURES = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures"


def field(page: pymupdf.Page, name: str, rect: tuple[float, float, float, float]) -> None:
    w = pymupdf.Widget()
    w.field_type, w.field_name, w.rect, w.field_value = pymupdf.PDF_WIDGET_TYPE_TEXT, name, pymupdf.Rect(rect), ""
    page.add_widget(w)


def build(labels: list[str], size: tuple[float, float], imported: bool) -> bytes:
    doc = pymupdf.open()
    for i, label in enumerate(labels):
        page = doc.new_page(width=size[0], height=size[1])
        page.insert_text((72, 72), label, fontname="helv", fontsize=14)
        if i == 0 and imported:
            page.insert_text((72, 200), "kata penting di sini", fontname="helv", fontsize=12)
            field(page, "nama", (72, 230, 272, 250))
        elif i == 0:
            field(page, "nama", (72, 100, 272, 120))
    return doc.tobytes(garbage=3, deflate=True)


if __name__ == "__main__":
    (FIXTURES / "pages.pdf").write_bytes(build(["Halaman satu", "Halaman dua", "Halaman tiga"], (595, 842), False))
    (FIXTURES / "import.pdf").write_bytes(build(["Impor A", "Impor B"], (400, 500), True))
    print("wrote", FIXTURES / "pages.pdf", FIXTURES / "import.pdf")
