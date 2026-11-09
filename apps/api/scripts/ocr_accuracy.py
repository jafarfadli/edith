"""OCR quality on the synthetic scanned form (tests.pdfs.make_scan_form_pdf), or overlays of a PDF's OCR.

    cd apps/api && uv run python -m scripts.ocr_accuracy [OUT_DIR]          # table of variants (+ overlay PNGs)
    cd apps/api && uv run python -m scripts.ocr_accuracy --pdf file.pdf OUT_DIR

Word accuracy: share of ground-truth words read exactly by the OCR word whose box overlaps it most (IoU ≥ 0.3).
Box error: mean distance (pt) between the left and right edges of matched boxes (the ground truth's
heights are font boxes, the OCR's ink: not comparable). Overlays: paragraph rects blue, covers green
(filled with their colour), words red, low-confidence paragraphs orange."""
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path
from statistics import mean

import pymupdf

from edith import ocr
from edith.fonts import FontRegistry
from edith.settings import Settings
from tests.pdfs import SCAN_SIZE, make_scan_form_pdf, scan_form_words

VARIANTS = [
    ("clean Tinos 300 dpi", dict(family="Tinos")),
    ("clean Arimo 300 dpi", dict(family="Arimo")),
    ("Tinos 200 dpi", dict(family="Tinos", dpi=200)),
    ("Tinos 0.7° blur noise12 jpeg75 paper", dict(family="Tinos", angle=0.7, blur=True, noise=12, jpeg=75,
                                                  paper=(0.97, 0.96, 0.92))),
    ("Arimo -1° noise18 jpeg60 blue ink", dict(family="Arimo", angle=-1.0, noise=18, jpeg=60, paper=(0.96, 0.94, 0.88),
                                               ink=(0.1, 0.12, 0.4))),
    ("Tinos 200 dpi blur noise10 jpeg70", dict(family="Tinos", dpi=200, blur=True, noise=10, jpeg=70)),
    ("Arimo 200 dpi blur noise10 jpeg70", dict(family="Arimo", dpi=200, blur=True, noise=10, jpeg=70)),
    ("Tinos 3° (skewed)", dict(family="Tinos", angle=3.0)),
]
LOW = 0.75


def iou(a: pymupdf.Rect, b: pymupdf.Rect) -> float:
    inter = (a & b)
    if inter.is_empty:
        return 0.0
    i = inter.width * inter.height
    return i / (a.width * a.height + b.width * b.height - i)


def overlay(page: pymupdf.Page, result: dict, words: list, out: Path) -> None:
    doc = pymupdf.open()
    doc.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
    p = doc[0]
    p.set_rotation(0)
    for para in result["paragraphs"]:
        rgb = tuple(int(para["coverColor"][i:i + 2], 16) / 255 for i in (1, 3, 5))
        for c in para["covers"]:
            p.draw_rect(pymupdf.Rect(c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"]), color=(0, 0.6, 0), fill=rgb,
                        fill_opacity=0.35, width=0.4)
        r = para["rect"]
        low = para["confidence"] < LOW
        p.draw_rect(pymupdf.Rect(r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]),
                    color=(1, 0.5, 0) if low else (0, 0.3, 1), width=0.6)
        p.insert_text((r["x"], r["y"] - 1), f'{para["id"]} {para["confidence"]:.2f} {para["runs"][0]["size"]}pt',
                      fontsize=4, color=(0, 0.3, 1))
    for _t, _c, r in words:
        p.draw_rect(r, color=(1, 0, 0), width=0.2)
    p.get_pixmap(dpi=110).save(out)


