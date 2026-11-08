# Task 2: Segment paragraphs at rules, hard breaks, bullets, form rows and style changes

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Rewrite the paragraph grouping of `edith/paragraphs.py` so a form like the owner's Korean visa application comes out cell by cell instead of as 10-line blobs (reference page 1: g3 = heading + 8 bullets, g6 = two table cells, g15 = question + checkbox rows + name fields). Rules (Task 1): never join two pieces on one baseline across a vertical rule (replaces the unconditional 2-em join), never continue a block or a paragraph across a horizontal rule (a rule within 0.15 em under a baseline is an underline and does not count). Hard breaks: after a line that ended early — the next line's first word plus a space (0.25 em) would have fitted before the group's widest line — start a new paragraph; for CJK, a line starting with a Han/kana character has that character (plus following punctuation) as its first word, Hangul keeps word (eojeol) semantics. Lists: a line starting with a bullet glyph starts a paragraph, and a list item continues only on lines hanging past its bullet. Form rows: a line with a run of three spaces is laid out with spaces and stands alone. Style: a change of the dominant (size ±8 %, bold, colour) style starts a paragraph. CJK lines are joined without the soft-break space. Text is read with `rawdict` (character boxes give ink extents and first-word widths). Measured on the reference (5 pages): 172 → 258 paragraphs; paragraphs with 3+ lines 25 → 9 (all genuinely wrapped or centred blocks). Two fixtures of `make_paragraphs_pdf` were hand-placed lines that did not follow a wrap (paragraph A, the centred E); their texts change so they still are one paragraph.

**Files:**
- Modify: `apps/api/edith/paragraphs.py`
- Create: `apps/api/scripts/paragraph_overlay.py`
- Modify: `apps/api/tests/pdfs.py`
- Modify: `apps/api/tests/test_paragraphs.py`

