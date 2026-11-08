"""Compares each identity-edit export (identity.harness.ts) with the original page.

For every paragraph: its words before/after (origin x, baseline, font, size, colour, bold), displacement,
line-break changes, glyph loss, word-width / gap changes, pixel diff inside the paragraph and damage outside.
Writes OUT/results.json (one record per paragraph) and prints a summary.

Run with the API venv (pymupdf + numpy):  apps/api/.venv/bin/python compare.py [OUT] [REFS]
"""
import difflib
import json
import math
import re
import statistics
import sys
from pathlib import Path

import numpy as np
import pymupdf

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/private/tmp/claude-501/audit3/out")
REFS = Path(sys.argv[2] if len(sys.argv) > 2 else "/Users/jafarfadli/Koding/edith/references")
FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
GAP_EM = 0.15      # a jump this wide (× size) between two glyphs of a line ends a word (no space glyph: Hancom)
ZOOM = 2


def fkey(name: str) -> str:
    name = name.split("+", 1)[1] if re.match(r"^[A-Z]{6}\+", name) else name
    return re.sub(r"[^a-z0-9]", "", name.lower())


def words_of(page: pymupdf.Page) -> list[dict]:
    """Words from rawdict chars: split at spaces and at gaps > GAP_EM·size. Each: text, x (origin of first
    glyph), x1 (bbox right of last), y (baseline), font, size, color, bold, bbox, chars [(c, x)]."""
    out = []
    for b in page.get_text("rawdict", flags=FLAGS)["blocks"]:
        for ln in b.get("lines", []):
            if abs(ln["dir"][0] - 1) > 1e-3:
                continue
            cur = None
            for s in ln["spans"]:
                for ch in s["chars"]:
                    c = ch["c"]
                    if c.isspace() or c == "\xa0":
                        cur = None
                        continue
                    ox, oy = ch["origin"]
                    if cur is not None and (abs(oy - cur["y"]) > 0.3 * s["size"] or ox - cur["x1"] > GAP_EM * s["size"]
                                            or ox < cur["x1"] - 0.5 * s["size"]):
                        cur = None
                    if cur is None:
                        cur = {"text": "", "x": ox, "x1": ch["bbox"][2], "y": oy, "font": s["font"], "size": s["size"],
                               "color": s["color"], "bold": bool(s["flags"] & 16), "bbox": list(ch["bbox"]),
                               "chars": [], "fonts": set()}
                        out.append(cur)
                    cur["text"] += c
                    cur["x1"] = ch["bbox"][2]
                    cur["chars"].append((c, ox))
                    cur["fonts"].add(fkey(s["font"]))
                    bb = cur["bbox"]
                    cur["bbox"] = [min(bb[0], ch["bbox"][0]), min(bb[1], ch["bbox"][1]), max(bb[2], ch["bbox"][2]),
                                   max(bb[3], ch["bbox"][3])]
    return out


def in_lines(w: dict, para: dict) -> bool:
    cx, cy = w["x"] + 0.3, w["y"] - 0.3 * w["size"]
    for ln in para["lines"]:
        r = ln["rect"]
        if r["x"] - 0.6 <= cx <= r["x"] + r["w"] + 0.6 and r["y"] - 0.6 <= cy <= r["y"] + r["h"] + 0.6:
            return True
    return False


def same(a: dict, b: dict, tol=0.35) -> bool:
    return a["text"] == b["text"] and abs(a["x"] - b["x"]) <= tol and abs(a["y"] - b["y"]) <= tol


def line_ids(ws: list[dict]) -> list[int]:
    """Line index per word (in reading order): a new line when the baseline moves by > 0.4·size."""
    ids, cur, last = [], -1, None
    for w in ws:
        if last is None or abs(w["y"] - last) > 0.4 * w["size"]:
            cur += 1
            last = w["y"]
        ids.append(cur)
    return ids


def render(page: pymupdf.Page, clip: pymupdf.Rect | None = None) -> np.ndarray:
    pm = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), clip=clip, colorspace=pymupdf.csGRAY, alpha=False)
    return np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width).astype(np.int16)


def tolerant_diff(A: np.ndarray, B: np.ndarray, thr: int = 64) -> np.ndarray:
    """Pixels of A with no pixel within 1 px in B closer than `thr` grey levels (ignores anti-aliasing and
    sub-pixel hinting changes, e.g. after font subsetting), symmetric."""
    def one(X, Y):
        best = np.full(X.shape, 255, dtype=np.int16)
        P = np.pad(Y, 1, mode="edge")
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                best = np.minimum(best, np.abs(X - P[dy:dy + X.shape[0], dx:dx + X.shape[1]]))
        return best > thr
    return one(A, B) | one(B, A)


def order(ws: list[dict]) -> list[dict]:
    """Reading order: by line (baseline clusters), then x."""
    ws = sorted(ws, key=lambda w: (w["y"], w["x"]))
    rows: list[list[dict]] = []
    for w in ws:
        if rows and abs(rows[-1][0]["y"] - w["y"]) <= 0.4 * w["size"]:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [w for r in rows for w in sorted(r, key=lambda w: w["x"])]


