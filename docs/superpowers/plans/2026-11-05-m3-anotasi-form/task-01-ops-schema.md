# Task 1: Op schema: signature, stamp, symbol, link, annot, form.set

Adds the M3 op types to the single source of truth (`apps/api/edith/ops.py`), regenerates the JSON Schema and the TS types, and adds an example covering every new op. `form.set` is document-wide (no `pageKey`), so it is not a `ContentOp` on either side; until Task 4 the bake rejects it explicitly instead of crashing on the missing `pageKey`.

**Files:**
- Modify: `apps/api/edith/bake/__init__.py`
- Modify: `apps/api/edith/ops.py`
- Modify: `apps/api/tests/test_ops.py`
- Create: `packages/ops/examples/annotations.json`
- Generate: `packages/ops/schema.json`
- Modify: `packages/ops/src/index.ts`
- Generate: `packages/ops/src/types.ts`

**Interfaces:**
- Consumes: M1/M2 `ops.py` (`_Content`, `Rect`, `HexColor`, `PageKey`, `Point`, `_check_ops`).
- Produces (Python, `edith.ops`): `SignatureAdd {rect, assetId}`; `STAMP_PRESETS` (17 ids, tuple) and `StampPreset`; `StampCustom {text 1..60, date?: str ≤40, time?: str ≤20}`; `StampAdd {rect, preset? | custom?, color}` (exactly one of preset/custom); `SymbolAdd {kind: "check"|"cross", rect, color}`; `UrlTarget {url: ^(https?://|mailto:)\S+$, ≤2048}`, `PageTarget {pageKey}`; `LinkAdd {rect, target: UrlTarget|PageTarget}`; `AnnotAdd {kind: highlight|underline|strike|note, quads?: Rect[1..2000], point?: [x, y], color, content?: str ≤10000}` (markup needs quads and no point; note needs point and no quads); `FormSet {id, type: "form.set", fieldName 1..500, value: str|bool}` (no pageKey); `_check_ops` also rejects two `form.set` for one `fieldName`.
- Produces (TS, `@edith/ops`): generated interfaces `SignatureAdd`, `StampAdd`, `StampCustom`, `SymbolAdd`, `LinkAdd`, `UrlTarget`, `PageTarget`, `AnnotAdd`, `FormSet`; `ContentOp = Exclude<Op, {type: "pages.layout"} | {type: "form.set"}>`; `StampPreset = NonNullable<StampAdd["preset"]>`; `AnnotKind = AnnotAdd["kind"]`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/test_ops.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/tests/test_ops.py
+++ b/apps/api/tests/test_ops.py
@@ -4,7 +4,8 @@ from pathlib import Path
 import pytest
 from pydantic import ValidationError
 
-from edith.ops import BundledFont, ExportRequest, OriginalFont, PagesLayout, Run, ShapeAdd, TextAdd, TextEdit
+from edith.ops import (STAMP_PRESETS, AnnotAdd, BundledFont, ExportRequest, FormSet, LinkAdd, OriginalFont, PageTarget, PagesLayout,
+                       Run, ShapeAdd, StampAdd, TextAdd, TextEdit, UrlTarget)
 from edith.settings import REPO_ROOT
 from scripts.export_schema import build_schema
 
@@ -100,3 +101,61 @@ def test_paragraph_id_and_font_ref_patterns():
     for bad in ({"kind": "original", "ref": "3"}, {"kind": "original"}, {"family": "Arimo", "ref": "f1"}):
         with pytest.raises(ValidationError):
             Run.model_validate({**run, "font": bad})
