# Task 2: Ops schema — `FontRef`, rich `Run`, `text.edit` (+ web types)

**Files:**
- Modify: `apps/api/edith/ops.py`, `apps/api/tests/test_ops.py`, `packages/ops/examples/basic.json`, `packages/ops/src/index.ts`
- Regenerate: `packages/ops/schema.json`, `packages/ops/src/types.ts`
- Modify (web adopts the new types so tsc stays green): `apps/web/src/lib/fonts.ts` (rewrite), `apps/web/src/lib/fonts.test.ts`, `apps/web/src/lib/layout.ts`, `apps/web/src/lib/textbox.ts`, `apps/web/src/lib/textbox.test.ts`, `apps/web/src/components/editor/text/TextProps.tsx`, `apps/web/src/components/editor/text/textEdit.ts`, `apps/web/src/components/editor/text/textEdit.test.ts`

**Interfaces:**
- Consumes: Task 1 `pickFile`, `Style`.
- Produces:
  - Python (`edith.ops`): `OriginalFont(kind: Literal["original"], ref: str /^f\d+$/)`, `FontRef = Union[BundledFont, OriginalFont]`, `Run.font: FontRef`, `Run.bgColor: HexColor | None = None`, `Run.underline: bool = False`, `Run.strike: bool = False`, `TextEdit(id, pageKey, type="text.edit", paragraphId: str /^g\d+$/, box: TextBox)`; `ContentOp`/`Op` include `TextEdit`; `ExportRequest`/`RenderPageRequest` reject two `text.edit` ops with the same `(pageKey, paragraphId)`.
  - TS (`@edith/ops`): generated `OriginalFont`, `TextEdit`, `Run` (`font: BundledFont | OriginalFont`, `bgColor?`, `underline?`, `strike?`); `export type FontRef = Run["font"]`.
  - `apps/web/src/lib/fonts.ts`:
    ```ts
    export interface FontMetrics { unitsPerEm; ascent; descent; advance(ch): number; hasGlyph?(cp: number): boolean }
    export function covers(m: FontMetrics, text: string): boolean
    export function isOriginal(f: FontRef): f is OriginalFont
    export function fontKey(f: FontRef): string        // "orig-f12" | "Arimo-bold-italic"
    export function cssFamily(f: FontRef): string       // "edith-" + fontKey
    class FontStore { setOriginalSource(url: ((ref: string) => string) | null): void; load(f: FontRef): Promise<FontMetrics>; peek(f: FontRef): FontMetrics | null; get(f: FontRef): FontMetrics; families(): Promise<string[]> }
    ```
  - `layoutText`/`relayout` take `metricsFor: (f: FontRef) => FontMetrics`; `boxFonts(box): FontRef[]`.

- [ ] **Step 1: Failing schema tests**

In `apps/api/tests/test_ops.py`, change the import to:
```python
from edith.ops import BundledFont, ExportRequest, OriginalFont, PagesLayout, Run, ShapeAdd, TextAdd, TextEdit
```
replace the two assertions at the end of `test_example_validates` with:
```python
    assert types == ["pages.layout", "text.add", "shape.add", "ink.add", "whiteout.add", "redact.add", "image.add", "text.edit"]
    assert isinstance(req.ops[1], TextAdd)
    edit = req.ops[-1]
    assert isinstance(edit, TextEdit) and edit.paragraphId == "g0"
    first, second = edit.box.paragraphs[0]
    assert isinstance(first.font, OriginalFont) and first.font.ref == "f12"
    assert isinstance(second.font, BundledFont) and second.underline and second.bgColor == "#ffff00"
```
and append:
```python


def _edit(op_id: str, page_key: str = "o0", paragraph_id: str = "g0") -> dict:
    return {"id": op_id, "type": "text.edit", "pageKey": page_key, "paragraphId": paragraph_id,
            "box": {"rect": {"x": 0, "y": 0, "w": 10, "h": 10}, "lineHeight": 12, "paragraphs": [], "layout": []}}


def test_one_text_edit_per_paragraph():
    ExportRequest.model_validate({"ops": [_edit("a"), _edit("b", paragraph_id="g1"), _edit("c", page_key="u-dup")]})
    with pytest.raises(ValidationError):
        ExportRequest.model_validate({"ops": [_edit("a"), _edit("b")]})


def test_paragraph_id_and_font_ref_patterns():
    with pytest.raises(ValidationError):
        TextEdit.model_validate(_edit("a", paragraph_id="p0"))
    run = {"text": "x", "size": 10, "color": "#000000"}
    assert Run.model_validate({**run, "font": {"kind": "original", "ref": "f3"}}).font == OriginalFont(kind="original", ref="f3")
    assert Run.model_validate({**run, "font": {"kind": "bundled", "family": "Arimo"}}).underline is False
    for bad in ({"kind": "original", "ref": "3"}, {"kind": "original"}, {"family": "Arimo", "ref": "f1"}):
        with pytest.raises(ValidationError):
            Run.model_validate({**run, "font": bad})
```

