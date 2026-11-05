# Task 11: Font metrics loader + text layout engine

**Files:**
- Create: `apps/web/src/lib/fonts.ts`, `apps/web/src/lib/fonts.test.ts`, `apps/web/src/lib/layout.ts`, `apps/web/src/lib/layout.test.ts`
- Modify: `apps/web/package.json` (add deps `fontkit`, `@edith/ops`)

**Interfaces:**
- Consumes: `@edith/ops` types `BundledFont`, `Run`, `LayoutLine`, `Segment` (Task 3); `/fonts/manifest.json` + TTFs (Task 2).
- Produces:
```ts
// fonts.ts
export interface FontMetrics { unitsPerEm: number; ascent: number; descent: number; advance(ch: string): number } // font units; descent positive
export function metricsFromBuffer(buf: ArrayBuffer | Uint8Array): FontMetrics;
export function textWidth(text: string, m: FontMetrics, size: number): number;      // pt, sum of advances, no kerning
export function charOffsets(text: string, m: FontMetrics, size: number): number[];   // x offset of each char from segment start
export function fontKey(f: BundledFont): string;                                     // e.g. "Arimo-bold-italic"
export function cssFamily(f: BundledFont): string;                                   // "edith-Arimo-bold-italic"
export class FontStore {
  constructor(baseUrl?: string);              // default "/fonts"
  families(): Promise<string[]>;
  load(f: BundledFont): Promise<FontMetrics>; // fetches TTF, builds metrics, registers FontFace(cssFamily) when `document` exists
  get(f: BundledFont): FontMetrics;           // throws if not loaded
}
export const fontStore: FontStore;
// layout.ts
export interface LayoutInput { width: number; align: "left" | "center" | "right" | "justify"; lineHeight: number; paragraphs: Run[][] }
export interface LayoutResult { lines: LayoutLine[]; height: number; contentWidth: number }
export function layoutText(input: LayoutInput, metricsFor: (f: BundledFont) => FontMetrics): LayoutResult;
```
Layout rules (must match spec + Task 8 server):
- Segment `x` relative to box left, line `baseline` relative to box top. `runIndex` indexes `paragraphs.flat()`.
- Greedy wrap at whitespace; words wider than `width` are broken by character. Spaces at a wrap point are dropped; trailing spaces don't count for alignment.
- First line baseline = max ascent (pt) of runs on that line; each next line baseline = previous + `lineHeight` (paragraph breaks too). Empty paragraph = one empty line (uses its first run size).
- `height` = last baseline + max descent of last line. `contentWidth` = widest line width.
- `justify` spreads extra space evenly across spaces on every line except a paragraph's last line; justified lines emit one segment per word.
- No kerning, no ligatures: width = Σ advance(char) / unitsPerEm × size.

- [ ] **Step 1: Dependencies**

Run:
```bash
npm install -w apps/web fontkit@^2 @edith/ops@*
npm install -w apps/web -D @types/fontkit
```
If `@types/fontkit` does not exist, create `apps/web/src/types/fontkit.d.ts`:
```ts
declare module "fontkit" {
  export interface Glyph { advanceWidth: number }
  export interface Font { unitsPerEm: number; ascent: number; descent: number; glyphsForString(s: string): Glyph[] }
  export function create(buffer: Uint8Array | Buffer): Font;
}
```

- [ ] **Step 2: Failing font tests**

`apps/web/src/lib/fonts.test.ts`:
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { charOffsets, cssFamily, fontKey, metricsFromBuffer, textWidth } from "@/lib/fonts";

const ttf = (name: string) => readFileSync(path.resolve(__dirname, "../../../../packages/fonts/files", name));

