# Task 11: Web — rich text model (run attrs, style patches, editor JSON)

**Files:**
- Create: `apps/web/src/lib/richtext.ts`, `apps/web/src/lib/richtext.test.ts`
- Modify: `apps/web/src/lib/textbox.ts` (`withStyle` on top of `applyPatch`), `apps/web/src/lib/textbox.test.ts`

**Interfaces:**
- Consumes: Task 8 `DocFont`, `normalizeRuns`; Task 2 `cssFamily`, `isOriginal`.
- Produces (`lib/richtext.ts`):
  ```ts
  export type FontTable = Record<string, DocFont>;
  export interface RunAttrs { font: FontRef; size: number; color: string; bgColor: string | null; underline: boolean; strike: boolean }
  export interface StylePatch { family?: string; bold?: boolean; italic?: boolean; size?: number; color?: string; bgColor?: string | null; underline?: boolean; strike?: boolean }
  export function attrsOf(r: Run): RunAttrs
  export function runOf(text: string, a: RunAttrs): Run                       // omits default bgColor/underline/strike
  export function fontStyle(f: FontRef, fonts: FontTable): { family: string; bold: boolean; italic: boolean; original: string | null }
  export function patchFont(f: FontRef, patch: StylePatch, fonts: FontTable): FontRef
  export function applyPatch(a: RunAttrs, p: StylePatch, fonts: FontTable): RunAttrs
  export function runCss(a: RunAttrs): string                                  // inline CSS for the editor span
  export interface RichMark { type: string; attrs?: Record<string, unknown> }
  export interface RichNode { type: string; text?: string; marks?: RichMark[]; content?: RichNode[] }
  export function runsToDoc(paragraphs: Run[][]): RichNode                     // doc → paragraph → text + one "run" mark
  export function docToRuns(doc: RichNode, fallback: RunAttrs): Run[][]
  ```
  `patchFont`: family/bold/italic changes only; an original font stays original when the document has a reusable font of the same `family` key with the wanted bold/italic, else becomes `{kind:"bundled", family: substitute family (or the patch's family), bold, italic}`. `runCss` sizes text with `calc(var(--edith-scale, 1) * <size>px)`. `docToRuns` gives unmarked text (typed into an empty box, pasted) the previous text's style, else `fallback`; an empty paragraph keeps one empty run.