**Interfaces:**
- Consumes: Task 1 `page_rules`, `Rules.h_between`, `Rules.v_between`.
- Produces: Same JSON shape as M2 (ids `g0…`, `rect`, `lines`, `runs`, `align`, `lineHeight`, `editable`). `tests.pdfs.make_form_table_pdf()`, `_wrap()`, `FORM_EN/FORM_JA/FORM_KO` (used by later tests); `scripts/paragraph_overlay.py <pdf> <outdir>` (PNG per page with paragraph boxes + counts, for eyeballing any PDF).

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/pdfs.py`:

```diff
diff --git a/apps/api/tests/pdfs.py b/apps/api/tests/pdfs.py
index 3d8862e..9cee223 100644
--- a/apps/api/tests/pdfs.py
+++ b/apps/api/tests/pdfs.py
@@ -81,7 +81,7 @@ def make_paragraphs_pdf() -> bytes:
     D heading 18 pt + body 12 pt · E centered · F rotated 90°."""
     doc = pymupdf.open()
     page = doc.new_page(width=595, height=842)
-    for i, text in enumerate(["Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A", "baris tiga akhir A."]):
+    for i, text in enumerate(["Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A yang", "berakhir di baris tiga A."]):
         page.insert_text((72, 100 + i * 14.4), text, fontname="helv", fontsize=12)
     page.insert_textbox(pymupdf.Rect(72, 180, 372, 260), LOREM, fontname="tiro", fontsize=11,
                         align=pymupdf.TEXT_ALIGN_JUSTIFY)
@@ -91,7 +91,7 @@ def make_paragraphs_pdf() -> bytes:
         page.insert_text((x, 320 + i * 14.4), text, fontname="helv", fontsize=12)
     page.insert_text((72, 420), "Judul Besar", fontname="hebo", fontsize=18)
     page.insert_text((72, 440), "Isi di bawah judul.", fontname="helv", fontsize=12)
-    for i, text in enumerate(["Baris tengah pertama yang lebar", "lebih pendek", "tengah"]):
+    for i, text in enumerate(["Baris tengah pertama yang lebar", "lebih pendek namun tetap", "seimbang"]):
         w = pymupdf.get_text_length(text, fontname="helv", fontsize=12)
         page.insert_text((297.5 - w / 2, 500 + i * 14.4), text, fontname="helv", fontsize=12)
     page.insert_text((500, 700), "Teks diputar", fontname="helv", fontsize=12, rotate=90)
@@ -269,3 +269,50 @@ def make_xfa_form_pdf() -> bytes:
     doc.xref_set_key(acro, "XFA", f"[(datasets) {xfa} 0 R]")
     doc.xref_set_key(cat, "AcroForm", f"{acro} 0 R")
     return doc.tobytes()
+
+
+def _wrap(text: str, font: pymupdf.Font, size: float, width: float, by_char: bool) -> list[str]:
+    """Greedy line breaks of `text` at `width`: at spaces, or after any character (`by_char`, CJK)."""
+    lines, line = [], ""
+    for piece in (list(text) if by_char else text.split(" ")):
+        candidate = line + piece if by_char or not line else f"{line} {piece}"
+        if line and font.text_length(candidate, size) > width:
+            lines.append(line)
+            line = piece
+        else:
+            line = candidate
+    return lines + [line]
+
+
+FORM_EN = "The applicant must write in block letters either in English or Korean and sign the form at the end."
+FORM_JA = "これは日本語の段落です。行は文字単位で折り返され、単語の間に空白はありません。最後の行は短い。"
+FORM_KO = "신청서상의 모든 질문에 대한 답변은 한글 또는 영문으로 기재해야 하며 사실에 근거하여 빠짐없이 작성해야 합니다."
+
+
+def make_form_table_pdf() -> bytes:
+    """A form page like Korean visa applications: an instruction list, a bordered table (labels on one baseline in
+    two cells, a label above a field rule in one text block, checkbox rows, wrapped text in a cell), a bold heading,
+    and paragraphs wrapped at 200 pt in Japanese (by character) and Korean (by word), each followed by a short line."""
+    doc = pymupdf.open()
+    page = doc.new_page(width=595, height=842)
+    cjk = pymupdf.Font("korea")
+    page.insert_font(fontname="AR", fontfile=str(FONT_FILES / "Arimo-Regular.ttf"))
+    for i, text in enumerate(["<How to fill out this form>", "• Fill out this form completely and correctly.",
+                              "• Write in block letters either in English or Korean.", "• Check all that apply."]):
+        page.insert_text((56, 80 + 12.5 * i), text, fontname="AR", fontsize=9)
+    page.draw_rect(pymupdf.Rect(50, 200, 545, 330), color=(0, 0, 0), width=0.5)
+    page.draw_line((300, 200), (300, 330), color=(0, 0, 0), width=0.5)
+    page.draw_line((50, 220), (545, 220), color=(0, 0, 0), width=0.5)
+    page.insert_text((103, 215), "1.1 Full name in English (as shown in passport)", fontname="helv", fontsize=9)
+    page.insert_text((306, 215), "1.2 Sex", fontname="helv", fontsize=9)
+    page.insert_text((56, 230), "Family Name", fontname="helv", fontsize=9)
+    page.insert_text((306, 245), "Long-term stay over 90 days      [   ]", fontname="cour", fontsize=9)
+    page.insert_text((306, 257), "Short-term stay below 90 days    [   ]", fontname="cour", fontsize=9)
+    assert page.insert_textbox(pymupdf.Rect(56, 250, 294, 328), FORM_EN, fontname="helv", fontsize=9) >= 0
+    page.insert_text((56, 360), "SECTION TWO: GENERAL CONDITIONS OF THE APPLICATION", fontname="hebo", fontsize=10)
+    page.insert_text((56, 372), "Body text right below the heading.", fontname="helv", fontsize=10)
+    for x, (text, by_char, font_name) in [(56, (FORM_JA, True, "japan")), (300, (FORM_KO, False, "korea"))]:
+        lines = _wrap(text, cjk, 10, 200, by_char) + ["短い行。" if by_char else "짧은 줄.", text[:12]]
+        for i, line in enumerate(lines):
+            page.insert_text((x, 420 + 14 * i), line, fontname=font_name, fontsize=10)
+    return doc.tobytes(garbage=3, deflate=True)
```

Modify `apps/api/tests/test_paragraphs.py`:

```diff
diff --git a/apps/api/tests/test_paragraphs.py b/apps/api/tests/test_paragraphs.py
index c80a3ef..8fd8cd0 100644
--- a/apps/api/tests/test_paragraphs.py
+++ b/apps/api/tests/test_paragraphs.py
@@ -2,7 +2,7 @@ import pymupdf
 import pytest
 
 from edith.paragraphs import extract_paragraphs
-from tests.pdfs import LOREM, make_edit_pdf, make_paragraphs_pdf
+from tests.pdfs import FONT_FILES, FORM_EN, FORM_JA, FORM_KO, LOREM, make_edit_pdf, make_form_table_pdf, make_paragraphs_pdf
 
 
 def paragraphs(data: bytes, resolve=None) -> list[dict]:
@@ -22,13 +22,13 @@ def page_with(draw) -> bytes:
 def test_boundaries_and_text():
     ps = paragraphs(make_paragraphs_pdf())
     assert [text(p) for p in ps] == [
-        "Paragraf A baris satu yang cukup panjang baris dua lanjutan paragraf A baris tiga akhir A.",
+        "Paragraf A baris satu yang cukup panjang baris dua lanjutan paragraf A yang berakhir di baris tiga A.",
         LOREM,
         "Paragraf C1 baris pertama yang panjang sekali akhir C1.",            # split from C2 by its indent
         "Paragraf C2 dimulai dengan indentasi baris pertama lalu berlanjut.",
         "Judul Besar",                                                        # split by the size change
         "Isi di bawah judul.",
-        "Baris tengah pertama yang lebar lebih pendek tengah",
+        "Baris tengah pertama yang lebar lebih pendek namun tetap seimbang",
         "Teks diputar",
     ]
     assert [p["id"] for p in ps] == [f"g{i}" for i in range(8)]
@@ -46,7 +46,7 @@ def test_lines_index_the_joined_text():
     p = paragraphs(make_paragraphs_pdf())[0]
     t = text(p)
     assert [t[ln["start"]:ln["end"]] for ln in p["lines"]] == [
-        "Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A", "baris tiga akhir A."]
+        "Paragraf A baris satu yang cukup panjang", "baris dua lanjutan paragraf A yang", "berakhir di baris tiga A."]
     assert [ln["baseline"] for ln in p["lines"]] == [100, 114.4, 128.8]
     assert p["lines"][0]["size"] == 12
     assert p["rect"]["x"] == 72 and p["lines"][0]["rect"]["x"] == 72
@@ -95,11 +95,13 @@ def test_hyphenated_soft_break_joins_without_space():
 
 def test_soft_break_space_lands_in_previous_run_when_styles_differ():
     def draw(pg):
-        pg.insert_text((72, 100), "Merah", fontname="helv", fontsize=12, color=(1, 0, 0))
+        w = pymupdf.get_text_length("Biru lalu ", fontname="helv", fontsize=12)
+        pg.insert_text((72, 100), "Biru lalu ", fontname="helv", fontsize=12, color=(0, 0, 1))
+        pg.insert_text((72 + w, 100), "Merah", fontname="helv", fontsize=12, color=(1, 0, 0))
         pg.insert_text((72, 114.4), "biru", fontname="helv", fontsize=12, color=(0, 0, 1))
     p = paragraphs(page_with(draw))[0]
-    assert [(r["text"], r["color"]) for r in p["runs"]] == [("Merah ", "#ff0000"), ("biru", "#0000ff")]
-    assert [(ln["start"], ln["end"]) for ln in p["lines"]] == [(0, 5), (6, 10)]
+    assert [(r["text"], r["color"]) for r in p["runs"]] == [("Biru lalu ", "#0000ff"), ("Merah ", "#ff0000"), ("biru", "#0000ff")]
+    assert [(ln["start"], ln["end"]) for ln in p["lines"]] == [(0, 15), (16, 20)]
 
 
 def test_line_ending_in_space_excludes_it_from_end():
@@ -109,3 +111,88 @@ def test_line_ending_in_space_excludes_it_from_end():
     p = paragraphs(page_with(draw))[0]
     assert text(p) == "satu dua tiga"
     assert [(ln["start"], ln["end"]) for ln in p["lines"]] == [(0, 8), (9, 13)]
+
+
+def test_form_table_segments_like_a_form():
+    assert [text(p) for p in paragraphs(make_form_table_pdf())] == [
+        "<How to fill out this form>",                    # ended early: a hard break
+        "• Fill out this form completely and correctly.",  # every bullet starts an item …
+        "• Write in block letters either in English or Korean.",
+        "• Check all that apply.",
+        "1.1 Full name in English (as shown in passport)",  # … a cell border keeps neighbours on one baseline apart
+        "1.2 Sex",
+        "Family Name",                                     # below the field rule, same text block
+        "Long-term stay over 90 days      [   ]",          # checkbox rows are laid out with spaces
+        "Short-term stay below 90 days    [   ]",
+        FORM_EN,                                           # wrapped text in a cell stays one paragraph
+        "SECTION TWO: GENERAL CONDITIONS OF THE APPLICATION",  # bold heading, though as wide as a full line
+        "Body text right below the heading.",
+        FORM_JA,                                           # wrapped by character, joined without spaces
+        "短い行。",
+        FORM_JA[:12],
+        FORM_KO,                                           # Korean wraps at spaces
+        "짧은 줄.",
+        FORM_KO[:12],
+    ]
+
+
+@pytest.mark.parametrize("rotation", [0, 90])
+@pytest.mark.parametrize("rule", [True, False])
+def test_vertical_rule_keeps_cells_on_one_baseline_apart(rotation, rule):
+    def draw(pg):
+        w = pymupdf.get_text_length("Left cell text", fontname="helv", fontsize=10)
+        pg.insert_text((100, 100), "Left cell text", fontname="helv", fontsize=10)
+        if rule:
+            pg.draw_line((100 + w + 5, 80), (100 + w + 5, 120))
+        pg.insert_text((100 + w + 10, 100), "Right cell", fontname="helv", fontsize=10)
+        pg.set_rotation(rotation)
+    got = [text(p) for p in paragraphs(page_with(draw))]
+    assert got == (["Left cell text", "Right cell"] if rule else ["Left cell text Right cell"])
+
+
+def test_underline_does_not_split_but_a_rule_between_lines_does():
+    def draw(pg):
+        for i, t in enumerate(["Sebuah paragraf dengan garis bawah", "pada baris pertamanya saja."]):
+            pg.insert_text((72, 100 + 14 * i), t, fontname="helv", fontsize=11)
+        pg.draw_line((72, 101.5), (200, 101.5), width=0.6)  # underline: 1.5 pt below the baseline
+        for i, t in enumerate(["Label di atas garis isian formulir", "Isian di bawah garis."]):
+            pg.insert_text((72, 200 + 14 * i), t, fontname="helv", fontsize=11)
+        pg.draw_line((60, 205), (400, 205), width=0.5)  # a field rule between the lines
+    assert [text(p) for p in paragraphs(page_with(draw))] == [
+        "Sebuah paragraf dengan garis bawah pada baris pertamanya saja.",
+        "Label di atas garis isian formulir", "Isian di bawah garis."]
+
+
+def test_hard_break_after_a_line_that_ended_early():
+    """An address: each line ended before the widest one with room for the next line's first word. (The widest
+    line itself can't end early, so a block whose first line is the longest keeps its second line.)"""
+    lines = ["Jl. Merdeka 17", "Gambir", "Jakarta Pusat, DKI Jakarta 10110"]
+
+    def draw(pg):
+        for i, t in enumerate(lines):
+            pg.insert_text((72, 100 + 13 * i), t, fontname="helv", fontsize=11)
+    assert [text(p) for p in paragraphs(page_with(draw))] == lines
+
+
+def test_list_item_continues_only_past_its_bullet():
+    def draw(pg):
+        pg.insert_font(fontname="AR", fontfile=str(FONT_FILES / "Arimo-Regular.ttf"))
+        rows = [(72, "• Butir pertama yang cukup panjang sehingga"), (80, "berlanjut ke baris kedua."),
+                (72, "• Butir kedua yang juga cukup panjang hingga"), (72, "tidak menggantung di bawah butir.")]
+        for i, (x, t) in enumerate(rows):
+            pg.insert_text((x, 100 + 13 * i), t, fontname="AR", fontsize=11)
+    assert [text(p) for p in paragraphs(page_with(draw))] == [
+        "• Butir pertama yang cukup panjang sehingga berlanjut ke baris kedua.",
+        "• Butir kedua yang juga cukup panjang hingga", "tidak menggantung di bawah butir."]
+
+
+def test_first_word_of_cjk_is_one_character():
+    from edith.paragraphs import _first_word
+
+    def chars(text: str, w: float = 10.0) -> list[dict]:
+        return [{"c": c, "bbox": (i * w, 0, (i + 1) * w, 10)} for i, c in enumerate(text)]
+    assert _first_word(chars("  word next")) == 40      # spaces skipped, up to the next space
+    assert _first_word(chars("日本語")) == 10            # Han / kana: one character …
+    assert _first_word(chars("本、次")) == 20            # … plus punctuation right after it
+    assert _first_word(chars("한국어 단어")) == 30        # Hangul: a word (eojeol)
+    assert _first_word(chars("   ")) == 0
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_paragraphs.py`

Expected: FAIL — the form fixture, the rule, list and hard-break tests fail on the old grouping. Spike output (last lines):

```
E       ImportError: cannot import name '_first_word' from 'edith.paragraphs' (<repo>/apps/api/edith/paragraphs.py)
tests/test_paragraphs.py:190: ImportError
FAILED tests/test_paragraphs.py::test_form_table_segments_like_a_form - Asser...
FAILED tests/test_paragraphs.py::test_vertical_rule_keeps_cells_on_one_baseline_apart[True-0]
FAILED tests/test_paragraphs.py::test_vertical_rule_keeps_cells_on_one_baseline_apart[True-90]
FAILED tests/test_paragraphs.py::test_underline_does_not_split_but_a_rule_between_lines_does
FAILED tests/test_paragraphs.py::test_hard_break_after_a_line_that_ended_early
FAILED tests/test_paragraphs.py::test_list_item_continues_only_past_its_bullet
FAILED tests/test_paragraphs.py::test_first_word_of_cjk_is_one_character - Im...
7 failed, 14 passed in 0.14s
```

- [ ] **Step 3: Implement**

Modify `apps/api/edith/paragraphs.py`:

```diff
diff --git a/apps/api/edith/paragraphs.py b/apps/api/edith/paragraphs.py
index f2c38a9..b750d80 100644
--- a/apps/api/edith/paragraphs.py
+++ b/apps/api/edith/paragraphs.py
@@ -1,16 +1,25 @@
 """Original text of a page as editable paragraphs (spec: Ekstraksi paragraf)."""
