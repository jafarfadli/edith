# Edith M5 — Kualitas Teks & UI Gelap: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task lives in its own file in this folder; read README.md (this file) + your task file only.

**Goal:** Fix what the owner hit with a real Korean government form (`references/Visa Application Form (1).pdf`, untracked): paragraphs split per table cell, bullet, form row and heading instead of 10-line blobs; edited text keeps the PDF's own font (cmap-less CID subsets reused) with per-character fallback, including optional Korean/Japanese/Chinese fonts; the Catatan and Link tools leave the UI; every download failure explains itself; and the whole UI is redesigned in a dark, design-app style.

**Architecture:** The API reads the page's vector rules (`edith/rules.py`) and regroups text lines with rules, hard breaks, bullets, form rows and style changes (`edith/paragraphs.py`, segmentation version 2, ids versioned end to end so old drafts can't edit the wrong paragraph). Embedded CID TrueType subsets without a cmap get one rebuilt from ToUnicode + CIDToGIDMap with fontTools (`edith/cid_fonts.py`) — the same bytes feed the browser (FontFace + fontkit) and the bake (TextWriter). The web resolves fonts per character (`lib/fallback.ts`): original → substitute → CJK pack font of the character's script and the run's design → Arimo → Noto Sans, loading fonts lazily. Exports subset the fonts they embed. The UI gets design tokens, lucide line icons, one top bar with tooltips and key caps, a floating contextual properties bar with a one-line hint per tool, and restyled panels, dialogs and start page.

**Tech Stack:** As M4 (Python 3.12/uv/FastAPI/PyMuPDF 2.1 (MuPDF 1.28.6) · Next.js 16/React 19/Konva 10/zustand/pdfjs-dist 6.5/fontkit/Vitest/Playwright). New: **fontTools ≥ 4.50 becomes a runtime dependency** of the API (Task 4); **`lucide-react` 1.61.0** (exact, Task 9); Geist + Geist Mono via `next/font/google` (Task 9). Optional, not committed: the CJK font pack (Noto Sans/Serif KR/JP/SC, Task 5).

Inputs: owner feedback on the deployed app (5 points, Bahasa Indonesia; see "Owner decisions" below) and the M1–M4 plans in `../2026-11-05-m1-fondasi/` … `../2026-11-08-m4-halaman-polish/` (format, conventions, earlier spikes). Screenshots referenced below are in `shots/`.

## Global Constraints

Everything in the M1–M4 READMEs' Global Constraints still holds (npm + uv, error JSON shape, coordinates in unrotated-CropBox points of the page's source, `pageKey` `o{n}`/`u-{uuid}`, `#rrggbb`, client = layout authority, snapshot undo with `coalesce`, Bahasa Indonesia UI strings only in `apps/web/src/lib/strings.ts`, new TextWriter text only through `draw_text_box`). In addition:

