# M5 backlog

Items deliberately left out of M5 (see README.md, Deviations):

- CJK line breaking between characters with kinsoku rules (today a long Japanese/Chinese run wraps through the editor's "split a too-long word by character" path).
- Traditional Chinese fallback fonts (Noto Sans/Serif TC, +20 MB); Traditional font names map to SC.
- A smaller CJK pack (Hangul + KS X 1001 Hanja subset, or WOFF2 for the browser with the same metrics).
- Rebuilding cmaps for cmap-less simple TrueType fonts and CFF/Type1 CID fonts (only Type0/Identity CIDFontType2 is handled).
- Span font names longer than ~24 characters are truncated by MuPDF and then miss their font (prefix matching in `span_fonts`).
- Hard breaks measured against the real cell edge (needs the column structure, not just the nearest rule).
- Keeping the old (version 1) segmentation for drafts made before M5 instead of dropping their text edits.
- Caching rebuilt font programs per document (each `/text`, `/fonts/{ref}` and export rebuilds them; ~10–50 ms per font).
- Notes and links: decide whether they come back (data, bake and Anotasi labels are kept; the tools and their properties are hidden).
- A first-run tour of the tools (the one-line hint per tool is the M5 answer).
- `pages.spec` flaked once under parallel load in the spike (passed on rerun); watch it.

## Task 2 review minors
- Indent test uses `ink_x0`: Korean wrapped by character with a leading space looks indented (1 → 2 paragraphs).
- Form-row rule (3 spaces) splits wrapped labels/sentences from continuation (reference p3 g24/g25, g26/g27; p4 g11/g12, g36–g38).
- Hard-break result depends on group content (reference p5 g12: Korean line + English translation merge).
- `scripts/paragraph_overlay.py`: no box on cropped+rotated pages; no usage message without arguments.

## Task 4 review (deferred)
- Cache `font_bytes` rebuild (LRU keyed by doc hash + xref); `_doc_font` parses the result twice.
- Bake does not reject `text.edit` on an `editable: false` paragraph (also true for vertical text).
- Word lists with a non-embedded Symbol bullet lock the whole list item.

## Task 5 review (deferred)
- `FontRegistry._cache` keeps CJK `pymupdf.Font` objects resident (~113–226 MB worst case), duplicated per italic key: key by resolved path or add an LRU.
- Docker builds and the Playwright text.spec change were not run in Task 5 (E2E ports arrive in Task 7).
- Until Task 15 the web `FontStore.url()` throws for a CJK substitute family returned by the API (only matters on a machine with the pack fetched).
