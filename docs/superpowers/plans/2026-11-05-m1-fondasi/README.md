# Edith M1 — Fondasi Editor PDF: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task lives in its own file in this folder; read README.md (this file) + your task file only.

**Goal:** A working web PDF editor: upload a PDF, reorder/rotate/delete pages and insert blank pages, add text boxes (single style), shapes (rect/ellipse/line/arrow), freehand ink, images, whiteout and true redaction, then download the baked PDF.

**Architecture:** npm-workspaces monorepo. `apps/api` (FastAPI + PyMuPDF) stores uploads for 1 hour and bakes a JSON list of ops into the PDF on export. `apps/web` (Next.js) renders pages with pdf.js, keeps edits as client state with snapshot undo/redo, lays out text itself with fontkit metrics, and sends compacted ops on export. Pydantic models in `apps/api/edith/ops.py` are the single source of truth for the ops schema; `packages/ops` holds the exported JSON Schema and generated TS types. `packages/fonts` holds TTF files shared by both apps so on-screen text matches the baked PDF.

**Tech Stack:** Python 3.12, uv, FastAPI, PyMuPDF (`import pymupdf`, v1.26+/2.x), pydantic v2, pydantic-settings, pytest, httpx · Node 22+, npm workspaces, Next.js 16 (App Router, TS, Tailwind v4), pdfjs-dist 5+, react-konva/konva, zustand, fontkit 2, @dnd-kit, Vitest, Playwright · json-schema-to-typescript.

Spec: `docs/superpowers/specs/2026-11-05-pdf-editor-design.md` (sections relevant to M1: Arsitektur, Font, Teks/Model rich text, Skema Ops, Backend/Urutan bake, Penanganan Error, Testing).

## Global Constraints

- Repo root: `/Users/jafarfadli/Koding/edith`. Package manager: **npm** (no pnpm). Python via **uv** (`requires-python = ">=3.12"`).
- Upload limit 50 MB **or** 500 pages → `413 too_large`. Asset limit 10 MB (PNG/JPEG only). Export max 5000 ops.
- Doc TTL 1 hour since last access. `doc_id` = `secrets.token_urlsafe(16)` (22 chars, `^[A-Za-z0-9_-]{22}$`).
- Error JSON shape everywhere: `{"error": {"code": "<code>", "message": "<text>", ...extra}}`. Codes: `pdf_corrupt` 400, `pdf_encrypted` 400, `too_large` 413, `unsupported_media` 415, `doc_not_found` 404, `asset_not_found` 404, `doc_expired` 410, `invalid_op` 422 (+`op_index`), `bake_failed` 500 (+`op_id`).
- Coordinates: PDF points, origin top-left of the source page's **CropBox, unrotated** (PyMuPDF convention). Rotation from `pages.layout` is applied last in bake.
- Page identity: `pageKey` = `o{n}` (original page n of main doc) or `u{uuid}` (client-created). Regex `^(o\d+|u[0-9A-Za-z-]+)$`.
- Colors: `#rrggbb` hex strings.
- Text layout is done by the client; kerning and ligatures are **off** everywhere (PyMuPDF TextWriter does not kern; client measures with fontkit `glyphsForString` advance widths and draws glyph-by-glyph).
- PyMuPDF facts verified by spike: `doc.select([...])` with repeated indices makes pages **share one page object** (drawing on one shows on both) → duplicates must use `doc.fullcopy_page(i)`. Drawing/insert methods and `get_text` use unrotated coordinates. Coordinates are relative to CropBox top-left. Redaction constants: `PDF_REDACT_IMAGE_PIXELS`, `PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED`, `PDF_REDACT_TEXT_REMOVE`.
- All UI text in Bahasa Indonesia, collected in `apps/web/src/lib/strings.ts`. No pdfguru name/logo/assets anywhere.
- API base URL in web: `process.env.NEXT_PUBLIC_API_URL` (default `http://localhost:8000`). API CORS allows `http://localhost:3000`.
- Commit after every task with conventional messages ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviations from spec (intentional, M1)

- Next.js 16 instead of 15 (current stable).
- Pydantic models are the schema source; `packages/ops/schema.json` is generated from them (spec said JSON Schema first). Same single-source guarantee, enforced by a freshness test.
- Client undo/redo uses immutable state snapshots instead of `object.update`/`object.delete` ops; compaction just serializes current state. Output ops are identical to spec.
- Cleanup runs as an asyncio background task (no APScheduler dependency).
- M1 schema contains only M1 ops; later milestones extend it.

## Tasks

| # | File | Deliverable |
|---|---|---|
| 1 | task-01-scaffold.md | Monorepo, API skeleton with `/health`, Next app, Vitest, pytest running |
| 2 | task-02-fonts.md | `packages/fonts` (Arimo/Tinos/Cousine TTF + manifest), API `FontRegistry`, web font sync |
| 3 | task-03-ops-schema.md | Pydantic ops models, `packages/ops` schema.json + TS types + examples, freshness tests |
| 4 | task-04-storage-documents.md | Storage with TTL/tombstones, errors, `POST /documents`, `GET structure`, `GET file`, cleanup task |
| 5 | task-05-assets.md | `POST /documents/{id}/assets` |
| 6 | task-06-bake-pages.md | `bake()` pipeline + `pages.layout` (reorder, duplicate-safe, blank, rotate) |
| 7 | task-07-bake-draw.md | whiteout, shape, ink, image, redact handlers |
| 8 | task-08-bake-text.md | `text.add` handler (TextWriter from client layout) |
| 9 | task-09-export-render.md | `POST export`, `POST render-page` endpoints |
| 10 | task-10-web-coords.md | `coords.ts` page ↔ screen transform |
| 11 | task-11-web-fonts-layout.md | `fonts.ts` loader/metrics, `layout.ts` text layout |
| 12 | task-12-web-store.md | zustand editor store, history, autosave, `compact.ts` |
| 13 | task-13-web-upload.md | API client + upload page |
| 14 | task-14-web-viewer.md | Editor shell: pdf.js pages, zoom pill, header, download |
| 15 | task-15-web-sidebar.md | Thumbnails sidebar with page operations |
| 16 | task-16-web-objects.md | Object geometry + Konva overlay: render, select, move, resize, drag-to-draw |
| 17 | task-17-web-tools.md | Toolbar, properties bar, image tool, arrow-key nudge |
| 18 | task-18-web-text.md | Text tool (single style) with client layout + text properties |
| 19 | task-19-e2e-docker.md | Playwright E2E, Docker, CI, README |

Tasks 1–9 (API) and 10–12 (web libs) only depend on earlier tasks in their own track plus tasks 1–3. Tasks 13–18 depend on 9–12. Task 19 needs everything.
