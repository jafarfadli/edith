"""Root-cause tags per paragraph from OUT/results.json (compare.py) + summary tables (markdown).

Usage: python classify.py [OUT]   -> prints tables, writes OUT/classified.json

Tags (a paragraph can carry several; `primary` = the one with the largest estimated contribution in pt):
  TRAIL_ANCHOR   right / centre / justified text anchored on the line bbox, which includes the trailing space glyph
  JUSTIFY_LEFT   a justified-looking line (wider gaps than spaces, not a tab) re-laid ragged (2-line justified
                 paragraphs come back as align "left"; hard-broken pieces of justified text end left-aligned)
  INDENT         a line whose left edge is not the paragraph's left edge (first-line indent, hanging indent,
                 text after a colon/tab in another column) re-laid at rect.x
  LEAD_WS        a line starting with space characters: the layout drops spaces at line start
  CENTER_AS_LEFT a centred multi-line paragraph (e.g. a 2-line table header "국적 / Nationality") detected as
                 align "left": every line is re-laid at the leftmost line's x
  TAB_GAP        an original gap > 3 pt wider than the re-laid spaces (tab stops, dot leaders, pieces joined
                 from different cells, bullet + tab)
  WORD_SPACING   gaps differ by 0.15–3 pt (Tw, per-word positioning as in Hancom, space width ≠ space glyph)
  CHAR_SPACING   glyph advances differ from the font program's (Tc, Tz horizontal scaling, TJ per-glyph offsets)
  JUSTIFY_WIDEN  justified paragraph whose box is widened past the original width (paragraphWidth measures an
                 original line at natural space width; Word had shrunk its spaces) -> every line overshoots
  OVERFLOW       the re-laid line runs off the page (glyphs clipped) or characters lost
  FONT_SUB       some words are drawn in a bundled substitute instead of the original font
"""
import collections
import json
import sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/private/tmp/claude-501/audit3/out")
BUNDLED = ("arimo", "tinos", "cousine", "carlito", "caladea", "noto", "inter", "lato", "lora", "merriweather")


def tags_of(r: dict) -> dict[str, float]:
    t: dict[str, float] = {}
    lines, api = r["lines"], r.get("api_lines") or []
    n = len(lines)
    align = r["align"]

    def add(tag, pt):
        t[tag] = max(t.get(tag, 0.0), round(abs(pt), 2))

    for k, ln in enumerate(lines):
        a = api[ln["line"]] if ln["line"] < len(api) else None
        last = k == n - 1
        dx0, drift, gm, gmin = ln["dx0"], ln["drift"], ln["gap_mean"], ln["gap_min"]
        trail = a["trail"] if a else 0
        # Anchor on a bbox with the trailing space.
        if align == "right" and dx0 > 0.5 and a and abs(dx0 - trail) < 0.6:
            add("TRAIL_ANCHOR", dx0)
        if align == "center" and abs(dx0) > 0.5:
            add("TRAIL_ANCHOR" if a and abs(dx0 - trail / 2) < 0.6 else "CENTER_ANCHOR", dx0)
        if align == "justify" and not last and drift > 0.5 and a and abs(drift - trail) < 1.0 and r["box_w"] <= r["rect_w"] + 0.5:
            add("TRAIL_ANCHOR", drift)
        # Left edge of the line.
        if align in ("left", "justify") and abs(dx0) > 0.5:
            add("LEAD_WS" if a and a["lead_ws"] and abs(dx0 + a["lead"]) < 1.0 else "INDENT", dx0)
        # Gaps.
        last_gm = lines[-1]["gap_mean"] if n else None
        justified_look = (gm is not None and gm < -0.3 and not last and align == "left" and n >= 2
                          and gm - gmin < 1.0 and not (last_gm is not None and last_gm < -0.3))
        if justified_look:
            add("JUSTIFY_LEFT", drift)
        elif gmin is not None and gmin < -3:
            add("TAB_GAP", min(drift, gmin, key=abs) if drift < -3 else gmin)
        elif gm is not None and abs(gm) >= 0.15 and not (align == "justify" and not last):
            add("WORD_SPACING", gm * max(1, ln["n"] - 1))
        if abs(r["char_delta"]) > 0.015:
            add("CHAR_SPACING", r["char_delta"] * ln["chars"])
    para = r.get("_para")
    if para and align == "left" and len(para["lines"]) >= 2 and t.get("INDENT"):
        rs = [L["rect"] for L in para["lines"]]
        centers = [x["x"] + x["w"] / 2 for x in rs]
        if max(centers) - min(centers) <= 1.5 and max(x["x"] for x in rs) - min(x["x"] for x in rs) > 1.0:
            t["CENTER_AS_LEFT"] = t.pop("INDENT")
    if align == "justify" and r["box_w"] > r["rect_w"] + 0.5:
        add("JUSTIFY_WIDEN", r["box_w"] - r["rect_w"] + (api[0]["trail"] if api else 0))
    if r["overflow"] or r["lost_chars"]:
        add("OVERFLOW", r["max_disp"] or 0)
    if any(f.startswith(BUNDLED) for f in r["new_fonts"]):
        add("FONT_SUB", 0.0)
    return t


