# Audit: where the text goes when an original paragraph is edited

Date: 2026-11-09. Code: `main` @ 35cbe29. This is an audit only: nothing in the repo was changed.
The complaint: **"when I edit a paragraph of an imported PDF, its text moves."**
Scope: everything that happens after a paragraph has been picked: the runs the editor gets, the web layout
(`paragraphBox` / `layoutText`), the `text.edit` op, and the bake (redaction + `draw_text_box`).
Whether the paragraph was segmented correctly is covered by the parallel `AUDIT.md`. Where a bad segmentation
makes the re-layout worse, this doc says so and points there.

## TL;DR

* **338 of 688 editable paragraphs (49 %) move by more than 2 pt when re-baked without a single text change.
  Only 315 (46 %) stay within 0.5 pt, and almost all of those are 1–2-word labels.** Just 17 of the 144
  multi-line paragraphs stay within 0.5 pt.
* In the real UI, committing an unchanged paragraph does nothing (`paragraphsEqual`, textEdit.ts:198). But
  **any change, even one character, redraws the whole paragraph with Edith's own layout**, so every word
  gets the offset measured here, not just the edited word. That matches the complaint exactly.
* Vertical placement is correct: the first baseline is anchored, line spacing matches (max |dy| 0.26 pt),
  sizes, colours and bold are unchanged, and no neighbouring text was damaged. **All the error is
  horizontal.** It comes from Edith replacing the PDF's actual glyph and word positions with "font advance +
  one space glyph + one left edge".
* Top root causes, counted over paragraphs that moved more than 0.5 pt (one paragraph can have several):
  1. **CHAR_SPACING**: 242 paragraphs (primary cause in 142). The PDF's glyph advances are not the font
     program's: Hancom `Tz 94.7 %` plus TJ condensing in the Visa form, letter-spaced headings (Tc / TJ),
     Calibri Tc ≈ 0.08 pt. Edith lays out and bakes with raw hmtx advances.
  2. **WORD_SPACING**: 204 (primary in 45). The gaps between words are not the space glyph: Hancom places
     each word individually (Dotum gaps are 1.40 × the space glyph), and Word sometimes shrinks spaces.
  3. **LEAD_WS**: 106 (primary in 49). Lines that start with spaces: `layoutText` drops spaces at line
     start, while `rect.x` still includes them.
  4. **TAB_GAP**: 55 (primary in 37). Tabs and tab stops (TOC, "Nama : ....", bullets) become one space:
     `_clean` turns `\t` into `" "` and `_join` glues column pieces with one space.
  5. **TRAIL_ANCHOR + JUSTIFY_WIDEN**: 31 + 10. The line bbox includes the trailing space glyph, so justified
     and right-aligned lines overshoot by one space. `paragraphWidth` also widens justified boxes to the
     natural width of a line Word had squeezed.
  6. **INDENT / CENTER_AS_LEFT / JUSTIFY_LEFT**: 30 + 12 + 19. Hanging indents and centred 2-line cells are
     re-laid at one left edge, and 2-line justified paragraphs come back as `left` (`_align` needs ≥ 3 lines).
  7. **OVERFLOW**: 8, all in the Visa form. Inflated DotumChe lines run off the page and get clipped
     (e.g. "provide details of the spouse" is lost).
  8. **FONT_SUB**: 59 paragraphs drawn in Tinos or Carlito although the original font is embedded and
     reusable. Two subsets on one page share a BaseFont name, which makes the name ambiguous.
* With a real 1-character edit (`EDIT_MODE=typo`), **33 of 108 multi-line paragraphs re-wrap**: a word jumps
  to another line, a ~400 pt move. 40 single-line cells wrap onto a second line. The cause is that the wrap
  width is the widest original line, which leaves no slack.
* Most effective fix: **leave lines the user did not touch alone.** Neither redact nor redraw them. Then fix
  the per-glyph and per-word metrics (Tc / Tz / Tw, tabs, indents, trailing space) for the lines that are
  redrawn. See the fix list below.

## Method

**Harness:** `harness/` next to this file. It is a copy of `/private/tmp/claude-501/audit3/harness/`.

