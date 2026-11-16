# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Today: the owner and people on the owner's tailnet, editing everyday Indonesian documents (letters, official memos such as Nota Dinas, forms, scanned pages, slide decks exported to PDF).

Planned: the general public, as a free alternative to pdfguru.com and iLovePDF. Because of that, the start page must also explain the product to a first-time visitor, not only serve as an upload box.

Users work on desktop, and must also be able to work comfortably on a phone or tablet (confirmed requirement; the editor is currently desktop-first).

## Product Purpose

Edith edits a PDF in the browser and returns a PDF that looks exactly like the original except for the changes. Beside the editor it offers single-purpose PDF tools (merge, split, extract pages, compress, PDF to images, images to PDF, PDF to text, unlock, lock, watermark, page numbers, searchable PDF via OCR, Office to PDF, PDF to Word).

Success: a user changes a word in a letter or form and the result is indistinguishable from the original document, without paying, signing up, or sending the file to a third party.

## Positioning

Confirmed by the owner as what sets Edith apart:

1. **Edits the original text faithfully.** Original fonts (including CJK subsets) are reused, paragraphs follow table cells, list items and form rows, text inside images is read by OCR and hidden text layers are measured, so an edit blends into the page.
2. **Private, on its own server.** Files are processed on Edith's own server, never sent to third-party services, and deleted after 1 hour.
3. **Free and unlimited.** No subscription, no watermark, no quota.

These should be visible in the product: stated plainly where a first-time visitor decides to trust it (start page, upload), and proven by the editor's behaviour rather than claimed in marketing language.

## Operating Context

- Upload a PDF (locked PDFs ask for their password), edit in the editor, download (as PDF, as images, compressed, password-locked, or only some pages).
- Drafts are kept in the browser; recent edits are listed on the start page.
- Each tool has its own page at `/tools/{slug}`; the start page lists them.
- Deployed on the owner's Mac mini, reachable over Tailscale; a public deployment is planned but not set up.

## Capabilities and Constraints

- The editor's full feature set and every keyboard shortcut must be kept (layout and grouping may change). See the README for the inventory: original-text editing with rich text and Find & Replace, text, shapes, images, freehand, whiteout, redaction, highlight/underline/strike, signatures, 34 stamps, check/cross, form filling, page management, crop, layer order, OCR.
- UI language today is Indonesian only (`src/lib/strings.ts`). Whether other languages will be added is undecided.
- The PDF page itself is always shown as white paper; the editor draws on it.
- Limits that the UI must communicate honestly: 1-hour storage, page limits per tool (for example 60 pages for OCR, 100 for PDF to Word), password handling.

## Brand Commitments

- The name **Edith** stays. A logo is to be designed from it; none exists yet (only the default `favicon.ico`).
- Voice: plain, friendly Indonesian that explains what happened and what to do next, without jargon.

## Evidence on Hand

- Real reference PDFs used in testing live in `references/` at the repository root (owner documents; do not publish them).
- No testimonials, user counts, press, or benchmarks exist. Do not invent any.

## Product Principles

1. The document is the hero: the result must match the original, and the interface stays out of its way.
2. Say what happens to the file: where it goes, how long it stays, what the output will be.
3. Every feature is reachable without knowing the shortcut, and every shortcut keeps working.
4. Free means free: no upsell, no fake limits, no dark patterns.
5. Works where the user is: desktop first-class, phone and tablet usable.

## Accessibility & Inclusion

No external standard was set. Current code targets WCAG AA contrast (noted in `src/app/globals.css`) and full keyboard operation of the editor; keep both.
