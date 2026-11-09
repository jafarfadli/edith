"""Writes apps/web/e2e/fixtures/wrap.pdf (tests.pdfs.make_wrap_pdf) for the one-letter-edit E2E test (M5d)."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_wrap_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "wrap.pdf"

if __name__ == "__main__":
    OUT.write_bytes(make_wrap_pdf())
    print("wrote", OUT)
