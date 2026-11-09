"""Debug: original vs exported words of one paragraph.  python words.py <slug> <page> <gid> [OUT] [REFS]"""
import json
import sys
from pathlib import Path

import paths  # noqa: E402 - harness/paths.py: default OUT, REFS, REPO

import pymupdf

sys.path.insert(0, str(Path(__file__).parent))
from compare import FLAGS, in_lines, order, words_of  # noqa: E402

slug, page, gid = sys.argv[1], int(sys.argv[2]), sys.argv[3]
OUT = Path(sys.argv[4]) if len(sys.argv) > 4 else paths.OUT
REFS = Path(sys.argv[5]) if len(sys.argv) > 5 else paths.REFS
d = OUT / slug
idx = json.loads((d / "index.json").read_text())
src = pymupdf.open(REFS / idx[0]["pdf"])
data = json.loads((d / f"p{page}_{gid}.op.json").read_text())
para = data["paragraph"]
out = pymupdf.open(d / f"p{page}_{gid}.pdf")
ow = order([w for w in words_of(src[page]) if in_lines(w, para)])
nw_all = words_of(out[0])
nw = order([w for w in nw_all if in_lines(w, para) or True])
others = [w for w in words_of(src[page]) if not in_lines(w, para)]
nw = [w for w in nw if not any(o["text"] == w["text"] and abs(o["x"] - w["x"]) < .35 and abs(o["y"] - w["y"]) < .35 for o in others)]
print("ORIG", len(ow), "NEW", len(nw))
for i in range(max(len(ow), len(nw))):
    o = ow[i] if i < len(ow) else None
    n = nw[i] if i < len(nw) else None
    fo = f"{o['text'][:18]:18} x={o['x']:7.2f}-{o['x1']:7.2f} y={o['y']:7.2f} {o['font'][:22]:22} {o['size']:.2f}" if o else " " * 60
    fn = f"{n['text'][:18]:18} x={n['x']:7.2f}-{n['x1']:7.2f} y={n['y']:7.2f} {n['font'][:22]:22} {n['size']:.2f}" if n else ""
    dx = f"dx={n['x'] - o['x']:+.2f}" if o and n and o["text"] == n["text"] else ""
    print(fo, "|", fn, dx)
