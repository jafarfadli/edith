# Task 3: Ops schema (Pydantic source → JSON Schema → TS)

**Files:**
- Create: `apps/api/edith/ops.py`, `apps/api/scripts/export_schema.py`, `apps/api/tests/test_ops.py`
- Create: `packages/ops/package.json`, `packages/ops/schema.json` (generated), `packages/ops/src/types.ts` (generated), `packages/ops/src/index.ts`, `packages/ops/examples/basic.json`, `packages/ops/tsconfig.json`

**Interfaces:**
- Produces (Python, `edith.ops`): `Rect`, `BundledFont`, `Run`, `Segment`, `LayoutLine`, `TextBox`, `TextAdd`, `ImageAdd`, `ShapeAdd`, `InkAdd`, `WhiteoutAdd`, `RedactAdd`, `DocSrc`, `BlankSize`, `BlankSrc`, `LayoutPage`, `PagesLayout`, `Op` (discriminated union on `type`), `ContentOp` (union of the 6 content ops), `ExportRequest`, `RenderPageRequest`, constant `MAX_OPS = 5000`.
- Produces (TS, `@edith/ops`): same names as TS interfaces/types (generated), re-exported from `packages/ops/src/index.ts`. `Op` type and `ExportRequest` interface are what the web app uses.

Field names (exact):
- `Rect {x, y, w, h}`; `Point = [number, number]` (list of 2 floats).
- `BundledFont {kind: "bundled", family, bold, italic}`.
- `Run {text, font: BundledFont, size, color}`.
- `Segment {x, text, runIndex}` — `x` is relative to `box.rect.x`; `runIndex` indexes the flattened runs `paragraphs.flat()`.
- `LayoutLine {baseline, segments}` — `baseline` is relative to `box.rect.y`.
- `TextBox {rect, align, lineHeight, paragraphs: Run[][], layout: LayoutLine[]}`.
- Content ops all have `id`, `type`, `pageKey`: `text.add {box}`, `image.add {rect, assetId}`, `shape.add {kind, rect?, points?, stroke, fill?, width}`, `ink.add {paths, color, width}`, `whiteout.add {rect}`, `redact.add {rect, fill: "black"|"white"}`.
- `pages.layout {id, type, pages: LayoutPage[]}`, `LayoutPage {pageKey, src: DocSrc | BlankSrc, rotate: 0|90|180|270}`, `DocSrc {doc, index}`, `BlankSrc {blank: {width, height}}`. `rotate` is added to the source page's existing rotation.
- `ExportRequest {ops, flatten_forms, filename}`; `RenderPageRequest {pageKey, ops}`.

- [ ] **Step 1: Failing tests**

`apps/api/tests/test_ops.py`:
```python
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from edith.ops import ExportRequest, PagesLayout, ShapeAdd, TextAdd
from edith.settings import REPO_ROOT
from scripts.export_schema import build_schema

OPS_DIR = REPO_ROOT / "packages" / "ops"


def test_example_validates():
    data = json.loads((OPS_DIR / "examples" / "basic.json").read_text())
    req = ExportRequest.model_validate(data)
    types = [op.type for op in req.ops]
    assert types == ["pages.layout", "text.add", "shape.add", "ink.add", "whiteout.add", "redact.add", "image.add"]
    assert isinstance(req.ops[1], TextAdd)


def test_schema_file_is_fresh():
    on_disk = json.loads((OPS_DIR / "schema.json").read_text())
    assert on_disk == build_schema(), "run: cd apps/api && uv run python -m scripts.export_schema"


def test_shape_requires_rect_for_rect_kind():
    with pytest.raises(ValidationError):
        ShapeAdd.model_validate({"id": "a", "type": "shape.add", "pageKey": "o0", "kind": "rect", "stroke": "#000000", "width": 1})


def test_line_requires_two_points():
    with pytest.raises(ValidationError):
        ShapeAdd.model_validate({"id": "a", "type": "shape.add", "pageKey": "o0", "kind": "line", "points": [[0, 0]], "stroke": "#000000", "width": 1})


def test_bad_color_and_pagekey_rejected():
    with pytest.raises(ValidationError):
        ShapeAdd.model_validate({"id": "a", "type": "shape.add", "pageKey": "x1", "kind": "rect", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}, "stroke": "red", "width": 1})


def test_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [], "bogus": 1})


def test_only_one_layout_and_unique_ids():
    layout = {"id": "L", "type": "pages.layout", "pages": [{"pageKey": "o0", "src": {"doc": "d", "index": 0}}]}
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [layout, {**layout, "id": "L2"}]})
    w = {"id": "same", "type": "whiteout.add", "pageKey": "o0", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}}
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [w, w]})


def test_layout_page_keys_unique():
    with pytest.raises(ValidationError):
        PagesLayout.model_validate({"id": "L", "type": "pages.layout", "pages": [
            {"pageKey": "o0", "src": {"doc": "d", "index": 0}},
            {"pageKey": "o0", "src": {"doc": "d", "index": 0}},
        ]})


def test_too_many_ops():
    w = {"type": "whiteout.add", "pageKey": "o0", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}}
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [{**w, "id": str(i)} for i in range(5001)]})
```

