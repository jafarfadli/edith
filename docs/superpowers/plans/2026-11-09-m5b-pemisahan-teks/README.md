# M5b — Text separation and edit fidelity

Owner feedback after M5: "text separation still needs strengthening: many misses and some not quite right; when edited the text position changes". Five new reference documents were added to `references/` (untracked: they hold personal data). Two audits, both reproducible with `harness/run.sh`:

- `AUDIT.md` — segmentation correctness, root causes RC1–RC5 per reference page.
- `AUDIT-EDIT-FIDELITY.md` — identity-edit harness: 49 % of the 688 editable paragraphs move more than 2 pt on any edit; all error is horizontal. Root causes: character/word spacing ignored, leading spaces and tabs dropped, wrong alignment guess, merged cells, every line redrawn.

Screenshots (`shots/`) are git-ignored because they show personal data.

## Plan (order matters: shared files `paragraphs.py`, `lib/paragraphs.ts`, `bake/text.py`)

| Track | Task | Source |
|---|---|---|
| S (API only) | S1 Row/cell merge fixes: overlap rule, raw-line split at column borders, border merge, dot-leader rows | AUDIT RC4 |
| S | S2 Numbered list markers + hanging indents, tabs kept as gaps | AUDIT RC5, FIDELITY 4/6 |
| S | S3 Ink rects, leading spaces as indent, alignment detection (2-line justified, centred first line, single lines), duplicate font names | FIDELITY 3/5/6/7/8/12 |
| F | F1 P0: keep original glyphs of unchanged lines (`LayoutLine.source`), redraw only changed lines | FIDELITY P0 |
| F (after S, F1) | F2 P1: hScale / charSpacing / wordSpacing on runs; clamp single-line widths; wrap slack | FIDELITY P1/P3 |
| — | Final: re-run the harness, whole-branch review, PR, merge, redeploy (pm2: `edith-api` first, then `edith-web`) | |

S and F1 run in parallel worktrees; F2 starts after both merge.

## Constraints

Same machine etiquette as M5: servers/E2E only on ports 19000–19999, never touch 3000/8000/844x/443, no `pkill -f`, never `next build` in the main checkout (pm2 serves from it), `PARAGRAPHS_VERSION` bumps to 3 when ids can change (S1–S3), nothing from `references/` or `shots/` committed.