describe("fonts", () => {
  const arimo = metricsFromBuffer(ttf("Arimo-Regular.ttf"));

  it("reads metrics", () => {
    expect(arimo.unitsPerEm).toBe(2048);
    expect(arimo.ascent).toBeGreaterThan(0);
    expect(arimo.descent).toBeGreaterThan(0);
  });

  it("measures without kerning (matches PyMuPDF TextWriter)", () => {
    expect(textWidth("A", arimo, 20)).toBeCloseTo(13.33984375, 5);
    expect(textWidth("AV", arimo, 20)).toBeCloseTo(textWidth("A", arimo, 20) + textWidth("V", arimo, 20), 6);
  });

  it("char offsets accumulate", () => {
    const o = charOffsets("AVA", arimo, 10);
    expect(o[0]).toBe(0);
    expect(o[2]).toBeCloseTo(textWidth("AV", arimo, 10));
  });

  it("keys", () => {
    const f = { kind: "bundled" as const, family: "Tinos", bold: true, italic: false };
    expect(fontKey(f)).toBe("Tinos-bold");
    expect(cssFamily({ ...f, bold: false })).toBe("edith-Tinos-regular");
  });
});
```

Note: the expected `13.33984375` is Arimo's `A` advance (1366/2048 × 20). If the downloaded font version differs, replace it with `pymupdf.Font(fontfile=...).text_length("A", 20)` printed from Python, and keep both sides equal.

Run: `npm test -w apps/web` → Expected: FAIL.

- [ ] **Step 3: fonts.ts**

`apps/web/src/lib/fonts.ts`:
```ts
import * as fontkit from "fontkit";
import type { BundledFont } from "@edith/ops";

export interface FontMetrics { unitsPerEm: number; ascent: number; descent: number; advance(ch: string): number }

export function metricsFromBuffer(buf: ArrayBuffer | Uint8Array): FontMetrics {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const font = fontkit.create(bytes as Buffer) as unknown as fontkit.Font;
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
  };
}

export function textWidth(text: string, m: FontMetrics, size: number): number {
  let units = 0;
  for (const ch of text) units += m.advance(ch);
  return (units / m.unitsPerEm) * size;
}

export function charOffsets(text: string, m: FontMetrics, size: number): number[] {
  const out: number[] = [];
  let units = 0;
  for (const ch of text) {
    out.push((units / m.unitsPerEm) * size);
    units += m.advance(ch);
  }
  return out;
}

function style(f: BundledFont): "regular" | "bold" | "italic" | "bolditalic" {
  if (f.bold && f.italic) return "bolditalic";
  if (f.bold) return "bold";
  if (f.italic) return "italic";
  return "regular";
}

export function fontKey(f: BundledFont): string {
  const s = style(f);
  return `${f.family}-${s === "bolditalic" ? "bold-italic" : s}`;
}

export function cssFamily(f: BundledFont): string {
  return `edith-${fontKey(f)}`;
}

interface Manifest { default: string; families: Record<string, { category: string; files: Record<string, string> }> }

export class FontStore {
  private manifest?: Promise<Manifest>;
  private loaded = new Map<string, FontMetrics>();
  private pending = new Map<string, Promise<FontMetrics>>();

  constructor(private baseUrl = "/fonts") {}

  private getManifest(): Promise<Manifest> {
    this.manifest ??= fetch(`${this.baseUrl}/manifest.json`).then((r) => r.json());
    return this.manifest;
  }

  async families(): Promise<string[]> {
    return Object.keys((await this.getManifest()).families);
  }

  load(f: BundledFont): Promise<FontMetrics> {
    const key = fontKey(f);
    const done = this.loaded.get(key);
    if (done) return Promise.resolve(done);
    let p = this.pending.get(key);
    if (!p) {
      p = (async () => {
        const manifest = await this.getManifest();
        const fam = manifest.families[f.family];
        if (!fam) throw new Error(`unknown font family ${f.family}`);
        const url = `${this.baseUrl}/${fam.files[style(f)]}`;
        const buf = await (await fetch(url)).arrayBuffer();
        const metrics = metricsFromBuffer(buf);
        if (typeof document !== "undefined") {
          const face = new FontFace(cssFamily(f), buf);
          await face.load();
          document.fonts.add(face);
        }
        this.loaded.set(key, metrics);
        return metrics;
      })();
      this.pending.set(key, p);
    }
    return p;
  }

  get(f: BundledFont): FontMetrics {
    const m = this.loaded.get(fontKey(f));
    if (!m) throw new Error(`font not loaded: ${fontKey(f)}`);
    return m;
  }
}

export const fontStore = new FontStore();
```

Run: `npm test -w apps/web` → Expected: fonts tests PASS.

- [ ] **Step 4: Failing layout tests**

`apps/web/src/lib/layout.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Run } from "@edith/ops";
import type { FontMetrics } from "@/lib/fonts";
import { layoutText } from "@/lib/layout";