+import unicodedata
 from dataclasses import dataclass
 from statistics import median
 from typing import Callable
 
 import pymupdf
 
+from edith.rules import Rules, page_rules
+
 # No TEXT_PRESERVE_LIGATURES: "ﬁ" comes out as "fi", which every font can draw.
 FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
 GAP_FACTOR = 1.5     # a gap larger than this × the block's usual line spacing starts a paragraph
-SIZE_CHANGE = 0.2    # so does a dominant font size change larger than 20 %
+SIZE_CHANGE = 0.08   # so does a dominant font size change larger than 8 %
 INDENT_EM = 0.5      # and a first-line indent of at least half an em
 JOIN_EM = 2.0        # pieces on one baseline closer than this many ems are one line (MuPDF splits wide justified gaps)
+SPACE_EM = 0.25      # assumed width of the space before a wrapped word
+UNDERLINE_EM = 0.15  # a rule this close below a baseline underlines it rather than separating lines
+CAP_EM = 0.6         # a rule must lie this far above the next line's baseline to separate it
+BULLETS = frozenset("•‣▪■□○●◦※►▶➢✓√·∙")
+HANG_EM = 0.3       # a list item's next line must start this far right of its bullet to continue it
+TAB_GAP = "   "      # a line with this many spaces in a row is laid out with spaces (form rows, columns), not prose
 
 FontResolver = Callable[[dict], dict]  # pymupdf span → FontRef JSON
 