+
+
+def test_annotations_example_validates():
+    data = json.loads((OPS_DIR / "examples" / "annotations.json").read_text())
+    req = ExportRequest.model_validate(data)
+    assert [op.type for op in req.ops] == ["pages.layout", "signature.add", "stamp.add", "stamp.add", "symbol.add",
+                                           "link.add", "link.add", "annot.add", "annot.add", "form.set", "form.set"]
+    assert isinstance(req.ops[6].target, PageTarget) and req.ops[6].target.pageKey == "o1"
+    assert isinstance(req.ops[5].target, UrlTarget)
+    assert req.ops[3].custom.date == "05/11/2026"
+    assert req.ops[-1].value is True and req.flatten_forms is True
+
+
+def _annot(**kw) -> dict:
+    return {"id": "a", "type": "annot.add", "pageKey": "o0", "color": "#ffeb3b", **kw}
+
+
+QUAD = {"x": 0, "y": 0, "w": 10, "h": 10}
+
+
+def test_annot_geometry():
+    AnnotAdd.model_validate(_annot(kind="highlight", quads=[QUAD]))
+    AnnotAdd.model_validate(_annot(kind="note", point=[1, 2], content="x"))
+    for bad in (_annot(kind="highlight"), _annot(kind="underline", quads=[]), _annot(kind="strike", quads=[QUAD], point=[0, 0]),
+                _annot(kind="note"), _annot(kind="note", point=[0, 0], quads=[QUAD]), _annot(kind="squiggly", quads=[QUAD])):
+        with pytest.raises(ValidationError):
+            AnnotAdd.model_validate(bad)
+
+
+def test_stamp_needs_exactly_one_kind():
+    base = {"id": "s", "type": "stamp.add", "pageKey": "o0", "rect": QUAD, "color": "#15803d"}
+    assert len(STAMP_PRESETS) == 17
+    StampAdd.model_validate({**base, "preset": "sign-here"})
+    StampAdd.model_validate({**base, "custom": {"text": "OK"}})
+    for bad in (base, {**base, "preset": "approved", "custom": {"text": "OK"}}, {**base, "preset": "nope"},
+                {**base, "custom": {"text": ""}}):
+        with pytest.raises(ValidationError):
+            StampAdd.model_validate(bad)
+
+
+def test_link_targets():
+    base = {"id": "l", "type": "link.add", "pageKey": "o0", "rect": QUAD}
+    for ok in ({"url": "https://a.b/c?d=1"}, {"url": "http://x"}, {"url": "mailto:a@b.c"}, {"pageKey": "u-1"}):
+        LinkAdd.model_validate({**base, "target": ok})
+    for bad in ({"url": "javascript:alert(1)"}, {"url": "example.com"}, {"url": "https://a b"}, {"pageKey": "x"}, {}):
+        with pytest.raises(ValidationError):
+            LinkAdd.model_validate({**base, "target": bad})
+
+
+def test_one_form_set_per_field():
+    f = {"type": "form.set", "fieldName": "nama", "value": "x"}
+    ExportRequest.model_validate({"ops": [{**f, "id": "a"}, {**f, "id": "b", "fieldName": "lain", "value": False}]})
+    with pytest.raises(ValidationError):
+        ExportRequest.model_validate({"ops": [{**f, "id": "a"}, {**f, "id": "b"}]})
+    with pytest.raises(ValidationError):  # form.set is not page content
+        FormSet.model_validate({**f, "id": "a", "pageKey": "o0"})
+    with pytest.raises(ValidationError):
+        FormSet.model_validate({**f, "id": "a", "value": 3})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest tests/test_ops.py -q`
Expected: collection error — `ImportError: cannot import name 'STAMP_PRESETS' from 'edith.ops'`.

- [ ] **Step 3: Implement**

`STAMP_PRESETS` is a tuple so the bake (Task 2) and tests can iterate it; `Literal[STAMP_PRESETS]` expands to the 17 string literals at runtime.

Modify `apps/api/edith/bake/__init__.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/bake/__init__.py
+++ b/apps/api/edith/bake/__init__.py
@@ -55,7 +55,10 @@ def bake(source: bytes, ops: list, ctx: BakeContext) -> pymupdf.Document:
         ctx = replace(ctx, source=pages_src)
 
         keys = {p.pageKey for p in layout.pages}
-        content = [(i, op) for i, op in enumerate(ops) if op.type != "pages.layout"]
+        content = [(i, op) for i, op in enumerate(ops) if op.type not in ("pages.layout", "form.set")]
+        for op in ops:
+            if op.type == "form.set":
+                raise BakeFailed("no handler for form.set", op_id=op.id)  # Task 4 fills forms
         for i, op in content:
             if op.pageKey not in keys:
                 raise InvalidOp(f"unknown pageKey {op.pageKey}", op_index=i)
