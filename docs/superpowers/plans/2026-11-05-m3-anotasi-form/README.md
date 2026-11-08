# Edith M3 — Anotasi & Form: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task lives in its own file in this folder; read README.md (this file) + your task file only.

**Goal:** Native text markup (highlight/underline/strike attached to the original text) and sticky notes, signatures (drawn/typed/uploaded) with a per-browser library, 17 preset + custom stamps, check/cross symbols, links to a URL or another page, and filling AcroForm fields with optional flatten — all shown in the editor as they will be exported, plus the two M2-backlog text warnings.

**Architecture:** The op schema gains `signature.add`, `stamp.add`, `symbol.add`, `link.add`, `annot.add` and the document-wide `form.set`. The bake draws signatures/stamps/symbols with the other content (stamps through M2's `draw_text_box`), then adds native annotations and links per page on the unrotated page, then fills form fields and optionally flattens them (`Document.bake(widgets=True)`); it also stops losing the AcroForm in its page rebuild. The structure endpoint lists form widgets and a new per-page endpoint serves character boxes for text selection. The web client draws every new op in Konva with the same geometry as the bake (stamps and symbols through shared formulas tested with identical numbers on both sides; highlights in a CSS-multiplied layer), selects original text by character for markup, shows HTML inputs over form widgets, and keeps form values in the undoable document.

**Tech Stack:** As M2 (Python 3.12/uv/FastAPI/PyMuPDF 2.1 (MuPDF 1.28.6) · Next.js 16/React 19/Konva/react-konva/zustand/fontkit/pdfjs-dist 6.5/Tiptap 3/Vitest/Playwright). No new dependencies.

Spec: `docs/superpowers/specs/2026-11-05-pdf-editor-design.md` — Fitur v1 (Stamp, Simbol, Link, Anotasi, Tanda tangan, Form), Skema Ops, Urutan bake 4–6, Frontend (Toolbar, SignatureModal, StampPicker, LinkPopover, FormLayer), Testing, Kriteria Selesai ("Anotasi markup dan sticky note bisa diedit di Acrobat"). Earlier plans (format and conventions): `docs/superpowers/plans/2026-11-05-m1-fondasi/`, `docs/superpowers/plans/2026-11-05-m2-edit-teks/`.

## Global Constraints

Everything in the M1 and M2 READMEs' Global Constraints still holds (repo root, npm + uv, error JSON shape, coordinates in unrotated-CropBox points with pages unrotated while drawing, `pageKey` rules, `#rrggbb` colors, quantized advances `floor(advanceWidth·1000/unitsPerEm)/1000·size`, client = layout authority, snapshot undo with `coalesce`, Bahasa Indonesia UI strings only in `apps/web/src/lib/strings.ts`). In addition:

- **Commands.** API `cd apps/api && uv run pytest -q` (warning-free). Web unit tests `npm test -w apps/web`; types `npx tsc --noEmit -p apps/web`; lint `npm run lint -w apps/web` (0 problems); E2E `npm run e2e -w apps/web` (starts uvicorn :8000 and `next dev` :3000 itself; it *reuses* servers already on those ports — stop them first). The shell has `NODE_ENV=production`; the root `.npmrc` has `include=dev`. After changing `apps/api/edith/ops.py`: `cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops` (never edit `packages/ops/schema.json` / `src/types.ts` by hand). `next dev` may rewrite `apps/web/tsconfig.json`; restore it with `git checkout apps/web/tsconfig.json` before committing.
- **Commit trailer.** Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Code in the task files** was written and run in a throwaway worktree before this plan was written: after each task the suites were green with these counts — API 262 / 271 / 282 / 291 / 295 (Tasks 1–5, then unchanged), web 169 (Tasks 1–5) / 176 / 183 / 190 / 194 / 195 / 201 / 204 / 209 / 209, tsc and eslint clean at every task, E2E 4 passed at Task 14. Modified files are given as unified diffs against the state the previous task leaves; new files in full.
- **New error code:** `page_not_found` 404 (chars endpoint, index outside the document).
- **Any new TextWriter text goes through `draw_text_box`** (M2: its ToUnicode hook makes spaces extract as U+0020). Stamps do; nothing else in M3 writes text.
- **Spike results (PyMuPDF 2.1 / MuPDF 1.28.6, pdfjs-dist 6.5, Chromium) — the design relies on these:**
  - **Text markup:** `page.add_highlight_annot(quads=[Rect.quad, …])` / `add_underline_annot` / `add_strikeout_annot`; `set_colors(stroke=rgb)` writes `/C`; `Annot.vertices` reads each quad back as top-left, top-right, bottom-left, bottom-right in page coordinates. MuPDF's appearance streams: a highlight fills each quad (ends rounded, bulging 0.236·h past the quad) with `/BM /Multiply` and no `/CA`; an underline is a line h/16 wide whose centre is h/7 above the quad bottom, a strike-out at 3h/7 (h = quad height). Quads added on the unrotated page stay on their text after `set_rotation` (90/270, cropped pages checked).
  - **Sticky note:** `add_text_annot(point, content, icon="Note")` → a `/Text` annotation 16 × 16 pt with its top-left corner at `point`, flags 28 (Print, NoZoom, NoRotate), a `/Popup`, `/Contents` = content; its appearance is the color-filled square with a 1 pt black border and four 8 × 1 pt black lines at y + 4, 6, 8, 10.
  - **Links:** `insert_link({"kind": LINK_GOTO, "from": rect, "page": i, "to": Point(0, 0), "zoom": 0})` / `{"kind": LINK_URI, "uri": …}` with `from` in page coordinates handles the CropBox offset (PDF `/Rect` = crop origin + rect); GoTo writes `/XYZ` at the target page's unrotated top-left. Links are inserted after `build_pages`, so `page` is the output index. `Page.get_links()` reports rects for the rotation the page was *loaded* with — tests un-rotate, save and reopen before reading.
  - **Widgets:** `page.widgets()` gives `field_name` (fully qualified), `field_type` (7 text, 2 checkbox, 5 radio, 3 combo, 4 list, 1 button, 6 signature), `field_value` (checkbox `"Off"`/on-state, radio: this button's state, text/choice strings), `on_state()`, `choice_values`, `field_flags` (1 read-only, 4096 multiline), `text_fontsize` (0 = auto) and `rect` — **in unrotated CropBox coordinates even on rotated pages**. Filling: set `field_value` (checkbox `True/False`; radio `True` on the chosen button switches the group's other buttons off; strings otherwise) then `update()` (regenerates the appearance). PyMuPDF-*created* radio buttons all get the on-state name `"False"` (fixtures rename them; real PDFs are fine).
  - **`Document.select()` drops `/AcroForm` from the catalog** (widgets stay on the pages, `is_form_pdf` becomes false): every M1/M2 export lost its form. **`fullcopy_page()`** copies widgets with `/Parent` but the parent's `/Kids` does not list the copy, and `update()` on it then raises "Widget is not listed in its /Parent/Kids array". Task 4 re-attaches the AcroForm with `/Fields` rebuilt and adopts copied widgets; a duplicated page then shares the field value with the original (same field), so `form.set` updates every widget of that name.
  - **Flatten:** `Document.bake(annots=False, widgets=True)` turns widgets into page content and removes the AcroForm; highlight/note annotations and links stay (checked).
  - **Character boxes:** `get_text("rawdict")` char bboxes are contiguous in x (good for selection) but their height is the font bbox (Helvetica 12 pt: 16.5 pt, overlapping the next line at 12–14 pt leading) — markup quads use M2's text-background band `baseline − 0.9·size … baseline + 0.25·size` instead.
  - **pdf.js:** the default `AnnotationMode.ENABLE` (what `PageView` uses) draws every annotation's appearance, widgets included, into the page canvas. `ENABLE_FORMS` skips text/choice widgets but emits *both* appearance states of checkboxes/radios (meant for annotation-layer canvases we do not have) — so the mode stays and the form layer's inputs are opaque. The editor never shows unbaked ops through pdf.js (they live in the store and are drawn by Konva; the source PDF is never modified), so nothing is drawn twice after a reload.
  - **Multiply on screen:** CSS `mix-blend-mode: multiply` on a Konva layer's `<canvas>` blends with the pdf.js canvas below (Chromium screenshot: black text stays black under a yellow highlight).
  - `insert_image` keeps a PNG's alpha (transparent signature over a colored page checked). `draw_rect(…, radius=r)` rounds corners by `r × min(w, h)` (r ≤ 0.5).
- **Shared geometry contracts (change both sides together; both test suites pin the same numbers):**
  - Stamp (`apps/api/edith/bake/stamps.py` ↔ `apps/web/src/lib/stamps.ts`): font Arimo Bold; border width `max(0.5, 0.05·min(w, h))`, stroked on the rect inset by half of it, corner radius `0.2·min(inner w, inner h)`; available width `w − 2·(0.12·h + border)`; one line: size `min(0.5·h, avail / width₁pt)`, baseline `h/2 + 0.688·size/2`; label + date/time line: sizes `min(0.36·h, …)` and `min(0.2·h, …)`, baselines `0.5·h` and `0.78·h`; each line centred. Date/time strings are formatted by the client (`dd/mm/yyyy`, `HH:MM`) and drawn verbatim.
  - Symbols (`bake/symbols.py` ↔ `lib/symbols.ts`): check `(0.12, 0.52) → (0.4, 0.8) → (0.88, 0.2)`, cross `(0.18, 0.18)–(0.82, 0.82)` and `(0.82, 0.18)–(0.18, 0.82)` in the unit square of the rect; stroke `0.12·min(w, h)`, round caps and joins.
  - Text markup: one axis-aligned quad per line, `x` from the first to the last selected character box (spaces at the ends trimmed), `y` = the text-background band above; on screen underline/strike are drawn as MuPDF draws them (h/16 line at h/7 / 3h/7 above the bottom).
  - Sticky note icon: 16 × 16 pt from `point`.
- **Bake order per page:** text-edit redactions → `redact.add` → drawn ops in op order (now incl. signature, stamp, symbol) → `annot.add` → `link.add`; then for the document `form.set` + optional flatten; then rotation (spec: Urutan bake 3–7).

## Decisions (and why)

- **One op per spec row, no extra geometry in ops.** Stamps and symbols are fully determined by their rect (shared formula), so the spec's op fields suffice and resizing needs no relayout; the client never has to send glyph positions for them.
- **Stamps:** vector border + text (spec: `bake/stamps.py`), Arimo Bold (bundled, metric-identical on both sides). The 17 preset labels are the spec's English names; presets carry a default color from the 5 stamp colors.
- **Symbols:** stroked vector paths, not ✓/✗ glyphs (Arimo and most fonts lack them; M2 backlog shows TextWriter would silently substitute).
- **Signatures:** always a PNG asset (`signature.add {rect, assetId}`, spec). Typed signatures are rendered client-side on a canvas with the same `FontFace` the editor already loads for the 4 script fonts, so what is previewed is what is placed — one code path for drawn/typed/uploaded, no new op shape. Library in `localStorage["edith:signatures"]` (spec: per browser), at most 5 entries, newest first, an image over 400 000 data-URL characters (≈ 300 KB) is used but not saved; uploads are scaled to ≤ 900 × 300 px first. Placed 160 pt wide (≤ 80 pt tall) in the middle of the page in view.
- **Markup selection:** a press on an original text line with the Penanda tool starts a character selection (caret before/after the nearer half of a character), dragging extends it across lines in extraction order, release adds one `annot.add`; the tool stays active (spec). Character boxes come from a new per-page endpoint fetched on demand. Lines of edited paragraphs (`text.edit`) are excluded (their glyphs are redacted at bake); text boxes are not markable (YAGNI). Markup can't be moved or resized — it belongs to its text.
- **Notes:** the Catatan tool places the icon at the click and selects it; its text is edited in the properties bar (no popover). Back to Pilih after one note (spec lists only Teks/Gambar Bebas/Highlight/Centang/Silang as staying active).
- **Links:** the Link tool (Ctrl/Cmd+K, spec shortcut) drags a rect like the shape tools; the **LinkPopover** under it asks for "Ke URL" (http/https/mailto; a bare host gets `https://`) or "Ke halaman" (a list "Halaman 1…n" of the current page order, stored as `pageKey`, so reordering keeps the target). A selected link edits its target in the properties bar. On screen a link is a dashed light-blue box (no appearance in the PDF). A link to a deleted page is dropped by `compact()`; the bake rejects an unknown target as `invalid_op`.
- **Forms:** HTML inputs over the widgets (spec `FormLayer`), opaque, interactive only with the select tool; values live in `EditorDoc.forms` (undoable, autosaved with the draft, typing in one field = one undo step) and are exported as `form.set` ops — not page objects, because a field's widgets may be on several pages and `form.set` has no `pageKey` in the spec. Push buttons, signature fields and read-only fields get no input.
- **Flatten toggle:** a "Ratakan form" checkbox next to Unduh, shown only when the document has fields, off by default, not persisted (an export option, not an edit).
- **Highlights multiply on screen** through a second Konva layer with CSS `mix-blend-mode: multiply`, above the objects (annotations are above page content in viewers).
- **M2 backlog owner decisions:** (a) an edited paragraph whose first-to-last-baseline height exceeds the original's gets an orange dashed outline and a properties-bar message (no auto-push); (b) the properties bar warns "beberapa karakter tidak didukung font ini" when a character is not covered even after the full fallback chain (`covers()` on the resolved runs); the bake stays permissive.
- **Other backlog items folded in where M3 touches the code:** `redact_handlers` hoisted out of the page loop (M2 Task 7, in Task 3); `SplitButton` menu closes on Escape (M1 Task 17, in Task 10); image upload uses the shared `currentPage()/placeObject()` (Task 10). M2 final review "bundled-font missing glyph: client should warn" = decision (b).

## Deviations from spec (intentional, M3)

- **`annot.add.quads` are axis-aligned rects** (`Rect[]`, one per line), not 4-point quads: v1 only marks horizontal text (rotated text is not editable either). `content` is accepted on every kind; the UI sets it only for notes.
- **New endpoint `GET /documents/{id}/pages/{index}/chars`** for character boxes (the spec has no source for them; putting them in `/text` would make it megabytes for long documents).
- **`structure.fields[]` shape:** one entry per widget `{name, type, value, onState, options, page, rect, readOnly, multiline, fontSize}` — `rect` (unrotated CropBox points, like every other geometry) instead of `bbox`, plus what the inputs need; `type` also reports `button`/`signature` (shown by pdf.js only).
- **`form.set` values:** checkbox → boolean, radio → the chosen button's on-state name (`"Off"` = none), text/combo/list → string. Client-side the values are `EditorDoc.forms`, not objects.
- **Bug fix in M1 behaviour:** exports now keep the AcroForm (before, `select()` silently dropped it).
- **Toolbar labels in Indonesian:** Highlight▾ is "Penanda" (Stabilo / Garis bawah / Coret); Gambar▾ holds the actions "Unggah gambar" / "Stamp"; Centang, Silang, Tanda Tangan, Catatan, Link as in the spec order. Kelola Halaman and Crop remain M4.
- **No `opacity` field yet** (spec: on every drawn object) — part of M4's properties polish; highlights rely on MuPDF's Multiply instead.
- **GoTo links** jump to the target page's top-left (`/XYZ`, zoom unchanged) rather than a fit-page destination (what `insert_link` writes).
- **E2E scope:** the spec's single big E2E (also duplicate/delete pages, crop) is split by milestone; M3's covers highlight, note, typed signature from the library, stamp, link to another page, text field + checkbox, with and without flatten.

## Tasks

| # | File | Deliverable |
|---|---|---|
| 1 | task-01-ops-schema.md | New op types + validators, regenerated schema/types, example JSON |
| 2 | task-02-bake-marks.md | Bake signatures, vector stamps (shared layout), check/cross |
| 3 | task-03-bake-annots-links.md | Bake native highlight/underline/strike, sticky notes, URL/page links |
| 4 | task-04-forms.md | Structure `fields`, `form.set`, flatten, AcroForm kept through page rebuilds |
| 5 | task-05-chars-endpoint.md | `GET /documents/{id}/pages/{index}/chars` |
| 6 | task-06-web-model.md | Tools, styles, `EditorDoc.forms`, compaction, annotation geometry, strings |
| 7 | task-07-web-render.md | Konva rendering of every new op; multiplied markup layer |
| 8 | task-08-web-markup-tool.md | Penanda tool: character selection → `annot.add` |
| 9 | task-09-web-click-tools.md | Centang/Silang/Catatan tools, Link tool + LinkPopover, Ctrl/Cmd+K |
| 10 | task-10-web-stamps.md | Gambar▾ (Unggah/Stamp), StampPicker, stamp colors |
| 11 | task-11-web-signatures.md | SignatureModal (draw/type/upload) + browser library |
| 12 | task-12-web-forms.md | FormLayer inputs, flatten toggle |
| 13 | task-13-web-text-warnings.md | Overflow outline + unsupported-character warning (M2 backlog) |
| 14 | task-14-e2e-docs.md | E2E over the whole milestone, PyMuPDF checks, README |

Tasks 1–5 (API) build on each other in order (Task 1's schema keeps the web green). Task 6 needs 1, 4 and 5 (types/JSON shapes); 7 needs 2's contracts and 6; 8 needs 5–7; 9 needs 6–7; 10 needs 7; 11 needs 10 (`placement.ts`); 12 needs 4 and 6; 13 is independent of 7–12 (M2 code only); 14 needs everything.

## Self-review (spec coverage)

- Markup teks native menempel ke teks → Tasks 3, 5, 7, 8 (+ E2E quads/colors). Sticky note → 3, 7, 9. Editable in Acrobat: native `/Highlight`, `/Underline`, `/StrikeOut`, `/Text` annotations with `/C`, `/Contents`, appearance streams generated by MuPDF.
- Tanda tangan gambar/ketik (4 font script, 3 warna)/unggah + pustaka per browser → Tasks 2, 11 (+ E2E typed + library).
- Stamp 17 preset + custom teks/tanggal/jam, 5 warna → Tasks 1, 2, 7, 10 (+ E2E preset).
- Simbol centang/silang → Tasks 2, 7, 9.
- Link ke URL atau halaman (insert_link LINK_URI/LINK_GOTO via pageKey → output index) → Tasks 3, 9 (+ E2E page link).
- Form AcroForm isi (teks, checkbox, radio, dropdown) + flatten → Tasks 4, 12 (+ E2E text + checkbox, flatten).
- Skema Ops rows signature/stamp/symbol/link/annot/form.set → Task 1. Urutan bake 4–6 → Tasks 2–4.
- Frontend: Toolbar items (Tasks 8–11), SignatureModal (11), StampPicker (10), LinkPopover (9), FormLayer (12); Ctrl/Cmd+K (9).
- Owner decisions from the M2 backlog (overflow outline, unsupported characters with `covers()`) → Task 13.

## Owner decisions (2026-11-05, after plan review) — override the text above where they conflict

1. Typed signatures are rendered to PNG (as planned).
2. **Stamp presets are bilingual:** keep the 17 English presets from the spec AND add Indonesian equivalents of all 17 (e.g. Approved → Disetujui, Not Approved → Tidak Disetujui, Draft → Draf, Final → Final, Completed → Selesai, Confidential → Rahasia, For Public Release → Untuk Publik, Not For Public Release → Tidak Untuk Publik, For Comment → Untuk Dikomentari, Void → Batal, Preliminary Results → Hasil Sementara, Information Only → Hanya Informasi, Witness → Saksi, Initial Here → Paraf di Sini, Sign Here → Tanda Tangan di Sini, Accepted → Diterima, Rejected → Ditolak). The StampPicker shows a language switch (Indonesia / English, default Indonesia) above the preset grid; both sets share colours. Preset ids stay stable and distinct per language (e.g. `approved` and `disetujui`), and API + web must agree on every preset's text and colour (Tasks 1, 2, 10, 14).
3. Text markup works on original PDF text only (as planned).
4. Annotation author (`/T`) stays empty (as planned).
5. Planner defaults accepted: signature library 5 entries × ~300 KB; flatten off by default, not remembered.

**Update after Task 1:** `STAMP_PRESETS` (apps/api/edith/ops.py) has 34 ids — the 17 English ids in plan order, then the Indonesian ids in the same order: disetujui, tidak-disetujui, draf, final-id, selesai, rahasia, untuk-publik, tidak-untuk-publik, untuk-dikomentari, batal, hasil-sementara, hanya-informasi, saksi, paraf-di-sini, tanda-tangan-di-sini, diterima, ditolak. Each Indonesian preset uses the same colour as its English counterpart and the label from Owner decision #2. Wherever later tasks say "17 presets", read "34 presets". Tasks 2 and 10 must keep API and web preset tables identical (label + colour per id) and add a parity test (e.g. a JSON table in packages/ops or a test that compares the web table against the API table).

**Update after Task 2:** the single preset table is `packages/ops/stamp-presets.json` (`[{id, label, color}]`, 34 entries, labels uppercase incl. Indonesian, e.g. "DISETUJUI"). Tasks 7, 10 and 14 must import this JSON on the web side (no hand-written table; resolve the JSON import from the `@edith/ops` workspace) and use 34 presets; the StampPicker language switch filters by the English/Indonesian halves (first 17 / last 17 ids). The API reads the file from `REPO_ROOT/packages/ops` (like fonts), so deployments must ship `packages/`.