def measure(name: str, kw: dict, registry: FontRegistry, cmd: str, out: Path | None) -> dict:
    data = make_scan_form_pdf(**kw)
    page = pymupdf.open(stream=data, filetype="pdf")[0]
    words: list = []
    t = time.monotonic()
    result = ocr.ocr_page(page, registry, cmd, words_out=words)
    took = time.monotonic() - t
    truth = scan_form_words(kw.get("family", "Tinos"), kw.get("angle", 0.0))
    hits, errs, wrong = 0, [], 0.0
    for text, box in truth:
        best = max(words, key=lambda w: iou(w[2], box), default=None)
        if best is not None and iou(best[2], box) >= 0.3:
            errs.append((abs(best[2].x0 - box.x0) + abs(best[2].x1 - box.x1)) / 2)
            hits += best[0] == text
            m = SequenceMatcher(None, text, best[0], autojunk=False)
            wrong += max(len(text), len(best[0])) - sum(b.size for b in m.get_matching_blocks())
        else:
            wrong += len(text)
    cer = wrong / sum(len(t) for t, _ in truth)  # characters wrong or missing, per ground-truth character
    paras = result["paragraphs"]
    fams = {r["font"]["family"] + ("-B" if r["font"]["bold"] else "") for p in paras for r in p["runs"]}
    sizes = [r["size"] for p in paras for r in p["runs"]]
    if out:
        overlay(page, result, words, out / f"{name.split()[0]}-{abs(hash(name)) % 1000}.png")
    return {"name": name, "quality": result["quality"], "angle": result["angle"], "words": len(truth),
            "accuracy": hits / len(truth), "char_err": cer, "box_err": mean(errs) if errs else None,
            "paragraphs": len(paras), "low": sum(p["confidence"] < LOW for p in paras), "fonts": sorted(fams),
            "size_body": sorted(sizes)[len(sizes) // 2] if sizes else None, "seconds": took,
            "colours": sorted({r["color"] for p in paras for r in p["runs"]}), "covers": sorted({p["coverColor"] for p in paras}),
            "uneven": sum(not p["coverUniform"] for p in paras)}


def main() -> None:
    registry = FontRegistry(Settings().fonts_dir)
    cmd = ocr.tesseract_cmd()
    if not ocr.available():
        sys.exit("tesseract with ind+eng is not installed")
    args = sys.argv[1:]
    if args and args[0] == "--pdf":
        src, out = Path(args[1]), Path(args[2])
        out.mkdir(parents=True, exist_ok=True)
        doc = pymupdf.open(src)
        for page in doc:
            words: list = []
            t = time.monotonic()
            result = ocr.ocr_page(page, registry, cmd, words_out=words)
            print(f"page {page.number}: {result['quality']} angle {result['angle']} dpi {result['dpi']} "
                  f"{len(words)} words, {len(result['paragraphs'])} paragraphs, {time.monotonic() - t:.1f} s")
            for p in result["paragraphs"]:
                text = "".join(r["text"] for r in p["runs"])
                r0 = p["runs"][0]
                print(f"  {p['id']:6s} {p['confidence']:.2f} {r0['font']['family']}{'-B' if r0['font']['bold'] else ''}"
                      f" {r0['size']}pt {r0['color']} cover {p['coverColor']}{'' if p['coverUniform'] else ' (uneven)'}"
                      f" {p['align']}: {text[:90]}")
            if result["regions"]:
                overlay(page, result, words, out / f"page-{page.number}.png")
        return
    out = Path(args[0]) if args else None
    if out:
        out.mkdir(parents=True, exist_ok=True)
    print(f"ground truth body size {SCAN_SIZE} pt; low confidence < {LOW}")
    for name, kw in VARIANTS:
        m = measure(name, kw, registry, cmd, out)
        box = f"{m['box_err']:.2f}" if m["box_err"] is not None else "-"
        print(f"{m['name']:40s} {m['quality']:10s} angle {m['angle']:+.2f}  words {m['accuracy']:.1%} of {m['words']}"
              f"  CER {m['char_err']:.1%}  box ±{box} pt  {m['paragraphs']} paragraphs ({m['low']} low)"
              f"  {','.join(m['fonts'])} body {m['size_body']} pt  ink {','.join(m['colours'])}"
              f"  cover {','.join(m['covers'])} uneven {m['uneven']}  {m['seconds']:.1f} s")


if __name__ == "__main__":
    main()