In `packages/ops/examples/basic.json`, replace the last op line (`{ "id": "img1", … "assetId": "ASSET" }`) with:
```json
    { "id": "img1", "type": "image.add", "pageKey": "u-blank-1", "rect": { "x": 100, "y": 100, "w": 120, "h": 80 }, "assetId": "ASSET" },
    { "id": "e1", "type": "text.edit", "pageKey": "o0", "paragraphId": "g0", "box": {
      "rect": { "x": 72, "y": 90, "w": 300, "h": 16 }, "align": "justify", "lineHeight": 14.4,
      "paragraphs": [[
        { "text": "Teks ", "font": { "kind": "original", "ref": "f12" }, "size": 12, "color": "#111111" },
        { "text": "baru", "font": { "kind": "bundled", "family": "Arimo", "bold": true, "italic": false }, "size": 12, "color": "#111111", "bgColor": "#ffff00", "underline": true, "strike": false }
      ]],
      "layout": [{ "baseline": 11.0, "segments": [{ "x": 0, "text": "Teks ", "runIndex": 0 }, { "x": 26.0, "text": "baru", "runIndex": 1 }] }]
    } }
```

Run: `cd apps/api && uv run pytest tests/test_ops.py -q`
Expected: FAIL — `ImportError: cannot import name 'OriginalFont'`.

- [ ] **Step 2: Schema**

In `apps/api/edith/ops.py`:
- Replace the `Run` class with:
```python
class OriginalFont(Model):
    """A font embedded in the uploaded PDF (`ref` from GET /documents/{id}/text), reused as is."""
    kind: Literal["original"]
    ref: str = Field(pattern=r"^f\d+$")


FontRef = Union[BundledFont, OriginalFont]


class Run(Model):
    text: str
    font: FontRef
    size: float = Field(gt=0, le=500)
    color: HexColor
    bgColor: HexColor | None = None
    underline: bool = False
    strike: bool = False
```
- After `class TextAdd`, add:
```python
class TextEdit(_Content):
    """Replaces original paragraph `paragraphId` of the page's source page with `box`."""
    type: Literal["text.edit"]
    paragraphId: str = Field(pattern=r"^g\d+$")
    box: TextBox
```
- Replace the `ContentOp`/`Op` lines with:
```python
ContentOp = Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd]
Op = Annotated[
    Union[TextAdd, TextEdit, ImageAdd, ShapeAdd, InkAdd, WhiteoutAdd, RedactAdd, PagesLayout],
    Field(discriminator="type"),
]
```
- At the end of `_check_ops` add:
```python
    edited = [(op.pageKey, op.paragraphId) for op in ops if op.type == "text.edit"]
    if len(edited) != len(set(edited)):
        raise ValueError("at most one text.edit per (pageKey, paragraphId)")
```

(`FontRef` is a plain union, not discriminated: M1 drafts may omit `kind` on bundled fonts, and `extra="forbid"` keeps the two shapes apart.)

Run: `cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops`
Then `cd apps/api && uv run pytest -q` → Expected: all pass (incl. `test_schema_file_is_fresh`).

`packages/ops/src/index.ts` (replace):
```ts
export * from "./types";
import type { ExportRequest, Run } from "./types";

/** Any op accepted by the API. */
export type Op = ExportRequest["ops"][number];
export type ContentOp = Exclude<Op, { type: "pages.layout" }>;
/** A run's font: a bundled family or a font embedded in the uploaded PDF. */
export type FontRef = Run["font"];
```