@@ -25,6 +34,11 @@ class _Line:
     baseline: float
     size: float
     horizontal: bool
+    ink_x0: float = 0.0      # left edge of the first non-space character
+    ink_x1: float = 0.0      # right edge of the last non-space character
+    first_word: float = 0.0  # width of the first word (CJK: first character), see _first_word()
+    style: tuple = ()        # (size, bold, color) of the span style with the most characters
+    tabular: bool = False    # spaced out with runs of spaces (see TAB_GAP): never part of a wrapped paragraph
 
     @property
     def text(self) -> str:
@@ -39,20 +53,79 @@ def _num(v: float) -> float:
     return round(v, 2)
 
 
+def _hangul(c: str) -> bool:
+    return "가" <= c <= "힣" or "ᄀ" <= c <= "ᇿ" or "㄰" <= c <= "㆏"
+
+
+def _wide(c: str) -> bool:
+    """CJK ideographs, kana and full-width forms: lines may wrap after any of them (no spaces between words).
+    Not Hangul: Korean puts spaces between words (eojeol)."""
+    return bool(c) and unicodedata.east_asian_width(c) in ("W", "F") and not _hangul(c)
+
+
+def _first_word(chars: list[dict]) -> float:
+    """Width of the line's first word: its characters up to the first space; for a line starting with a
+    CJK ideograph or kana, only that character (plus punctuation right after it)."""
+    i = 0
+    while i < len(chars) and chars[i]["c"].isspace():
+        i += 1
+    if i == len(chars):
+        return 0.0
+    j = i + 1
+    if _wide(chars[i]["c"]):
+        while j < len(chars) and unicodedata.category(chars[j]["c"]) in ("Pe", "Pf", "Po"):
+            j += 1
+    else:
+        while j < len(chars) and not chars[j]["c"].isspace() and not _wide(chars[j]["c"]):
+            j += 1
+    return chars[j - 1]["bbox"][2] - chars[i]["bbox"][0]
+
+
+def _style(spans: list[dict]) -> tuple:
+    weight: dict[tuple, int] = {}
+    for s in spans:
+        key = (round(s["size"], 1), bool(s["flags"] & pymupdf.TEXT_FONT_BOLD), s["color"])
+        weight[key] = weight.get(key, 0) + len(s["text"].strip())
+    return max(weight, key=weight.get)
+
+
 def _line(raw: dict) -> _Line | None:
-    spans = [dict(s, text=_clean(s["text"])) for s in raw["spans"] if s["text"]]
-    if not spans or not "".join(s["text"] for s in spans).strip():
+    spans, chars = [], []
+    for s in raw["spans"]:
+        text = _clean("".join(c["c"] for c in s["chars"]))
+        if text:
+            spans.append({k: v for k, v in s.items() if k != "chars"} | {"text": text})
+            chars.extend(dict(c, c=_clean(c["c"])) for c in s["chars"])
+    ink = [c for c in chars if not c["c"].isspace()]
+    if not ink:
         return None
     main = max(spans, key=lambda s: (s["size"], len(s["text"].strip())))
     dx, dy = raw["dir"]
     x0, y0, x1, y1 = raw["bbox"]
     return _Line(spans=spans, x0=x0, y0=y0, x1=x1, y1=y1, baseline=main["origin"][1], size=main["size"],
-                 horizontal=abs(dx - 1) < 1e-3 and abs(dy) < 1e-3)
-
-
-def _same_row(a: _Line, b: _Line) -> bool:
+                 horizontal=abs(dx - 1) < 1e-3 and abs(dy) < 1e-3, ink_x0=ink[0]["bbox"][0],
+                 ink_x1=ink[-1]["bbox"][2], first_word=_first_word(chars), style=_style(spans),
+                 tabular=TAB_GAP in "".join(c["c"] for c in chars).strip())
+
+
+def _ruled(a: _Line, b: _Line, rules: Rules) -> bool:
+    """A drawn rule separates line `a` from the line `b` below it: a horizontal one between them under both
+    (not an underline of `a`), or a vertical one between their columns."""
+    if rules.h_between(a.baseline + UNDERLINE_EM * a.size, b.baseline - CAP_EM * b.size,
+                       max(a.ink_x0, b.ink_x0), min(a.ink_x1, b.ink_x1)):
+        return True
+    top, bottom = min(a.y0, b.y0), max(a.y1, b.y1)
+    if b.ink_x0 >= a.ink_x1:
+        return rules.v_between(a.ink_x1, b.ink_x0, top, bottom)
+    if a.ink_x0 >= b.ink_x1:
+        return rules.v_between(b.ink_x1, a.ink_x0, top, bottom)
+    return False
+
+
+def _same_row(a: _Line, b: _Line, rules: Rules) -> bool:
     return (a.horizontal and b.horizontal and abs(a.baseline - b.baseline) <= 0.5
-            and -0.5 <= b.x0 - a.x1 <= JOIN_EM * max(a.size, b.size))
+            and -0.5 <= b.x0 - a.x1 <= JOIN_EM * max(a.size, b.size)
+            and not rules.v_between(a.ink_x1, b.ink_x0, min(a.y0, b.y0), max(a.y1, b.y1)))
 
 
 def _join(a: _Line, b: _Line) -> _Line:
