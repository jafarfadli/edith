"""Writes apps/web/e2e/fixtures/form-ko.pdf (tests.pdfs.make_korean_form_pdf) for the Korean form E2E test."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_korean_form_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "form-ko.pdf"

if __name__ == "__main__":
    OUT.write_bytes(make_korean_form_pdf())
    print("wrote", OUT)
