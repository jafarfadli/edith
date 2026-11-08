# M4 backlog

Items deliberately left out of M4 (from README.md, Deliberate exclusions):

- A re-upload flow for an expired import (its pages are dropped with a notice instead).
- Caching `/text`, `/chars` and font files per document (each imported PDF adds one `/text` request per editor load).
- Thumbnails re-rendered after edits (still the source page only); live thumbnails in the modal.
- Multi-object selection, group align/distribute, align to other objects.
- Rotation of whiteout/redaction/links/notes; a numeric rotation input.
- System clipboard interop (pasting images/text from other apps) — owner decision 5.
- Crop by drag on the page without the Crop button.
- M2 "should fix soon" items (font subsetting, caching `/text`, same-name fonts) — untouched by M4 code.
- Import-specific 410 message on export (name the expired import instead of the generic message).
- Insert only the used page spans of an import (today the whole imported PDF is inserted, then unused pages dropped).
- `OriginalFont.doc` pointing at an expired import: pre-check and answer 410 up front.
- pdfStore: retry / notice for imports whose PDF failed to load (errored state is sticky).
- Regression test for a combined export (layout + imports + forms + text edits together).
- Ctrl+C steals the browser copy when text is selected on the page.
- Switch `pages.spec` back to canvas clicks now that the Konva hit graph refreshes synchronously (9eb2eda).