def main():
    rows = json.loads((OUT / "results.json").read_text())
    R = [r for r in rows if r.get("out") and "cmp_error" not in r]
    for r in R:
        r["_para"] = json.loads((OUT / r["slug"] / r["out"].replace(".pdf", ".op.json")).read_text())["paragraph"]
        r["tags"] = tags_of(r)
        del r["_para"]
        moving = {k: v for k, v in r["tags"].items() if k != "FONT_SUB"}
        r["primary"] = max(moving, key=moving.get) if moving and (r["max_disp"] or 0) > 0.5 else None
    (OUT / "classified.json").write_text(json.dumps(R, indent=1, ensure_ascii=False))
    if not R:  # EDIT_MODE=identity: the UI sends nothing for an unchanged paragraph
        print("no paragraph exported:", sum(1 for r in rows if r.get("skipped")), "skipped as unchanged")
        return

    # Per-PDF summary.
    by = collections.defaultdict(list)
    for r in R:
        by[r["pdf"]].append(r)
    print("| PDF | paragraphs tested | max disp < 0.5 pt | 0.5–2 pt | > 2 pt | mean of max disp (pt) | worst (pt) | line-break diffs | glyph loss / overflow | font substituted | neighbour words damaged |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")

    def row(name, rs):
        n = len(rs)
        md = [r["max_disp"] if r["max_disp"] is not None else 999 for r in rs]
        pct = lambda k: f"{k} ({100 * k / n:.0f} %)"
        lb = sum(1 for r in rs if r["starts_diff"] or r["orig_lines"] != r["new_lines"])
        gl = sum(1 for r in rs if r["lost_chars"] or r["added_chars"] or r["overflow"])
        fs = sum(1 for r in rs if "FONT_SUB" in r["tags"])
        nd = sum(1 for r in rs if r["n_damaged"])
        print(f"| {name} | {n} | {pct(sum(m < 0.5 for m in md))} | {pct(sum(0.5 <= m <= 2 for m in md))} | "
              f"{pct(sum(m > 2 for m in md))} | {sum(md) / n:.2f} | {max(md):.1f} | {pct(lb)} | {pct(gl)} | {pct(fs)} | {pct(nd)} |")

    allr = []
    for pdf, rs in sorted(by.items()):
        row(pdf, rs)
        allr += rs
    row("**all**", allr)

    print("\n| root cause | paragraphs tagged (disp > 0.5 pt) | of them > 2 pt | primary cause (count) | max contribution (pt) | per PDF (tagged) |")
    print("|---|---|---|---|---|---|")
    moved = [r for r in allr if (r["max_disp"] or 0) > 0.5]
    tags = collections.Counter(t for r in moved for t in r["tags"])
    for tag, cnt in tags.most_common():
        big = sum(1 for r in moved if tag in r["tags"] and r["max_disp"] > 2)
        prim = sum(1 for r in moved if r["primary"] == tag)
        mx = max(r["tags"][tag] for r in moved if tag in r["tags"])
        per = collections.Counter(r["pdf"].split()[0] + ("" if r["pdf"].split()[0] != "Form" else " " + r["pdf"].split()[2][:5]) for r in moved if tag in r["tags"])
        print(f"| {tag} | {cnt} | {big} | {prim} | {mx} | {', '.join(f'{k} {v}' for k, v in per.most_common())} |")
    print("\nunclassified moved:", [(r["pdf"][:6], r["page"], r["id"], r["max_disp"]) for r in moved if not r["primary"]][:20])


if __name__ == "__main__":
    main()