def compare_one(orig_page, out_page, para, op, null_page=None) -> dict:
    ow = words_of(orig_page)
    nw = words_of(out_page)
    p_orig = [w for w in ow if in_lines(w, para)]
    others = [w for w in ow if not in_lines(w, para)]
    # Other words should be untouched: match them out of the export.
    pool = list(nw)
    damaged = []
    for w in others:
        hit = next((i for i, v in enumerate(pool) if same(w, v)), None)
        if hit is None:
            damaged.append(w)
        else:
            pool.pop(hit)
    p_new = pool  # what is left = the redrawn paragraph (+ anything else that changed)
    p_orig, p_new = order(p_orig), order(p_new)
    a, b = [w["text"] for w in p_orig], [w["text"] for w in p_new]
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    pairs = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            pairs += list(zip(range(i1, i2), range(j1, j2)))
    la, lb = line_ids(p_orig), line_ids(p_new)
    disp, dxs, dys = [], [], []
    font_sub, size_drift, color_drift, bold_drift = 0, [], 0, 0
    width_delta = []
    starts_diff = 0
    per_line: dict[int, list[tuple[float, float, int]]] = {}
    word_disp = []  # per matched word: [original line, export line, displacement] (summary.py)
    for i, j in pairs:
        o, n = p_orig[i], p_new[j]
        dx, dy = n["x"] - o["x"], n["y"] - o["y"]
        disp.append(math.hypot(dx, dy))
        word_disp.append([la[i], lb[j], round(disp[-1], 2)])
        dxs.append(dx)
        dys.append(dy)
        if not (o["fonts"] & n["fonts"]):
            font_sub += 1
        size_drift.append(n["size"] - o["size"])
        if (o["color"] & 0xFFFFFF) != (n["color"] & 0xFFFFFF):
            color_drift += 1
        if o["bold"] != n["bold"]:
            bold_drift += 1
        width_delta.append((n["x1"] - n["x"]) - (o["x1"] - o["x"]))
        first_o = i == 0 or la[i] != la[i - 1]
        first_n = j == 0 or lb[j] != lb[j - 1]
        if first_o != first_n:
            starts_diff += 1
        per_line.setdefault(la[i], []).append((dx, dy, i))
    # Glyph loss: characters of the paragraph gone or changed.
    ca, cb = "".join(a), "".join(b)
    cm = difflib.SequenceMatcher(a=ca, b=cb, autojunk=False)
    lost = sum(i2 - i1 for t, i1, i2, _, _ in cm.get_opcodes() if t in ("delete", "replace"))
    added = sum(j2 - j1 for t, _, _, j1, j2 in cm.get_opcodes() if t in ("insert", "replace"))
    # Per original line: dx of first word, drift (last − first dx) and dy.
    lines = []
    for li, vals in sorted(per_line.items()):
        lines.append({"line": li, "dx0": round(vals[0][0], 2), "drift": round(vals[-1][0] - vals[0][0], 2),
                      "dy": round(statistics.mean(v[1] for v in vals), 2), "n": len(vals),
                      "chars": sum(len(p_orig[v[2]]["text"]) for v in vals)})
    # Gap delta: inter-word gaps in the original vs the export (same consecutive pair on the same line).
    gap_delta = []
    line_gaps: dict[int, list[float]] = {}
    for (i, j), (i2, j2) in zip(pairs, pairs[1:]):
        if i2 == i + 1 and j2 == j + 1 and la[i] == la[i2] and lb[j] == lb[j2]:
            go = p_orig[i2]["x"] - p_orig[i]["x1"]
            gn = p_new[j2]["x"] - p_new[j]["x1"]
            gap_delta.append(gn - go)
            line_gaps.setdefault(la[i], []).append(gn - go)
    for ln_ in lines:
        g = line_gaps.get(ln_["line"], [])
        ln_["gap_mean"] = round(statistics.mean(g), 2) if g else None
        ln_["gap_min"] = round(min(g), 2) if g else None
    # Trailing / leading whitespace of each API line: rect edge vs ink of its words.
    text = para_text(para)
    api_lines = []
    for k, L in enumerate(para["lines"]):
        r = L["rect"]
        ws = [w for w in p_orig if r["x"] - 0.6 <= w["x"] + 0.3 <= r["x"] + r["w"] + 0.6 and abs(w["y"] - L["baseline"]) < 0.5 * L["size"]]
        if not ws:
            continue
        api_lines.append({"trail": round(r["x"] + r["w"] - max(w["x1"] for w in ws), 2),
                          "lead": round(min(w["x"] for w in ws) - r["x"], 2),
                          "lead_ws": text[L["start"]:L["end"]][:1].isspace()})
    nchars = sum(len(p_orig[i]["text"]) for i, _ in pairs)
    page_w = out_page.rect.width
    # Pixels: inside the paragraph (union of its rect and the new box) and outside it.
    pr = para["rect"]
    box = op["box"]["rect"]
    clip = pymupdf.Rect(min(pr["x"], box["x"]) - 2, min(pr["y"], box["y"]) - 2,
                        max(pr["x"] + pr["w"], box["x"] + box["w"]) + 2, max(pr["y"] + pr["h"], box["y"] + box["h"]) + 2)
    clip &= orig_page.rect
    A, B = render(null_page if null_page is not None else orig_page), render(out_page)
    h = min(A.shape[0], B.shape[0])
    w_ = min(A.shape[1], B.shape[1])
    diff = tolerant_diff(A[:h, :w_], B[:h, :w_])
    mask = np.zeros_like(diff)
    y0, y1 = int(clip.y0 * ZOOM), int(math.ceil(clip.y1 * ZOOM))
    x0, x1 = int(clip.x0 * ZOOM), int(math.ceil(clip.x1 * ZOOM))
    mask[max(0, y0):y1, max(0, x0):x1] = True
    inside = int(diff[mask].sum())
    ink = int((A[:h, :w_][mask] < 128).sum())
    outside = int(diff[~mask].sum())
    sizes = [r["size"] for r in op["box"]["paragraphs"][0]]
    return {
        "words": len(p_orig), "new_words": len(p_new), "matched": len(pairs),
        "max_disp": round(max(disp), 2) if disp else None,
        "mean_disp": round(statistics.mean(disp), 2) if disp else None,
        "max_dx": round(max(dxs, key=abs), 2) if dxs else None,
        "max_dy": round(max(dys, key=abs), 2) if dys else None,
        "orig_lines": (la[-1] + 1) if la else 0, "new_lines": (lb[-1] + 1) if lb else 0,
        "starts_diff": starts_diff,
        "font_sub": font_sub, "size_drift": round(max(size_drift, key=abs), 3) if size_drift else 0,
        "color_drift": color_drift, "bold_drift": bold_drift,
        "width_delta_max": round(max(width_delta, key=abs), 2) if width_delta else 0,
        "width_delta_mean": round(statistics.mean(width_delta), 3) if width_delta else 0,
        "gap_delta_mean": round(statistics.mean(gap_delta), 2) if gap_delta else None,
        "gap_delta_max": round(max(gap_delta, key=abs), 2) if gap_delta else None,
        "lost_chars": lost, "added_chars": added,
        "damaged_words": [{"text": w["text"], "x": round(w["x"], 1), "y": round(w["y"], 1)} for w in damaged][:12],
        "n_damaged": len(damaged),
        "px_inside": inside, "px_ink": ink, "px_outside": outside,
        "lines": lines, "api_lines": api_lines, "word_disp": word_disp,
        "orig_line_words": [[p_orig[i]["text"] for i in range(len(p_orig)) if la[i] == k] for k in range(la[-1] + 1)] if la else [],
        "new_line_words": [[p_new[j]["text"] for j in range(len(p_new)) if lb[j] == k] for k in range(lb[-1] + 1)] if lb else [],
        "char_delta": round(sum(width_delta) / nchars, 3) if nchars else 0,
        "overflow": any(w["x1"] > page_w + 0.5 for w in p_new),
        "orig_fonts": sorted({f for w in p_orig for f in w["fonts"]}),
        "new_fonts": sorted({f for w in p_new for f in w["fonts"]}),
        "orig_sizes": sorted({round(w["size"], 2) for w in p_orig}),
        "run_sizes": sorted(set(sizes)),
        "text": para_text(para)[:90], "first_x_orig": round(p_orig[0]["x"], 2) if p_orig else None,
    }


