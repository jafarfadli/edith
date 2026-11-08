# M5b audit: paragraph segmentation on the owner's reference PDFs

Audit only. No code was changed. Repo state: `main` at 35cbe29 (`PARAGRAPHS_VERSION = 2`).
Inputs are the five untracked files in `references/`. Probe scripts and full outputs are in
`/private/tmp/claude-501/audit2/` (outside the repo; see Appendix A). Annotated crops are in `shots/`.

Owner complaint (paraphrased): *text separation still needs strengthening: many misses and some not quite right;
as a result, the text position changes when edited.*

## TL;DR

The segmentation is not the main reason text moves. Lines almost never re-wrap (0 of 144 multi-line paragraphs
re-wrap when opened unchanged), and the line height is right everywhere (no baseline moves more than 1 pt). What
moves is the horizontal position of the words. **364 of 688 editable paragraphs (53 %) move more than 1 pt, 313 (45 %)
more than 3 pt and 140 (20 %) more than 10 pt** as soon as the web lays them out again with the declared
`rect`/`align`/`lineHeight`, using the PDF's own fonts. There are three groups of causes:

1. **Character and word spacing are not modelled** (RC1). PDFs place glyphs with `Tc`/`Tw` or explicit positions, but
   a `Run` only carries font, size and colour. This affects 260 paragraphs, 238 of them in the Visa form (HWP
   *자간*). Drift reaches 177 pt on one line.
2. **Geometry fields describe the line box, not the ink.** Leading spaces are part of the text and the rect (RC2,
   106 paragraphs), trailing spaces sit inside justified widths (RC2, 37), the alignment is wrong for 2-line
   justified or centred paragraphs (RC3, 30) and single lines are always "left" (RC3, 174 candidates, which only
   matters when the text length changes).
3. **Real segmentation errors** (RC4–RC7), about 60 paragraphs. These are the visually worst cases: lines from
   different table rows, cells or form rows end up in one paragraph (no horizontal overlap, a MuPDF line that
   crosses a column rule, dot-leader rows, TOC entries); numbered items are split from their continuation; tab gaps
   after list markers or TOC numbers collapse to one space; hanging indents are lost.

Simulated fixes, checked on the data (Appendix B):

| | moves > 3 pt | moves > 10 pt |
|---|---|---|
| Today | 45 % | 20 % |
| RC2 + RC3 fixed (ink rects, alignment) | 38 % | 16 % |
| RC1 fixed (one letter spacing per run, one word spacing per paragraph) | 31 % | 11 % |
| RC1 + RC2 + RC3 | **15 %** | **5 %** |

What is left after that is the segmentation errors (RC4–RC7) plus the justified-width widening in the web (RC8).

**Completeness.** No text is missed: on all 28 pages, every word of `page.get_text("words")` lies in some paragraph
line and the token multisets match exactly. The "misses" the owner sees are not text: the whole body of *Form
Permohonan* is three raster images (shot 13), so it needs OCR. Only 12 paragraphs are `editable:false`, all of them
rotated table headers in Panduan p13/p17 (shot 14).

## Summary per PDF

Counts are paragraphs. "Moves" means the largest word displacement when the web re-lays out the unchanged paragraph
(Appendix B). The issue columns count paragraphs I confirmed by eye or with a detector checked for false positives.
One paragraph can carry several issues.

| PDF | pages | paragraphs (multi-line) | locked | moves >3 pt now → after RC1–3 | MISS | MERGE | SPLIT | ALIGN | RECT (lead/trail) | TAB / HANG | RUN-STYLE (spacing / underline / text) | LINEHEIGHT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Surat Keterangan Magang | 1 | 24 (11) | 0 | 10 → 6 | 0 | 3 (g9, g14, g16) | 0 | 2 single centred (g5, g6) | 0 / 3 | 0 | 4 / 1 (link g21) / 0 | 0 |
| Form Pernyataan | 1 | 29 (11) | 0 | 13 → 8 | 0 | 2 (g6, g10) + 3 harmless | 2 (g15, g18) | 1 cell-centred | 1 / 1 | 4 tab (g14, g16, g17, g19) / 2 hang (g16, g19) | 1 (+ letter-spaced heading g0/g1) / 1 (g17 "kecuali") / 0 | 0 |
| Form Permohonan | 1 | 15 (1) | 0 | 3 → 0 | **body is an image** (3 rasters) | 0 | 0 | 2 right (g4, g5) | 0 | 0 | 1 / 0 / 0 | 0 |
| Panduan Kerja Praktek | 20 | 374 (86) | 12 (rotated) | 90 → 46 | 0 | 23 (3 form rows, 12 across a column rule, 5 TOC, 3 form) | 2 (p4 g13, p11 g1/g2) | 11 justify→left, 1 single justified, 2 centre→left, ~134 single centred | 13 / 32 | ~22 tab (bullets, TOC, p5 form) / 2 hang | 16 / 2 (p7 "bukan", p15 blanks) / 0 | 0 |
| Visa Application Form | 5 | 258 (35) | 0 | 197 → 44 | 0 | 1 (p5 g12) + known form-row cases | 3 known (p3 g24/25, g26/27, p4 g11/12) | 1 justify→left, 11 centre→left, ~33 single centred/right | 92 / 1 | 3 tab / 3 hang | **238** / 0 / 7 mid-word joins | 0 |

