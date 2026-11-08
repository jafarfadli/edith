"""Draws the paragraphs GET /documents/{id}/text would return onto each page of a PDF, for eyeballing segmentation.

    cd apps/api && uv run python -m scripts.paragraph_overlay "../../references/Visa Application Form (1).pdf" /tmp/overlay

Writes <out>/page-<n>.png (110 dpi, one coloured box + id per paragraph) and prints, per page, the paragraph count
and the paragraphs with three or more lines (the ones worth checking for wrong merges).
"""
import sys
from pathlib import Path

import pymupdf

from edith.paragraphs import extract_paragraphs

COLORS = [(0.9, 0.1, 0.1), (0.1, 0.5, 0.9), (0.1, 0.7, 0.2), (0.8, 0.4, 0.0), (0.6, 0.1, 0.8)]


def main(src: str, out: str) -> None:
    Path(out).mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(src)
    total = 0
    for page in doc:
        paragraphs = extract_paragraphs(page)
        total += len(paragraphs)
        tall = [p for p in paragraphs if len(p["lines"]) >= 3]
        print(f"page {page.number + 1}: {len(paragraphs)} paragraphs, {len(tall)} with 3+ lines")
        for p in tall:
            print(f"  {p['id']} {len(p['lines'])} lines: {''.join(r['text'] for r in p['runs'])[:90]!r}")
        for i, p in enumerate(paragraphs):
            r, color = p["rect"], COLORS[i % len(COLORS)]
            rect = pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])
            page.draw_rect(rect, color=color, width=0.8)
            page.insert_text((rect.x0, rect.y0 - 0.5), p["id"], fontsize=5, color=color)
        page.get_pixmap(dpi=110).save(Path(out) / f"page-{page.number + 1}.png")
    print(f"total: {total} paragraphs")


if __name__ == "__main__":
    main(*sys.argv[1:3])
