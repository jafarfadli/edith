"""Writes apps/web/e2e/fixtures/scan.pdf (tests.pdfs.make_scan_form_pdf) for the OCR E2E test: the synthetic scanned
form (invented content) as one 200 dpi JPEG on off-white paper, no text layer."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_scan_form_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "scan.pdf"
PAPER = (0.97, 0.96, 0.92)

if __name__ == "__main__":
    OUT.write_bytes(make_scan_form_pdf(dpi=200, jpeg=85, paper=PAPER))
    print("wrote", OUT)
