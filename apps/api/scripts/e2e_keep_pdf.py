"""Writes apps/web/e2e/fixtures/keep-lines.pdf (tests.pdfs.make_keep_lines_pdf) for the kept-lines E2E test."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_keep_lines_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "keep-lines.pdf"

if __name__ == "__main__":
    OUT.write_bytes(make_keep_lines_pdf())
    print("wrote", OUT)