Run: `npx tsc --noEmit -p apps/web`
Expected: FAIL — errors like `Argument of type 'Font' is not assignable to parameter of type 'BundledFont'` in `layout.ts`, `textbox.ts`, `TextNode.tsx`, `TextEditor.tsx`, `TextProps.tsx`. The next steps fix them.

- [ ] **Step 3: Failing web font tests**

Change the `@/lib/fonts` import of `apps/web/src/lib/fonts.test.ts` to
`import { FontStore, charOffsets, covers, cssFamily, fontKey, metricsFromBuffer, pickFile, textWidth } from "@/lib/fonts";`
and append:
```ts
describe("FontRef support", () => {
  afterEach(() => vi.unstubAllGlobals());
  const bytes = () => {
    const b = ttf("Arimo-Regular.ttf");
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  it("keys original fonts by ref", () => {
    expect(fontKey({ kind: "original", ref: "f12" })).toBe("orig-f12");
    expect(cssFamily({ kind: "original", ref: "f12" })).toBe("edith-orig-f12");
  });

  it("loads an original font from the document source and checks glyph coverage", async () => {
    const fetchMock = vi.fn(async () => new Response(bytes(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = new FontStore("/fonts");
    const orig = { kind: "original" as const, ref: "f9" };
    await expect(store.load(orig)).rejects.toThrow("no source for original font f9");
    store.setOriginalSource((ref) => `/api/fonts/${ref}`);
    const m = await store.load(orig);
    expect(fetchMock).toHaveBeenCalledWith("/api/fonts/f9");
    expect(store.peek(orig)).toBe(m);
    expect(covers(m, "Halo Ж")).toBe(true);
    expect(covers(m, "漢")).toBe(false);
    store.setOriginalSource(null); // another document: its fonts are gone
    expect(store.peek(orig)).toBeNull();
  });

  it("rejects bytes fontkit cannot parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })));
    const store = new FontStore("/fonts");
    store.setOriginalSource((ref) => `/api/fonts/${ref}`);
    await expect(store.load({ kind: "original", ref: "f1" })).rejects.toThrow();
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL (`covers` not exported).

- [ ] **Step 4: `fonts.ts` with FontRef**

`apps/web/src/lib/fonts.ts` (replace the file):
```ts
import * as fontkit from "fontkit";
import type { BundledFont, FontRef, OriginalFont } from "@edith/ops";

export interface FontMetrics {
  unitsPerEm: number; ascent: number; descent: number;
  advance(ch: string): number;
  /** Whether the font maps code point `cp` to a glyph (its cmap). Test doubles may omit it (= every glyph). */
  hasGlyph?(cp: number): boolean;
}

export function metricsFromBuffer(buf: ArrayBuffer | Uint8Array): FontMetrics {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const font = fontkit.create(bytes as Buffer) as unknown as fontkit.Font;
  if (typeof font.glyphsForString !== "function") throw new Error("font collection, not a font");
  const cache = new Map<string, number>();
  return {
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: Math.abs(font.descent),
    advance(ch: string) {
      let w = cache.get(ch);
      if (w === undefined) {
        w = font.glyphsForString(ch).reduce((sum, g) => sum + g.advanceWidth, 0);
        cache.set(ch, w);
      }
      return w;
    },
    hasGlyph: (cp: number) => font.hasGlyphForCodePoint(cp),
  };
}

/** True when `m` has a glyph for every character of `text`. */
export function covers(m: FontMetrics, text: string): boolean {
  if (!m.hasGlyph) return true;
  for (const ch of text) if (!m.hasGlyph(ch.codePointAt(0)!)) return false;
  return true;
}

/** Glyph advance in thousandths of an em, truncated — exactly what PyMuPDF writes into the PDF /W array. */
function milliEm(ch: string, m: FontMetrics): number {
  return Math.floor((m.advance(ch) * 1000) / m.unitsPerEm);
}

export function textWidth(text: string, m: FontMetrics, size: number): number {
  let milli = 0;
  for (const ch of text) milli += milliEm(ch, m);
  return (milli / 1000) * size;
}

export function charOffsets(text: string, m: FontMetrics, size: number): number[] {
  const out: number[] = [];
  let milli = 0;
  for (const ch of text) {
    out.push((milli / 1000) * size);
    milli += milliEm(ch, m);
  }
  return out;
}

