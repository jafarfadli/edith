"""Writes apps/web/src/lib/fixtures/spacing.json: GET /documents/{id}/text of tests.pdfs.make_spacing_pdf() (one
paragraph each with Tz, Tc and per-word gaps, in an embedded Tinos) plus every glyph's original origin x per paragraph
(`origins`), for the web tests that check that the client lays out redrawn text where the original glyphs were.
tests/test_spacing.py checks that the file is current."""
import json

import pymupdf

from edith.extract import extract_text
from edith.fonts import FontRegistry
from edith.settings import REPO_ROOT, Settings
from tests.pdfs import make_spacing_pdf

OUT = REPO_ROOT / "apps" / "web" / "src" / "lib" / "fixtures" / "spacing.json"


def build() -> dict:
    doc = pymupdf.open(stream=make_spacing_pdf(), filetype="pdf")
    data = extract_text(doc, FontRegistry(Settings().fonts_dir))
    page = doc[0]
    chars = [c for b in page.get_text("rawdict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"]
             for c in s["chars"] if not c["c"].isspace()]
    origins = {}
    for p in data["pages"][0]["paragraphs"]:
        r = p["rect"]
        origins[p["id"]] = [round(c["origin"][0], 3) for c in chars if r["y"] <= c["origin"][1] <= r["y"] + r["h"]]
    return {"doc_id": "spacing", **data, "origins": origins}


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=1) + "\n")
    print("wrote", OUT)
