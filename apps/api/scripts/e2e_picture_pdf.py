"""Writes apps/web/e2e/fixtures/picture-text.pdf (tests.pdfs.make_picture_text_pdf) for the picture-text E2E test."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_picture_text_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "picture-text.pdf"

if __name__ == "__main__":
    OUT.write_bytes(make_picture_text_pdf())
    print("wrote", OUT)