- Produces (`lib/textbox.ts`): `export type BoxPatch = StylePatch & { align?: TextBox["align"] }; export function withStyle(box: TextBox, patch: BoxPatch, fonts: FontTable = {}): TextBox` (replaces Task 2's interim version; a size change still resets the line height to 1.2 × size).

- [ ] **Step 1: Failing tests**

`apps/web/src/lib/richtext.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { applyPatch, attrsOf, docToRuns, fontStyle, patchFont, runCss, runOf, runsToDoc } from "@/lib/richtext";

const arimo = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const r = (text: string, extra: Partial<Run> = {}): Run => ({ text, font: arimo, size: 12, color: "#111111", ...extra });
const doc = (ref: string, name: string, bold: boolean, reusable = true): DocFont => ({
  ref, name, embedded: true, format: "ttf", reusable, family: "calibri", bold, italic: false,
  substitute: { kind: "bundled", family: "Carlito", bold, italic: false },
});
const fonts = { f1: doc("f1", "Calibri", false), f2: doc("f2", "Calibri-Bold", true) };

describe("rich text model", () => {
  it("round-trips runs through the editor JSON", () => {
    const paragraphs = [[r("Halo "), r("tebal", { font: { ...arimo, bold: true }, underline: true })], [r("akhir", { bgColor: "#ffff00" })]];
    expect(docToRuns(runsToDoc(paragraphs), attrsOf(r("")))).toEqual(paragraphs);
  });

  it("gives an empty paragraph the style of the text before it", () => {
    const red = r("merah", { color: "#ff0000" });
    expect(docToRuns(runsToDoc([[red], [r("")]]), attrsOf(r(""))))
      .toEqual([[red], [r("", { color: "#ff0000" })]]);
  });

  it("gives unmarked text the previous style or the fallback", () => {
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "tempel" }] }] };
    expect(docToRuns(json, attrsOf(r("", { color: "#ff0000" })))).toEqual([[r("tempel", { color: "#ff0000" })]]);
    expect(docToRuns({ type: "doc" }, attrsOf(r("")))).toEqual([[r("")]]);
  });

  it("keeps the previous font when a pasted mark has none", () => {
    const json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "run", attrs: { font: null, size: 20 } }] }] }] };
    expect(docToRuns(json, attrsOf(r("")))[0][0]).toEqual(r("x", { size: 20 }));
  });

  it("leaves default decoration fields out", () => {
    expect(runOf("x", attrsOf(r("")))).toEqual(r("x"));
  });

  it("toggles bold on a bundled font", () => {
    expect(patchFont(arimo, { bold: true }, {})).toEqual({ ...arimo, bold: true });
    expect(patchFont(arimo, { size: 3 }, {})).toBe(arimo);
  });

  it("keeps an original font when the document has the variant, else uses the substitute", () => {
    expect(patchFont({ kind: "original", ref: "f1" }, { bold: true }, fonts)).toEqual({ kind: "original", ref: "f2" });
    expect(patchFont({ kind: "original", ref: "f1" }, { italic: true }, fonts)).toEqual({ kind: "bundled", family: "Carlito", bold: false, italic: true });
    expect(patchFont({ kind: "original", ref: "f1" }, { family: "Lora" }, fonts)).toEqual({ kind: "bundled", family: "Lora", bold: false, italic: false });
    expect(fontStyle({ kind: "original", ref: "f2" }, fonts)).toEqual({ family: "Carlito", bold: true, italic: false, original: "f2" });
  });

  it("applies a patch", () => {
    const a = applyPatch(attrsOf(r("")), { size: 20, bgColor: "#00ff00", strike: true }, {});
    expect(a).toMatchObject({ size: 20, bgColor: "#00ff00", strike: true, underline: false, color: "#111111" });
    expect(applyPatch(a, { bgColor: null }, {}).bgColor).toBeNull();
  });

  it("builds editor CSS", () => {
    const css = runCss(attrsOf(r("", { underline: true, strike: true, bgColor: "#ffff00" })));
    expect(css).toContain('font-family:"edith-Arimo-regular"');
    expect(css).toContain("font-size:calc(var(--edith-scale, 1) * 12px)");
    expect(css).toContain("text-decoration-line:underline line-through");
    expect(css).toContain("background-color:#ffff00");
  });
});
```

In `apps/web/src/lib/textbox.test.ts` add `import type { DocFont } from "@/lib/api";` above the `FontMetrics` import and append:
```ts

describe("withStyle with original fonts", () => {
  const calibri = (ref: string, bold: boolean): DocFont => ({
    ref, name: bold ? "Calibri-Bold" : "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold, italic: false,
    substitute: { kind: "bundled", family: "Carlito", bold, italic: false },
  });
  const fonts = { f1: calibri("f1", false), f2: calibri("f2", true) };
  const box = { ...newBox([0, 0], style), paragraphs: [[{ text: "x", font: { kind: "original" as const, ref: "f1" }, size: 10, color: "#111111" }]] };

  it("switches to the document's bold variant and keeps the font for other changes", () => {
    expect(withStyle(box, { bold: true }, fonts).paragraphs[0][0].font).toEqual({ kind: "original", ref: "f2" });
    expect(withStyle(box, { underline: true, bgColor: "#ffff00" }, fonts).paragraphs[0][0])
      .toEqual({ text: "x", font: { kind: "original", ref: "f1" }, size: 10, color: "#111111", underline: true, bgColor: "#ffff00" });
  });
});
```

Run: `npm test -w apps/web`
Expected: FAIL — cannot resolve `@/lib/richtext`.

- [ ] **Step 2: Implement the model**

`apps/web/src/lib/richtext.ts`:
```ts
import type { FontRef, Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { cssFamily, isOriginal } from "@/lib/fonts";
import { normalizeRuns } from "@/lib/runs";

export type FontTable = Record<string, DocFont>;

/** Character style of a run — the attributes of the rich editor's `run` mark. */
export interface RunAttrs { font: FontRef; size: number; color: string; bgColor: string | null; underline: boolean; strike: boolean }
/** A style change from the properties bar; only the given fields change. */
export interface StylePatch {
  family?: string; bold?: boolean; italic?: boolean; size?: number; color?: string;
  bgColor?: string | null; underline?: boolean; strike?: boolean;
}

export function attrsOf(r: Run): RunAttrs {
  return { font: r.font, size: r.size, color: r.color, bgColor: r.bgColor ?? null, underline: !!r.underline, strike: !!r.strike };
}

/** A run with `a`'s style; default decoration fields are left out (as the API's defaults). */
export function runOf(text: string, a: RunAttrs): Run {
  return {
    text, font: a.font, size: a.size, color: a.color,
    ...(a.bgColor ? { bgColor: a.bgColor } : {}),
    ...(a.underline ? { underline: true } : {}),
    ...(a.strike ? { strike: true } : {}),
  };
}

/** Family/bold/italic a font shows as in the properties bar; `original` is the ref of an embedded font. */
export function fontStyle(f: FontRef, fonts: FontTable): { family: string; bold: boolean; italic: boolean; original: string | null } {
  if (isOriginal(f)) {
    const info = fonts[f.ref];
    return { family: info?.substitute.family ?? "Arimo", bold: info?.bold ?? false, italic: info?.italic ?? false, original: f.ref };
  }
  return { family: f.family, bold: f.bold ?? false, italic: f.italic ?? false, original: null };
}

/** `f` with a family/bold/italic change. An original font keeps being original when the document
 *  embeds a reusable variant of its family with the wanted style; otherwise it becomes its substitute. */
export function patchFont(f: FontRef, patch: StylePatch, fonts: FontTable): FontRef {
  if (patch.family === undefined && patch.bold === undefined && patch.italic === undefined) return f;
  const cur = fontStyle(f, fonts);
  const bold = patch.bold ?? cur.bold;
  const italic = patch.italic ?? cur.italic;
  if (isOriginal(f) && patch.family === undefined) {
    const info = fonts[f.ref];
    const variant = info && Object.values(fonts).find((x) => x.reusable && x.family === info.family && x.bold === bold && x.italic === italic);
    if (variant) return { kind: "original", ref: variant.ref };
  }
  return { kind: "bundled", family: patch.family ?? cur.family, bold, italic };
}

export function applyPatch(a: RunAttrs, p: StylePatch, fonts: FontTable): RunAttrs {
  return {
    font: patchFont(a.font, p, fonts),
    size: p.size ?? a.size,
    color: p.color ?? a.color,
    bgColor: p.bgColor !== undefined ? p.bgColor : a.bgColor,
    underline: p.underline ?? a.underline,
    strike: p.strike ?? a.strike,
  };
}

/** Inline CSS of a run in the rich editor; sizes scale with the `--edith-scale` variable (zoom). */
export function runCss(a: RunAttrs): string {
  const deco = [a.underline && "underline", a.strike && "line-through"].filter(Boolean).join(" ") || "none";
  return [
    `font-family:"${cssFamily(a.font)}"`,
    `font-size:calc(var(--edith-scale, 1) * ${a.size}px)`,
    `color:${a.color}`,
    a.bgColor ? `background-color:${a.bgColor}` : "",
    `text-decoration-line:${deco}`,
  ].filter(Boolean).join(";");
}

/** Tiptap/ProseMirror JSON as used by the rich editor: doc → paragraph → text with one `run` mark. */
export interface RichMark { type: string; attrs?: Record<string, unknown> }
export interface RichNode { type: string; text?: string; marks?: RichMark[]; content?: RichNode[] }

export function runsToDoc(paragraphs: Run[][]): RichNode {
  return {
    type: "doc",
    content: paragraphs.map((p) => {
      const content = p.filter((r) => r.text).map((r) => ({ type: "text", text: r.text, marks: [{ type: "run", attrs: { ...attrsOf(r) } }] }));
      return content.length ? { type: "paragraph", content } : { type: "paragraph" };
    }),
  };
}

/** Rich editor JSON → runs. Text without a run mark (typed into an empty box, pasted) takes the
 *  previous text's style, else `fallback`. */
export function docToRuns(doc: RichNode, fallback: RunAttrs): Run[][] {
  let last = fallback;
  const paragraphs = (doc.content ?? []).filter((n) => n.type === "paragraph").map((p) => {
    const runs = (p.content ?? []).filter((n) => n.type === "text" && n.text).map((n) => {
      const mark = n.marks?.find((m) => m.type === "run");
      if (mark?.attrs) {
        const a = mark.attrs as Partial<RunAttrs>;
        last = { ...fallback, ...a, font: a.font ?? last.font }; // a mark parsed from foreign HTML has no font
      }
      return runOf(n.text!, last);
    });
    return normalizeRuns(runs.length ? runs : [runOf("", last)]);
  });
  return paragraphs.length ? paragraphs : [[runOf("", fallback)]];
}
```

- [ ] **Step 3: `withStyle` on the model**

In `apps/web/src/lib/textbox.ts`:
- Imports become:
```ts
import type { FontRef, Run, TextBox } from "@edith/ops";
import type { FontMetrics } from "@/lib/fonts";
import { fontKey } from "@/lib/fonts";
import { layoutText } from "@/lib/layout";
import { applyPatch, attrsOf, runOf, type FontTable, type StylePatch } from "@/lib/richtext";
```
- Replace `restyle` and `withStyle` (from Task 2) with:
```ts
export type BoxPatch = StylePatch & { align?: TextBox["align"] };

/** `patch` applied to every run (and the box alignment); a size change resets the line height to 1.2 × size. */
export function withStyle(box: TextBox, patch: BoxPatch, fonts: FontTable = {}): TextBox {
  const paragraphs = box.paragraphs.map((p) => p.map((r) => runOf(r.text, applyPatch(attrsOf(r), patch, fonts))));
  return {
    ...box,
    paragraphs,
    align: patch.align ?? box.align,
    lineHeight: patch.size !== undefined ? lineHeightFor(patch.size) : box.lineHeight,
  };
}
```

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: all pass (the M1 `textbox` tests still pass: `TextStyle` patches are valid `BoxPatch`es).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/richtext.ts apps/web/src/lib/richtext.test.ts apps/web/src/lib/textbox.ts apps/web/src/lib/textbox.test.ts
git commit -m "feat(web): rich text run model with original-font aware style patches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