The ORDER of ids follows MuPDF block order. It does not affect positions and I did not evaluate it further.

## Re-layout risk ("position changes on edit")

Method: for each editable paragraph I re-implemented `paragraphBox()` (apps/web/src/lib/paragraphs.ts) and
`layoutText()` (apps/web/src/lib/layout.ts) in Python. That covers the box width (`max(rect.w, widest line) + 0.01`,
or `maxWidth` for left-aligned single lines), the hard breaks, the greedy wrap, the per-align placement, and the
first baseline pinned to the original one. Glyph widths come from the fonts the API resolves (all reference fonts are
reusable originals, except the Type3 titles on Visa p1). I then compared every word's start position with the
original glyph origin. A second run that uses the PDF's own glyph widths gives nearly identical numbers, so font
metrics are not the problem.

| | editable | moves >1 pt | >3 pt | >10 pt | re-wrap (multi-line) | baseline >1 pt |
|---|---|---|---|---|---|---|
| all | 688 | 364 (53 %) | 313 (45 %) | 140 (20 %) | 0 / 144 | 0 |
| Surat | 24 | 11 | 10 | 5 | 0 / 11 | 0 |
| Pernyataan | 29 | 15 | 13 | 5 | 0 / 11 | 0 |
| Permohonan | 15 | 3 | 3 | 0 | 0 / 1 | 0 |
| Panduan | 362 | 109 | 90 | 35 | 0 / 86 | 0 |
| Visa | 258 | 226 (88 %) | 197 (76 %) | 95 (37 %) | 0 / 35 | 0 |

Per-document median / p90 / max displacement: Surat 0.8 / 48.7 / 277 pt; Pernyataan 2.6 / 17.5 / 169;
Permohonan 0.1 / 4.3 / 9.3; Panduan 0.2 / 9.2 / 170; Visa 8.1 / 25.8 / 177.

Why nothing re-wraps: `paragraphWidth()` widens the box to the widest natural line and `hardBreaks()` keeps short
lines apart. The original line breaks survive, but the box can become wider than the original column (RC8). After a
real edit, the text reflows within that wider box.

Of the 313 paragraphs that move more than 3 pt, spacing alone (RC1) fixes 114, rect/alignment alone (RC2/RC3) fixes
38, both together fix another 57, and **104 remain**. Those 104 are the segmentation and tab/indent cases (RC4–RC8).

## Root-cause catalogue

Severity scale for the owner's complaint: **S1** means text jumps a cell or column, or more than 20 pt, or its
content is corrupted. **S2** means visible drift of 3–20 pt. **S3** means it only shows once the text length changes,
or is cosmetic.

### RC1: Character/word spacing and glyph positioning are not modelled (RUN-STYLE). S1 on Visa, S2 elsewhere

- **What.** Runs have no letter or word spacing, so the web lays out with plain advances. Producers position glyphs
  differently:
  - **HWP (Visa).** A constant per-span `Tc` from −0.18 to −2.04 pt per character, plus word spacing. Example: p2
    g38 "5.2 배우자 인적사항 … spouse" is condensed. The re-layout runs **177 pt** past the original end (shot 10).
    Also p4 g30 (112 pt), p2 g25 (87 pt), p1 g5–g13 (12–24 pt per line, shot 9).
  - **Letter-spaced headings.** Surat g0 "INSTITUT TEKNOLOGI BANDUNG" uses `Tc` ≈ +1.9 pt and shrinks by 49 pt; g1
    shrinks by 40 pt (shot 11). Pernyataan/Permohonan g0/g1 "I N S T I T U T …" are spelled with real spaces and
    still drift 7–9 pt.
  - **Word (Calibri).** A steady +0.10 pt per character, about 1 % of the width. Pernyataan g14 drifts 9 pt across
    one line.
- **Count.** 260 paragraphs with a median in-word |Tc| above 0.4 % em (Visa 238, Panduan 16, Surat 4, Pernyataan 1,
  Permohonan 1).
- **Fix direction (sanity-checked).**
  - *API.* Measure from `rawdict`. For each run, the median of `origin[i+1] − origin[i] − advance[i]` over character
    pairs inside one word gives `letterSpacing` (pt). For each paragraph that is not justified, the median extra per
    space gives `wordSpacing`.
  - *Schema.* Add `Run.letterSpacing?` and `TextBox.wordSpacing?` (or a per-run `wordSpacing`).
  - *Web.* `textWidth`/`charOffsets`/`layoutText` add the spacing per character and per space.
  - *Bake.* `draw_text_box` must draw with the same spacing (TextWriter has no `Tc`, so either per-glyph placement
    or a `Tc` operator). This is the largest piece of work in the list.
  - *Simulated effect.* Paragraphs moving more than 3 pt drop from 45 % to 31 % with spacing alone, and to 15 %
    together with RC2/RC3. Visa drops from 76 % to 17 %. Measuring per line instead of per paragraph only gains
    about one more point (14 %), so one value per run or paragraph is enough.

### RC2: Rects and line text include leading and trailing whitespace (WRONG-RECT). S1/S2

