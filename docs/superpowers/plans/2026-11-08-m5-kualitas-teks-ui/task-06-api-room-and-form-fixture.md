# Task 6: Room to grow for single-line paragraphs; Korean form E2E fixture

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** With cells split, a table label is a paragraph exactly as wide as its text, and the web keeps a paragraph's width when it is edited (M2) — so any longer edit of a label wrapped onto a second line (seen in the spike's E2E). Single-line paragraphs now get `maxWidth`: how far they may grow from their left edge — up to the first vertical rule or other text to their right on their height, or the right margin (the page's left text margin, mirrored), less 2 pt. Task 16 makes the editor use it. Also adds the E2E stand-in for the owner's form: `make_korean_form_pdf()` (Korean + Latin in a cmap-less CID subset named Dotum, instructions, a bordered table whose two labels share a baseline 12 pt apart across a cell border, checkbox rows) written to `apps/web/e2e/fixtures/form-ko.pdf` by `scripts/e2e_form_pdf.py`.

**Files:**
- Modify: `apps/api/edith/paragraphs.py`
- Create: `apps/api/scripts/e2e_form_pdf.py`
- Modify: `apps/api/tests/pdfs.py`
- Modify: `apps/api/tests/test_paragraphs.py`
- Modify: `apps/api/tests/test_text.py`
- Create: `apps/web/e2e/fixtures/form-ko.pdf` (generated — see Step 3)

**Interfaces:**
- Consumes: Tasks 1–2 (`Rules.vertical`, `_Line` ink extents), Task 4 (`_renamed`).
- Produces: Paragraph JSON `maxWidth?: number` (single-line horizontal paragraphs only); `tests.pdfs.make_korean_form_pdf()`, `KO_LABEL`; `apps/web/e2e/fixtures/form-ko.pdf`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/pdfs.py`:

```diff
diff --git a/apps/api/tests/pdfs.py b/apps/api/tests/pdfs.py
index b5adbca..31151ab 100644
--- a/apps/api/tests/pdfs.py
+++ b/apps/api/tests/pdfs.py
@@ -363,3 +363,30 @@ def fake_cjk_pack(root: Path, files: tuple[str, ...] = ("NotoSansKR-Regular.ttf"
     for name in files:
         (root / "files" / "cjk" / name).write_bytes(droid)
     return root
+
+
+KO_LABEL = "1.1 성명 Full name in English"
+
+
+def make_korean_form_pdf() -> bytes:
+    """A stand-in for the owner's Korean visa form (apps/web/e2e/fixtures/form-ko.pdf): Korean and Latin text in a
+    cmap-less CID subset named "Dotum" (as Hancom exports it), an instruction list, and a bordered table whose two
+    labels share one baseline 12 pt apart across a cell border, a field label under a rule and two checkbox rows."""
+    doc = pymupdf.open()
+    page = doc.new_page(width=595, height=842)
+    droid = pymupdf.Font("korea")
+    page.insert_font(fontname="DO", fontbuffer=_renamed(droid.buffer, "Dotum"))
+    for i, text in enumerate(["<신청서 작성방법>", "※ 신청서는 한글 또는 영문으로 작성합니다.", "※ 해당 칸에 표시를 하시기 바랍니다."]):
+        page.insert_text((56, 80 + 13 * i), text, fontname="DO", fontsize=10)
+    page.draw_rect(pymupdf.Rect(50, 150, 545, 240), color=(0, 0, 0), width=0.5)
+    page.draw_line((300, 150), (300, 240), color=(0, 0, 0), width=0.5)
+    page.draw_line((50, 175), (545, 175), color=(0, 0, 0), width=0.5)
+    page.insert_text((294 - droid.text_length(KO_LABEL, 10), 167), KO_LABEL, fontname="DO", fontsize=10)
+    page.insert_text((306, 167), "1.2 성별 Sex", fontname="DO", fontsize=10)
+    page.insert_text((56, 195), "성 Family Name", fontname="DO", fontsize=10)
+    page.insert_text((306, 195), "남성 Male      [   ]", fontname="DO", fontsize=10)
+    page.insert_text((306, 210), "여성 Female    [   ]", fontname="DO", fontsize=10)
+    doc.subset_fonts()
+    for xref, *_rest in page.get_fonts(full=True):
+        doc.xref_set_key(xref, "BaseFont", "/EDITHB+Dotum")
+    return doc.tobytes(garbage=3, deflate=True)
```

Modify `apps/api/tests/test_paragraphs.py`:

```diff
diff --git a/apps/api/tests/test_paragraphs.py b/apps/api/tests/test_paragraphs.py
index a6050d7..4b785ba 100644
--- a/apps/api/tests/test_paragraphs.py
+++ b/apps/api/tests/test_paragraphs.py
@@ -201,3 +201,21 @@ def test_first_word_of_cjk_is_one_character():
     assert _first_word(chars("本、次")) == 20            # … plus punctuation right after it
     assert _first_word(chars("한국어 단어")) == 30        # Hangul: a word (eojeol)
     assert _first_word(chars("   ")) == 0
+
+
+def test_korean_form_fixture_segments_cell_by_cell():
+    from tests.pdfs import KO_LABEL, make_korean_form_pdf
+    assert [text(p) for p in paragraphs(make_korean_form_pdf())] == [
+        "<신청서 작성방법>", "※ 신청서는 한글 또는 영문으로 작성합니다.", "※ 해당 칸에 표시를 하시기 바랍니다.",
+        KO_LABEL, "1.2 성별 Sex", "성 Family Name", "남성 Male      [   ]", "여성 Female    [   ]"]
+
+
+def test_single_lines_get_room_up_to_the_next_rule_or_text():
+    from tests.pdfs import make_korean_form_pdf
+    ps = {text(p): p for p in paragraphs(make_korean_form_pdf())}
+    assert ps["1.1 성명 Full name in English"]["maxWidth"] == pytest.approx(300 - 2 - ps["1.1 성명 Full name in English"]["rect"]["x"], abs=0.01)  # cell border
+    left = min(p["rect"]["x"] for p in ps.values())  # 56
+    assert ps["1.2 성별 Sex"]["maxWidth"] == pytest.approx(595 - left - 2 - 306, abs=0.01)  # margin before the table side (545)
+    assert ps["<신청서 작성방법>"]["maxWidth"] == pytest.approx(595 - left - 2 - left, abs=0.01)  # mirrored left margin
+    wrapped = paragraphs(make_paragraphs_pdf())[0]
+    assert len(wrapped["lines"]) == 3 and "maxWidth" not in wrapped  # wrapped text keeps its measure
```

Modify `apps/api/tests/test_text.py`:

```diff
diff --git a/apps/api/tests/test_text.py b/apps/api/tests/test_text.py
index 33ed261..832d7d1 100644
--- a/apps/api/tests/test_text.py
+++ b/apps/api/tests/test_text.py
@@ -136,3 +136,11 @@ def test_cjk_fonts_substitute_with_the_pack(tmp_path):
     with TestClient(create_app(settings)) as c:
         f = by_name(text_of(c, make_cid_subset_pdf()))
     assert (f["Dotum"]["substitute"]["family"], f["Batang"]["substitute"]["family"]) == ("Noto Sans KR", "Noto Serif KR")
+
+
+def test_korean_form_fixture_reuses_its_dotum_subset(client):
+    from tests.pdfs import make_korean_form_pdf
+    body = text_of(client, make_korean_form_pdf())
+    (font,) = body["fonts"]
+    assert (font["name"], font["reusable"]) == ("Dotum", True)
+    assert {p["runs"][0]["font"]["kind"] for p in body["pages"][0]["paragraphs"]} == {"original"}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_paragraphs.py tests/test_text.py`

Expected: FAIL — single-line paragraphs have no `maxWidth`. Spike output (last lines):

```
E       KeyError: 'maxWidth'
tests/test_paragraphs.py:216: KeyError
FAILED tests/test_paragraphs.py::test_single_lines_get_room_up_to_the_next_rule_or_text
1 failed, 35 passed in 1.85s
```

- [ ] **Step 3: Implement**

Modify `apps/api/edith/paragraphs.py`:

```diff
diff --git a/apps/api/edith/paragraphs.py b/apps/api/edith/paragraphs.py
index c4f1c15..3c7dfff 100644
--- a/apps/api/edith/paragraphs.py
+++ b/apps/api/edith/paragraphs.py
@@ -22,6 +22,7 @@ UNDERLINE_EM = 0.15  # a rule this close below a baseline underlines it rather t
 CAP_EM = 0.6         # a rule must lie this far above the next line's baseline to separate it
 BULLETS = frozenset("•‣▪■□○●◦※►▶➢✓√·∙")
 HANG_EM = 0.3       # a list item's next line must start this far right of its bullet to continue it
+ROOM_PAD = 2.0       # pt left free before whatever ends a single line's room (a rule, other text)
 TAB_GAP = "   "      # a line with this many spaces in a row is laid out with spaces (form rows, columns), not prose
 
 FontResolver = Callable[[dict], dict]  # pymupdf span → FontRef JSON
@@ -312,7 +313,8 @@ def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None,
     """Paragraphs of `page` in content order, ids `g0`, `g1`, … (stable for a given file and extraction
     version). Coordinates are unrotated-CropBox points. `resolve` maps a span to its run FontRef (None →
     runs get font None); a paragraph with a span `locked` accepts is not editable. Text is never merged
-    across a drawn rule (table borders, separators)."""
+    across a drawn rule (table borders, separators). A single-line paragraph also gets `maxWidth`: how wide
+    it may grow when edited (see _room)."""
     rules = page_rules(page)
     blocks: list[list[_Line]] = []
     for block in page.get_text("rawdict", flags=FLAGS)["blocks"]:
@@ -330,8 +332,24 @@ def extract_paragraphs(page: pymupdf.Page, resolve: FontResolver | None = None,
             else:
                 blocks.append([line])
             starts_block = False
+    every = [line for lines in blocks for line in lines]
+    right_margin = page.rect.width - min((line.ink_x0 for line in every), default=0.0)  # the left margin, mirrored
     paragraphs: list[dict] = []
     for lines in blocks:
         for group in _split(lines, rules):
-            paragraphs.append(_paragraph(f"g{len(paragraphs)}", group, resolve, locked))
+            paragraph = _paragraph(f"g{len(paragraphs)}", group, resolve, locked)
+            if len(group) == 1 and group[0].horizontal:
+                paragraph["maxWidth"] = _room(group[0], every, rules, right_margin)
+            paragraphs.append(paragraph)
     return paragraphs
+
+
+def _room(line: _Line, every: list[_Line], rules: Rules, right_margin: float) -> float:
+    """Width a single-line paragraph may grow to when edited (from its left edge): up to the first vertical rule
+    or other text to its right on its height, or the right margin, less ROOM_PAD; at least its own width."""
+    mid = (line.y0 + line.y1) / 2
+    ends = [right_margin]
+    ends += [s.at for s in rules.vertical if s.at > line.ink_x1 - 0.5 and s.lo <= mid <= s.hi]
+    ends += [o.ink_x0 for o in every if o is not line and o.ink_x0 > line.ink_x1 - 0.5
+             and min(o.y1, line.y1) - max(o.y0, line.y0) > 0.5 * min(o.y1 - o.y0, line.y1 - line.y0)]
+    return _num(max(line.x1 - line.x0, min(ends) - ROOM_PAD - line.x0))
```

Create `apps/api/scripts/e2e_form_pdf.py`:

```python
"""Writes apps/web/e2e/fixtures/form-ko.pdf (tests.pdfs.make_korean_form_pdf) for the Korean form E2E test."""
from edith.settings import REPO_ROOT
from tests.pdfs import make_korean_form_pdf

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "form-ko.pdf"

if __name__ == "__main__":
    OUT.write_bytes(make_korean_form_pdf())
    print("wrote", OUT)
```

Write the E2E fixture (binary, committed): `cd apps/api && uv run python -m scripts.e2e_form_pdf` → `wrote …/apps/web/e2e/fixtures/form-ko.pdf` (≈14 KB). Do not regenerate `apps/web/src/lib/fixtures/text.json` yet: its web tests change with Task 14.

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q` → 422 passed.

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json 2>/dev/null; rm -f apps/web/AGENTS.md
git add apps/api/edith/paragraphs.py apps/api/scripts/e2e_form_pdf.py apps/api/tests/pdfs.py apps/api/tests/test_paragraphs.py apps/api/tests/test_text.py apps/web/e2e/fixtures/form-ko.pdf
git commit -m "feat(api): room to grow for single-line paragraphs; Korean form E2E fixture" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