export type Style = "regular" | "bold" | "italic" | "bolditalic";

export function isOriginal(f: FontRef): f is OriginalFont {
  return f.kind === "original";
}

function style(f: BundledFont): Style {
  if (f.bold && f.italic) return "bolditalic";
  if (f.bold) return "bold";
  if (f.italic) return "italic";
  return "regular";
}

/** Styles to try when a family lacks the requested one — same order as the API's FontRegistry.path. */
const STYLE_FALLBACK: Record<Style, Style[]> = {
  regular: ["regular"],
  bold: ["bold", "regular"],
  italic: ["italic", "regular"],
  bolditalic: ["bolditalic", "bold", "italic", "regular"],
};

export function pickFile(files: Partial<Record<Style, string>>, wanted: Style): string {
  for (const s of STYLE_FALLBACK[wanted]) if (files[s]) return files[s]!;
  throw new Error("font family has no regular style");
}

export function fontKey(f: FontRef): string {
  if (isOriginal(f)) return `orig-${f.ref}`;
  const s = style(f);
  return `${f.family}-${s === "bolditalic" ? "bold-italic" : s}`;
}

export function cssFamily(f: FontRef): string {
  return `edith-${fontKey(f)}`;
}

interface Manifest { default: string; families: Record<string, { category: string; files: Partial<Record<Style, string>> }> }

export class FontStore {
  private manifest?: Promise<Manifest>;
  private loaded = new Map<string, FontMetrics>();
  private pending = new Map<string, Promise<FontMetrics>>();
  private originalUrl: ((ref: string) => string) | null = null;

  constructor(private baseUrl = "/fonts") {}

  /** Where original (embedded) fonts of the open document come from; forgets the previous document's. */
  setOriginalSource(url: ((ref: string) => string) | null): void {
    this.originalUrl = url;
    for (const key of [...this.loaded.keys(), ...this.pending.keys()]) {
      if (key.startsWith("orig-")) { this.loaded.delete(key); this.pending.delete(key); }
    }
  }

  private getManifest(): Promise<Manifest> {
    if (!this.manifest) {
      const url = `${this.baseUrl}/manifest.json`;
      const p = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`font fetch failed: ${url} (${r.status})`);
        return r.json() as Promise<Manifest>;
      });
      this.manifest = p;
      p.catch(() => { if (this.manifest === p) this.manifest = undefined; });
    }
    return this.manifest;
  }

  async families(): Promise<string[]> {
    return Object.keys((await this.getManifest()).families);
  }

  private async url(f: FontRef): Promise<string> {
    if (isOriginal(f)) {
      if (!this.originalUrl) throw new Error(`no source for original font ${f.ref}`);
      return this.originalUrl(f.ref);
    }
    const fam = (await this.getManifest()).families[f.family];
    if (!fam) throw new Error(`unknown font family ${f.family}`);
    return `${this.baseUrl}/${pickFile(fam.files, style(f))}`;
  }

  load(f: FontRef): Promise<FontMetrics> {
    const key = fontKey(f);
    const done = this.loaded.get(key);
    if (done) return Promise.resolve(done);
    let p = this.pending.get(key);
    if (!p) {
      p = (async () => {
        const url = await this.url(f);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`font fetch failed: ${url} (${res.status})`);
        const buf = await res.arrayBuffer();
        const metrics = metricsFromBuffer(buf);
        if (typeof document !== "undefined") {
          const face = new FontFace(cssFamily(f), buf);
          await face.load();
          document.fonts.add(face);
        }
        // Not stored when setOriginalSource() dropped this load meanwhile (another document).
        if (this.pending.get(key) === p) this.loaded.set(key, metrics);
        return metrics;
      })();
      const settled = p;
      this.pending.set(key, settled);
      settled.then(
        () => { if (this.pending.get(key) === settled) this.pending.delete(key); },
        () => { if (this.pending.get(key) === settled) this.pending.delete(key); },
      );
    }
    return p;
  }

  /** Metrics of a loaded font, or null. */
  peek(f: FontRef): FontMetrics | null {
    return this.loaded.get(fontKey(f)) ?? null;
  }

  get(f: FontRef): FontMetrics {
    const m = this.peek(f);
    if (!m) throw new Error(`font not loaded: ${fontKey(f)}`);
    return m;
  }
}

