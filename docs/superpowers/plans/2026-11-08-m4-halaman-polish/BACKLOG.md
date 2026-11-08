# M4 backlog

Items deliberately left out of M4 (from README.md, Deliberate exclusions):

- A re-upload flow for an expired import (its pages are dropped with a notice instead).
- Caching `/text`, `/chars` and font files per document (each imported PDF adds one `/text` request per editor load).
- Thumbnails re-rendered after edits (still the source page only); live thumbnails in the modal.
- Multi-object selection, group align/distribute, align to other objects.
- Rotation of whiteout/redaction/links/notes; a numeric rotation input.
- System clipboard interop (pasting images/text from other apps) — owner decision 5.
- Crop by drag on the page without the Crop button.
- Konva hit canvas occasionally stale right after a tool click (seen in E2E: selection by canvas click right after placing a symbol); E2E selects via the Anotasi panel.
- M2 "should fix soon" items (font subsetting, caching `/text`, same-name fonts) — untouched by M4 code.