1. `identity.harness.ts` runs inside vitest from `apps/web`, so it uses the real web modules, real fontkit,
   the real bundled fonts (`apps/web/public/fonts`) and the original fonts served by
   `GET /documents/{id}/fonts/{ref}`. For every reference PDF it uploads the file to the API and calls
   `GET /text`. Then, for every editable paragraph:
   * It runs `paragraphStartBox` (`prepareRuns` + `paragraphBox`). The real function is in
     `components/editor/text/textEdit.ts`, which pulls in the stores, so the harness repeats its two lines.
   * It then runs the commit path: `normalizeRuns` → `resolveLoadedRuns` → `relayout` → `keepBaseline`.
     `keepBaseline` is copied because it is module-private.
   * The text is unchanged. This is the op the UI would send for an edit with no visible change.
   * It bakes the op with `POST /documents/{id}/export`, with a `pages.layout` that keeps just that page,
     `paragraphs_version: 2`, and `subset_fonts` on as in production.
   * It also exports the page with no edit (`p<i>_null.pdf`) as the pixel baseline.
2. `compare.py` uses PyMuPDF `rawdict` and takes words from glyph origins. A word ends at a space or at a
   gap of more than 0.15 em, so per-word positioning without a space glyph is handled. For each paragraph it
   compares the original page and the export:
   * words matched by text (difflib) and their displacement at the origin of the first glyph (x, baseline);
   * per-line dx of the first word, drift along the line, and gap and word-width changes;
   * font, size, colour and bold;
   * line-start changes;
   * lost or added characters;
   * neighbour words that disappeared or moved;
   * a pixel diff inside the paragraph and outside it, against the no-edit export, at 144 dpi, ignoring
     ±1 px and anti-aliasing.
3. `classify.py` tags root causes per paragraph with measured heuristics (rules in its docstring), estimates
   each cause's contribution in pt and picks a primary cause.
4. `decor.py` counts underline rules and link annotations over each paragraph. `probe_widths.py` measures, per
   font, the PDF pen advance against the font-program advance. `probe_ops.py` counts Tc / Tw / Tz operators.
   `words.py` prints the original and exported words of one paragraph for debugging.
5. `EDIT_MODE=typo` is the same pipeline with one real edit: an `x` appended to the first word.

**Re-run after fixes** (servers only on 19400; no Next server and no `next build` needed):

```bash
docs/superpowers/plans/2026-11-09-m5b-pemisahan-teks/harness/run.sh /private/tmp/claude-501/audit3/out
# one PDF:            ONLY="Visa" .../run.sh <out>
# 1-char edit variant: EDIT_MODE=typo .../run.sh <out_typo>
# one paragraph:      PARA="3:g6" ONLY="Panduan" .../run.sh <out>;  python harness/words.py Panduan_Kerja_Praktek 3 g6 <out>
```

`run.sh` starts a private API on `127.0.0.1:19400` if none answers there. Its data goes to `<out>/.data`
and the server keeps running afterwards. Port 19401 is reserved for a later Playwright check of the on-screen
editor and is not used by this harness. Results: `<out>/classified.json`, one record per paragraph, plus the
exported PDFs and ops.

**Caveats.**
* Displacement is measured per word: the origin of its first glyph. Kerning inside a word shows up as word
  width.
* Tags are heuristics. 3 moved paragraphs (0.52–0.56 pt) stay unclassified. Contributions are estimates.
* The on-screen rich editor (a DOM contenteditable with CSS `line-height` and browser justification) is
  **not** measured. Only the baked export is. See "Not covered".

## Results per PDF (identity edit)