@@ -61,7 +134,8 @@ def _join(a: _Line, b: _Line) -> _Line:
         spans.append(dict(a.spans[-1], text=" "))
     spans.extend(b.spans)
     return _Line(spans=spans, x0=min(a.x0, b.x0), y0=min(a.y0, b.y0), x1=max(a.x1, b.x1), y1=max(a.y1, b.y1),
-                 baseline=a.baseline, size=max(a.size, b.size), horizontal=True)
+                 baseline=a.baseline, size=max(a.size, b.size), horizontal=True, ink_x0=a.ink_x0,
+                 ink_x1=b.ink_x1, first_word=a.first_word, style=_style(spans), tabular=a.tabular or b.tabular)
 
 
 def _spacing(lines: list[_Line]) -> float | None:
@@ -73,20 +147,36 @@ def _spread(values: list[float]) -> float:
     return max(values) - min(values)
 
 
-def _continues(block: list[_Line], line: _Line) -> bool:
+def _continues(block: list[_Line], line: _Line, rules: Rules) -> bool:
     """MuPDF often puts the last line of a centered or right-aligned paragraph in a block of its own:
-    `line` continues `block` when it sits right below it, overlapping horizontally, at the same size."""
+    `line` continues `block` when it sits right below it, overlapping horizontally, at the same size,
+    with no rule in between."""
     prev = block[-1]
     gap = line.baseline - prev.baseline
     spacing = _spacing(block) or 1.2 * prev.size
     return (prev.horizontal and line.horizontal and 0 < gap <= GAP_FACTOR * spacing
             and abs(line.size - prev.size) <= SIZE_CHANGE * prev.size
-            and line.x0 < prev.x1 and line.x1 > prev.x0)
+            and line.x0 < prev.x1 and line.x1 > prev.x0 and not _ruled(prev, line, rules))
 
 
-def _split(lines: list[_Line]) -> list[list[_Line]]:
+def _restyled(a: _Line, b: _Line) -> bool:
+    """The dominant style changes between two lines (a heading above body text, a coloured label)."""
+    (size_a, bold_a, color_a), (size_b, bold_b, color_b) = a.style, b.style
+    return bold_a != bold_b or color_a != color_b or abs(size_a - size_b) > SIZE_CHANGE * max(size_a, size_b)
+
+
+def _bulleted(line: _Line) -> bool:
+    return line.text.lstrip()[:1] in BULLETS
+
+
+def _ends_item(prev: _Line, line: _Line) -> bool:
+    """`line` does not continue the list item `prev` starts: continuation lines hang past the bullet."""
+    return _bulleted(prev) and line.ink_x0 < prev.ink_x0 + HANG_EM * prev.size
+
+
+def _split(lines: list[_Line], rules: Rules) -> list[list[_Line]]:
     spacing = _spacing(lines)
-    left = min(line.x0 for line in lines)
+    left = min(line.ink_x0 for line in lines)
     tol = max(1.0, 0.1 * max(line.size for line in lines))
     # In right-aligned text every line moves its left edge: that is not a first-line indent.
     right_aligned = len(lines) >= 2 and _spread([ln.x1 for ln in lines]) <= tol < _spread([ln.x0 for ln in lines])
@@ -101,17 +191,37 @@ def _split(lines: list[_Line]) -> list[list[_Line]]:
             not line.horizontal or not prev.horizontal
             or gap <= 0
             or (spacing is not None and gap > GAP_FACTOR * spacing)
-            or abs(line.size - prev.size) > SIZE_CHANGE * prev.size
+            or _restyled(prev, line)
+            or _bulleted(line) or _ends_item(prev, line)
+            or prev.tabular or line.tabular
+            or _ruled(prev, line, rules)
             or (not right_aligned
-                and line.x0 > left + INDENT_EM * line.size      # indented first line …
-                and line.x0 > prev.x0 + INDENT_EM * line.size   # … more than the line before …
-                and line.x1 >= prev.x1 - INDENT_EM * line.size)  # … whose right edge doesn't move in (not centered text)
+                and line.ink_x0 > left + INDENT_EM * line.size         # indented first line …
+                and line.ink_x0 > prev.ink_x0 + INDENT_EM * line.size  # … more than the line before …
+                and line.x1 >= prev.x1 - INDENT_EM * line.size)        # … whose right edge doesn't move in (not centered)
         )
         if new:
             groups.append([line])
         else:
             groups[-1].append(line)
-    return groups
+    return [part for group in groups for part in _hard_breaks(group)]
+
+
+def _hard_breaks(lines: list[_Line]) -> list[list[_Line]]:
+    """Splits after every line that ended early: the next line's first word (plus a space) would have fit in
+    the room left before the group's widest line. Wrapped text, ragged or justified, has no such line; lists,
+    form rows, addresses and short lines do."""
+    if len(lines) < 2:
+        return [lines]
+    widest = max(line.ink_x1 for line in lines)
+    out = [[lines[0]]]
+    for line, nxt in zip(lines, lines[1:]):
+        need = nxt.first_word + (0.0 if _wide(nxt.text.lstrip()[:1]) else SPACE_EM * nxt.size)
+        if widest - line.ink_x1 > need:
+            out.append([nxt])
+        else:
+            out[-1].append(nxt)
+    return out
 
 
 def _align(lines: list[_Line]) -> str:
@@ -154,7 +264,8 @@ def _paragraph(pid: str, lines: list[_Line], resolve: FontResolver | None) -> di
     for i, line in enumerate(lines):
         if i > 0:
             prev_text = lines[i - 1].text
-            if not (prev_text.endswith((" ", "-")) or line.text.startswith(" ")):
+            if not (prev_text.endswith((" ", "-")) or line.text.startswith(" ")
+                    or _wide(prev_text[-1:]) or _wide(line.text[:1])):  # CJK wraps between characters
                 runs[-1]["text"] += " "  # the soft line break becomes a space in the previous run
                 offset += 1
         start = offset
@@ -192,10 +303,12 @@ def _rect(x0: float, y0: float, x1: float, y1: float) -> dict:
 
 
 def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None) -> list[dict]:
-    """Paragraphs of `page` in content order, ids `g0`, `g1`, … (stable for a given file). Coordinates
-    are unrotated-CropBox points. `resolve` maps a span to its run FontRef (None → runs get font None)."""
+    """Paragraphs of `page` in content order, ids `g0`, `g1`, … (stable for a given file and extraction
+    version). Coordinates are unrotated-CropBox points. `resolve` maps a span to its run FontRef (None →
+    runs get font None). Text is never merged across a drawn rule (table borders, separators)."""
+    rules = page_rules(page)
     blocks: list[list[_Line]] = []
-    for block in page.get_text("dict", flags=FLAGS)["blocks"]:
+    for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
         if block.get("type", 0) != 0:
             continue
         starts_block = True
@@ -203,15 +316,15 @@ def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None)
             line = _line(raw)
             if line is None:
                 continue
-            if blocks and _same_row(blocks[-1][-1], line):
+            if blocks and _same_row(blocks[-1][-1], line, rules):
                 blocks[-1][-1] = _join(blocks[-1][-1], line)
-            elif blocks and (not starts_block or _continues(blocks[-1], line)):
+            elif blocks and (not starts_block or _continues(blocks[-1], line, rules)):
                 blocks[-1].append(line)
             else:
                 blocks.append([line])
             starts_block = False
     paragraphs: list[dict] = []
     for lines in blocks:
-        for group in _split(lines):
+        for group in _split(lines, rules):
             paragraphs.append(_paragraph(f"g{len(paragraphs)}", group, resolve))
     return paragraphs
```

Create `apps/api/scripts/paragraph_overlay.py`:

```python
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
```

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q`
Expected: 384 passed.

If the owner's reference PDF is present (untracked `references/`), also run:
`cd apps/api && uv run python -m scripts.paragraph_overlay "../../references/Visa Application Form (1).pdf" /tmp/overlay`
Expected: `page 1: 60 paragraphs, 3 with 3+ lines` … `total: 258 paragraphs` (before this task: 35 on page 1, 172 in total). Compare `/tmp/overlay/page-1.png` with `shots/seg-after-p1.png`.

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add apps/api/edith/paragraphs.py apps/api/scripts/paragraph_overlay.py apps/api/tests/pdfs.py apps/api/tests/test_paragraphs.py
git commit -m "feat(api): segment paragraphs at rules, hard breaks, bullets, form rows and style changes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
