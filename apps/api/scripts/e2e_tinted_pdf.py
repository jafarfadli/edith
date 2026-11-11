"""Writes apps/web/e2e/fixtures/tinted.pdf (tests.pdfs.make_tinted_cell_pdf) for the cover-colour E2E test."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_tinted_cell_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "tinted.pdf"

if __name__ == "__main__":
    OUT.write_bytes(make_tinted_cell_pdf())
    print("wrote", OUT)
