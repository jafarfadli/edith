# M1 backlog (deferred review items)

Collected from per-task and final reviews of the M1 plan. Promoted items were fixed before merge (commits c273f05..af1b323); everything below is deferred to M2+.

- Task 1: minor (deferred): create-next-app boilerplate (lang=en, title, public svgs) — replaced in Task 13; package name "web".
- Task 2: note: pyproject filterwarnings for pymupdf SWIG DeprecationWarnings (scoped regex).
- Task 2: minor (deferred): LICENSES.md lacks full Apache text; fetch.mjs no error handling; sync-fonts doesn't purge stale; fonts tests thin (no all-styles exists check); commit trailer said Haiku.
- Task 3: minor (deferred): ops index export * leaks generated field aliases (Id, Type, Text, Width1...) — prefer explicit export list; unused Path import in test_ops.py; ShapeAdd doesn't reject stray rect/points.
- Task 4: minor (deferred): generic 500 handler response lacks CORS headers (browser sees network error); get_file tiny vanish window → 500; uploads spooled before size check; no endpoint-level 410 TTL test.
- Task 5: minor (deferred): no nosniff/cache headers on asset GET; get_asset vanish race → 500; `pytest -W error` segfaults on pymupdf import (pre-existing).
- Task 6: minor (deferred): no tests for no-handler BakeFailed, close-on-failure, 3x duplicates; stray blank line bake/__init__.py:53.
- Task 7: minor (deferred): arrow test weak (head geometry unasserted); draw_oval/empty rect could fail export if w/h=0 (schema allows w=0); untyped ctx in handlers; head miter join tip ~1pt.
- Task 8: minor (deferred): writers keyed by raw color case; draw order grouped by color; no multi-segment x>0 test.
- Task 9: minor (deferred): no test for non-ASCII filename header; 410 test only on /export; meta read in render_page even with layout; tobytes/pixmap errors not mapped to bake_failed. (multi-layout concern moot: schema allows ≤1.)
- Task 10: minor (deferred): normRotation(NaN)/off-grid silently cast.
- Task 11: minor (deferred): fontkit heavy for browser bundle; transpilePackages untested until a page imports; newline/tab chars measured as glyphs if present in runs.
- Task 12: minor (deferred): no history coalescing (drag must commit on release); insertBlank uses unrotated neighbor size; saveDraft silent on quota; crypto.randomUUID needs secure context.
- Task 13: minor (deferred): layout metadata strings hardcoded not from strings.ts; no UploadDropzone component test; API_URL fallback untested; next/font/google needs network at build.
- Task 14: note: pdfjs-dist ^6.5 (not ^5); destroy via doc.loadingTask.destroy(); render({canvas, viewport}) works.
- Task 14: minor (deferred): in-flight load at cancel destroyed only after resolve; pan lacks pointer capture; zoom loses scroll anchor; notices never auto-dismiss; canvas blank flicker on zoom; render effect depends on entry.src identity.
- Task 15: minor (deferred, USER-VISIBLE — triage at final review): PageMenu outside-click listener bubble-phase → two menus can stay open; w-44 menu right-anchored likely clipped by sidebar overflow (may affect E2E clicks); menu padding clicks bubble to thumb; nested button a11y (dnd attributes on wrapper); eager thumbnail renders; setTimeout scroll after insert.
- Task 16: minor (deferred, triage at final): release outside Stage discards draft (needs window pointerup); ink last point dropped on flick; Konva arrow head stroked with shaft width → head bigger than bake (bake head stroke 0.5); dot/zero-extent bounds resize shift; transformer flipEnabled; crossOrigin img w/o onerror; no touch-action:none. (Transformer-in-draw-mode moot: setTool clears selection.)
- Task 17: minor (deferred, triage at final): Notice (fixed top-16) overlaps toolbar & intercepts clicks until dismissed; split menu lacks Escape/arrow keys; slider drags + nudge = one history entry per change; Ctrl+Z ignored when range/color input focused; "Pilih" substring matches "... pilihan" (E2E must use exact).
- Task 18: note: WYSIWYG measured — glyph origins within 3e-5 pt of layout; Konva vs PDF raster ink bounds within 1px. installTextTool runs in ssr:false loader.
- Task 18: minor (deferred): commit race when fonts not loaded + new click; no commitEditing unit tests; size input 1 history entry/keystroke; multi-run flattened on edit; font failures console-only; textarea wrap differs during typing.
- Task 19: minor (deferred): web Dockerfile copies full tree & runs root; uv:latest unpinned; CI never run; Header/Toolbar await wiring untested; rejected commit → unhandled rejection on queued undo; pdfjs standardFontDataUrl warning in e2e.
- Task 19: note: `npx eslint src` in apps/web has 1 error — useImageAsset.ts:12 react-hooks/set-state-in-effect (from Task 16). CI does not run lint.
