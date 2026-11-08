# Task 1: Ops schema: opacity, rotation, new shapes, dash, crop

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 0 (main) leaves, new files are complete.

**Goal:** Every drawn op gets `opacity`; rect-placed drawn ops get `rotation`; `shape.add` gets polygon/polyline/cloud and `dash`; `pages.layout` pages get `crop`. Types regenerated; web stays green (all new fields optional).

**Files:**
- Modify: `apps/api/edith/ops.py`
- Modify: `apps/api/tests/test_ops.py`
- Create: `packages/ops/examples/pages.json`
- Regenerate: `packages/ops/schema.json`
- Regenerate: `packages/ops/src/types.ts`

**Interfaces:**
- Consumes: M3 `apps/api/edith/ops.py`.
- Produces:
- `_Drawn` (adds `opacity: float = 1`, 0–1) on TextAdd, ImageAdd, ShapeAdd, InkAdd, SignatureAdd, StampAdd, SymbolAdd; `_Rotatable(_Drawn)` (adds `rotation: float = 0`, −360…360, clockwise on screen around the rect centre) on all of those except InkAdd.
- `ShapeAdd.kind`: `rect|ellipse|line|arrow|polygon|polyline|cloud`; `points` for every kind except rect/ellipse (polygon/cloud ≥ 3, polyline ≥ 2, line/arrow exactly 2, ≤ 1000); point kinds require `rotation == 0`; `dash: "solid"|"dashed"|"dotted" = "solid"`; stray `rect`/`points` rejected (M1 backlog).
- `CropRect {x ≥ 0, y ≥ 0, w ≥ 1, h ≥ 1}`; `LayoutPage.crop: CropRect | None`.
- TS (generated): `ShapeAdd.dash?`, `opacity?`, `rotation?`, `PagesLayout.pages[].crop?`. Example `packages/ops/examples/pages.json`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/api/tests/test_ops.py`:

```diff
--- a/apps/api/tests/test_ops.py
+++ b/apps/api/tests/test_ops.py
@@ -164,3 +164,48 @@ def test_one_form_set_per_field():
         FormSet.model_validate({**f, "id": "a", "pageKey": "o0"})
     with pytest.raises(ValidationError):
         FormSet.model_validate({**f, "id": "a", "value": 3})