- **What.** `_line()` keeps whitespace (`TEXT_PRESERVE_WHITESPACE`). The line `x0`/`x1` come from the MuPDF bbox,
  which includes space glyphs. `layoutText` drops spaces at the start of a line (`layout.ts` l. 76), so text that
  starts with spaces jumps left by their width.
  - Pernyataan g23 "⎵×72 Menyetujui," jumps **−168 pt** (shot 12).
  - Panduan p11 g6–g8 jump 12–42 pt, p6 g13 jumps 22 pt.
  - Visa p1 g5–g13 ("⎵‣ …"), all "⎵⎵a) …" field labels, p5 notes: 3–70 pt (92 paragraphs).
  - Trailing spaces stay inside `rect.w`. Justified lines are then stretched one space too far: about +3.3 pt at
    the right end of every justified line, in 37 paragraphs (e.g. Surat g19, Panduan p1 g4). Centred lines are off
    by half a space (Surat g2 ±5 pt, Pernyataan g2 4 pt).
- **Count.** 106 paragraphs with leading spaces (Visa 92, Panduan 13, Pernyataan 1). 37 justified paragraphs with
  trailing space in the width.
- **Fix direction (sanity-checked).** In `_line()`, drop leading and trailing whitespace characters (keep inner
  ones) and use `ink_x0`/`ink_x1` for `x0`/`x1`. `_paragraph` then builds `rect` and `lines[].rect` from ink. Also
  fix `_room()`, which starts from `line.x0`. Bake redaction bands come from `lines[].rect`, so they shrink to the
  ink; underlined blanks drawn as line art stay where they are.
  - *Simulated effect.* Together with RC3, the rect/alignment fix brings paragraphs moving more than 3 pt from 45 %
    to 38 %; it is the main gain for Panduan (25 % → 15 %).

### RC3: Alignment misclassified (ALIGN). S1/S2 for multi-line paragraphs, S3 for single lines

The cases below are in `_align()` (paragraphs.py l. 242):

1. **Justified paragraphs with 2 lines are declared `left`.** Justify needs at least 3 lines. Re-layout drops the
   first line's stretch: 11–48 pt.
   - Panduan p1 g6, p2 g7, p2 g12, p7 g1, **p8 g0 (45.5 pt)**, p8 g14, p17 g22/g24/g26, **p20 g1 (48 pt)**, p20 g2;
     Visa p3 g42 (64 pt). See shot 08.
   - A single full-width justified line gets the same treatment: Panduan p11 g1, 14 pt (it was split from g2 by its
     double line spacing).
   - Fix: classify as justify when every line but the last has *stretched* word gaps, meaning the median gap
     exceeds `n_spaces·(space advance + Tc) + Tc` by more than 0.06 em. On the data this flags exactly these 12
     paragraphs plus 2 false positives (Pernyataan g6/g10, dot-leader rows, which RC5 makes tabular anyway).
2. **Centred paragraphs whose first line is shorter are declared `left`.** With 2 lines, `rest` holds one line, so
   its x0 spread is 0 and the first test returns `left`. 13 paragraphs:
   - Panduan p3 g1 "JURNAL MINGGUAN / KERJA PRAKTEK" (37 pt, shot 07), p4 g15 "26 -27 / Mei 2026" (9 pt);
   - Visa p1 g16/g17, p4 g6/g16/g17/g43 (11–41 pt), p5 g27/g32/g34/g36/g39.
   - Fix: test centre before treating the first line as a first-line indent. When the x0s differ by more than tol,
     the x1s also differ, and the centres agree within tol, the paragraph is centred.
3. **Single-line paragraphs are always `left`** (`len(lines) < 2`). `paragraphBox` then lets them grow to the right
   (`maxWidth`). An edited centred title or right-aligned date no longer sits centred or flush right; a same-length
   re-layout shows no error.
   - Candidates: 29 centred on the page (Surat g5/g6 "SURAT KETERANGAN", Panduan title pages p1/p10/p11/p13/p15/
     p17/p19/p20), 137 centred in their table cell (mostly digits in the Panduan p5/p13/p17 score tables and Visa
     official-use labels), 8 right-aligned (Permohonan g4/g5, Visa page footers).
   - Fix: centre if the line's centre matches the centre between the vertical rules around it (≤1.5 pt), or the
     page centre (≤3 pt) away from the left margin. Right if x1 matches the text column's right edge. Then make
     `paragraphBox` give centred/right single lines the cell or column width instead of `maxWidth`.
   - Two false positives seen: Visa p2 g47 "있음 Yes [ ]" and p2 g7 are centred on the page by coincidence. Prefer
     the cell test and require the margin test to agree with neighbouring lines.

### RC4: Lines from different rows or cells merged (MERGE across a layout boundary). S1

1. **No horizontal overlap.** MuPDF block order lists a row's value, then the next row's label, and `_split` never
   asks whether a "wrapped" line overlaps the previous one. Six paragraphs, 140–277 pt, shots 01 and 05:
   - Surat g9 ": <nama>… / Jabatan", g14 "NIM / 1.", g16 "<NIM> / 2.";
   - Panduan p5 g5 ":  / 4. Lembaga…", g6, g8.
   - Fix: start a new paragraph when `min(a.ink_x1, b.ink_x1) − max(a.ink_x0, b.ink_x0) < 0`. Across all 700
     paragraphs this fires exactly on these 6 and nowhere else, because a wrapped line always overlaps the line
     above it.
   - Second cause for the Surat table: its vertical borders are drawn per row (`rules.v_between` gets segments
     308.0–321.2, 321.7–335.0, …). `v_between` tests only the midpoint of the two lines' y-range, which falls in the
     0.5 pt gap between segments. Fix: merge collinear segments with gaps ≤ 1 pt in `rules._sorted`. Checked: this
     changes only Surat g14/g16.
