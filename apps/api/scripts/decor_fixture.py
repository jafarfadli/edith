"""Writes apps/web/src/lib/fixtures/decor.json: GET /documents/{id}/text of tests.pdfs.make_decor_pdf() (underlined,
struck and highlighted original text), for the web tests of decorations on edited original text."""
import json

import pymupdf

from edith.extract import extract_text
from edith.fonts import FontRegistry
from edith.settings import REPO_ROOT, Settings
from tests.pdfs import make_decor_pdf

OUT = REPO_ROOT / "apps" / "web" / "src" / "lib" / "fixtures" / "decor.json"


def build() -> dict:
    doc = pymupdf.open(stream=make_decor_pdf(), filetype="pdf")
    return {"doc_id": "fixture", **extract_text(doc, FontRegistry(Settings().fonts_dir))}


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), indent=1) + "\n")
    print("wrote", OUT)
