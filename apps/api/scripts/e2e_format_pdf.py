"""Writes apps/web/e2e/fixtures/formatting.pdf (tests.pdfs.make_formatting_pdf) for the formatting E2E test."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_formatting_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "formatting.pdf"

if __name__ == "__main__":
    OUT.write_bytes(make_formatting_pdf())
    print("wrote", OUT)
