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