2. **One MuPDF line spans a column rule.** MuPDF puts "23/5/2026 Pengenalan" (Panduan p4 g6, g19) and "1  Pemahaman
   Terhadap Pekerjaan" (p5 g16 … g97, 10 rows) in one span across the cell border. Nothing in `paragraphs.py` splits
   a raw line. 12 paragraphs; 78 pt on p4 and 4–8 pt on p5 (shot 04). Fix: in `_line()`, split the character list
   where a vertical rule lies between two consecutive characters, before `_same_row`.
3. **Dot-leader rows.** "Nama Mahasiswa : …………… / NIM" (Pernyataan g6) and ": …………… / Kategori Kegiatan : …" (g10,
   91 pt). The next row's label is glued under a full-width leader line (shot 03). Fix: treat a line containing ≥5
   dots, ≥2 "…" or ≥4 "_" as `tabular`. That flags 5 paragraphs: these 2, plus 3 harmless signature blocks
   (g21, g25, g27) that would also split.
4. **Short lines (TOC entries, form rows) that the widest-line rule cannot separate.** `_hard_breaks` measures room
   against the widest line *of the group*. Two entries of similar length stay together:
   - Panduan p6 g1 "Halaman Sampul / Halaman Pengesahan / Kata Pengantar", g9 "1.4. Waktu… / Bab II Profil…",
     g15 "4.2 … / 4.3 …", g19, p9 g1;
   - form rows Panduan p5 g2 "1. Nama Mahasiswa / NIM : / 2. Perioda…", p15 g8, p19 g10. See shot 06.
   - Editing one entry reflows the next one into it. g9 also loses the 22 pt indent of its first line.
   - Fix: also break when the next line's first word fits in the line's *own room*, meaning `_room()` (vertical
     rule, other text, right margin) − `ink_x1` > first word + space + **0.5 em**. Checked on all paragraphs: it
     splits the TOC and form cases above and also Surat g2/g3/g4/g22/g23 and Visa p1 g15, p5 g34/g39–g42 (stacked
     labels; splitting these is harmless).
   - Without the extra 0.5 em it also split two genuinely wrapped table cells (Panduan p13 g21 and g25, room 23 vs
     22 and 15 vs 10 because of cell padding). With the margin, no wrapped prose was split.
   - M5 rejected a "cell right edge" measure because one rule above or below made cells too wide. `_room` only uses
     rules that cross the line's own height, which is why these results differ.

### RC5: List markers, tab gaps and hanging indents (SPLIT / TAB / HANG). S2, S1 for TOC and forms

1. **Numbered items are not list items.** `BULLETS` only has symbols, so "1.", "a)" and "4.2" are ordinary text. A
   continuation line indented to the item's body looks like a first-line indent and starts a new paragraph, but only
   when it is full width, because of the `x1 >= prev.x1 − 0.5em` test.
   - Pernyataan g14/g15 and g17/g18 are split (shot 02); g16 and g19 (short last lines) are not.
   - Symbol bullets have the same problem with full-width continuation lines, because the indent test runs even
     when `_bulleted(prev)`.
   - Fix: a line that starts with `^\s*(\d{1,2}(\.\d{1,2})*[.)]|\(?[a-zA-Z][.)]|[ivx]{1,4}[.)]|<bullet>)` followed by
     a gap counts as an item. Its body x is the first character after the marker. A following line whose `ink_x0`
     equals the body x (±1 pt) continues it, overriding the indent rule.
2. **The hanging indent is lost in the web.** `paragraphBox` puts every line at `rect.x`, so continuation lines move
   left by the hang. 7 paragraphs, 13–38 pt: Pernyataan g16, g19; Panduan p6 g24, p19 g15; Visa p5 g4, g10, g13.