export const fontStore = new FontStore();
```

- [ ] **Step 5: Adopt FontRef in the M1 text code**

`apps/web/src/lib/layout.ts`: import `FontRef` instead of `BundledFont` (`import type { FontRef, LayoutLine, Run, Segment } from "@edith/ops";`) and change the signature to `export function layoutText(input: LayoutInput, metricsFor: (f: FontRef) => FontMetrics): LayoutResult {`.

`apps/web/src/lib/textbox.ts`:
- Imports become:
```ts
import type { FontRef, Run, TextBox } from "@edith/ops";
import type { FontMetrics } from "@/lib/fonts";
import { fontKey, isOriginal } from "@/lib/fonts";
import { layoutText } from "@/lib/layout";
```
- Replace `withStyle` with (Task 11 replaces it again with the font-table aware version):
```ts
/** `font` with the family/bold/italic of `patch` applied; an original font becomes a bundled one only when the patch touches those. */
function restyle(font: FontRef, patch: Partial<TextStyle>): FontRef {
  if (patch.family === undefined && patch.bold === undefined && patch.italic === undefined) return font;
  const base = isOriginal(font) ? { family: patch.family ?? "Arimo", bold: false, italic: false } : font;
  return { kind: "bundled", family: patch.family ?? base.family, bold: patch.bold ?? base.bold ?? false, italic: patch.italic ?? base.italic ?? false };
}

export function withStyle(box: TextBox, patch: Partial<TextStyle>): TextBox {
  const paragraphs = box.paragraphs.map((p) => p.map((r) => ({
    ...r,
    size: patch.size ?? r.size,
    color: patch.color ?? r.color,
    font: restyle(r.font, patch),
  })));
  return {
    ...box,
    paragraphs,
    align: patch.align ?? box.align,
    lineHeight: patch.size !== undefined ? lineHeightFor(patch.size) : box.lineHeight,
  };
}
```
- `relayout(box: TextBox, metricsFor: (f: FontRef) => FontMetrics): TextBox` and
```ts
export function boxFonts(box: TextBox): FontRef[] {
  const seen = new Map<string, FontRef>();
  for (const r of box.paragraphs.flat()) seen.set(fontKey(r.font), r.font);
  return [...seen.values()];
}
```

`apps/web/src/lib/textbox.test.ts`: in "applies style to all runs and updates line height" use
`expect(b.paragraphs.flat().every((r) => r.size === 20 && r.font.kind !== "original" && r.font.bold)).toBe(true);`

`apps/web/src/components/editor/text/TextProps.tsx`: import `isOriginal` (`import { fontStore, isOriginal } from "@/lib/fonts";`) and replace the `cur` computation with:
```ts
  const font = run && !isOriginal(run.font) ? run.font : null;
  const cur: TextStyle = run && box
    ? { family: font?.family ?? style.fontFamily, bold: font?.bold ?? false, italic: font?.italic ?? false, size: run.size, color: run.color, align: box.align ?? "left" }
    : { family: style.fontFamily, bold: style.bold, italic: style.italic, size: style.fontSize, color: style.color, align: style.align };
```

`apps/web/src/components/editor/text/textEdit.ts`: import `TextAdd, TextBox` only (drop `BundledFont`) and make `fontsReady` use the non-throwing lookup:
```ts
export function fontsReady(box: TextBox): boolean {
  return boxFonts(box).every((f) => fontStore.peek(f) !== null);
}
```

`apps/web/src/components/editor/text/textEdit.test.ts`: in `beforeEach`, next to the `get` spy, add
`vi.spyOn(fontStore, "peek").mockImplementation(() => (fontsLoaded ? arimo : null));`

- [ ] **Step 6: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run check -w packages/ops && (cd apps/api && uv run pytest -q)`
Expected: all pass; `npm run check -w packages/ops` shows no diff.

- [ ] **Step 7: Commit**

```bash
git add apps/api/edith/ops.py apps/api/tests/test_ops.py packages/ops apps/web/src
git commit -m "feat(ops): original fonts, rich runs and text.edit in the schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