Add empty `apps/api/scripts/__init__.py`.

Run: `cd apps/api && uv run pytest tests/test_ops.py -q` → Expected: FAIL (import errors).

- [ ] **Step 2: Models**

`apps/api/edith/ops.py`:
```python
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_OPS = 5000

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
PageKey = Annotated[str, Field(pattern=r"^(o\d+|u[0-9A-Za-z-]+)$")]
OpId = Annotated[str, Field(min_length=1, max_length=64)]
Point = Annotated[list[float], Field(min_length=2, max_length=2)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Rect(Model):
    x: float
    y: float
    w: float = Field(ge=0)
    h: float = Field(ge=0)


class BundledFont(Model):
    kind: Literal["bundled"] = "bundled"
    family: str
    bold: bool = False
    italic: bool = False


class Run(Model):
    text: str
    font: BundledFont
    size: float = Field(gt=0, le=500)
    color: HexColor


class Segment(Model):
    x: float
    text: str
    runIndex: int = Field(ge=0)


class LayoutLine(Model):
    baseline: float
    segments: list[Segment]


class TextBox(Model):
    rect: Rect
    align: Literal["left", "center", "right", "justify"] = "left"
    lineHeight: float = Field(gt=0)
    paragraphs: list[list[Run]]
    layout: list[LayoutLine]

    @model_validator(mode="after")
    def _run_indexes_in_range(self):
        n = sum(len(p) for p in self.paragraphs)
        for line in self.layout:
            for seg in line.segments:
                if seg.runIndex >= n:
                    raise ValueError(f"runIndex {seg.runIndex} out of range ({n} runs)")
        return self


class _Content(Model):
    id: OpId
    pageKey: PageKey


class TextAdd(_Content):
    type: Literal["text.add"]
    box: TextBox


class ImageAdd(_Content):
    type: Literal["image.add"]
    rect: Rect
    assetId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")


class ShapeAdd(_Content):
    type: Literal["shape.add"]
    kind: Literal["rect", "ellipse", "line", "arrow"]
    rect: Rect | None = None
    points: list[Point] | None = None
    stroke: HexColor
    fill: HexColor | None = None
    width: float = Field(ge=0, le=100)

    @model_validator(mode="after")
    def _geometry(self):
        if self.kind in ("rect", "ellipse") and self.rect is None:
            raise ValueError(f"{self.kind} needs rect")
        if self.kind in ("line", "arrow") and (self.points is None or len(self.points) != 2):
            raise ValueError(f"{self.kind} needs exactly 2 points")
        return self


class InkAdd(_Content):
    type: Literal["ink.add"]
    paths: list[Annotated[list[Point], Field(min_length=1)]] = Field(min_length=1)
    color: HexColor
    width: float = Field(gt=0, le=100)


class WhiteoutAdd(_Content):
    type: Literal["whiteout.add"]
    rect: Rect


class RedactAdd(_Content):
    type: Literal["redact.add"]
    rect: Rect
    fill: Literal["black", "white"] = "black"


class DocSrc(Model):
    doc: str
    index: int = Field(ge=0)


class BlankSize(Model):
    width: float = Field(gt=0, le=14400)
    height: float = Field(gt=0, le=14400)


class BlankSrc(Model):
    blank: BlankSize


class LayoutPage(Model):
    pageKey: PageKey
    src: DocSrc | BlankSrc
    rotate: Literal[0, 90, 180, 270] = 0


class PagesLayout(Model):
    id: OpId
    type: Literal["pages.layout"]
    pages: list[LayoutPage] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_keys(self):
        keys = [p.pageKey for p in self.pages]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate pageKey in layout")
        return self


ContentOp = Union[TextAdd, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd]
Op = Annotated[Union[TextAdd, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd, PagesLayout], Field(discriminator="type")]


def _check_ops(ops: list) -> None:
    ids = [op.id for op in ops]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate op id")
    if sum(1 for op in ops if op.type == "pages.layout") > 1:
        raise ValueError("at most one pages.layout")


class ExportRequest(Model):
    ops: list[Op] = Field(max_length=MAX_OPS)
    flatten_forms: bool = False
    filename: str = Field(default="document.pdf", max_length=200)

    @model_validator(mode="after")
    def _ops(self):
        _check_ops(self.ops)
        return self


class RenderPageRequest(Model):
    pageKey: PageKey
    ops: list[Op] = Field(max_length=MAX_OPS)

    @model_validator(mode="after")
    def _ops(self):
        _check_ops(self.ops)
        return self
```