| PDF | paragraphs tested | max disp < 0.5 pt | 0.5–2 pt | > 2 pt | mean of max disp (pt) | worst (pt) | line-break diffs | glyph loss / overflow | font substituted | neighbour words damaged |
|---|---|---|---|---|---|---|---|---|---|---|
| Form Permohonan Surat Pengantar.pdf | 15 | 12 (80 %) | 0 (0 %) | 3 (20 %) | 1.44 | 9.4 | 0 | 0 | 0 | 0 |
| Form Pernyataan Pertanggungjawaban Kegiatan.pdf | 29 | 9 (31 %) | 5 (17 %) | 15 (52 %) | 12.89 | 168.5 | 0 | 0 | 0 | 0 |
| Panduan Kerja Praktek.pdf (12 not editable) | 362 | 245 (68 %) | 11 (3 %) | 106 (29 %) | 5.06 | 169.8 | 0 | 0 | 57 (16 %) | 0 |
| Surat Keterangan Magang.pdf | 24 | 12 (50 %) | 1 (4 %) | 11 (46 %) | 32.36 | 276.6 | 0 | 0 | 0 | 0 |
| Visa Application Form.pdf | 258 | 37 (14 %) | 18 (7 %) | 203 (79 %) | 11.97 | 136.7 | 0 | 8 (3 %) | 2 (1 %) | 0 |
| **all** | **688** | **315 (46 %)** | **35 (5 %)** | **338 (49 %)** | **8.85** | **276.6** | **0** | **8 (1 %)** | **59 (9 %)** | **0** |

Word-weighted mean displacement (pt per word): Form Permohonan 2.74, Form Pernyataan 5.33, Panduan 2.82,
Surat 8.17, Visa **10.55**. Multi-line paragraphs within 0.5 pt: Form Pernyataan 2/11, Panduan 13/86,
Surat 2/11, Visa 0/35. The paragraphs that survive have a median of 2 words.

**What is fine:**
* Baselines: max |dy| 0.26 pt. `paragraphBox` puts the first baseline on the original one and `keepBaseline`
  keeps it there. `lineHeight` (median baseline delta) matches the uniform originals.
* No size drift (≤ 0.004 pt; `_num` rounds to 0.01 pt, ≤ 0.1 pt over a full line), no colour or bold
  drift, and no line-break changes for an unchanged commit.
* No glyph loss except the 8 overflow cases.
* No neighbouring word removed or moved: the REDACT_BAND thin bands work.
* Link annotations are kept (`restore_links`).
* The outside-pixel diffs that remain (17 px per page on Panduan p12, ~750 px on Visa p0) show up for every
  paragraph of the page and also without any paragraph change. They come from `doc.subset_fonts()`
  re-subsetting the page's original fonts and changing the hinting. Glyphs are visually identical (checked
  at 8×) and nothing moves. Cosmetic, noted only.

## Root-cause catalogue

Counts: paragraphs with max displacement > 0.5 pt that carry the tag; in brackets, how many of them move more
than 2 pt, and how many have it as their primary cause.

| # | root cause | tagged (> 2 pt / primary) | max contribution | where |
|---|---|---|---|---|
| 1 | CHAR_SPACING: glyph advances ≠ font program (Tc, Tz, TJ) | 242 (214 / 142) | 87 pt | Visa 214, Panduan 19, Surat 5, Forms 4 |
| 2 | WORD_SPACING: gap ≠ space glyph (Tw, per-word positioning, squeezed spaces) | 204 (192 / 45) | 46 pt | Visa 185, Panduan 10, Forms 7, Surat 2 |
| 3 | LEAD_WS: leading spaces dropped | 106 (106 / 49) | 168 pt | Visa 92, Panduan 13, Form 1 |
| 4 | TAB_GAP: tabs / tab stops / joined cells → one space | 55 (55 / 37) | 48 pt (90 pt with indent) | Panduan 35, Visa 9, Form 8, Surat 3 |
| 5 | TRAIL_ANCHOR: line bbox includes the trailing space (right, justify, centre) | 31 (30 / 31) | 4.1 pt | Panduan 26, Surat 3, Form 2 |
| 6 | INDENT: per-line left edges (hanging indent, mis-joined cells) → one left edge | 30 (28 / 19) | 277 pt | Visa 13, Panduan 9, Form 4, Surat 4 |
| 7 | JUSTIFY_LEFT: justified text re-laid ragged | 19 (19 / 16) | 49 pt | Panduan 18, Visa 1 |
| 8 | CENTER_AS_LEFT: centred multi-line cell detected as left | 12 (12 / 12) | 41 pt | Visa 10, Panduan 2 |
| 9 | CENTER_ANCHOR: centred line re-centred on a different width | 11 (8 / 1) | 7 pt | Visa 8, Forms 2, Surat 1 |
| 10 | JUSTIFY_WIDEN: justified box widened past the original width | 10 (10 / 10) | 17 pt | Panduan 8, Surat 1, Visa 1 |
| 11 | OVERFLOW: line runs off the page, glyphs clipped | 8 (8 / 8) | 125 pt | Visa 8 |
| 12 | FONT_SUB: drawn with a bundled substitute although the original is reusable | 59 paragraphs in total (28 of them also move) | (shapes, not positions) | Panduan 57, Visa 2 |

