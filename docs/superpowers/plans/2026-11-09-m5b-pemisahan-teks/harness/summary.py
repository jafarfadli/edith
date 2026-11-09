"""Per-PDF word displacement table from OUT/results.json (compare.py), for the F1/F2 before/after comparisons.

Usage: python summary.py OUT

Words are the matched words of each exported paragraph (compare.py: same text, reading order). Columns:
  paras      paragraphs exported (an op was sent); `skipped` = unchanged paragraphs the UI would not send
  words      matched words; >0.5 / >2: displaced more than 0.5 / 2 pt
  line 0     words of the paragraph's first line (the one EDIT_MODE=typo edits)
  line 0 c   the same, less the shift the typed "x" causes by alignment (compare.py word_disp_c, F2): what is left is
             the layout's own error (spacing, scale, anchor); equal to `line 0` in the identity modes
  other      words of every other line; `kept` = the other lines that came back with the same words on the
             same line index (untouched by the edit and by any re-wrap)
  breaks     paragraphs whose line breaks changed (line count or a line's first word): multi-line re-wraps / single
             lines that wrapped
  off page   paragraphs with a word running past the page's right edge
  subst      paragraphs with a word drawn in another font than the original's (classify.py FONT_SUB)
  damage     paragraphs with a neighbouring word removed or moved
"""
import collections
import json
import sys
from pathlib import Path

OUT = Path(sys.argv[1])


def main() -> None:
    results = json.loads((OUT / "results.json").read_text())
    tags = {}
    if (OUT / "classified.json").exists():
        tags = {(r["pdf"], r["page"], r["id"]): r.get("tags", {}) for r in json.loads((OUT / "classified.json").read_text())}
    by: dict[str, list[dict]] = collections.defaultdict(list)
    for r in results:
        if r.get("editable"):
            by[r["pdf"]].append(r)
    print("| PDF | paras (skipped) | words | >0.5 | >2 | line 0 >0.5 / >2 (of) | line 0 c >0.5 / >2 | other >0.5 / >2 (of) | "
          "kept lines: words >0.5 / >2 (of) | paras with a word >2 | breaks (multi / single) | off page | subst | damage |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    total = collections.Counter()

    def row(name: str, c: collections.Counter) -> None:
        print(f"| {name} | {c['paras']} ({c['skipped']}) | {c['words']} | {c['w05']} | {c['w2']} | "
              f"{c['l0_05']} / {c['l0_2']} ({c['l0']}) | {c['l0c_05']} / {c['l0c_2']} | {c['o05']} / {c['o2']} ({c['o']}) | "
              f"{c['k05']} / {c['k2']} ({c['k']}) | {c['p2']} | {c['breaks']} ({c['br_multi']} / {c['br_single']}) | "
              f"{c['offpage']} | {c['subst']} | {c['damage']} |")

    for pdf, rs in sorted(by.items()):
        c = collections.Counter()
        for r in rs:
            if r.get("skipped"):
                c["skipped"] += 1
                continue
            if "word_disp" not in r:
                continue
            c["paras"] += 1
            same = {k for k, ws in enumerate(r["orig_line_words"]) if k > 0 and k < len(r["new_line_words"])
                    and r["new_line_words"][k] == ws}
            big = False
            for (lo, _ln, d), (_lo, _ln2, dc) in zip(r["word_disp"], r.get("word_disp_c", r["word_disp"])):
                c["words"] += 1
                c["w05"] += d > 0.5
                c["w2"] += d > 2
                big |= d > 2
                pre = "l0" if lo == 0 else "o"
                c[pre] += 1
                c[pre + "_05" if pre == "l0" else "o05"] += d > 0.5
                c[pre + "_2" if pre == "l0" else "o2"] += d > 2
                if lo == 0:
                    c["l0c_05"] += dc > 0.5
                    c["l0c_2"] += dc > 2
                if lo in same:
                    c["k"] += 1
                    c["k05"] += d > 0.5
                    c["k2"] += d > 2
            c["p2"] += big
            broke = bool(r["starts_diff"] or r["orig_lines"] != r["new_lines"])
            c["breaks"] += broke
            c["br_multi" if r.get("n_lines_api", 1) > 1 else "br_single"] += broke
            c["offpage"] += bool(r.get("overflow"))
            c["subst"] += "FONT_SUB" in tags.get((r["pdf"], r["page"], r["id"]), {})
            c["damage"] += bool(r["n_damaged"])
        row(pdf, c)
        total += c
    row("**all**", total)


if __name__ == "__main__":
    main()
