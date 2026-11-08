"""Per font: pen advance in the PDF (next glyph origin − this origin, / size) vs the font program advance the
web layout uses (served by GET /documents/{id}/fonts/{ref}). extra/em = Tc, Tz, TJ offsets, Tw (spaces)."""
import json, os, statistics, sys, collections, urllib.request, re
import pymupdf
from pathlib import Path
# Usage: python probe_widths.py [OUT]  (after identity.harness.ts; the API on 19400 must still hold the uploads)
API = os.environ.get("EDITH_API", "http://127.0.0.1:19400")
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/private/tmp/claude-501/audit3/out")
REPO = Path(os.environ.get("EDITH_REPO") or "/Users/jafarfadli/Koding/edith")
sys.path.insert(0, str(REPO / "apps/api"))
from edith.doc_fonts import name_key
for d in sorted(OUT.iterdir()):
    if not (d / "index.json").exists(): continue
    idx = json.loads((d / "index.json").read_text()); text = json.loads((d / "text.json").read_text())
    doc = pymupdf.open((REPO / "references") / idx[0]["pdf"])
    docid = text["doc_id"]
    progs = {}
    for f in text["fonts"]:
        if f["reusable"]:
            try:
                progs[f["ref"]] = pymupdf.Font(fontbuffer=urllib.request.urlopen(f"{API}/documents/{docid}/fonts/{f['ref']}").read())
            except Exception as e: pass
    # map span font name -> refs via text runs is hard; use doc fonts by name key
    bykey = collections.defaultdict(set)
    for f in text["fonts"]:
        bykey[name_key(f["name"])].add(f["ref"])
    stats = collections.defaultdict(list)
    for page in doc:
        for b in page.get_text("rawdict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)["blocks"]:
            for ln in b.get("lines", []):
                for s in ln["spans"]:
                    refs = bykey.get(name_key(s["font"]), set())
                    if len(refs) != 1: continue
                    ref = next(iter(refs)); prog = progs.get(ref)
                    if prog is None: continue
                    chs = s["chars"]
                    for ch, nx in zip(chs, chs[1:]):
                        c = ch["c"]
                        w = (nx["origin"][0] - ch["origin"][0]) / s["size"]
                        p = prog.glyph_advance(ord(c)) if not c.isspace() else prog.glyph_advance(32)
                        if p > 0 and w > 0: stats[(ref, s["font"], c.isspace())].append((w / p, c, w - p))
    print("==", d.name)
    for k, v in stats.items():
        rs = [x for x, _, _ in v]
        worst = sorted(v, key=lambda t: abs(t[0] - 1))[-3:]; worst=[(a,c) for a,c,_ in worst]
        dd = statistics.median([e for _, _, e in v]) * 1000
        print(f"  {k[0]:5} {k[1][:26]:26} {'SPACE' if k[2] else 'glyph'} n={len(rs):5} extra/em(median,1000ths)={dd:6.1f} median={statistics.median(rs):.3f} p10={sorted(rs)[len(rs)//10]:.3f} p90={sorted(rs)[9*len(rs)//10]:.3f} worst={[(round(a,2),c) for a,c in worst]}")