// Every char is 1 em wide → width = chars × size. Ascent 0.8 em, descent 0.2 em.
const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
const metrics = () => mono;
const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const run = (text: string, size = 10): Run => ({ text, font, size, color: "#000000" });
const texts = (r: ReturnType<typeof layoutText>) => r.lines.map((l) => l.segments.map((s) => s.text).join("|"));

describe("layoutText", () => {
  it("wraps greedily and drops wrap spaces", () => {
    const r = layoutText({ width: 55, align: "left", lineHeight: 12, paragraphs: [[run("aa bb cc")]] }, metrics);
    expect(texts(r)).toEqual(["aa bb", "cc"]);
    expect(r.lines.map((l) => l.baseline)).toEqual([8, 20]);
    expect(r.height).toBeCloseTo(22);
    expect(r.contentWidth).toBe(50);
  });

  it("aligns right and center using width without trailing space", () => {
    const right = layoutText({ width: 100, align: "right", lineHeight: 12, paragraphs: [[run("ab ")]] }, metrics);
    expect(right.lines[0].segments[0].x).toBe(80);
    const center = layoutText({ width: 100, align: "center", lineHeight: 12, paragraphs: [[run("ab")]] }, metrics);
    expect(center.lines[0].segments[0].x).toBe(40);
  });

  it("justifies all but the last line, one segment per word", () => {
    const r = layoutText({ width: 60, align: "justify", lineHeight: 12, paragraphs: [[run("aa bb cc")]] }, metrics);
    expect(r.lines[0].segments).toEqual([
      { x: 0, text: "aa", runIndex: 0 },
      { x: 40, text: "bb", runIndex: 0 },
    ]);
    expect(r.lines[1].segments).toEqual([{ x: 0, text: "cc", runIndex: 0 }]);
  });

  it("breaks long words by character", () => {
    const r = layoutText({ width: 35, align: "left", lineHeight: 12, paragraphs: [[run("abcdefgh")]] }, metrics);
    expect(texts(r)).toEqual(["abc", "def", "gh"]);
  });

  it("keeps run indexes across runs and paragraphs", () => {
    const r = layoutText({ width: 1000, align: "left", lineHeight: 12, paragraphs: [[run("ab"), run("cd ef")], [run("gh")]] }, metrics);
    expect(r.lines[0].segments).toEqual([
      { x: 0, text: "ab", runIndex: 0 },
      { x: 20, text: "cd ef", runIndex: 1 },
    ]);
    expect(r.lines[1].segments).toEqual([{ x: 0, text: "gh", runIndex: 2 }]);
  });

  it("uses the largest ascent on the first line", () => {
    const r = layoutText({ width: 1000, align: "left", lineHeight: 30, paragraphs: [[run("a", 10), run("B", 20)]] }, metrics);
    expect(r.lines[0].baseline).toBe(16);
  });

  it("empty paragraph makes an empty line", () => {
    const r = layoutText({ width: 100, align: "left", lineHeight: 12, paragraphs: [[run("a")], [run("")], [run("b")]] }, metrics);
    expect(r.lines.length).toBe(3);
    expect(r.lines[1].segments).toEqual([]);
    expect(r.lines[2].baseline).toBe(32);
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL (layout missing).

- [ ] **Step 5: layout.ts**

`apps/web/src/lib/layout.ts`:
```ts
import type { BundledFont, LayoutLine, Run, Segment } from "@edith/ops";
import { textWidth, type FontMetrics } from "@/lib/fonts";

export interface LayoutInput { width: number; align: "left" | "center" | "right" | "justify"; lineHeight: number; paragraphs: Run[][] }
export interface LayoutResult { lines: LayoutLine[]; height: number; contentWidth: number }

interface Token { text: string; runIndex: number; width: number; space: boolean }

export function layoutText(input: LayoutInput, metricsFor: (f: BundledFont) => FontMetrics): LayoutResult {
  const flat = input.paragraphs.flat();
  const ascentOf = (i: number) => { const r = flat[i]; const m = metricsFor(r.font); return (m.ascent / m.unitsPerEm) * r.size; };
  const descentOf = (i: number) => { const r = flat[i]; const m = metricsFor(r.font); return (m.descent / m.unitsPerEm) * r.size; };
  const measure = (text: string, i: number) => textWidth(text, metricsFor(flat[i].font), flat[i].size);

  const lines: LayoutLine[] = [];
  let baseline = 0;
  let lastDescent = 0;
  let contentWidth = 0;
  let runOffset = 0;

  for (const paragraph of input.paragraphs) {
    const tokens: Token[] = [];
    paragraph.forEach((r, k) => {
      const runIndex = runOffset + k;
      for (const m of r.text.matchAll(/\s+|[^\s]+/g)) {
        const text = m[0];
        const space = /^\s+$/.test(text);
        const width = measure(text, runIndex);
        if (!space && width > input.width) {
          let chunk = "";
          for (const ch of text) {
            if (chunk && measure(chunk + ch, runIndex) > input.width) {
              tokens.push({ text: chunk, runIndex, width: measure(chunk, runIndex), space: false });
              chunk = "";
            }
            chunk += ch;
          }
          if (chunk) tokens.push({ text: chunk, runIndex, width: measure(chunk, runIndex), space: false });
        } else {
          tokens.push({ text, runIndex, width, space });
        }
      }
    });
    const emptyRunIndex = runOffset;
    runOffset += paragraph.length;

    // Greedy line breaking.
    const rawLines: Token[][] = [];
    let current: Token[] = [];
    let currentWidth = 0;
    for (const t of tokens) {
      if (t.space) {
        if (current.length === 0) continue; // drop spaces at line start
        current.push(t);
        currentWidth += t.width;
        continue;
      }
      // Break when the line already holds a word and this word (plus the spaces before it) overflows.
      if (current.length > 0 && currentWidth - trailingSpaceWidth(current) > 0 && currentWidth + t.width > input.width) {
        rawLines.push(trimEnd(current));
        current = [];
        currentWidth = 0;
      }
      current.push(t);
      currentWidth += t.width;
    }
    rawLines.push(trimEnd(current));

    rawLines.forEach((lineTokens, li) => {
      const isLast = li === rawLines.length - 1;
      const runIdxs = lineTokens.length ? lineTokens.map((t) => t.runIndex) : [emptyRunIndex];
      const ascent = Math.max(...runIdxs.map(ascentOf));
      baseline = lines.length === 0 ? ascent : baseline + input.lineHeight;
      lastDescent = Math.max(...runIdxs.map(descentOf));
      const lineWidth = lineTokens.reduce((s, t) => s + t.width, 0);
      contentWidth = Math.max(contentWidth, lineWidth);
      lines.push({ baseline, segments: placeSegments(lineTokens, lineWidth, input, isLast) });
    });
  }

  return { lines, height: baseline + lastDescent, contentWidth };
}

function trailingSpaceWidth(tokens: Token[]): number {
  let w = 0;
  for (let i = tokens.length - 1; i >= 0 && tokens[i].space; i--) w += tokens[i].width;
  return w;
}

function trimEnd(tokens: Token[]): Token[] {
  let end = tokens.length;
  while (end > 0 && tokens[end - 1].space) end--;
  return tokens.slice(0, end);
}

function placeSegments(tokens: Token[], lineWidth: number, input: LayoutInput, isLastLine: boolean): Segment[] {
  const spaces = tokens.filter((t) => t.space).length;
  if (input.align === "justify" && !isLastLine && spaces > 0) {
    const extra = (input.width - lineWidth) / spaces;
    const segs: Segment[] = [];
    let x = 0;
    for (const t of tokens) {
      if (t.space) { x += t.width + extra; continue; }
      segs.push({ x, text: t.text, runIndex: t.runIndex });
      x += t.width;
    }
    return segs;
  }
  let x = 0;
  if (input.align === "right") x = input.width - lineWidth;
  else if (input.align === "center") x = (input.width - lineWidth) / 2;
  const segs: Segment[] = [];
  for (const t of tokens) {
    const last = segs[segs.length - 1];
    if (last && last.runIndex === t.runIndex) last.text += t.text;
    else segs.push({ x, text: t.text, runIndex: t.runIndex });
    x += t.width;
  }
  return segs;
}
```

Run: `npm test -w apps/web` → Expected: all PASS. Then `npx tsc --noEmit -p apps/web` → no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "feat(web): add font metrics loader and text layout engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