### 1. CHAR_SPACING: Edith uses hmtx advances, but the PDF does not

**Mechanism.** `textWidth` (lib/fonts.ts:45) and `layoutText` measure with the font program's advances.
`draw_text_box` (bake/text.py:81) writes with `TextWriter.append`, which uses the same advances and has no
character spacing, horizontal scaling or per-glyph offsets. The originals contain:
* **Visa (Hancom):** `Tz 94.737` on 1 676 text objects (plus 95.238 and 94.118), and TJ arrays that
  condense every glyph. Pen advance / program advance is 0.93 at the median (`probe_widths.py`: Dotum
  −38/1000 em per glyph, DotumChe −34, Haansoft Batang −41, TNR-Bold −36). DotumChe, which is monospaced in
  the program (0.5 em Latin), is placed proportionally: `p`, `l`, `i` are at 0.69×.
* **Surat:** letter-spaced headings. TimesNewRomanPS-BoldMT gets +97/1000 em per glyph (+1.9 pt at
  20 pt), TrebuchetMS +12/1000.
* **Forms:** Calibri with `Tc` ≈ 0.08 pt on some lines (`Tc 0.24–0.26` in the content stream).

**Examples:**
* Surat p0 g0 "INSTITUT TEKNOLOGI BANDUNG": TNR-Bold 20.04 pt. `INSTITUT` is 109.6 pt wide → 95.7 pt.
  `TEKNOLOGI` x 250.96 → 233.34 (−17.6). `BANDUNG` 400.33 → 362.94 (**−37.4 pt**).
* Visa p1 g38 "5.2 배우자 인적사항 Personal Information of the applicant's Spouse …": `Information` is
  38.7 pt wide → 53.4 pt. `Spouse` 270.2 → 357.0 (+86.8). The line runs to x = 596 on a 595 pt page, and
  "provide details of the spouse" (26 characters) is clipped. This is the OVERFLOW case (#11).
* Form Permohonan p0 g2: a centred address line in Calibri with Tc ≈ 0.08. `Jalan` moves +4.43 and
  `40132` −1.36. Both the centre anchor and the drift are wrong.

### 2. WORD_SPACING: the gap is not a space glyph

**Mechanism.** In `layoutText` a space is a token with the font's space advance, and `placeSegments` merges a
run's words into one segment (layout.ts:138). The bake then draws the PDF's own space glyph. The originals
use other gaps:
* Hancom positions every word itself. Dotum gaps are 1.40× the space glyph (+132/1000 em; the known
  3.96 pt against 2.67 pt), DotumChe 0.93×.
* Word sometimes shrinks spaces on justified or full lines (Panduan p1 g1: gaps 0.3 pt narrower than the
  space).

**Examples:**
* Visa p0 g0 "■ 출입국관리법 시행규칙 [별지 제17호서식]": every gap −1.30 pt, so the last word is at −4.84.
* Visa p3 g11 (a form row with `[   ]` boxes): words drift by up to 49.7 pt, together with LEAD_WS.
* Panduan p1 g1 "4. PENULISAN LEMBAR KEGIATAN …" (TNR-Bold 14.04): +0.33 per gap, +2.63 at `PRAKTEK`.

### 3. LEAD_WS: leading spaces are dropped, but `rect.x` still includes them

**Mechanism.** The API's line and paragraph rects start at the MuPDF line bbox (`line.x0`,
paragraphs.py:293/302), which includes leading space glyphs. `layoutText` drops spaces at the start of
every line (layout.ts:76 `if (current.length === 0) continue`). The first word therefore lands where the
first space was. Hancom and Word forms indent with runs of spaces constantly (Visa: 92 paragraphs).