def para_text(p):
    return "".join(r["text"] for r in p["runs"])


def main() -> None:
    results = []
    for d in sorted(x for x in OUT.iterdir() if x.is_dir()):
        idx_path = d / "index.json"
        if not idx_path.exists():
            continue
        index = json.loads(idx_path.read_text())
        if not index:
            continue
        src = pymupdf.open(REFS / index[0]["pdf"])
        for rec in index:
            r = dict(rec)
            if rec.get("out"):
                data = json.loads((d / rec["out"].replace(".pdf", ".op.json")).read_text())
                out = pymupdf.open(d / rec["out"])
                null_path = d / f"p{rec['page']}_null.pdf"
                null = pymupdf.open(null_path) if null_path.exists() else None
                try:
                    r.update(compare_one(src[rec["page"]], out[0], data["paragraph"], data["op"], null[0] if null else None))
                    p = data["paragraph"]
                    r.update(align=p["align"], n_lines_api=len(p["lines"]), lineHeight=p["lineHeight"],
                             rect_w=p["rect"]["w"], maxWidth=p.get("maxWidth"),
                             box_w=data["op"]["box"]["rect"]["w"], box_lh=data["op"]["box"]["lineHeight"],
                             runs_fonts=sorted({(x["font"].get("ref") or x["font"].get("family")) for x in data["op"]["box"]["paragraphs"][0]}))
                except Exception as exc:  # noqa: BLE001
                    r["cmp_error"] = repr(exc)
                out.close()
            results.append(r)
        src.close()
    (OUT / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))
    print(len(results), "records ->", OUT / "results.json")


if __name__ == "__main__":
    main()