```

Modify `apps/api/edith/ops.py` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/api/edith/ops.py
+++ b/apps/api/edith/ops.py
@@ -135,6 +135,91 @@ class RedactAdd(_Content):
     fill: Literal["black", "white"] = "black"
 
 
+class SignatureAdd(_Content):
+    """A signature image (drawn, typed or uploaded; always a PNG/JPEG asset)."""
+    type: Literal["signature.add"]
+    rect: Rect
+    assetId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
+
+
+STAMP_PRESETS = (
+    "approved", "not-approved", "draft", "final", "completed", "confidential", "for-public-release",
+    "not-for-public-release", "for-comment", "void", "preliminary-results", "information-only", "witness",
+    "initial-here", "sign-here", "accepted", "rejected",
+)
+StampPreset = Literal[STAMP_PRESETS]  # type: ignore[valid-type]
+
+
+class StampCustom(Model):
+    text: str = Field(min_length=1, max_length=60)
+    date: str | None = Field(default=None, max_length=40)  # formatted by the client, drawn as is
+    time: str | None = Field(default=None, max_length=20)
+
+
+class StampAdd(_Content):
+    type: Literal["stamp.add"]
+    rect: Rect
+    preset: StampPreset | None = None
+    custom: StampCustom | None = None
+    color: HexColor
+
+    @model_validator(mode="after")
+    def _one_kind(self):
+        if (self.preset is None) == (self.custom is None):
+            raise ValueError("stamp needs exactly one of preset, custom")
+        return self
+
+
+class SymbolAdd(_Content):
+    type: Literal["symbol.add"]
+    kind: Literal["check", "cross"]
+    rect: Rect
+    color: HexColor
+
+
+class UrlTarget(Model):
+    url: str = Field(max_length=2048, pattern=r"^(https?://|mailto:)\S+$")
+
+
+class PageTarget(Model):
+    pageKey: PageKey
+
+
+class LinkAdd(_Content):
+    type: Literal["link.add"]
+    rect: Rect
+    target: UrlTarget | PageTarget
+
+
+class AnnotAdd(_Content):
+    """A native PDF annotation: text markup over `quads` (one rect per line, horizontal text) or a
+    sticky note whose icon's top-left corner is `point`."""
+    type: Literal["annot.add"]
+    kind: Literal["highlight", "underline", "strike", "note"]
+    quads: list[Rect] | None = Field(default=None, min_length=1, max_length=2000)
+    point: Point | None = None
+    color: HexColor
+    content: str | None = Field(default=None, max_length=10000)
+
+    @model_validator(mode="after")
+    def _geometry(self):
+        if self.kind == "note":
+            if self.point is None or self.quads is not None:
+                raise ValueError("note needs point (and no quads)")
+        elif self.quads is None or self.point is not None:
+            raise ValueError(f"{self.kind} needs quads (and no point)")
+        return self
+
+
+class FormSet(Model):
+    """Value of AcroForm field `fieldName` (every widget of that name): text/combo/list → the string,
+    checkbox → bool, radio → the on-state name of the chosen button (or "Off")."""
+    id: OpId
+    type: Literal["form.set"]
+    fieldName: str = Field(min_length=1, max_length=500)
+    value: str | bool
+
+
 class DocSrc(Model):
     doc: str
     index: int = Field(ge=0)
@@ -168,9 +253,11 @@ class PagesLayout(Model):
         return self
 
 
-ContentOp = Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd]
+ContentOp = Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd,
+                  SignatureAdd, StampAdd, SymbolAdd, LinkAdd, AnnotAdd]
 Op = Annotated[
-    Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd, PagesLayout],
+    Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd,
+          SignatureAdd, StampAdd, SymbolAdd, LinkAdd, AnnotAdd, FormSet, PagesLayout],
     Field(discriminator="type"),
 ]
 
@@ -184,6 +271,9 @@ def _check_ops(ops: list) -> None:
     edited = [(op.pageKey, op.paragraphId) for op in ops if op.type == "text.edit"]
     if len(edited) != len(set(edited)):
         raise ValueError("at most one text.edit per (pageKey, paragraphId)")
+    fields = [op.fieldName for op in ops if op.type == "form.set"]
+    if len(fields) != len(set(fields)):
+        raise ValueError("at most one form.set per fieldName")
 
 
 class ExportRequest(Model):
```

