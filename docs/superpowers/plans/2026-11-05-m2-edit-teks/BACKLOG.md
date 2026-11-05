# M2 backlog (deferred review items)

From per-task and final whole-branch reviews of M2. Final verdict: ready to merge. Items below are deferred to M3+.

## Final review — should fix soon
- Coloured backgrounds under edited text: screen mask is white, bake keeps line art/images.
- No font subsetting at export (one Noto Sans fallback run ≈ 2.2 MB/style); re-run fix_to_unicode after subsetting.
- Same-name fonts on one page (Word exports) → ambiguous → silent substitute; disambiguate by glyph coverage; test with real Word/LibreOffice exports.
- Cache /text and /fonts/{ref} per doc.
- Find & Replace across hard breaks joins paragraphs: decide + test.
- Bake could log client/server advance mismatch > 0.5 pt.
- Bundled-font missing glyph (CJK/emoji/✓): bake silently substitutes; client should warn.

## Per-task deferred
- Task 1: minor (deferred): parse_font_name bold/italic substring false positives (plan-mandated, reviewer approved); duplicate aliases not asserted; fonts 22MB. Noto Sans fallback chain still TODO in later web task.
- Task 2: minor (deferred): transient — original-font runs in text.add / text.edit unhandled in bake until Tasks 6–7; stale FontFace add after setOriginalSource (orig-fN faces never removed); restyle drops original family (Task 11 replaces).
- Task 3: minor (deferred): Type3 embedded=false inconsistency; extract_font repeated per font; no font_bytes/OTF/Type3 tests (Task 5 should test font_bytes).
- Task 4: minor (deferred): rotated multi-line text → one paragraph per line (non-editable, plan-mandated); O(n²) _flat; justified-gap join synthesizes space in table cells; even-count median spacing.
- Task 5: minor (deferred): font route iterates all pages per request; nonstandard font/ttf MIME; no Python lint (ruff absent).
- Task 6: note: U+00A0 fixed via bake-time ToUnicode rewrite (tounicode.py), not font patching (OFL RFN); also fixes U+00AD hyphen, U+037E semicolon, non-BMP. Plan README + task-15 updated.
- Task 6: minor (deferred): fix tied to draw_text_box (M3 must reuse); fix_to_unicode silent early returns; test import order.
- Task 7: minor (deferred): redact_handlers rebuilt per page; no 0.8x leading regression test (probe passed). (dup text.edit moot: schema rejects.)
- Task 8: minor (deferred): setOriginalSource not cleared on load error; sameStyle JSON.stringify key-order; styleAt on empty runs; no stale-load test.
- Task 9: note: fallback chain original→substitute→Arimo→Noto Sans implemented (3 passes).
- Task 9: minor (deferred, triage at final): glyphs missing even in Noto Sans (CJK/emoji) — UI should warn; API bake behaviour for bundled-font missing glyph (TextWriter silently substitutes vs reject) needs checking for WYSIWYG.
- Task 10: minor (deferred): sliding coalesce window undocumented; init doesn't reset last; props key merges different controls; test gaps. NOTE for Tasks 12/13: PropertiesBar.tsx:20, PageOverlay.tsx:163-182, Editor.tsx:64 still check only "text.add" — must use isTextOp.
- Task 11: minor (deferred): runsToDoc drops empty runs (leading empty paragraph loses own style); fontStyle reports Arimo for missing ref. NOTE: TextProps wiring with font table is Task 12.
- Task 12: minor (deferred): stored mark lost after select/input focus; SizeField stale while focused; Tiptap options rebuilt per render; swatches only xl. NOTE Task 13: revert label + aria-label already changed in PropertiesBar (Task 12).
- Task 13: note: Task 12 editor wrap fixed with white-space:pre-wrap (9f2811f).
- Task 13: minor (deferred, triage at final): cursor stays "text" after paragraph drag/resize; paragraph Transformer under objects; leading spaces shown in editor but dropped by layout; pre-wrap caret at line end; paragraph selection survives tool switch; no unit test for drag/resize geometry; left-anchor resize drift at min width.
- Task 14: minor (deferred): case folding skips length-changing letters (İ); highlight drift on justified originals; full recompute per doc change; highlights during open session. OWNER DECISION PENDING: longer replacement/edit wraps in original paragraph width → may overlap next paragraph. E2E note: clear localStorage between uploads of same fixture.
- Task 15: note (final triage): span→font match needs PostScript & full name to normalize to same key, else silent fallback to substitute (real PDFs may hit this).
- Task 15: minor (deferred): weak unchanged-line checks; baseline check y-only; pdfSpans spawns uv twice.