+
+
+def _shape(**kw) -> dict:
+    return {"id": "s", "type": "shape.add", "pageKey": "o0", "stroke": "#000000", "width": 1, **kw}
+
+
+def test_pages_example_validates():
+    data = json.loads((OPS_DIR / "examples" / "pages.json").read_text())
+    req = ExportRequest.model_validate(data)
+    layout = req.ops[0]
+    assert layout.pages[0].crop.w == 523 and layout.pages[1].crop is None
+    assert [op.kind for op in req.ops[1:5]] == ["rect", "polygon", "cloud", "polyline"]
+    assert req.ops[1].dash == "dashed" and req.ops[1].rotation == 30 and req.ops[1].opacity == 0.5
+    assert req.ops[2].dash == "solid" and req.ops[2].opacity == 1 and req.ops[2].rotation == 0
+    assert req.ops[5].rotation == -45 and req.ops[6].opacity == 0.4
+
+
+def test_point_shapes_need_enough_points_and_no_rect():
+    tri = [[0, 0], [10, 0], [5, 8]]
+    for kind, pts in (("polygon", tri), ("cloud", tri), ("polyline", tri[:2]), ("line", tri[:2])):
+        ShapeAdd.model_validate(_shape(kind=kind, points=pts))
+    for bad in (_shape(kind="polygon", points=tri[:2]), _shape(kind="cloud", points=tri[:2]), _shape(kind="polyline", points=tri[:1]),
+                _shape(kind="line", points=tri), _shape(kind="polygon", points=tri, rect=QUAD),
+                _shape(kind="rect", rect=QUAD, points=tri[:2]), _shape(kind="polygon", points=tri, rotation=10),
+                _shape(kind="rect", rect=QUAD, dash="dashdot")):
+        with pytest.raises(ValidationError):
+            ShapeAdd.model_validate(bad)
+
+
+def test_opacity_and_rotation_ranges():
+    ShapeAdd.model_validate(_shape(kind="rect", rect=QUAD, rotation=-360, opacity=0))
+    for bad in (_shape(kind="rect", rect=QUAD, opacity=1.5), _shape(kind="rect", rect=QUAD, rotation=400)):
+        with pytest.raises(ValidationError):
+            ShapeAdd.model_validate(bad)
+    # Only drawn objects carry them: a link has neither.
+    with pytest.raises(ValidationError):
+        LinkAdd.model_validate({"id": "l", "type": "link.add", "pageKey": "o0", "rect": QUAD, "target": {"url": "https://a.b"}, "opacity": 0.5})
+
+
+def test_layout_crop_needs_positive_size():
+    page = {"pageKey": "o0", "src": {"doc": "d", "index": 0}}
+    PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": [{**page, "crop": {"x": 0, "y": 0, "w": 10, "h": 10}}]})
+    for crop in ({"x": 0, "y": 0, "w": 0, "h": 10}, {"x": -1, "y": 0, "w": 10, "h": 10}):
+        with pytest.raises(ValidationError):
+            PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": [{**page, "crop": crop}]})
```

Create `packages/ops/examples/pages.json`:

```json
{
  "ops": [
    { "id": "layout", "type": "pages.layout", "pages": [
      { "pageKey": "o0", "src": { "doc": "MAINDOCMAINDOCMAINDOC0", "index": 0 }, "rotate": 0, "crop": { "x": 36, "y": 36, "w": 523, "h": 770 } },
      { "pageKey": "u-dup-1", "src": { "doc": "MAINDOCMAINDOCMAINDOC0", "index": 0 } },
      { "pageKey": "u-imp-1", "src": { "doc": "IMPORTEDIMPORTEDIMPOR1", "index": 0 }, "rotate": 90 }
    ] },
    { "id": "sh1", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": { "x": 100, "y": 100, "w": 120, "h": 60 }, "stroke": "#e11d48", "fill": null, "width": 2, "dash": "dashed", "opacity": 0.5, "rotation": 30 },
    { "id": "sh2", "type": "shape.add", "pageKey": "o0", "kind": "polygon", "points": [[100, 300], [200, 300], [150, 380]], "stroke": "#1d4ed8", "fill": "#bfdbfe", "width": 1.5 },
    { "id": "sh3", "type": "shape.add", "pageKey": "u-dup-1", "kind": "cloud", "points": [[300, 300], [420, 300], [420, 380], [300, 380]], "stroke": "#e11d48", "fill": null, "width": 2, "dash": "dotted" },
    { "id": "sh4", "type": "shape.add", "pageKey": "u-imp-1", "kind": "polyline", "points": [[50, 50], [90, 80], [130, 50]], "stroke": "#111111", "width": 1 },
    { "id": "im1", "type": "image.add", "pageKey": "u-imp-1", "rect": { "x": 200, "y": 200, "w": 80, "h": 40 }, "assetId": "a1", "rotation": -45, "opacity": 0.8 },
    { "id": "in1", "type": "ink.add", "pageKey": "o0", "paths": [[[10, 10], [20, 25]]], "color": "#0000ff", "width": 3, "opacity": 0.4 }
  ],
  "filename": "pages.pdf"
}
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/api && uv run pytest -q tests/test_ops.py`
Expected: FAIL: `test_pages_example_validates` etc. (unknown fields / kinds rejected by `extra=forbid`)

- [ ] **Step 3: Implement**

Modify `apps/api/edith/ops.py`:

```diff
--- a/apps/api/edith/ops.py
+++ b/apps/api/edith/ops.py
@@ -81,7 +81,22 @@ class _Content(Model):
     pageKey: PageKey
 
 
-class TextAdd(_Content):
+Opacity = Annotated[float, Field(ge=0, le=1)]
+Rotation = Annotated[float, Field(ge=-360, le=360)]
+
+
+class _Drawn(_Content):
+    """Drawn objects can be translucent (`opacity`, 0–1)."""
+    opacity: Opacity = 1
+
+
+class _Rotatable(_Drawn):
+    """Drawn objects placed by a rect also turn by `rotation` degrees (clockwise on screen) around the
+    centre of that rect. Objects made of points (ink, lines, polygons) are rotated by moving their points."""
+    rotation: Rotation = 0
+
+
+class TextAdd(_Rotatable):
     type: Literal["text.add"]
     box: TextBox
 
@@ -93,31 +108,47 @@ class TextEdit(_Content):
     box: TextBox
 
 
-class ImageAdd(_Content):
+class ImageAdd(_Rotatable):
     type: Literal["image.add"]
     rect: Rect
     assetId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
 
 
-class ShapeAdd(_Content):
+RECT_SHAPES = ("rect", "ellipse")
+# Fewest points per point-based kind; line/arrow take exactly 2.
+MIN_POINTS = {"line": 2, "arrow": 2, "polyline": 2, "polygon": 3, "cloud": 3}
+MAX_SHAPE_POINTS = 1000
+
+
+class ShapeAdd(_Rotatable):
+    """rect/ellipse use `rect` (and may be rotated); the other kinds use `points` (closed for polygon and
+    cloud; a cloud's border is scalloped, see bake/geometry.py) and keep `rotation` 0."""
     type: Literal["shape.add"]
-    kind: Literal["rect", "ellipse", "line", "arrow"]
+    kind: Literal["rect", "ellipse", "line", "arrow", "polygon", "polyline", "cloud"]
     rect: Rect | None = None
-    points: list[Point] | None = None
+    points: list[Point] | None = Field(default=None, max_length=MAX_SHAPE_POINTS)
     stroke: HexColor
     fill: HexColor | None = None
     width: float = Field(ge=0, le=100)
+    dash: Literal["solid", "dashed", "dotted"] = "solid"
 
     @model_validator(mode="after")
     def _geometry(self):
-        if self.kind in ("rect", "ellipse") and self.rect is None:
-            raise ValueError(f"{self.kind} needs rect")
-        if self.kind in ("line", "arrow") and (self.points is None or len(self.points) != 2):
-            raise ValueError(f"{self.kind} needs exactly 2 points")
+        if self.kind in RECT_SHAPES:
+            if self.rect is None or self.points is not None:
+                raise ValueError(f"{self.kind} needs rect (and no points)")
+            return self
+        if self.points is None or self.rect is not None:
+            raise ValueError(f"{self.kind} needs points (and no rect)")
+        n = MIN_POINTS[self.kind]
+        if len(self.points) < n or (self.kind in ("line", "arrow") and len(self.points) != n):
+            raise ValueError(f"{self.kind} needs {'exactly' if self.kind in ('line', 'arrow') else 'at least'} {n} points")
+        if self.rotation:
+            raise ValueError(f"{self.kind} is rotated by its points (rotation must be 0)")
         return self
 
 
-class InkAdd(_Content):
+class InkAdd(_Drawn):
     type: Literal["ink.add"]
     paths: list[Annotated[list[Point], Field(min_length=1)]] = Field(min_length=1)
     color: HexColor
@@ -135,7 +166,7 @@ class RedactAdd(_Content):
     fill: Literal["black", "white"] = "black"
 
 
-class SignatureAdd(_Content):
+class SignatureAdd(_Rotatable):
     """A signature image (drawn, typed or uploaded; always a PNG/JPEG asset)."""
     type: Literal["signature.add"]
     rect: Rect
@@ -160,7 +191,7 @@ class StampCustom(Model):
     time: str | None = Field(default=None, max_length=20)
 
 
-class StampAdd(_Content):
+class StampAdd(_Rotatable):
     type: Literal["stamp.add"]
     rect: Rect
     preset: StampPreset | None = None
@@ -174,7 +205,7 @@ class StampAdd(_Content):
         return self
 
 
-class SymbolAdd(_Content):
+class SymbolAdd(_Rotatable):
     type: Literal["symbol.add"]
     kind: Literal["check", "cross"]
     rect: Rect
@@ -238,10 +269,20 @@ class BlankSrc(Model):
     blank: BlankSize
 
 
+class CropRect(Model):
+    """Visible part of a page, in the page's own coordinates (unrotated, relative to its source CropBox)."""
+    x: float = Field(ge=0)
+    y: float = Field(ge=0)
+    w: float = Field(ge=1)
+    h: float = Field(ge=1)
+
+
 class LayoutPage(Model):
+    """`src.doc` is the edited document or another uploaded one (an imported PDF)."""
     pageKey: PageKey
     src: DocSrc | BlankSrc
     rotate: Literal[0, 90, 180, 270] = 0
+    crop: CropRect | None = None
 
 
 class PagesLayout(Model):
```

Then regenerate (never edit by hand): `cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops`. The generated `types.ts` gains `Opacity*`/`Rotation*`/`Dash` aliases and the optional fields above.

- [ ] **Step 4: Run the suites**

Run: `cd apps/api && uv run pytest -q && npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: API 316 passed; web 226 passed; tsc and eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/api/edith/ops.py apps/api/tests/test_ops.py packages/ops/examples/pages.json packages/ops/schema.json packages/ops/src/types.ts
git commit -m "feat(api): ops schema for opacity, rotation, polygons, clouds, dashes and crop" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