Create `packages/ops/examples/annotations.json`:
```json
{
  "ops": [
    { "id": "layout", "type": "pages.layout", "pages": [
      { "pageKey": "o0", "src": { "doc": "d1", "index": 0 }, "rotate": 0 },
      { "pageKey": "o1", "src": { "doc": "d1", "index": 1 }, "rotate": 90 }
    ] },
    { "id": "s1", "type": "signature.add", "pageKey": "o0", "rect": { "x": 300, "y": 700, "w": 160, "h": 50 }, "assetId": "a1" },
    { "id": "st1", "type": "stamp.add", "pageKey": "o0", "rect": { "x": 72, "y": 600, "w": 140, "h": 40 }, "preset": "approved", "color": "#15803d" },
    { "id": "st2", "type": "stamp.add", "pageKey": "o0", "rect": { "x": 72, "y": 650, "w": 160, "h": 54 }, "custom": { "text": "DIPERIKSA", "date": "05/11/2026", "time": "14:30" }, "color": "#1d4ed8" },
    { "id": "sy1", "type": "symbol.add", "pageKey": "o0", "kind": "check", "rect": { "x": 72, "y": 560, "w": 20, "h": 20 }, "color": "#1d4ed8" },
    { "id": "l1", "type": "link.add", "pageKey": "o0", "rect": { "x": 72, "y": 500, "w": 100, "h": 20 }, "target": { "url": "https://example.com" } },
    { "id": "l2", "type": "link.add", "pageKey": "o0", "rect": { "x": 72, "y": 530, "w": 100, "h": 20 }, "target": { "pageKey": "o1" } },
    { "id": "h1", "type": "annot.add", "pageKey": "o0", "kind": "highlight", "quads": [{ "x": 72, "y": 89.2, "w": 80, "h": 13.8 }], "color": "#ffeb3b" },
    { "id": "n1", "type": "annot.add", "pageKey": "o1", "kind": "note", "point": [300, 300], "color": "#facc15", "content": "Periksa lagi" },
    { "id": "f1", "type": "form.set", "fieldName": "nama", "value": "Budi" },
    { "id": "f2", "type": "form.set", "fieldName": "setuju", "value": true }
  ],
  "flatten_forms": true,
  "filename": "annotated.pdf"
}
```

Modify `packages/ops/src/index.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/packages/ops/src/index.ts
+++ b/packages/ops/src/index.ts
@@ -1,8 +1,11 @@
 export * from "./types";
-import type { ExportRequest, Run } from "./types";
+import type { AnnotAdd, ExportRequest, Run, StampAdd } from "./types";
 
 /** Any op accepted by the API. */
 export type Op = ExportRequest["ops"][number];
-export type ContentOp = Exclude<Op, { type: "pages.layout" }>;
+/** Ops drawn on (or attached to) one page; `form.set` is document-wide and `pages.layout` is the page list. */
+export type ContentOp = Exclude<Op, { type: "pages.layout" } | { type: "form.set" }>;
 /** A run's font: a bundled family or a font embedded in the uploaded PDF. */
 export type FontRef = Run["font"];
+export type StampPreset = NonNullable<StampAdd["preset"]>;
+export type AnnotKind = AnnotAdd["kind"];
```

Regenerate the schema and the TS types (both files are generated — do not edit by hand):
```bash
cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops
```
Expected: `wrote …/packages/ops/schema.json`; `packages/ops/src/types.ts` now has `export interface StampAdd`, `AnnotAdd`, `FormSet`, … (`git diff --stat` shows both files changed).

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/api && uv run pytest tests/test_ops.py -q`
Expected: `17 passed`.

- [ ] **Step 5: Full check**

Run: `cd apps/api && uv run pytest -q`
Expected: `262 passed`, no warnings summary.

Run: `npx tsc --noEmit -p packages/ops && npx tsc --noEmit -p apps/web && npm test -w apps/web`
Expected: both tsc runs print nothing; `Tests  169 passed (169)` (the web code does not use the new types yet).

- [ ] **Step 6: Commit**

```bash
git add apps/api/edith/bake/__init__.py apps/api/edith/ops.py apps/api/tests/test_ops.py packages/ops/examples/annotations.json packages/ops/schema.json packages/ops/src/index.ts packages/ops/src/types.ts
git commit -m "feat(ops): add M3 op types for signatures, stamps, symbols, links, annotations and forms" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