**Examples:**
* Form Pernyataan p0 g23: a line of 60 spaces, so the content moves **−168.5 pt**.
* Panduan p10 g8 "              . ………………..": −42.0.
* Panduan p10 g6 "    Disetujui :": −12.1.
* Panduan p18 g9 "    Term:": −30.9.
* Visa p4 g22 "      …  Applicant Name": −136.7.

### 4. TAB_GAP: tab stops and column gaps collapse into one space

**Mechanism.**
* `_clean` replaces `\t` with `" "` (paragraphs.py:56).
* `_join` merges pieces on one baseline up to `JOIN_EM = 2` em apart with one space (paragraphs.py:141,
  JOIN_EM at :19).
* The layout then measures one space. Everything after a tab slides left by the width of the tab minus one
  space.

**Examples:**
* Panduan p5 g5 "Bab I⇥Pendahuluan" (TOC): `Pendahuluan` 144.02 → 122.32 (**−21.7**). Drawn in Tinos as well
  (#12).
* Form Pernyataan p0 g6 "Nama Mahasiswa⇥:⇥……": `:` −5.75, the dot leader −11.29. g10: −89.9.
* Panduan p4 g2 "1. Nama Mahasiswa / NIM : 2. …": −32.8.
* Bullets with a tab (Panduan p1 g14/g15, p14 g15–g17 "•⇥…"): −9.2 each.
* Panduan p3 g6 (journal table): "23/5/2026" and "Pengenalan…" sit in different cells joined into one line,
  then wrapped. −6.7 inside the line and −78.5 for the continuation lines (#6).

### 5. TRAIL_ANCHOR and 10. JUSTIFY_WIDEN: the right edge is wrong

**Mechanism (TRAIL_ANCHOR).** The line rect and the paragraph rect end at the MuPDF bbox `x1`, which includes
the trailing space glyph (paragraphs.py:293/302; `_Line.ink_x1` exists but is not used for the rect). The
measured trailing whitespace is 3.0 pt for TNR 12 and 2.6 pt for Calibri 11. `paragraphBox` uses `rect.w`
as the layout width (paragraphs.ts:31, :82), so:
* justified lines stretch to the margin plus one space;
* right-aligned lines end one space too far right;
* centred lines move half a space.

**Mechanism (JUSTIFY_WIDEN).** `paragraphWidth` = `max(rect.w, natural width of each original line)`
(paragraphs.ts:31). When Word had squeezed a justified line (gaps 2.34–2.5 pt against a 3.0 pt space, or a
double space), its natural width is larger than the column. The whole box widens and every justified line
overshoots.

**Examples:**
* Panduan p0 g4 (justify, 3 lines): the last word of lines 1–2 moves **+2.98 / +2.61** past the margin.
  Trailing whitespace is 3.09 / 3.00.
* Form Pernyataan p0 g4 (right): "FRM/STEI/KEU/SOP‐04/03‐00 / 04 November 2019", +2.79 / +2.75.
* Panduan p0 g5 (justify, 7 lines, "…praktek.␣␣Melalui…"): box 471.11 → 473.76. Each justified line ends
  **+5.6 to +5.8** past the margin.
* Panduan p16 g4 (justify, 6 lines): +8.2.

### 6. INDENT and 8. CENTER_AS_LEFT: one left edge for every line

**Mechanism.** `paragraphBox` gives the layout one `rect.x` = the leftmost line. `layoutText` starts every
line at x = 0 (left) and has no first-line or hanging indent. `_align` (paragraphs.py:242) checks "left"
first. For a 2-line paragraph the "rest" is a single line, so a centred 2-line cell (short line above a
longer one) comes back as `left`.

**Genuine layout cases:**
* Hanging indents: Form Pernyataan p0 g16 / g19 "2. Akan …". Line 2 moves 110.70 → 93.78 (**−16.9**), and
  line 1 loses its tab (−6.2).
* Bullets: Panduan p5 g24, p18 g15 (−13.6 to −18).
* Visa p4 g4 / g10 / g13 / g14 / g16 (numbered notes, −12.7 to −18).
* CENTER_AS_LEFT: Visa p3 g6 "국적 / Nationality" (`국적` 375.88 → 364.60, −11.3), Visa p3 g43 (−40.9),
  and 10 Visa table headers in total.

**Segmentation-induced** (the cell joins are in AUDIT.md's scope; the re-layout multiplies them):
* Surat p0 g14 "NIM / 1.": `NIM` 404.59 → 127.94 (**−276.7**).
* Surat p0 g16 (−262.6), Surat p0 g9 (−133).
* Panduan p4 g5 / g6 / g8 (": / 4. Lembaga…", −164 to −170).

### 7. JUSTIFY_LEFT: justified text comes back ragged

**Mechanism.** `_align` returns `justify` only for **≥ 3 lines** with equal right edges
(paragraphs.py:249). A 2-line justified paragraph is `left`, and its stretched first line is re-laid with
natural spaces. (No justified paragraph contained a hard break in this corpus, so the
`hardBreaks` → last-line-left path was not triggered.)

**Examples:** Panduan p0 g6 (−13.6 at the end of line 1), p7 g0 (−45.9), p16 g24 (−42.4), p19 g1 (**−48.8**),
p6 g1 (−22.2). 18 in Panduan.

### 9. CENTER_ANCHOR

Centred lines are re-centred on `rect.w` (which includes the trailing space) with a different line width (from
CHAR_SPACING). Examples: Form Permohonan / Pernyataan g2 (+4.4 at the first word), Surat p0 g2 (+5.1), Visa
centred cells. Fixing #1 and #5 fixes this.

### 11. OVERFLOW

A single-line paragraph's width is `max(rect.w, natural width, maxWidth)`. When CHAR_SPACING inflates the
natural width past the page, nothing clamps it. Visa p1 g38 (26 characters lost), p3 g30 (13), p3 g37 (7),
p1 g25 (7), p4 g6, p4 g14 / g16 (1–3), p2 g42 (1). PyMuPDF clips them at the MediaBox.

### 12. FONT_SUB: a reusable original font gets substituted

**Mechanism.** `span_fonts` (doc_fonts.py:116–124) maps a span's font name to the page's font with that name.
When two fonts on the page share a name (Word embeds two subsets of TimesNewRomanPSMT, f10 and f46, or two of
Calibri), the key becomes `None`, and `resolve` (extract.py:56–59) falls back to the bundled substitute.

**Effect:** Panduan p5 (24 paragraphs), p6 (12), p10 (8) are drawn in **Tinos**, and p18 (13) in **Carlito**.
Positions survive because the fonts are metric-compatible, but the glyph shapes visibly change. The Visa title
uses Type3 fonts (T2 / T3), which are not reusable, and gets Noto Sans KR / Arimo: "VISA APPLICATION FORM"
moves −23.3 because the Type3 widths are letter-spaced (#1).

(Not a substitution: `Calibri-Bold` subsets whose program name is "Calibri Regular" are re-embedded
correctly; bold flags match.)

### Decorations and links

8 tested paragraphs sit over an underline rule and 1 under a link (Surat p0 g21, the `mailto:` address). All
of them move (by 4–23 pt), and the drawn underline and the link rectangle stay where the old text was. After
a real edit they cannot follow, because runs never carry `underline` for original text. Low count, but
visible.

## The 1-character edit variant (`EDIT_MODE=typo`)

An `x` is appended to the first word, a real edit, through the same commit path:
* **33 of 108 multi-line paragraphs re-wrap.** One or more words move to another line (≈ 400 pt
  displacement). By alignment: left 18, justify 10, centre 4, right 1. By PDF: Panduan 15, Visa 8, Form 6,
  Surat 4.
* For `left`, the wrap width is the widest original line (`paragraphWidth`), so a paragraph whose first line
  is the widest has no slack. The real column (margin) is wider.
* For justified paragraphs, the greedy wrap at natural space width breaks earlier than Word, which squeezes
  spaces.
* **40 of 464 single-line paragraphs wrap onto a 2nd line** and run into the text below. 37 of them are Visa
  cells whose `maxWidth` room was already used up by the CHAR_SPACING inflation.

## Severity for the owner's complaint

1. **Visa (Hancom forms): critical.** 79 % of paragraphs move by more than 2 pt. Every word slides right
   progressively (Tz plus TJ condensing ignored, plus per-word gaps), by up to 125 pt, off the page, with
   characters lost. Lines indented with spaces jump left. Editing any cell or note makes it look broken.
2. **Panduan and Surat (Word documents): high.**
   * Justified body text overshoots the right margin by 3–8 pt (TRAIL_ANCHOR / JUSTIFY_WIDEN).
   * 2-line justified paragraphs turn ragged by up to 49 pt.
   * TOC entries and form rows lose their tab alignment (5–90 pt).
   * Letter-spaced headings shrink by 37 pt.
   * One edit in 15 of 52 multi-line Panduan paragraphs re-wraps a word.
   * Tinos / Carlito shapes on 57 paragraphs make even "unmoved" text look different.
3. **Forms (Form Permohonan / Pernyataan): medium–high.** Tab-aligned colons and dot leaders, bullets with
   tabs, and hanging indents move 5–168 pt.
4. **Not a contributor:** vertical position, line spacing, size, colour, bold, neighbour damage, links.

## Prioritised fix list

Order: by how many paragraphs and points each fix removes, and how directly it answers "my text moved".

**P0. Do not redraw what did not change (fixes every cause for untouched lines).**
* Idea: when a line's text, style and line break are the same as the original line, keep the original glyphs.
  Do not add its redaction band and do not draw its segments.
* With a typo fix in one line, the other lines of the paragraph would be exact, whatever Tz, TJ, tabs or
  indents the original used.
* Web: `paragraphBox` / `layoutText` must honour the original line breaks as forced breaks for the unchanged
  lines before (and, once the reflow settles, after) the edit. Today only `hardBreaks` (paragraphs.ts:36)
  forces breaks, and only for lines that ended early. Mark those layout lines with the original line index.
* Schema: optional `LayoutLine.source?: number` in packages/ops (schema.json + src types) and
  `apps/api/edith/ops.py` `LayoutLine`.
* API:
  * `redaction_rects` / `text_edit_redact` (bake/text.py:98–113) skip kept lines;
  * `draw_text_box` (bake/text.py:56) skips segments of kept lines;
  * validate that a kept line still matches the original text, and fall back to redrawing if not.
* On screen: `maskRects` (paragraphs.ts:94) and the ParagraphLayer cover only the lines that are redrawn.
* Follow-up on the edited line itself: keep the words before the caret at their original x (the API already
  has per-character origins in `rawdict`; expose word x per line) and shift only the rest.

**P1. Glyph and word metrics of redrawn text (CHAR_SPACING 242, WORD_SPACING 204, OVERFLOW 8, CENTER_ANCHOR 11).**
* API (`_paragraph` `add()`, paragraphs.py:268–277) measures per span what `probe_widths.py` measures:
  * horizontal scale (Tz: a constant ratio of pen advance to program advance);
  * character spacing (the constant extra per glyph);
  * word spacing (the extra per space, or per-word gaps).
* It emits them as optional run fields, e.g. `hScale`, `charSpacing`, `wordSpacing`. Schema: packages/ops
  `Run` and ops.py `Run`.
* Web: `textWidth` / `charOffsets` (lib/fonts.ts:45–60) and `layoutText` apply them. `placeSegments` must not
  merge words across spaces when `wordSpacing ≠ 0` (layout.ts:138).
* Bake: `draw_text_box` applies `hScale` with a per-segment `morph` (or a TextWriter per scale), and
  `charSpacing` through per-glyph segments, which the schema already allows.
* Clamp single-line widths to the page and to `maxWidth` (paragraphs.ts:81–82).
* Without P0, this is the only fix that makes the Visa form usable.

**P2. Left edges: LEAD_WS 106, INDENT 30, CENTER_AS_LEFT 12.**
* API:
  * use the ink extents `_Line.ink_x0` / `ink_x1` for line and paragraph rects (paragraphs.py:293, 302);
  * emit leading spaces as an indent rather than as text;
  * emit `firstIndent` / `restIndent` per paragraph (the x of line 1 and of line 2 relative to `rect.x`).
* `_align` (paragraphs.py:242–256): test centre (equal centres, unequal x0) before left for 2-line paragraphs.
* Web: `layoutText` offsets the first and following lines by the indents, and keeps leading whitespace of a
  logical paragraph's first line instead of dropping it (layout.ts:76).
* Schema: optional `TextBox.indent`.
* Cell joins that produce the 160–277 pt cases: see AUDIT.md (`_same_row` / `_continues`).

**P3. Right edge and justification: TRAIL_ANCHOR 31, JUSTIFY_WIDEN 10, JUSTIFY_LEFT 19, typo re-wraps.**
* Rect right = `ink_x1` (same change as P2). This removes the one-space overshoot of justify, right and centre.
* `paragraphWidth` (paragraphs.ts:30) for `justify`: the width is the original ink width, never the
  natural width. Lines that are wider at natural spacing must keep their original break and compress (the
  `extra` in layout.ts:122 may be negative), which needs P0's forced breaks.
* `_align` (paragraphs.py:249): detect justification on 2-line paragraphs (and single justified lines split
  off by segmentation) from stretched spaces (space pen advance > 1.1 × space glyph) or a right edge on the
  column margin.
* Wrap width for multi-line `left` paragraphs: let the API measure the column room, as `_room` does for
  single lines (`maxWidth`, paragraphs.py:358), so a 1-character edit does not re-wrap.

**P4. Tabs: TAB_GAP 55.**
* Keep `\t` (paragraphs.py:56) and emit the tab-stop x positions per paragraph. Do the same for `_join` gaps
  larger than 1 em (paragraphs.py:141).
* `layoutText` advances a tab to the next stop.
* Schema: optional `TextBox.tabs: number[]`.
* P0 already covers tabbed lines the user does not touch.

**P5. Font identity: FONT_SUB 59 paragraphs.**
* `span_fonts` (doc_fonts.py:116–124): when several page fonts share a name, pick the one whose program
  covers every character of the span (subsets differ), or accept any of them when all are reusable and
  cover it. Do not return `None`, which forces the substitute in `resolve` (extract.py:58).

**P6. Decorations.**
* Detect underline rules under a line into `run.underline`, and remove the rule together with the line,
  so the redrawn text brings its own underline.
* Keep link rects attached to the moved words, or at least warn. Low count.

**P7. Cosmetic.** Export re-subsets every font (`doc.subset_fonts()`, bake/__init__.py:212) once a text edit
embeds one, which changes the rasterisation of untouched text slightly (no movement). Optional: subset only the
fonts the bake added.

## Not covered

* The **on-screen editor** while typing (TextEditor.tsx:118–129: a DOM box at `rect.x / rect.y`, CSS
  `line-height` half-leading, browser justification, `fontKerning: none`). CSS puts the first baseline at
  `top + (lineHeight − (ascent + descent)) / 2 + ascent` (hhea metrics), while the layout puts it at
  `top + ascent` (fontkit). The text can therefore jump vertically when a session opens or closes, even though
  the export is right. A Playwright check on 19400 / 19401 would measure this.
* Edits that change styles, paste or delete across lines. Only identity and 1-character append were run.
* Non-editable paragraphs (12, Panduan): never redrawn.

## Files

* This doc: `docs/superpowers/plans/2026-11-09-m5b-pemisahan-teks/AUDIT-EDIT-FIDELITY.md`.
* Harness (re-runnable): `docs/superpowers/plans/2026-11-09-m5b-pemisahan-teks/harness/`:
  * `run.sh`
  * `identity.harness.ts`
  * `vitest.config.mts`
  * `compare.py`
  * `classify.py`
  * `decor.py`
  * `words.py`
  * `probe_widths.py`
  * `probe_ops.py`
* Working copy and full outputs: `/private/tmp/claude-501/audit3/`:
  * `out/`: identity: per-paragraph PDFs, ops, `results.json`, `classified.json`, `decor.json`
  * `out_typo/`: 1-character edit
  * `harness/`
