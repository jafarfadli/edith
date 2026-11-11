# Figma-style interaction model

Owner request: an editor feel like Figma — marquee multi-select, arrow-key nudge, smart guides (centre, edge, spacing) while moving, and "whatever else makes sense".

## Decisions

- **Selection model.** The store keeps `selected: string[]` (ordered; all on one page) next to the old `selection` (the *primary*: always the last of `selected`, or null). Everything that reads `selection` (properties bar, text props, mini-bar anchor, context menu) keeps working; group actions read `selected`. Shift+click on an object of another page starts a new selection (no cross-page selection).
- **Marquee** starts on the empty page *and* on original-text targets that are not draggable (paragraph frames, locked text, OCR paragraphs): on a text page nearly everything is a paragraph. Selects what it *touches* (partial intersection, Figma's rule), except an object that fully encloses the marquee (a big rectangle/scan under it). Shift adds. Live while dragging; Escape restores. Only objects of the page it starts on.
- **Original (unedited) text paragraphs are not part of a multi-selection** (moving one means materialising a `text.edit` op with async font loading, one per paragraph: it cannot be one undo step without a larger rewrite). They are snap *targets*, and a press/click on one still selects it alone. Form fields are not selectable objects either (they are values, not ops).
- **One undo step per group action.** `putObjects(ops, remove, { coalesce, within })` is the only multi-object commit; group move/nudge/delete/align/distribute/paste go through it. `commit` gets a per-call coalesce window so a nudge uses 400 ms (the default stays 1000 ms); consecutive arrow presses within it are one step, a held key repeats inside it. Keyup does not end the step (a quick second tap still merges); 400 ms of idle, another action, undo or a new selection does.
- **Snapping geometry is pure** (`lib/snap.ts`, no DOM, page points). Guides are derived from the *final* box (what is exactly aligned/equally spaced now), snapping only decides the delta. Threshold 5 screen px / zoom. Moving box = bounding box of the selection. Targets = other objects of the page (not markup/links), original paragraph frames, page edges/centre. Cmd/Ctrl while dragging turns snapping off. Resize snaps single, un-rotated objects through the Transformer's `boundBoxFunc` (moved edges only).
- **Rendering.** A `snapStore` (zustand) holds the guides/badge of the page being dragged; a small `SnapGuides` Konva layer subscribes to it, so a drag does not re-render the page's objects. Colour: Figma's red-pink, thin.
- **Align / distribute** are ops through `putObjects` in screen space (page rotation/crop aware, as `alignSelection` already was): one object aligns to the page, two or more to their bounding box; distribute needs three. Keys: Alt+A/H/D (left/centre/right), Alt+W/V/S (top/middle/bottom), Alt+Shift+H/V distribute (by `e.code`: Option changes the typed character on a Mac).
- **Alt+drag** copies: the original is dragged, and on release a copy lands at the drop point (one undo step). Alt+click keeps cycling to the object beneath (on a selected object it waits for the release, so a drag copies instead).
- **Cheap extras:** Cmd/Ctrl+A, Cmd/Ctrl+X, Cmd/Ctrl+D on groups; Tab / Shift+Tab cycles (reading order) only while an object is selected and focus is not on a control; Space+drag and middle-mouse pan; move cursor over objects.

## Limits (known, on purpose)

- Original (unedited) text paragraphs, and form fields, cannot join a multi-selection (see Decisions). A press on one still selects it alone, and a drag from original text is a marquee.
- Resize snapping works for one upright object on an upright page; a turned object (or a page turned 90/180/270°) resizes without guides. Moving snaps on any page rotation. Group resize has no guides.
- Equal-spacing guides need the objects to share a row or column (overlap on the cross axis) and look at the nearest neighbours' gaps and the other gaps of that row.
- Undo does not bring the selection back (as before for one object).

## Tasks (TDD, one commit each)

1. Store: `selected`, `selectMany`, `toggleSelected`, pruning; `putObjects` opts, per-call coalesce window.
2. `lib/snap.ts`: stops, alignment guides, spacing guides, `snapMove`, `snapResize`, measure.
3. `lib/arrange.ts`: marquee hit-test, group bounds, align/distribute, Tab order.
4. Group actions: move/nudge/delete/duplicate/copy/cut/paste/z-order over `selected`.
5. Shortcuts: Cmd+A, Escape, nudge, Tab, Cmd+X, align keys.
6. PageOverlay: marquee, Shift+click, group drag, guides + badge, Cmd to disable.
7. Resize snapping (single object).
8. Align/distribute UI (properties bar for a group, mini-bar for the group).
9. Alt+drag copy, Space/middle-mouse pan, cursors, Alt-hover distances.
10. Stretch: group bounding box with resize handles.
11. e2e: `e2e/figma-ux.spec.ts`.
