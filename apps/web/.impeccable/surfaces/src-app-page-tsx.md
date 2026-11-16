---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/tools"]
---

# Start page (/) and tool pages (/tools/*)

Mode: Persuade (start page), Operate (tool pages). Audience: first-time public visitors and returning tailnet users. Action: drop or pick a PDF; or open a PDF tool. Proof: the product itself (free, no signup, deleted after 1 hour). Constraints: Indonesian sentences with English technical terms (Tools, Upload, Download, Select, Markup …); no promotional copy, only what the user can do (owner: the users are the owner and family); keep every function, keyboard and e2e test ids.

## Direction contract

THESIS: Edith is a dark workbench. The PDF is a white sheet laid on a gridded cutting surface, with real tools and pencil marks around it. Refuses the category's centred headline over a blue upload box and a grid of identical tool cards.

OWN-WORLD: graphite grey ground (no hue), faint square grid in regions only, one accent: snap-off cutter yellow. White paper only for documents. Archivo (width axis) for type, Geist Mono for numbers. Custom drawn icons in one stroke system with the cut-corner sheet motif. Decorations: drawn cutter, pencil, steel ruler, binder clip, pencil scribbles (circles, arrows, ticks) in chalk white and yellow.

STORY: visitor sees a sheet waiting on the bench, understands "drop the PDF on it", trusts "gratis, tanpa daftar, dihapus 1 jam", picks a tool from the tray when they need one thing.

FIRST VIEWPORT: left: logo (simple-shape mascot tile), the headline "Edit PDF", a two-column list of what the editor does with a pencil ring around the first item, one line on the 1-hour server deletion. Right: A4 sheet on the grid with a binder clip, a cutter lying across its corner, a pencil arrow pointing at "Pilih PDF" (yellow). Below the fold starts the tool tray: tools grouped on a ruler-edged shelf.

FORM: owner-pinned direction (workbench / cutting grid, dark grey, restrained palette), replacing roll seed:155537e990ceba31. Signature interaction: on drop the cutter blade sweeps the sheet's dashed cut line and the sheet lifts away into the editor; scribbles draw themselves once on load.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Decisions recorded

- Workbench sketches (`.impeccable/mocks/workbench/`): direction approved by the owner with overrides: dark neutral grey instead of green-black, the cutting grid only as a faint square pattern (no rulers or mm labels), drawn tools and pencil scribbles as decoration, own icons, motion, less text.
- Logo: the cut-sheet mark was replaced at the owner's request by an original mascot (girl in a graduation cap, `mocks/mascot/m2.svg`), then simplified to plain shapes on a yellow tile (`mocks/mascot/s2.svg`, shipped as `src/app/icon.svg` and `components/brand/Logo.tsx`).
- Signature interaction as built: on upload the scissors run once round the sheet's cut line while the line is drawn in yellow and the sheet lifts; then the editor opens.
