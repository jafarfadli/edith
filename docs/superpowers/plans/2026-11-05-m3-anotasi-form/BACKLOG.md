# M3 backlog (deferred review items)

From per-task and final reviews of M3. Final verdict: ready to merge after the fix wave (URI injection, redaction leaks, XFA, links kept across text.edit, markup removed with edited/moved paragraphs, signature data URL check).

## Owner decisions applied in M3
- Markup on a paragraph that is later edited, replaced or moved is deleted in the same undo step, with a notice.

## Should fix soon (from final review)
- Missing bake tests: link to a duplicated pageKey; text.edit + annot.add on same lines; markup content.
- Prune form.set for fields on deleted pages in compact.
- /pages/{i}/chars reopens the PDF per call; add caching/size cap.
- Re-opened links display percent-encoded URLs.
- pytest -W error crashes on pymupdf import (environment).

## Per-task deferred
- Task 1: note: 34 stamp ids (final-id for Indonesian Final); README updated with parity requirement for Tasks 2/10.
- Task 1: minor (deferred): generated types export Date/Point names (shadowing); stamp exactly-one rule only in Python.
- Task 2: note: shared table packages/ops/stamp-presets.json; README updated for Tasks 7/10/14.
- Task 2: minor (deferred): no trailing newlines in stamps.py/symbols.py/test; STAMP_COLORS name clash with Task 7 palette; API requires packages/ at runtime.
- Task 3: minor (deferred): stale comment on handler import line; markup content untested.
- Task 4: minor (deferred): checkbox without /AP omitted from structure; form.set by name ambiguous when text+checkbox share name; unknown field name silently ignored (plan); radio/list/combo invalid values accepted silently; /XFA kept.
- Task 5: minor (deferred): no tests for negative index, blank-line drop, nbsp/tab mapping.
- Task 6: note: web preset table apps/web/src/lib/stamps.ts imports @edith/ops/stamp-presets.json (STAMPS_EN/STAMPS_ID); Task 10 must reuse it.
- Task 6: minor (deferred): opBounds on empty/missing quads → Infinity/throw (pass to Task 7 to guard); restoreDraft always forms:{}; setFormValue records original values; 17 split hard-coded.
- Task 7: minor (deferred): highlight plain rect vs MuPDF rounded ends; markup layer above transformer; stampRect not clamped to page width (Task 10 should clamp); note selection gap via transformer padding.
- Task 8: minor (deferred): overlapping bands on tight leading pick upper line; no noText hint on blank pages; recompute per pointermove; textTarget rotated-page test gap.
- Task 9: fix round 1/5 (Enter scoping, strict URL, popover reset, Ctrl+K mods; 5c70fb6) — note focus still failing in browser
- Task 9: fix round 2/5 (note focus deferred past mousedown, browser-verified by implementer; df98044; small diff inspected)
- Task 9: minor (deferred): popover no focus trap/flip; properties-bar link mode switch can desync; note add + first typing burst = 2 undo steps.
- Task 10: minor (deferred): stamp swatches don't highlight preset colours; tablist without tabpanel/arrow keys; unchecked preset cast; font-load failure console only.
- Task 11: minor (deferred): silent no-op on empty name/pad/file; tooBig notice also on storage blocked; save before upload; Escape while busy still places; valid() accepts any data:image; no aria-modal/focus trap; typed missing glyphs fallback.
- Task 12: minor (deferred, final triage): Ctrl+Z inside focused form field = native input undo (can desync controlled input); list box clipped; opaque checkbox/radio boxes cover objects; checkbox with null onState exports true.
- Task 13: minor (deferred): overflow status hidden while session open (plan).
- Task 14: minor (deferred): flattened export doesn't re-check signatures/stamps/checkbox; no position checks for signatures/stamps; labels duplicated from JSON.