3. **Tab gap after a marker or inside a line collapses to one space.**
   - "•⇥Lembar…" (Panduan p2 g14/g15, p6 g23, p15 g15–g17, p19 g14): 9 pt.
   - "1.⇥Pada…" (Pernyataan g14, g17): 6–9 pt.
   - TOC "Bab I⇥Pendahuluan" (Panduan p6 g5, g10, g16): 17–22 pt.
   - "1.⇥Nama…" on Panduan p5: 12–33 pt.
   - These gaps are almost all inside `_same_row` joins, where `_join` inserts a synthetic " ". 21 joins have a gap
     of at least 0.6 em: 15 are list/TOC tabs, 6 are wide justified gaps (Panduan p13 cell "mendapatkan
     pemahaman…", p4 "Tim⎵Keselamatan", Pernyataan "Student⎵Exchange/Konferensi").
   - **Fix for 2 and 3 together:** split the marker (or any piece left of a tab gap) into its own paragraph. A gap is
     a tab gap when it is ≥ 0.8 em **and** either more than twice the median of the line's other gaps, or the line's
     only gap in a line that does not reach the block's right edge. The body becomes a paragraph at body x, so its
     lines need no hang.
   - Checked: with that rule the 15 tab joins split and the 6 justified ones stay joined. The Pernyataan "Kategori
     Kegiatan : Kompetisi/…/Student⎵⎵Exchange…" row is borderline because it has a tabbed colon *and* wide gaps.
   - Alternative: add `indent`/`hanging` (and tab stops) to `TextBox` and `layoutText`. That is more faithful, but it
     is a schema change on both sides.

### RC6: Pieces on one baseline split too eagerly (SPLIT). S1 in narrow justified cells

- **What.** `_same_row` joins pieces at most `JOIN_EM = 2` em apart. In narrow justified cells MuPDF breaks
  "Induction)⎵⎵⎵⎵⎵oleh" into two lines 2.6 em apart. "oleh" then becomes the first line of a new paragraph (gap ≤ 0
  ⇒ new) and takes the next three lines with it: Panduan p4 g12/g13, the g13 line moves 108 pt (shot 04).
- **Count.** 2 confirmed (p4 g13; Pernyataan g10 is the same mechanism, behind RC4.3). The other "same-baseline"
  hits are correct, separate checkbox options (Visa p3 g4, g20, g22).
- **Fix direction.** Join same-baseline pieces with no vertical rule between them when the right piece ends at the
  block's right edge and the following line starts at the block's left edge, which is what a justified line in a
  cell looks like. I did not simulate this one; keep it behind a fixture.

### RC7: Mid-word wraps become spaces (RUN-STYLE / text corruption). S1 (wrong text)

- **What.** HWP wraps Latin text by character in narrow cells, and HWP lines never end in a space. `_paragraph`
  joins wrapped lines with " " unless the previous line ends in a space or hyphen or one side is CJK. The text
  becomes "full fa ce", "front vie w", "off-whi te" (Visa p1 g17), "appli cant" (p4 g7), "passpor t" (p5 g5),
  "Repu blic" (p5 g9), "click'Ch eck" (p5 g16). Hangul is affected too: "않아 야" (p1 g16), "교부받 고자" (p5 g13).
  See shot 15.
- **Count.** 7 paragraphs, about 10 joins.
- **Fix direction (checked on all soft breaks without a trailing space).** In a paragraph whose lines carry no
  trailing spaces, when both sides are letters **of the same script** and the line is full (ink_x1 within one
  character of the paragraph's right edge), join without a space. All 7 Latin–Latin cases in the data are mid-word.
  All mixed-script pairs ("국적|Nationality", "PHOTO|여권용", "접 수|Reception") are real word breaks and keep the
  space. Same-script Hangul is ambiguous ("촬영일|부터" is a word break in spirit), so a dictionary-free rule can
  only be a heuristic there.

### RC8: Justified boxes widened by the web (WRONG-RECT, web side). S2

- **What.** In 19 justified paragraphs the natural width of some line is larger than the original ink width,
  because Word compresses spaces when justifying. `paragraphWidth()` takes the maximum, so every line is stretched
  to the wider box and the right end moves 6–9 pt.
  - Panduan p1 g5/g7/g9, p2 g0/g8/g17, p6 g22, p17 g4 (+8.7);
  - Surat g21 (+7.9, shot 11);
  - Visa p5 g19 (+17).
- **Fix direction.** For `justify`, use the ink width (after RC2) and allow negative extra space on lines that keep
  their original break. One way: make the web treat every original line end as a break until the paragraph's text
  changes, then reflow at the original width. I did not simulate this; it changes `layoutText` semantics.

### RC9: Underlines are drawn line art, not run attributes (RUN-STYLE). S2 after editing

- **What.** Runs never get `underline` (it exists in the schema). The vector underline stays in the PDF because
  `text.edit` redacts with `PDF_REDACT_LINE_ART_NONE`. After an edit the underline sits under the old position or
  under the wrong words, and the new text has none.
- **Confirmed.** Surat g21 link "lili@itb.ac.id" (blue + underline); Pernyataan g17 "kecuali"; Panduan p7 g10
  "bukan"; Panduan p15/p19 form blanks (underlined spaces and "_" text).
- **Fix direction.** Treat an h-rule within [baseline + 0.02 em, baseline + 0.25 em] that covers at least 80 % of a
  run's ink as an underline: set `run.underline`, and have the bake remove that one path (a targeted line-art
  redaction band under the run). A plain rule test also fires on table borders right under cell text (Surat
  g12–g18, Panduan p4 header): require that the rule not extend more than about 1 em beyond the run's ink.

### RC10: Not editable or not text (expected limits). S3

- **Rotated headers.** `editable:false` for "Kurang / Cukup / Baik / Baik Sekali" (Panduan p13 g8–g11) and "Need s
  / improvements / Meet s / expectations / Exceeds" (p17 g7–g14). MuPDF also splits "Needs" into "Need s". 12
  paragraphs.
- **Type3 titles.** Visa p1 g2 "사증발급신청서" and g3 "VISA APPLICATION FORM" use Type3 fonts T2/T3. They are editable,
  but with substitute fonts (Noto Sans KR / Arimo): the glyph shapes change and the width differs by 8–26 pt. That
  is acceptable, but worth a notice.
- **Raster text.** The Permohonan form body (3 images, 1299×550 px, y = 174–689), the Surat/Panduan logos and the
  stamp/signature. These are fine as they are; the Permohonan body would need OCR.

### Checked and fine

- Line height: median spacing equals actual spacing within 0.5 pt in every paragraph. No paragraph's baselines move
  more than 1 pt.
- Run styles from the font (bold, italic, colour, size) are correct wherever I looked: Surat g20 bold phrases,
  Panduan italics, blue links, Calibri italic notes.
- Superscripts and off-baseline spans: none in the references.
- Rule-separated table cells (Panduan p5/p13/p17, Visa tables) are separated correctly, apart from RC4.1 and RC4.2.

## Page-by-page log

RC numbers refer to the catalogue above. Unless listed, the paragraphs on a page are segmented correctly. RC1
(spacing) applies to every Visa paragraph and is not repeated there.

**Surat Keterangan Magang p1** (24): g0/g1 RC1 letter-spaced heading (49/40 pt). g2 centred, RC2 trailing space
(5 pt). g3/g4 fine (g4 right-aligned, 3 lines). g5/g6 RC3.3 single centred. g8 "Nama" fine. **g9 RC4.1** value +
next label. g10 RC5.3 tab gap after ":" (7 pt). g12/g13 fine. **g14 "NIM 1.", g16 "<NIM> 2." RC4.1** (+ rule
gaps). g15/g17/g18 fine. g19/g20 RC2 trailing space (3.4 pt). g21 RC2 + RC8 (+8 pt) + RC9 link underline. g22/g23
signature lines merged; hard breaks keep them apart (harmless).

**Form Pernyataan p1** (29): g0/g1 spaced-letter heading "I N S T I T U T", RC1 (9 pt). g2 centred, RC2 (4 pt). g4
right-aligned. **g6 RC4.3** (+ NIM label). g7 fine. **g10 RC4.3 + RC6** (91 pt). g11 fine. g12 RC5.3 tab before the colon
(9 pt). **g14/g15 and g17/g18 RC5.1 split**. **g16/g19 RC5.2 hang lost** (17 pt). g14/g17 RC5.3 tab after "1."/"3.".
g17 RC9 "kecuali". g18 justified, RC2. g21/g25/g27 signature blocks (harmless). **g23 RC2 leading spaces (168 pt)**.
g28 fine.

**Form Permohonan p1** (15): g0/g1/g2 as Pernyataan. g4/g5 RC3.3 right-aligned single lines. g6–g14 table cells
fine. **Body = images** (RC10).

**Panduan p1** (14): g6/g10 RC3.1 two-line justify (13/7 pt). g4/g5/g7/g9/g11/g13 justified, RC2 (3 pt) and g5/g7/g9
RC8 (6–8 pt). g8 RC2 leading space. g0–g2 RC3.3.
**p2** (22): g0/g8/g17 RC8. g5/g6 "o Tanggal…" are list items with an "o" marker (fine). g7 RC3.1 (16 pt). g12/g16
RC3.1. **g14/g15 RC5.3 bullet tab (9 pt)**. g18 two sentences merged, hard break keeps them apart. g10/g21 RC2.
**p3** (5): **g1 RC3.2** (37 pt). g2–g4 fine.
**p4** (23): **g6, g19 RC4.2** across the Tanggal/Kegiatan rule (78 pt). **g12/g13 RC6** (108 pt). g11 fine. g15
RC3.2. g9/g20–g22 lone "-" lines (fine). g16 "Pengenalan Laboratorium -" fine.
**p5** (111): **g2 RC4.4 + RC5.3** (33 pt). g3 tabular ": s/d" fine. g4 RC5.3 (12 pt). **g5/g6/g8 RC4.1** (164–170 pt).
g7 "Praktek" fine. **g16…g97 RC4.2** (number + label across the rule, 10 rows, 4–8 pt). Score cells g17–g105 fine
(RC3.3 candidates). g108 RC2.
**p6** (28): **g1, g9, g15, g19 RC4.4** (TOC entries merged; g9 22 pt). **g5, g10, g16 RC5.3** tab (17–22 pt). g6–g8
"1.1.⇥…" RC5.3 (5 pt). g13 RC2 (22 pt). g11/g12/g17/g18 keep their spaces (fine). g20 RC2. g22 RC8. g23 RC5.3. **g24
RC5.2 + RC5.3** (18 pt).
**p7** (19): g1 RC3.1 (22 pt). g3/g8/g14/g16 justified, RC2. g10 RC9 "bukan" (4 pt drift, mostly RC1). g15 RC2.
**p8** (18): **g0 RC3.1 (45 pt)**, g14 RC3.1 (12 pt). g7/g9 RC8.
**p9** (5): g1 RC4.4 (two list lines).
**p10** (10): g1–g7/g9 RC3.3 (title page). g8 centred, 2 lines (fine).
**p11** (9): g1/g2 split by double spacing (RC3.1 single justified line, 14 pt). **g6/g7/g8 RC2** (12/21/42 pt).
g3–g5 RC3.3.
**p12** (1): fine.
**p13** (30): g0–g3 RC3.3. g4 justified (RC2). **g8–g11 locked (rotated)**. Table g12–g29 fine (justified cells
RC2 about 3 pt).
**p14** (3): g2 RC3.1 (7 pt).
**p15** (18): g8 RC4.4 ("Nama Perusahaan / Institusi : / Waktu :"). g9 RC2 (18 pt, underlined spaces). g5/g7/g11
"_" blanks with RC9 line art. g13 RC2. g15–g17 RC5.3 (9 pt).
**p16** (3): g2 RC3.1 (7 pt).
**p17** (27): g4 RC8 (9 pt). **g7–g14 locked (rotated)**. **g22/g24/g26 RC3.1** (20/42/31 pt). Table cells fine.
**p18** (9): g1 3 pt drift (RC1; 0.5 pt with spacing). g8 fine.
**p19** (16): g7/g9 RC2 (3/31 pt). g8 lone ":" is the wrapped tail of "Company / Institution :" (acceptable). g10
RC4.4. g12 RC2. g14 RC5.3. **g15 RC5.2** (14 pt).
**p20** (3): **g1 RC3.1 (48 pt)**, g2 RC3.1 (20 pt).

**Visa p1** (60): g2/g3 Type3 (RC10). g5–g8, g10–g13 RC2 leading space before "‣". **g16/g17 RC3.2** distributed/
centred photo note (36/20 pt). **g17 RC7** "fa ce / vie w / off-whi te". g19/g20, g29–g31, g33, g35–g38 RC2. g30/g32
tabbed checkbox rows (fine apart from RC1/RC2). Official-use grid g40–g56 fine (RC3.3 candidates).
**p2** (59): **g38 RC1 (177 pt)**. **g25 RC1 (87 pt)**. g7/g14/g55 RC2. g15, g20–g22, g29–g32, g39–g44 RC2 ("⎵⎵a)").
Checkbox option cells fine.
**p3** (49): g24/g25 "Trade/Investment/Intra- / Corporate Transferee" and g26/g27 "Visiting Family/ /
Relatives/Friends" split (known M5 backlog: form-row rule). g19 RC5.3. g31/g37/g38/g43 RC2 + tab (27–73 pt). **g42
RC3.1** (64 pt).
**p4** (45): **g30 RC1 (112 pt)**. g7 RC7 "appli cant". g6/g16/g17/g43 RC3.2. g11/g12 split (known backlog). g36/g37
question wraps into the checkbox row (known backlog; g37 90 pt → 12 pt after RC1). g2/g22 RC2.
**p5** (45): g4/g10/g13 RC5.2 hang. g5/g9/g16 RC7 (passpor t, Repu blic, Ch eck). g12 Korean + English merged
(known backlog). g18 RC2 + first-line indent. g19 RC2 + RC8 (+17 pt). g20 RC3.3 right. g21 space-padded signature row (RC1, 16 pt). **g22 RC2: 38 leading
spaces (137 pt)**. g23 RC1 (19 pt) + RC3.3. g24–g26, g28 RC2 + RC1 (11–41 pt). Procedure boxes g27/g32/g34/g36/g39 RC3.2.

## Prioritised fix list

Order is impact on the owner's complaint per unit of risk. Every item needs a fixture page from these references
(trimmed) and should bump `PARAGRAPHS_VERSION` once for the whole batch.

1. **RC4.1 + RC4.2 + rule-gap merge (paragraphs.py, rules.py).** Require horizontal overlap between consecutive
   lines, split raw lines at vertical rules, and merge collinear rule segments with gaps ≤ 1 pt. Each fires only on
   the S1 cases (6 + 12 + 2 paragraphs), with no false positives in 700 paragraphs. Small, safe, and removes the
   worst jumps (78–277 pt).
2. **RC2 ink-based lines and rects (paragraphs.py).** Strip leading and trailing whitespace from line text and
   rects. 106 + 37 paragraphs, up to 168 pt. No schema change. Check bake redaction bands and `_room` afterwards.
3. **RC3 alignment (paragraphs.py).** Justify detection from stretched gaps (12 paragraphs, up to 64 pt), centre
   before first-line indent (13), and single-line centre/right from cell or column (≈174, edit-time). The single-line
   part needs a matching web change: `paragraphBox` must give centred/right single lines their cell width instead of
   `maxWidth`.
4. **RC5.1 numbered markers + RC4.3 leaders + RC4.4 room-based hard breaks (paragraphs.py).** Fixes the Pernyataan
   list split, the dot-leader rows, and the TOC/form-row merges. Use the room margin of 0.5 em.
5. **RC5.2/RC5.3 tab-gap split (paragraphs.py `_same_row`/`_join`).** Split at tab gaps (≥ 0.8 em and an outlier or
   lone gap). Marker and body become separate paragraphs, which also fixes the hanging indents without a schema
   change. Watch the borderline "tabbed colon + justified" row.
6. **RC1 letter/word spacing (API + schema + web layout + bake).** Largest single gain (Visa 76 % → 17 % together
   with 2–3), but it touches the shared contract (`ops.py` → schema → `types.ts`), `layout.ts`/`fonts.ts`, and
   `draw_text_box`. Plan it as its own task with bake parity tests.
7. **RC7 mid-word wraps (paragraphs.py `_paragraph`).** Same-script letters + no trailing space + full line → no
   space. Small change. Fixes corrupted text in 7 Visa paragraphs.
8. **RC8 justified width (web `paragraphWidth`/`layoutText`).** Stop widening justified boxes; keep the original
   breaks until edited.
9. **RC6 justified same-baseline join** and **RC9 underline as run attribute + targeted line-art removal.** Lower
   frequency, needs care (bake).
10. RC10 notices: Type3 substitute, rotated text, image-only pages ("this page's text is an image").

## Shots

Blue boxes are API paragraphs. Red text is the current web re-layout of the same words.

| # | File | Shows |
|---|---|---|
| 01 | [shots/01-surat-form-rows-table.png](shots/01-surat-form-rows-table.png) | RC4.1: label/value rows and table cells merged (Surat g9, g14, g16) |
| 02 | [shots/02-pernyataan-numbered-list.png](shots/02-pernyataan-numbered-list.png) | RC5: numbered items split, hang lost, tab collapsed |
| 03 | [shots/03-pernyataan-leader-rows.png](shots/03-pernyataan-leader-rows.png) | RC4.3: dot-leader rows swallowing the next label |
| 04 | [shots/04-panduan-p4-table-cells.png](shots/04-panduan-p4-table-cells.png) | RC4.2 across a column rule, RC6 "oleh" split, RC3.2 |
| 05 | [shots/05-panduan-p5-form-colons.png](shots/05-panduan-p5-form-colons.png) | RC4.1 colon + next label, RC5.3 |
| 06 | [shots/06-panduan-p6-toc.png](shots/06-panduan-p6-toc.png) | RC4.4 TOC entries merged, RC5.3 tab gaps, RC2 |
| 07 | [shots/07-panduan-p3-centred-as-left.png](shots/07-panduan-p3-centred-as-left.png) | RC3.2 |
| 08 | [shots/08-panduan-p8-two-line-justify.png](shots/08-panduan-p8-two-line-justify.png) | RC3.1 |
| 09 | [shots/09-visa-p1-letter-spacing.png](shots/09-visa-p1-letter-spacing.png) | RC1 + RC2 (HWP) |
| 10 | [shots/10-visa-p2-condensed.png](shots/10-visa-p2-condensed.png) | RC1 extreme (177 pt) |
| 11 | [shots/11-surat-letterhead-justify.png](shots/11-surat-letterhead-justify.png) | RC1 letter-spaced heading, RC2/RC8 justified |
| 12 | [shots/12-pernyataan-leading-spaces.png](shots/12-pernyataan-leading-spaces.png) | RC2 (−168 pt) |
| 13 | [shots/13-permohonan-image-body.png](shots/13-permohonan-image-body.png) | RC10: form body is raster |
| 14 | [shots/14-panduan-p13-rotated.png](shots/14-panduan-p13-rotated.png) | RC10: rotated, locked |
| 15 | [shots/15-visa-p1-photo-box.png](shots/15-visa-p1-photo-box.png) | RC7 mid-word joins, RC3.2 |

## Appendix A: scripts (outside the repo)

All scripts are in `/private/tmp/claude-501/audit2/` and run with
`cd apps/api && PYTHONPATH=.:/private/tmp/claude-501/audit2 uv run python /private/tmp/claude-501/audit2/<script>`.

| Script | What it does |
|---|---|
| `probe.py <pdf> <out>` | Runs the real `extract_text` (with `resolve`/`locked`). Writes `data.json`, `list.txt` (every paragraph with fonts, align, rect, `maxWidth`, sim numbers) and 150-dpi overlays `pNN.png` (boxes, ids; red fill = locked; magenta = words not covered). Output for all files is in `audit2/{surat,pernyataan,permohonan,panduan,visa}/`. |
| `detail.py <pdf> <page> <ids…>` | Lines, ink extents, spans, runs and the per-word displacement of the simulated re-layout. |
| `stats.py` → `rows.json`, `summ.py [flag]` | Detectors (flags as used above) and re-layout variants for all 700 paragraphs. |
| `checks.py` | Sanity checks of the proposed fixes: rule-segment merge, room-based hard breaks, justified widening, soft breaks without trailing space. |
| `joins.py` | Gaps of `_same_row` joins. |
| `shots.py` | The crops in `shots/`. Blue = API paragraph boxes; **red text = where the current web re-layout draws the words**. |

## Appendix B: re-layout simulation details and caveats

- **Base.** Python port of `paragraphBox` + `layoutText`: width = `max(rect.w, widest line) + 0.01` (or
  `maxWidth + 0.01` for left single lines), `hardBreaks` against that width, greedy wrap over word units, leading
  spaces dropped, justify spreads the leftover over the space tokens of every non-last line, first baseline =
  `lines[0].baseline`, then `+ lineHeight`. Advances come from the font the API resolves (`load_font` for originals,
  the bundled file otherwise, per-character fallback to Noto Sans KR / Arimo). Rounding of advances to 1/1000 em
  is not reproduced, which is negligible here.
- **Variants.**
  - *rect/align:* `rect.x`/`w` from ink; align replaced by the RC3 classification.
  - *spacing:* per-run `letterSpacing` = median in-word origin pitch − advance; per-paragraph `wordSpacing` = median
    extra per space (not for justify).
  - *per line:* the same measured per line, which is an upper bound.
  - Variants never change the segmentation, so RC4–RC7 remain in the "after" numbers.
- **Caveats.**
  - Displacement is measured at word starts, which is enough to see drift.
  - "Single centred/right" (RC3.3) causes no displacement in a same-text re-layout. Its risk appears only when the
    text length changes, so it is not in the percentages.
  - The detectors are heuristics; the counts in the summary table were checked against the overlays, and known
    false positives are named where they occur.
- **Shots.** The crops contain content from the reference documents, including the owner's name and NIM in
  01/11. Keep this folder uncommitted, or redact the crops, before it goes anywhere public.
