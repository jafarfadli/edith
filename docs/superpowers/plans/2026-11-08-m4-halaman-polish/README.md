# Edith M4 — Halaman & Polish: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task lives in its own file in this folder; read README.md (this file) + your task file only.

**Goal:** Manage pages in a modal (multi-select rotate/duplicate/move/delete, insert blank, import another PDF; Simpan/Batal), duplicate pages with their objects, import PDFs, crop this page or all pages, a selection mini-bar with copy/paste/duplicate/align-to-page, rotation handles, opacity on every drawn object, dashed/dotted strokes, polygon/polyline/cloud shapes, and an Annotations panel — exported exactly as shown.

**Architecture:** The op schema gains `opacity`/`rotation` on drawn ops, three shape kinds plus `dash`, and `crop` on layout pages. The bake draws every drawn op with its normal handler and then wraps the content streams it added in `q [gs] [cm] … Q` (one mechanism for rotation and opacity of all kinds), appends imported documents whole with `insert_pdf` before the existing select/duplicate/AcroForm logic, and sets the CropBox last. The web keeps one pdf.js document per source doc, renders cropped pages whole-but-clipped through crop-aware `coords.ts`, does all page edits through pure functions in `lib/pages.ts` (the modal edits a copy and commits it as one undo step), and draws polygons/clouds/dashes with geometry shared number-for-number with the bake.

**Tech Stack:** As M3 (Python 3.12/uv/FastAPI/PyMuPDF 2.1 (MuPDF 1.28.6) · Next.js 16/React 19/Konva 10/react-konva/zustand/pdfjs-dist 6.5/dnd-kit/Vitest/Playwright). No new dependencies.

Spec: `docs/superpowers/specs/2026-11-05-pdf-editor-design.md` — M4 row; Fitur v1 (Halaman, UX objek, Panel samping); Skema Ops (`opacity`/`rotation`, shape kinds, `dash`, `pages.layout {pageKey, src, rotate, crop?}`); Identitas halaman; Urutan bake 2 and 7; Frontend (ManagePagesModal, CropOverlay, SelectionMiniBar, shortcuts Ctrl/Cmd+C/V/D). Earlier plans (format, conventions, spikes): `../2026-11-05-m1-fondasi/`, `../2026-11-05-m2-edit-teks/`, `../2026-11-05-m3-anotasi-form/`.

## Global Constraints

Everything in the M1–M3 READMEs' Global Constraints still holds (repo root, npm + uv, error JSON shape, coordinates in unrotated-CropBox points of the page's *source* with pages unrotated while drawing, `pageKey` `o{n}`/`u-{uuid}`, `#rrggbb` colours, client = layout authority, snapshot undo with `coalesce`, Bahasa Indonesia UI strings only in `apps/web/src/lib/strings.ts`, new TextWriter text only through `draw_text_box`). In addition:

- **Commands.** API `cd apps/api && uv run pytest -q` (warning-free). Web `npm test -w apps/web`; types `npx tsc --noEmit -p apps/web`; lint `npm run lint -w apps/web` (0 problems); E2E `npm run e2e -w apps/web` (starts uvicorn :8000 and `next dev` :3000, reuses servers already there — stop them first). Shell has `NODE_ENV=production`; root `.npmrc` has `include=dev`. After changing `apps/api/edith/ops.py`: `cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops` (never edit `schema.json`/`types.ts` by hand). `next dev` may rewrite `apps/web/tsconfig.json`; `git checkout apps/web/tsconfig.json` before committing.
- **Commit trailer.** Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Code in the task files** was written and run in a throwaway worktree (branch from `main` at 77bca03): suite counts after each task — API 316 / 326 / 336 / 346 / 353 (Tasks 1–5, then unchanged); web 226 (Tasks 1–5) / 243 / 257 / 260 / 261 / 264 / 264 / 272 / 274; tsc and eslint clean at every task; E2E 6 passed after Task 8, 7 passed at Task 14. Modified files are unified diffs against the state the previous task leaves; new files are complete.
- **Shared geometry contracts (change both sides together; both suites pin the same numbers):**
  - Dash (`bake/geometry.py` ↔ `lib/geometry.ts`): w' = max(width, 0.5); `dashed` = `[3w', 2w']` butt caps; `dotted` = `[0, 2w']` round caps (zero-length dashes + round caps = dots, checked in MuPDF raster). Arrow heads stay solid (Konva's Arrow also draws its head undashed).
  - Cloud: closed polygon; each edge split into n = max(1, floor(len / arc + 0.5)) chords, arc = 8 + 2·width; on each chord a half circle bulging away from the polygon (outward normal chosen by the shoelace sign: area2 > 0 = clockwise on screen) as two cubic Béziers with KAPPA = 0.5522847498. `floor(x + 0.5)` on both sides (Python `round` is banker's rounding).
  - Rotation: degrees, clockwise on screen (Konva's convention), around the centre of the op's `rect` (`box.rect` for `text.add`, whose `rect.h` is the laid-out height). Points-based ops (ink, line, arrow, polygon, polyline, cloud) never carry `rotation`: rotating them moves their points.
  - Opacity: one ExtGState `/CA = /ca = opacity` over the whole object; Konva sets the group's `opacity`, which also multiplies per shape — overlaps inside one object (stamp border + text) darken the same way on both sides.
  - Crop: page coordinates (unrotated, relative to the source CropBox); bake `set_cropbox(crop + cropbox.top_left)` in MediaBox coordinates, then `set_rotation`.
- **Bake order per document:** build pages (imports appended whole, once per doc, *before* `detach_acroform`) → per page: text-edit redactions → `redact.add` → drawn ops in op order (each wrapped for rotation/opacity) → `annot.add` → `link.add` → `form.set` + flatten → crop → rotation.
- **New error detail:** `doc_expired` (410) for an expired *imported* document carries `doc_id`.

## Spike results (PyMuPDF 2.1 / MuPDF 1.28.6, Chromium) — the design relies on these

- **`insert_pdf(src)`** copies annotations, links and widgets (`widgets=1` default). A field whose name already exists is **renamed `"name [xref]"`** (with `join_duplicates=0`), so the imported field keeps its own value and `form.set` by name never reaches it; `join_duplicates=1` would merge it with the main document's field (wrong). Inserting into a document without a form creates the catalog `/AcroForm`; detaching *after* the import keeps it through `select()` + `reattach_acroform`. Inserting whole documents keeps their internal links.
- **`set_cropbox(r)`** takes MediaBox top-left coordinates and raises "CropBox not in MediaBox" outside it. After it, drawings, words, links and widgets read back shifted by exactly the crop origin. Annotations/links/widgets outside the crop stay in the file (invisible, still in the AcroForm) — accepted.
- **Every PyMuPDF drawing call appends one new `/Contents` stream** (`draw_*`, `Shape.commit`, `insert_image`, `TextWriter.write_text`) — *except* that the first call on an unwrapped page also prepends a `q` stream and appends `Q`; calling `page.wrap_contents()` first avoids that. Merging the new streams into one and wrapping it in `q /GS gs a b c d e f cm … Q` works for every handler; `cm = TM · (T(−c) · Matrix(deg) · T(c)) · TM⁻¹` with `TM = page.transformation_matrix` gives a clockwise-on-screen rotation also on cropped / offset-MediaBox pages. `page._set_opacity(CA, ca)` registers the ExtGState. `insert_image(rotate=)` only does multiples of 90, and `show_pdf_page(rotate=)` has no opacity — so neither is used.
- **`get_drawings()`** reports `dashes` as `"[ 6 4 ] 0"`, `stroke_opacity`/`fill_opacity`, and closed polylines as explicit `l` items (`closePath` False).
- **Konva:** a click on an unfilled `Rect` only hits its stroke (`hitStrokeWidth` 'auto' = stroke width), so unfilled rect/ellipse get `hitStrokeWidth = max(width, 8)`; the hit canvas ignores dashes. Two clicks < 400 ms apart fire `dblclick` regardless of distance (polygon tool guards it). `Transformer` rotation works with a group whose `offset` = rect centre.

## Decisions (and why)

- **Rotation only on rect-placed objects; points-based objects rotate their points.** Avoids a second transform path in the bake for points and keeps their bounding boxes honest; the spec's "rotation around the rect centre" has no rect for them.
- **Opacity on drawn objects only** (text.add, image, signature, stamp, symbol, shape, ink). Whiteout/redact must stay opaque (they hide content); links and annotations are not page content; edited original paragraphs keep the original's look.
- **One content-stream wrapper** for rotation + opacity instead of per-handler code (morph/Shape/TextWriter `morph`/`show_pdf_page` hybrids): one mechanism, tested on rect, image, ink, text and stamp.
- **Polygon/polyline/cloud are points-based** (`points`), drawn by clicking vertices; finished by same-spot double-click, Enter, or clicking the first vertex; Esc cancels; back to Pilih afterwards (spec: Bentuk returns to Select). Cloud = a polygon with a scalloped border (Acrobat's "cloud" polygon), filled like a polygon.
- **Imported PDFs are separate documents** (POST /documents), referenced by `{doc, index}`; the client keeps their page sizes in a non-undoable registry `DocInfo.imports`, records their ids in `EditorDoc.imports` (so a restored draft can tell them from the main document after a re-upload changes the main id), and loads their pdf.js documents on demand. **Imported pages support everything drawn** (objects, notes, links, crop, duplicate) but **not original-text editing, text markup, Find, or filling their form fields** in M4: those need per-document `/text`, `/chars`, `/fonts/{ref}` and a doc-qualified `OriginalFont.ref` (refs are xref numbers, unique only per document). Their fields are kept (renamed on collision) and rendered by pdf.js. A restored draft whose import expired loses those pages with a notice.
- **Manage Pages works on a copy** of the whole `EditorDoc` and commits it with `replaceDoc` (one undo step); importing inside the modal uploads immediately but only Simpan inserts the pages. Page edits are pure functions in `lib/pages.ts`, reused by the thumbnail menu. "Pindah" moves the selection one place left/right as a block, plus drag-to-reorder.
- **Duplicating a page copies all its objects** (text.edit, markup and links included) with new ids; links on the copy keep their targets; form widgets become shared fields (M3 behaviour).
- **Crop UI:** Crop (toolbar, right) edits the page in view: whole page shown, outside shaded, dashed rect inside the page; *Terapkan ke halaman ini / semua halaman / Hapus crop / Batal*. "All pages" applies the same page-coordinate rect clamped to each page (pages it would shrink below 10 pt keep theirs). Display: the whole page is rendered and shifted under an `overflow:hidden` wrapper; overlays use crop-aware `coords.ts` and the Konva group's `offsetX/offsetY`.
- **Clipboard is the editor's own** (not the system clipboard): Salin/Tempel/Duplikat (+ Ctrl/Cmd+C/V/D); paste lands on the page in view at the same coordinates (another page) or +10 pt per paste (same page), kept inside the visible area; text.edit and markup cannot be copied. **Align** works in screen orientation (rotated/cropped pages) on the object's rotated bounds.
- **Sidebar tabs** Halaman | Anotasi (n) instead of a toolbar split button: same function, less chrome.
- **Backlog folded in:** page-menu Duplikat + "+" menu (Halaman kosong / Impor PDF); blank pages take the neighbour's on-screen orientation and crop (M1 T12); Ctrl+Z/Shift+Z/Ctrl+Y inside form fields undo the document (M3 T12); `compact` drops `form.set` for fields whose pages were all deleted (M3 should-fix); bake test for a link to a duplicated page (M3 should-fix); `ShapeAdd` rejects stray `rect`/`points` (M1 T3); transformer `flipEnabled=false` (M1 T16); `scrollToPage` scrolled the thumbnail instead of the page (found by the E2E; the selector matched the thumbnail first).

## Deviations from spec (intentional, M4)

- Imported pages: no original-text editing, markup, Find or form filling (see Decisions); the spec implies full parity.
- `rotation` exists only on rect-placed drawn ops; points-based shapes and ink rotate by their points; whiteout/redact/link/annot/text.edit have neither `rotation` nor `opacity`.
- Panel switch is a tab pair at the top of the sidebar, not a split button in toolbar row 1.
- "Crop semua halaman" uses the same page-coordinate rect per page (clamped), not a proportional or screen-oriented mapping.
- Annotations, links and widgets outside a crop are kept (invisible), not removed.
- The spec's granular client page ops (rotate/delete/duplicate/insert/move/crop) are snapshot-undo steps on `EditorDoc` (as since M1), compacted into one `pages.layout`.

## Deliberate exclusions (go to BACKLOG.md)

- Per-document text/fonts/chars for imported pages; editing imported form fields; re-upload flow for an expired import.
- Thumbnails re-rendered after edits (still the source page only); live thumbnails in the modal.
- Multi-object selection, group align/distribute, align to other objects.
- Rotation of whiteout/redaction/links/notes; a numeric rotation input.
- System clipboard interop (pasting images/text from other apps).
- Removing annotations/widgets outside a crop; crop by drag on the page without the Crop button.
- Konva hit canvas occasionally stale right after a tool click (seen in E2E: selection by canvas click right after placing a symbol); E2E selects via the Anotasi panel.
- M2 "should fix soon" items (font subsetting, caching `/text`, same-name fonts) — untouched by M4 code.

## Tasks

| # | File | Deliverable |
|---|---|---|
| 1 | task-01-ops-schema.md | Schema: opacity/rotation, polygon/polyline/cloud + dash, layout crop; types + example |
| 2 | task-02-bake-shapes.md | Bake new shape kinds and dash styles (shared geometry) |
| 3 | task-03-bake-transform.md | Bake rotation + opacity for every drawn op (content-stream wrapper) |
| 4 | task-04-bake-imports.md | Bake pages of imported PDFs (insert_pdf, forms, 410 with doc_id) |
| 5 | task-05-bake-crop.md | Bake crop last |
| 6 | task-06-web-model.md | Crop-aware coords, `geometry.ts`, object helpers, tool style |
| 7 | task-07-web-pages-model.md | `lib/pages.ts`, store page actions, imports registry, compaction, drafts |
| 8 | task-08-web-multidoc-render.md | Per-doc pdf.js, cropped rendering, "+" menu, import flow, page-menu Duplikat |
| 9 | task-09-web-manage-pages.md | Kelola Halaman modal |
| 10 | task-10-web-crop.md | Crop tool + overlay |
| 11 | task-11-web-object-style.md | Rotation handle, opacity, dash, polygon/polyline/cloud tools |
| 12 | task-12-web-minibar-clipboard.md | Mini-bar, copy/paste/duplicate, align, shortcuts, form-field undo |
| 13 | task-13-web-annotations-panel.md | Anotasi panel |
| 14 | task-14-e2e-docs.md | E2E over the milestone + PyMuPDF checks + README |

Tasks 1–5 (API) build on each other in order. Task 6 needs 1 (types) and 2 (numbers); 7 needs 6; 8 needs 7; 9 needs 7–8; 10 needs 7–8; 11 needs 6 (and 8's PageOverlay crop changes); 12 needs 6 and 8 (`MenuButton`); 13 needs 8 (Sidebar); 14 needs everything.

## Self-review (spec coverage)

- Modal Kelola Halaman (multi-select; putar, hapus, duplikat, pindah, sisip kosong, impor; Simpan/Batal) → Tasks 7, 9 (+ E2E rotate/duplicate/delete/Simpan).
- Duplikat (copies ops, new `u-` key) → 7, 8 (menu), 9; bake 4 (duplicate of imported page, link to duplicate).
- Impor PDF (POST /documents, `{doc, index}`, insert_pdf, forms) → 4, 7, 8, 9 (+ E2E import).
- Crop halaman ini/semua (set_cropbox last, client clipping) → 5, 6, 7, 8, 10 (+ E2E crop).
- Mini-bar + ⋯ (salin, tempel, duplikat, ratakan kiri/tengah/kanan/atas/tengah/bawah), Ctrl/Cmd+C/V/D → 12 (+ E2E paste + align).
- Rotasi objek (handle) → 3, 6, 11 (+ E2E rotate 90° checked in PDF).
- Opacity on all drawn objects → 1, 3, 11 (+ E2E 50 %).
- Garis putus-putus (dash) → 1, 2, 6, 11 (+ E2E dashes).
- Polygon/polyline/cloud → 1, 2, 6, 11 (+ E2E polygon + cloud).
- Panel Anotasi (list per page, jump, delete) → 13 (+ E2E select + delete).
