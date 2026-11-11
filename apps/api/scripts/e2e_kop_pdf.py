"""Writes apps/web/e2e/fixtures/kop.pdf (tests.pdfs.make_kop_pdf) for the picture-text-anywhere E2E test: a letterhead of
one picture per line under narrower invisible text, a pictured address line and a logo with its name."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_kop_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "kop.pdf"

if __name__ == "__main__":
    OUT.write_bytes(make_kop_pdf())
    print("wrote", OUT)
