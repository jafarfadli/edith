"""Writes apps/web/src/lib/fixtures/text.json: GET /documents/{id}/text of tests.pdfs.make_layout_pdf(),
for the web tests that check client layout against the original line breaks."""
import json

import pymupdf

from edith.extract import extract_text
from edith.fonts import FontRegistry
from edith.settings import REPO_ROOT, Settings
from tests.pdfs import make_layout_pdf

OUT = REPO_ROOT / "apps" / "web" / "src" / "lib" / "fixtures" / "text.json"


def build() -> dict:
    doc = pymupdf.open(stream=make_layout_pdf(), filetype="pdf")
    return {"doc_id": "fixture", **extract_text(doc, FontRegistry(Settings().fonts_dir))}


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), indent=1) + "\n")
    print("wrote", OUT)
