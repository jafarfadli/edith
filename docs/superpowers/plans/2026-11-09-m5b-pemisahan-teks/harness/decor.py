"""Underlines (drawn rules just below a baseline) and link annotations over each tested paragraph.
python decor.py [OUT] [REFS]  -> prints counts; adds OUT/decor.json"""
import json, sys, collections
from pathlib import Path
import pymupdf
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/private/tmp/claude-501/audit3/out")
REFS = Path(sys.argv[2] if len(sys.argv) > 2 else "/Users/jafarfadli/Koding/edith/references")
R = json.loads((OUT / "classified.json").read_text())
docs, segs = {}, {}
out = []
for r in R:
    if r["pdf"] not in docs:
        docs[r["pdf"]] = pymupdf.open(REFS / r["pdf"])
    page = docs[r["pdf"]][r["page"]]
    key = (r["pdf"], r["page"])
    if key not in segs:
        hs = []
        for d in page.get_drawings():
            for it in d["items"]:
                if it[0] == "l" and abs(it[1].y - it[2].y) < 0.3:
                    hs.append((min(it[1].x, it[2].x), max(it[1].x, it[2].x), it[1].y))
                elif it[0] == "re" and it[1].height < 1.5 and it[1].width > 2:
                    hs.append((it[1].x0, it[1].x1, (it[1].y0 + it[1].y1) / 2))
        segs[key] = (hs, page.get_links())
    hs, links = segs[key]
    para = json.loads((OUT / r["slug"] / r["out"].replace(".pdf", ".op.json")).read_text())["paragraph"]
    under = 0
    for L in para["lines"]:
        x0, x1 = L["rect"]["x"], L["rect"]["x"] + L["rect"]["w"]
        for a, b, y in hs:
            if L["baseline"] + 0.02 * L["size"] <= y <= L["baseline"] + 0.25 * L["size"] and min(b, x1) - max(a, x0) > 0.3 * min(b - a, x1 - x0) and b - a < 1.5 * (x1 - x0) + 5:
                under += 1
    pr = pymupdf.Rect(para["rect"]["x"], para["rect"]["y"], para["rect"]["x"] + para["rect"]["w"], para["rect"]["y"] + para["rect"]["h"])
    lk = sum(1 for l in links if l["from"].intersects(pr))
    out.append({"pdf": r["pdf"], "page": r["page"], "id": r["id"], "underlines": under, "links": lk, "max_disp": r["max_disp"]})
(OUT / "decor.json").write_text(json.dumps(out, indent=1))
c = collections.defaultdict(lambda: [0, 0, 0, 0])
for o in out:
    v = c[o["pdf"]]
    if o["underlines"]:
        v[0] += 1; v[1] += (o["max_disp"] or 0) > 0.5
    if o["links"]:
        v[2] += 1; v[3] += (o["max_disp"] or 0) > 0.5
for k, v in c.items():
    print(f"{k}: underlined paragraphs {v[0]} (moved >0.5pt: {v[1]}), paragraphs under links {v[2]} (moved: {v[3]})")
print([(o["pdf"][:6], o["page"], o["id"], o["underlines"], o["max_disp"]) for o in out if o["underlines"]][:20])
