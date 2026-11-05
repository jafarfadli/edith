"""Character boxes of a page's original text, for text-markup annotations (the client turns a
selection into one quad per line)."""
import pymupdf

from edith.paragraphs import FLAGS


def _num(v: float) -> float:
    return round(v, 2)


def page_chars(page: pymupdf.Page) -> list[dict]:
    """Horizontal text lines in content order: `text` (one character per code point) with the
    `[x0, x1]` box of each character, the line's baseline and size (of its largest span).
    Unrotated-CropBox points; rotated text and blank lines are left out."""
    out = []
    for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
        for line in block.get("lines", []):
            dx, dy = line["dir"]
            if abs(dx - 1) > 1e-3 or abs(dy) > 1e-3:
                continue
            chars = [c for span in line["spans"] for c in span["chars"]]
            text = "".join(c["c"] for c in chars).replace("\xa0", " ").replace("\t", " ")
            if not text.strip():
                continue
            main = max(line["spans"], key=lambda s: (s["size"], len(s["chars"])))
            out.append({
                "text": text,
                "boxes": [[_num(c["bbox"][0]), _num(c["bbox"][2])] for c in chars],
                "baseline": _num(main["origin"][1]),
                "size": _num(main["size"]),
            })
    return out