- **Commands.** API `cd apps/api && uv run pytest -q` (warning-free). Web `npm test -w apps/web`; types `npx tsc --noEmit -p apps/web`; lint `npm run lint -w apps/web` (0 problems); build `npm run build -w apps/web`; E2E `npm run e2e -w apps/web`. Shell has `NODE_ENV=production`; root `.npmrc` has `include=dev`. After changing `apps/api/edith/ops.py`: `cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops` (never edit `schema.json`/`types.ts` by hand). `next dev` may rewrite `apps/web/tsconfig.json` and create `apps/web/AGENTS.md`: `git checkout apps/web/tsconfig.json && rm -f apps/web/AGENTS.md` before committing. Never commit `.superpowers/`, `references/` (gitignored from this plan's commit on) or `packages/fonts/files/cjk/` (gitignored by Task 5).
- **E2E ports and machine etiquette.** From Task 7 the Playwright config takes `E2E_WEB_PORT` / `E2E_API_PORT` (defaults 3000 / 8000) and *reuses* whatever answers there. On the owner's Mac mini the deployed Edith answers on :3000/:8000 (and other apps on 3001–3005, 3200, 4173, 8443–8446, 443), so always run e.g. `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web` with free ports in 19000–19999, stop only processes you started (by PID; never `pkill -f`), never touch `tailscale serve/funnel`. Before Task 7 exists, don't run the E2E on that machine.
- **CJK pack.** `node packages/fonts/scripts/fetch-cjk.mjs` once per checkout (Task 5; ±113 MB, ≈20 s). API tests never need it (`tests.pdfs.fake_cjk_pack`); web unit tests neither; the E2E of Tasks 15–16 expects it (CI caches it).
- **Commit trailer.** Every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Code in the task files** was written and run in throwaway worktrees and then replayed in plan order on `main` (96e4666): suite counts after each task — API 375 / 384 / 385 / 395 / 419 / 422 (Tasks 1–6), unchanged through Task 13, 425 (Tasks 14–16); web 293 (Tasks 1–7), 306 / 309 / 309 / 314 / 314 / 314 (Tasks 8–13), 319 / 322 / 324 (Tasks 14–16); tsc and eslint clean at every task; E2E 12 passed after Task 13, 13 passed after Task 16 (39 passed with `--repeat-each=3`); `next build` clean. Modified files are unified diffs against the state the previous task leaves; new files and full rewrites are complete; generated files (`schema.json`, `types.ts`, `uv.lock`, `text.json`, `form-ko.pdf`, `package-lock.json`) come from the command the task gives.
- **Shared contracts (change both sides together; both suites pin them):**
  - `PARAGRAPHS_VERSION = 2` — `apps/api/edith/paragraphs.py` ↔ `apps/web/src/lib/api.ts`. Bump both whenever paragraph ids of an unchanged PDF can change. `/text` returns it as `paragraphsVersion`; exports/renders send `paragraphs_version`; drafts store `paragraphsVersion`; a mismatch with `text.edit` ops → 409 `text_outdated` (API) / edits dropped with a notice (web restore).
  - Paragraph JSON gains `maxWidth?` (single-line horizontal paragraphs): room from the paragraph's left edge to the next vertical rule or text on its height or the mirrored left margin, less 2 pt. The web widens left-aligned single lines to it.
  - Fonts: an original font is reused for exactly the characters its (possibly rebuilt) cmap has; glyph advances come from the program (they equal the PDF's `/W`), quantized as in M2 (`floor(adv·1000/upm)`) on both sides. The bake still refuses an original font for a character it lacks — the web never sends one.
  - Fallback chain per character (web): run font → substitute (original fonts) → CJK pack family `(script, design)` → Arimo → Noto Sans, keeping bold/italic; script: Hangul → `kr`, kana → `jp`, Han/CJK punctuation → the document's script (`kr` if it has Hangul ≥ kana, `jp` if kana, else `sc`); design: `serif` for serif families, else `sans`. API substitutes CJK font names the same way (`cjk_style`).

## Spike results (PyMuPDF 2.1 / MuPDF 1.28.6, Chromium) — the design relies on these

- **Reference form, segmentation** (`scripts/paragraph_overlay.py`): before 172 paragraphs on 5 pages, 25 of them with 3+ lines (page 1: 35; g3 = heading + 8 bullets, g6 = two table cells, g15 = 155 pt tall, question + checkbox rows + name fields); after 258 paragraphs, 9 with 3+ lines, all genuine (character-wrapped photo note, centred stacked labels, 2–3-line notes). See `shots/seg-before-p1.png` vs `shots/seg-after-p1.png` (and `-p5`). Of the planned "cell right edge" for hard breaks: a single rule above or below made the "cell" extend past neighbouring columns and split ordinary paragraphs, so the widest line of the group is the measure; bullets, three-space form rows and rules cover what the cell edge was for (deviation 1).
- **`get_cdrawings()`** returns the same coordinates as `get_text` on rotated and cropped pages; the reference's 71 paths per page take ~1 ms. Its title is drawn as vector glyphs: filled polygons are therefore ignored unless they are rectangles.
- **Reference fonts:** all embedded programs (Dotum 242 glyphs, DotumChe 407, Haansoft Batang, Times ×2, Wingdings) are Type0/Identity-H CIDFontType2 subsets with `ToUnicode`, CIDToGIDMap `/Identity`, and no `cmap`, `name`, `OS/2` or `post` table. The rebuilt programs: pymupdf.Font and fontkit read them; Chrome's FontFace accepts them (OTS needs the synthesized `name`/`OS/2`/`post`); hmtx advances equal `/W` (DotumChe: 500/1000). An unchanged edit redrawn with the rebuilt font is pixel-identical (< 1 % pixels differ). Edit before/after: `shots/font-edit-original.png`, `-before.png` (M4: Noto Sans + MuPDF builtin Hangul), `-after.png` (M5: DotumChe for every character it has, Noto Sans KR for "됨").
- **PyMuPDF subsets** (`doc.subset_fonts()`) keep glyph ids (dropped glyphs are emptied) and keep the font's full ToUnicode — the reason `add_cmap` skips empty glyphs and `trim_to_unicode` drops their CMap entries after subsetting. `subset_fonts()` left the reference, form and font fixtures pixel- and text-identical; it shrinks a Korean edit's export from 3.2 MB to ~100 KB. MuPDF truncates span font names at ~24 characters (name matching of very long PostScript names fails; backlog).
- **CJK pack sizes** (Google Fonts static TTFs, old-UA CSS API): Noto Sans KR 6.2 MB, Serif KR 14.1, Sans JP 5.7, Serif JP 8.0, Sans SC 10.5, Serif SC 14.8 (each ×2 with bold) = 113 MB. Traditional Chinese would add ~20 MB (not included; SC covers most Han; TC fonts map to SC).
- **E2E in the merged spike:** a stale `paragraphs_version` check before the web sends the version broke every export with text edits (hence Task 3 accepts, Task 14 enforces). A taller CJK fallback in the first line moved the baseline by 1.2 pt (fixed in Task 16). A table label edited longer wrapped inside its tight width (fixed by Tasks 6/16).
- **UI:** Playwright screenshots before/after in `shots/` (`before-*.png`, `after-*.png`); the old split-button menus rendered inside the toolbar's `overflow-x-auto` and were clipped (opened invisibly) — Task 9 portals them.

## Design system (Tasks 9–13)

Derived with the `hallmark` skill ("dark design app"): neutral grey canvas, dark panels, **one** electric-blue accent, no gradients, no emoji.

| Token | Value | Use |
|---|---|---|
| `--base` / `--panel` / `--raised` | oklch 19 % / 22.5 % / 27 % (hue 260, chroma ≈ 0.006) | start page / top bar, sidebar, properties bar / menus, popovers, dialogs, tooltips |
| `--canvas` | oklch 32 % | the grey area the pages sit on |
| `--line` / `--line-strong` | oklch 31 % / 40 % | hairlines / control borders |
| `--ink` / `--muted` / `--faint` | oklch 95 % / 72 % / 65 % (faint was 57 %, below 4.5:1; raised in Task 13) | text levels |
| `--accent` (+ `-hover`, `-text`, `-ink`) | oklch 57 % 0.22 262; `-hover` oklch 51 % 0.2 262 (darker: white text 5.8:1; was 62 %, 3.7:1, fixed in the final review) | the one accent: primary button (Unduh), selection, focus, active tool |
| `--danger` / `--warn` | oklch 65 % 0.2 22 / 80 % 0.15 75 | errors / warnings |
| `--paper` / `--paper-ink` | white / oklch 20 % | the PDF page and what is drawn on it |

Type: Geist (UI) + Geist Mono (numbers, key caps); sizes `2xs` 11, `xs` 12, `sm` 13, `base` 15 px. Radii 6 (controls) / 8 (menus) / 12 (dialogs); shadows `pop`, `modal`, `page`. Icons: lucide-react, 16 px (`ICON`) / 14 px (`ICON_SM`), stroke 1.75, `aria-hidden`; labels move to `aria-label` + tooltip.

Layout: **one 48 px top bar** (wordmark · file name · tool groups history | select/text/erase | markup/draw/shape | image/signature/symbols | pages/crop · Cari · Ratakan form · **Unduh**) replaces header + wrapping toolbar + empty second row; split buttons keep "last used" + a portalled chevron menu. Tooltips (500 ms hover, instant on focus) show the name and key caps (`⌘ ⇧ Z` / `Ctrl Shift Z`). **Properties bar** floats over the canvas, hidden when empty; with a tool active it starts with **one Indonesian sentence** saying what to do (Pilih has none). Tool keys V H T E M P R O L (no modifier, ignored in text fields). Sidebar with segmented Halaman | Anotasi tabs; notices as raised toasts with an optional action (Coba lagi / Buka di tab baru); Kelola Halaman, stamp picker, signature dialog, find bar and crop bar in the same recipes (`components/ui/styles.ts`); canvas colours that Konva needs as literals in `lib/theme.ts`. The start page is the editor's empty canvas with an A4-shaped drop target. Every `data-testid` and accessible name used by the E2E stays (icon buttons keep their names as `aria-label`).

## Decisions (and why)

- **Segmentation signals, in order:** existing gap/indent rules; a drawn rule between two lines or pieces (never merge across); a bullet glyph starts an item, items continue only on hanging lines; a line with three spaces in a row (form row, columns) stands alone; a dominant style change (size > 8 %, bold, colour) splits; then hard breaks against the group's widest line (CJK: first character; Hangul: first word). CJK char-wrapped lines join without a space. Ids stay positional `gN` (no schema change), versioned instead.
- **Old drafts:** their `text.edit` ops are dropped on restore with a notice (they would replace the wrong paragraph); a stale tab gets 409 `text_outdated` → "muat ulang". Other objects of the draft stay.
- **Font reuse by rebuilt cmap** rather than mapping text to glyph ids ourselves: TextWriter, fontkit and FontFace all need a cmap, and one rebuilt program serves all three, so web and bake stay metric-identical. Only Type0/Identity CIDFontType2 is handled (what Word/Hancom write); other cmap-less kinds stay "not reusable".
- **Symbol fonts** (Wingdings, Symbol, ZapfDingbats, Webdings, Dingbats, Marlett, MT Extra) are never substituted: reused when rebuildable, otherwise the paragraph is not editable.
- **Per-character fallback** splits runs (same size/colour/decoration) so existing characters keep the original font; fallback fonts load only for characters that need them; a bundled font failing to load still rejects (no silent font change), an original that fails counts as having no glyphs.
- **CJK pack:** regular + bold of KR/JP/SC, Sans + Serif; not committed, fetched by script/Docker/CI; manifest section `cjk` separate from `families` (not in the font picker: fallback only); the web manifest lists only fetched files, so without the pack nothing breaks and the unsupported warning stays.
- **Subsetting at export** only when the bake embedded fonts (TextWriter embeds whole files); MuPDF's subsetter applies to all embedded fonts of that export (checked identical on the fixtures and the reference).
- **Labels may grow** into their room (`maxWidth`) because cell-level paragraphs are as tight as their text; multi-line paragraphs keep their measure (M2).
- **Catatan/Link hidden, not deleted:** schema, bake, API tests, the web model, rendering, export and Anotasi labels stay; restored notes/links can be selected, moved, deleted, but have no properties UI.
- **Download hardening** without changing the endpoint: a message per failure class, retry for transient ones, `%PDF-` signature check, new-tab fallback when the download is blocked, 120 s timeout.
- **Task order** API (1–6) → UI (7–13) → web text (14–16): the UI tasks only touch the web, the text tasks touch `lib/` and three components; the API's version enforcement waits for the web sending the version (Task 14).

## Deviations from the brief (intentional)

1. Hard breaks are measured against the group's widest line, not the cell's right edge (see Spike results); bullets, form rows and rules take over the cell cases.
2. Segmentation changes ids, so ids are versioned (`PARAGRAPHS_VERSION`, 409 `text_outdated`, drafts stamped) — the brief only asked to drop unknown ids; shifted ids were the real risk.
3. Added `maxWidth` (labels grow into their cell) and first-baseline anchoring of edits — both found by the merged spike's E2E.
4. The CJK pack is 113 MB, not ~6 MB per file (Serif SC/KR are 14–15 MB each); bold included. Traditional Chinese not included (fonts named MingLiU/JhengHei map to SC).
5. CJK line breaking between characters (kinsoku) is not added: the editor's existing "split a too-long word by character" path wraps Japanese/Chinese edits; Korean wraps at spaces (backlog).
6. The tool hint line lives at the start of the floating properties bar (not a separate row under the toolbar), so there is still no empty second row.
7. Font subsetting (an M2 backlog item) is done now, for every export that embeds fonts.

## Deliberate exclusions (go to BACKLOG.md)

See `BACKLOG.md`.

## Tasks

| # | File | Deliverable |
|---|---|---|
| 1 | task-01-api-rules.md | `edith/rules.py`: page rules from vector drawings, range queries |
| 2 | task-02-api-segmentation.md | Rule/hard-break/bullet/form-row/style-aware segmentation, CJK-aware; overlay script |
| 3 | task-03-api-paragraphs-version.md | `PARAGRAPHS_VERSION` in /text, `paragraphs_version` on export/render requests (accepted) |
| 4 | task-04-api-cid-font-reuse.md | Rebuild cmaps of cmap-less CID subsets (fontTools runtime dep); lock non-reusable symbol-font paragraphs |
| 5 | task-05-cjk-pack.md | Optional CJK pack (fetch script, manifest, gitignore, Docker, CI, README), CJK substitutes, export font subsetting |
| 6 | task-06-api-room-and-form-fixture.md | `maxWidth` for single-line paragraphs; Korean form E2E fixture |
| 7 | task-07-web-e2e-ports-hide-notes-links.md | E2E ports from env; Catatan + Link tools out of the UI |
| 8 | task-08-web-download.md | Download errors per failure class, retry, new-tab fallback, E2E |
| 9 | task-09-ui-tokens-shell.md | Design tokens, Geist, lucide icons, one top bar with tooltips, floating properties bar |
| 10 | task-10-ui-panels.md | Sidebar, menus, dialogs, notices, find/crop bars, stamp/signature, canvas colours |
| 11 | task-11-ui-hints-keys.md | One-line tool hint, one-letter tool keys, key caps, colour popover |
| 12 | task-12-ui-landing.md | Start page as an empty canvas with a page-shaped drop target |
| 13 | task-13-ui-visual-qa.md | Screenshot script, visual QA fixes |
| 14 | task-14-versioned-text-edits.md | Web sends/stamps the version, API refuses others (409), stale draft edits dropped with notice |
| 15 | task-15-web-char-fallback.md | Per-character fallback with the CJK pack, script/design aware, lazy |
| 16 | task-16-web-room-e2e-docs.md | Labels grow into `maxWidth`, first baseline kept, Korean form E2E (edit + download), README |

Tasks 1–6 (API) build on each other in order. Tasks 7–13 need only `main` (they never touch `apps/api`) and build on each other; Task 13's screenshot pass and Task 12's E2E expect Tasks 9–11. Task 14 needs 3 and 8 (`exportPdf` with timeout); 15 needs 5 and 14; 16 needs 6, 14, 15 and the UI (button/test names).

## Self-review (brief coverage)

- A(1) hard-break rule (incl. CJK first character / Hangul word) → 2; A(2) drawings, never merge across vertical rules or cell boundaries, 2-em join limited → 1, 2; A(3) style split → 2; A(4) fixtures (table + bullets + checkbox rows, CJK lines) → 2, 6; reference measured + overlay PNGs → 2 (script) and `shots/seg-*`; M2 guarantees (original lines, quantized widths, one undo step, ids per page) kept — ids versioned, old `text.edit` dropped with notice → 3, 14.
- B(1) cmap reconstruction, served to the browser and used by the bake, ToUnicode rewrite still applied, per-character coverage → 4 (+ `trim_to_unicode` in 5); B(2) per-character fallback → 15; B(3) CJK pack (fetch script, gitignore, README, Docker, CI with cache, absent-pack graceful, lazy web loading, gothic/serif by name, script by characters, Han → document script) → 5, 15; B(4) unsupported warning → 15 (unit + E2E); B(5) Wingdings/Symbol → 4. Fixtures with cmap-less CID subsets → 4 (`make_cid_subset_pdf`), 6 (`make_korean_form_pdf`); reference before/after render → `shots/font-edit-*`.
- C Catatan + Link removed from the UI, data kept, annots.spec adapted (PDF assertions kept), API tests untouched → 7.
- D download hardening (network, 4xx/5xx with code, blocked download, retry, new-tab fallback) → 8; E2E downloading after editing the Korean form-like fixture → 16.
- E redesign: tokens + icons + shell/toolbar → 9; sidebar/pages/modals/popovers/notices/properties bar → 10; tool hint line + keyboard/tooltips → 11; landing → 12; visual QA with screenshots → 13 (+ `shots/`).
- F E2E + docs + README + deployment notes (CJK download in README/Docker/CI) → 5, 16.

## Open questions for the owner

1. CJK pack size: 113 MB on disk (and in both Docker images); the browser downloads a 6–15 MB file the first time a document needs it. Keep bold (halves to 57 MB if dropped)? Keep the Serif designs (Serif KR/SC are the largest)?
2. Traditional Chinese (Noto Sans/Serif TC, +20 MB): add, or keep mapping Traditional fonts to SC?
3. Old drafts: text edits made before this update are dropped with a notice when the PDF is reopened (other edits stay). Acceptable, or should we keep the old segmentation around for old drafts?
4. Single-line labels now grow to the next cell border when edited longer; text that still doesn't fit wraps (and shows the overflow warning). Should longer edits of a label shrink the font instead?
5. The tool hint replaces a dedicated second toolbar row; is one sentence at the start of the floating bar enough, or do you want a first-run tour?
6. After the redeploy, please retest "Unduh" on the same browser; any failure now shows a message (screenshot it).

## Results

Spike (plan order replayed on `main`): API 425, web 324, E2E 13 tests (39 runs with `--repeat-each=3`, all passed; one earlier run of the unchanged M4 `pages.spec` flaked once under parallel load and passed on rerun); tsc, eslint and `next build` clean.