- [ ] **Step 3: Schema export script**

`apps/api/scripts/export_schema.py`:
```python
import json

from pydantic import BaseModel

from edith.ops import ExportRequest, RenderPageRequest
from edith.settings import REPO_ROOT

OUT = REPO_ROOT / "packages" / "ops" / "schema.json"


class EdithSchema(BaseModel):
    export: ExportRequest
    renderPage: RenderPageRequest


def build_schema() -> dict:
    schema = EdithSchema.model_json_schema()
    schema["title"] = "EdithSchema"
    return schema


if __name__ == "__main__":
    OUT.write_text(json.dumps(build_schema(), indent=2) + "\n")
    print("wrote", OUT)
```

Run: `cd apps/api && uv run python -m scripts.export_schema`
Expected: `wrote .../packages/ops/schema.json`.

- [ ] **Step 4: Example file**

`packages/ops/examples/basic.json`:
```json
{
  "ops": [
    { "id": "L", "type": "pages.layout", "pages": [
      { "pageKey": "o1", "src": { "doc": "DOC", "index": 1 }, "rotate": 90 },
      { "pageKey": "o0", "src": { "doc": "DOC", "index": 0 } },
      { "pageKey": "u-blank-1", "src": { "blank": { "width": 595, "height": 842 } } }
    ] },
    { "id": "t1", "type": "text.add", "pageKey": "o0", "box": {
      "rect": { "x": 72, "y": 72, "w": 200, "h": 20 }, "align": "left", "lineHeight": 14.4,
      "paragraphs": [[{ "text": "Halo dunia", "font": { "kind": "bundled", "family": "Arimo", "bold": false, "italic": false }, "size": 12, "color": "#111111" }]],
      "layout": [{ "baseline": 11.0, "segments": [{ "x": 0, "text": "Halo dunia", "runIndex": 0 }] }]
    } },
    { "id": "s1", "type": "shape.add", "pageKey": "o0", "kind": "rect", "rect": { "x": 50, "y": 200, "w": 100, "h": 50 }, "stroke": "#ff0000", "fill": null, "width": 2 },
    { "id": "i1", "type": "ink.add", "pageKey": "o1", "paths": [[[10, 10], [20, 25], [30, 12]]], "color": "#0000ff", "width": 3 },
    { "id": "w1", "type": "whiteout.add", "pageKey": "o1", "rect": { "x": 0, "y": 0, "w": 40, "h": 20 } },
    { "id": "r1", "type": "redact.add", "pageKey": "o0", "rect": { "x": 300, "y": 300, "w": 80, "h": 20 }, "fill": "black" },
    { "id": "img1", "type": "image.add", "pageKey": "u-blank-1", "rect": { "x": 100, "y": 100, "w": 120, "h": 80 }, "assetId": "ASSET" }
  ],
  "flatten_forms": false,
  "filename": "hasil.pdf"
}
```

Run: `cd apps/api && uv run pytest tests/test_ops.py -q` → Expected: `9 passed`.

- [ ] **Step 5: TS package**

`packages/ops/package.json`:
```json
{
  "name": "@edith/ops",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "gen": "json2ts -i schema.json -o src/types.ts --unreachableDefinitions --no-additionalProperties --bannerComment \"/* Generated from apps/api/edith/ops.py — do not edit. Run: npm run gen -w packages/ops */\"",
    "check": "npm run gen && git diff --exit-code -- src/types.ts && tsc --noEmit -p ."
  },
  "devDependencies": { "json-schema-to-typescript": "^15.0.0", "typescript": "^5.6.0" }
}
```

`packages/ops/tsconfig.json`:
```json
{ "compilerOptions": { "strict": true, "noEmit": true, "module": "ESNext", "moduleResolution": "Bundler", "target": "ES2022", "skipLibCheck": true }, "include": ["src"] }
```

Run: `npm install && npm run gen -w packages/ops`
Expected: `packages/ops/src/types.ts` exists and contains `export interface TextAdd` and `export interface PagesLayout`. Inspect the generated union for ops: it is the type of `ExportRequest["ops"][number]`.

`packages/ops/src/index.ts`:
```ts
export * from "./types";
import type { ExportRequest } from "./types";

/** Any op accepted by the API. */
export type Op = ExportRequest["ops"][number];
export type ContentOp = Exclude<Op, { type: "pages.layout" }>;
```

If the generator already emits a type named `Op`, delete the local `Op` alias line and re-export instead.

Run: `npx tsc --noEmit -p packages/ops`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/edith/ops.py apps/api/scripts apps/api/tests/test_ops.py packages/ops package.json package-lock.json
git commit -m "feat: add ops schema with generated JSON Schema and TS types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
