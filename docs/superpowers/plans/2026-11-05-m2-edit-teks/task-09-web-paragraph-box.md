# Task 9: Web — paragraph → TextBox (original lines kept), font fallback, masks

**Files:**
- Create: `apps/web/src/lib/paragraphs.ts`, `apps/web/src/lib/paragraphs.test.ts`

**Interfaces:**
- Consumes: Task 8 `Paragraph`, `DocFont`, `runsText`, `sliceRuns`, `normalizeRuns`; Task 2 `covers`, `isOriginal`, `textWidth`, `fontStore` (`load`, `peek`); M1 `relayout`, `boxFonts`; Task 5 fixture `apps/web/src/lib/fixtures/text.json`.
- Produces (`lib/paragraphs.ts`):
  ```ts
  export type MetricsFor = (f: FontRef) => FontMetrics;
  export type FontTable = Record<string, DocFont>;
  export const MASK_ASCENT = 0.95, MASK_DESCENT = 0.25;
  export function measureRange(runs: Run[], start: number, end: number, metricsFor: MetricsFor, trimEnd = true): number
  export function paragraphWidth(p: Paragraph, metricsFor: MetricsFor): number    // max(rect.w, widest original line) + 0.01
  export function hardBreaks(p: Paragraph, width: number, metricsFor: MetricsFor): number[]   // line indexes followed by a non-wrap break
  export function paragraphRuns(p: Paragraph, breaks: number[]): Run[][]          // logical paragraphs (joiners dropped)
  export function rawToBox(p: Paragraph, breaks: number[]): (offset: number) => number   // joined-text offset → box-text offset
  export function paragraphBox(p: Paragraph, metricsFor: MetricsFor, edit?: (paragraphs: Run[][], toBox: (o: number) => number) => Run[][]): TextBox
  export function substituteOf(f: FontRef, fonts: FontTable): BundledFont
  export function resolveRunFonts(runs: Run[], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Run[]
  export function prepareRuns(paragraphs: Run[][], fonts: FontTable, store?: Pick<FontStore, "load" | "peek">): Promise<Run[][]>
  export function maskRects(p: Paragraph): Rect[]
  ```
  `paragraphBox` puts the box at `x = p.rect.x` and shifts `rect.y` so the first laid-out baseline equals `p.lines[0].baseline`; it keeps `p.align` and `p.lineHeight`. `prepareRuns` loads the fonts (original failures tolerated), applies `resolveRunFonts` twice (original → substitute → Arimo) and rejects only when a bundled font fails to load.

- [ ] **Step 1: Failing tests**

`apps/web/src/lib/paragraphs.test.ts`:
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FontRef, Run } from "@edith/ops";
import type { DocFont, Paragraph, TextData } from "@/lib/api";
import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { runsText } from "@/lib/runs";
import { hardBreaks, maskRects, paragraphBox, paragraphRuns, prepareRuns, rawToBox, resolveRunFonts } from "@/lib/paragraphs";

const FONTS = path.resolve(__dirname, "../../../../packages/fonts/files");
const metrics = new Map<string, FontMetrics>();
function bundled(f: FontRef): FontMetrics {
  if (isOriginal(f)) throw new Error("no original fonts in this fixture");
  const style = f.bold && f.italic ? "BoldItalic" : f.bold ? "Bold" : f.italic ? "Italic" : "Regular";
  const key = fontKey(f);
  if (!metrics.has(key)) metrics.set(key, metricsFromBuffer(readFileSync(path.join(FONTS, `${f.family}-${style}.ttf`))));
  return metrics.get(key)!;
}

// GET /documents/{id}/text of apps/api tests.pdfs.make_layout_pdf() (regenerate: cd apps/api && uv run python -m scripts.text_fixture).
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "text.json"), "utf8")) as TextData;
const paragraphs = fixture.pages[0].paragraphs;
const lineTexts = (p: Paragraph) => p.lines.map((l) => p.runs.map((r) => r.text).join("").slice(l.start, l.end));
const laidOut = (box: ReturnType<typeof paragraphBox>) => box.layout.map((l) => l.segments.map((s) => s.text).join(" ").replace(/\s+/g, " "));

describe("paragraphBox", () => {
  it.each(paragraphs.map((p) => [p.id, p.align, p] as const))("keeps the original line breaks of %s (%s)", (_id, _align, p) => {
    const box = paragraphBox(p, bundled);
    expect(laidOut(box)).toEqual(lineTexts(p).map((t) => t.replace(/\s+/g, " ")));
  });

  it.each(paragraphs.map((p) => [p.id, p] as const))("puts every baseline of %s within 0.5 pt of the original", (_id, p) => {
    const box = paragraphBox(p, bundled);
    box.layout.forEach((line, i) => expect(Math.abs(box.rect.y + line.baseline - p.lines[i].baseline)).toBeLessThanOrEqual(0.5));
    expect(box.rect.x).toBe(p.rect.x);
  });

  it("splits hand-broken lines into logical paragraphs", () => {
    const address = paragraphs.find((p) => p.runs[0].text.startsWith("Jl."))!;
    const box = paragraphBox(address, bundled);
    expect(box.paragraphs.map((ps) => ps.map((r) => r.text).join(""))).toEqual(["Jl. Merdeka Barat No. 17, Jakarta Pusat", "Indonesia"]);
  });

  it("keeps wrapped lines in one logical paragraph", () => {
    const p = paragraphs.find((x) => x.align === "justify")!;
    expect(paragraphRuns(p, hardBreaks(p, p.rect.w + 0.01, bundled))).toHaveLength(1);
  });

  it("maps joined-text offsets onto the split paragraphs", () => {
    // "ab-" / "cd" / "ef": the hyphen line has no joining space; every break is hard at width 10.
    const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
    const line = (start: number, end: number) => ({ rect: { x: 0, y: 0, w: 3, h: 1 }, baseline: 1, size: 1, start, end });
    const p: Paragraph = { id: "g0", rect: { x: 0, y: 0, w: 3, h: 3 }, lines: [line(0, 3), line(3, 5), line(6, 8)],
      runs: [{ text: "ab-cd ef", font: { kind: "bundled", family: "Arimo" }, size: 1, color: "#000000" }], align: "left", lineHeight: 1, editable: true };
    const breaks = hardBreaks(p, 10, () => mono);
    expect(breaks).toEqual([0, 1]);
    expect(paragraphRuns(p, breaks).map((ps) => ps[0].text)).toEqual(["ab-", "cd", "ef"]); // box text "ab-\ncd\nef"
    const toBox = rawToBox(p, breaks);
    expect([0, 3, 4, 5, 6, 8].map(toBox)).toEqual([0, 3, 5, 6, 7, 9]);
  });

  it("applies an edit to the logical paragraphs before layout", () => {
    const address = paragraphs.find((p) => p.runs[0].text.startsWith("Jl."))!;
    const raw = runsText(address.runs).indexOf("Indonesia");
    const box = paragraphBox(address, bundled, (ps, toBox) => {
      expect(toBox(raw)).toBe(runsText(ps[0]).length + 1); // start of the second logical paragraph
      return [ps[0], [{ ...ps[1][0], text: "RI" }]];
    });
    expect(box.paragraphs.map((ps) => ps.map((r) => r.text).join(""))).toEqual(["Jl. Merdeka Barat No. 17, Jakarta Pusat", "RI"]);
    expect(box.layout).toHaveLength(3);
  });
});

const ORIG = { kind: "original" as const, ref: "f9" };
const fonts: Record<string, DocFont> = {
  f9: { ref: "f9", name: "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold: false, italic: false,
        substitute: { kind: "bundled", family: "Carlito", bold: false, italic: false } },
};
const run = (text: string): Run => ({ text, font: ORIG, size: 12, color: "#000000" });
const onlyAbc: FontMetrics = { unitsPerEm: 1000, ascent: 800, descent: 200, advance: () => 500, hasGlyph: (cp) => "abc ".includes(String.fromCodePoint(cp)) };

describe("original fonts", () => {
  it("keep a run whose glyphs exist and swap the others for the substitute", () => {
    const out = resolveRunFonts([run("abc"), run("abz")], fonts, () => onlyAbc);
    expect(out[0].font).toEqual(ORIG);
    expect(out[1].font).toEqual({ kind: "bundled", family: "Carlito", bold: false, italic: false });
  });

  it("swap when the font did not load", () => {
    expect(resolveRunFonts([run("a")], fonts, () => null)[0].font).toMatchObject({ family: "Carlito" });
  });

  it("swap a bundled family lacking a glyph for Arimo", () => {
    const lato = { ...run("abz"), font: { kind: "bundled" as const, family: "Lato", bold: true, italic: false } };
    expect(resolveRunFonts([lato], fonts, () => onlyAbc)[0].font).toEqual({ kind: "bundled", family: "Arimo", bold: true, italic: false });
    expect(resolveRunFonts([lato], fonts, () => null)[0]).toBe(lato); // not loaded yet: unchanged
  });

  it("prepareRuns loads originals first and tolerates their failure", async () => {
    const loaded: string[] = [];
    const store = {
      async load(f: FontRef) { if (isOriginal(f)) throw new Error("404"); loaded.push(fontKey(f)); return onlyAbc; },
      peek: (f: FontRef) => (loaded.includes(fontKey(f)) ? onlyAbc : null),
    };
    const out = await prepareRuns([[run("abc")]], fonts, store);
    expect(out[0][0].font).toMatchObject({ kind: "bundled", family: "Carlito" });
    expect(loaded).toContain("Carlito-regular");
  });

  it("prepareRuns falls back twice: original → substitute → Arimo", async () => {
    const store = { load: async () => onlyAbc, peek: () => onlyAbc };
    const out = await prepareRuns([[run("abz")]], fonts, store);
    expect(out[0][0].font).toEqual({ kind: "bundled", family: "Arimo", bold: false, italic: false });
  });
});

describe("maskRects", () => {
  it("covers each line around its baseline", () => {
    const p = paragraphs[0];
    const [m] = maskRects(p);
    expect(m.y).toBeCloseTo(p.lines[0].baseline - 0.95 * p.lines[0].size);
    expect(m.h).toBeCloseTo(1.2 * p.lines[0].size);
  });
});
```

Run: `npm test -w apps/web`
Expected: FAIL — cannot resolve `@/lib/paragraphs`.

- [ ] **Step 2: Implement**

`apps/web/src/lib/paragraphs.ts`:
```ts
import type { BundledFont, FontRef, Rect, Run, TextBox } from "@edith/ops";
import type { DocFont, Paragraph } from "@/lib/api";
import { covers, fontStore, isOriginal, textWidth, type FontMetrics } from "@/lib/fonts";
import { normalizeRuns, runsText, sliceRuns } from "@/lib/runs";
import { boxFonts, relayout } from "@/lib/textbox";

export type MetricsFor = (f: FontRef) => FontMetrics;
export type FontTable = Record<string, DocFont>;
type Loader = Pick<typeof fontStore, "load" | "peek">;

const ARIMO: BundledFont = { kind: "bundled", family: "Arimo", bold: false, italic: false };
/** Extra box width so a line measured at exactly the box width still fits. */
const WIDTH_SLACK = 0.01;
/** On-screen cover of an edited paragraph's original line (× size around the baseline). */
export const MASK_ASCENT = 0.95;
export const MASK_DESCENT = 0.25;

/** Width of characters [start, end) of `runs`; trailing spaces are excluded unless `trimEnd` is false. */
export function measureRange(runs: Run[], start: number, end: number, metricsFor: MetricsFor, trimEnd = true): number {
  const pieces = sliceRuns(runs, start, end);
  while (trimEnd && pieces.length && /\s$/.test(pieces[pieces.length - 1].text)) {
    const last = pieces[pieces.length - 1];
    const text = last.text.replace(/\s+$/, "");
    if (text) pieces[pieces.length - 1] = { ...last, text };
    else pieces.pop();
  }
  return pieces.reduce((w, r) => w + textWidth(r.text, metricsFor(r.font), r.size), 0);
}

/** Box width that holds every original line on one line. */
export function paragraphWidth(p: Paragraph, metricsFor: MetricsFor): number {
  return Math.max(p.rect.w, ...p.lines.map((l) => measureRange(p.runs, l.start, l.end, metricsFor))) + WIDTH_SLACK;
}

/** Indexes of the lines followed by a hard break: the next line's first word would have fit on the
 *  line, so the original break was not a wrap (addresses, poems, short lines). */
export function hardBreaks(p: Paragraph, width: number, metricsFor: MetricsFor): number[] {
  const text = runsText(p.runs);
  const out: number[] = [];
  p.lines.forEach((line, i) => {
    const next = p.lines[i + 1];
    if (!next) return;
    const word = /^\S*/.exec(text.slice(next.start))![0];
    if (measureRange(p.runs, line.start, next.start + word.length, metricsFor) <= width) out.push(i);
  });
  return out;
}

/** The paragraph's runs as logical paragraphs: split at the hard breaks, whose joining characters are dropped. */
export function paragraphRuns(p: Paragraph, breaks: number[]): Run[][] {
  const out: Run[][] = [];
  let from = 0;
  for (const i of breaks) {
    out.push(normalizeRuns(sliceRuns(p.runs, from, p.lines[i].end)));
    from = p.lines[i + 1].start;
  }
  out.push(normalizeRuns(sliceRuns(p.runs, from, runsText(p.runs).length)));
  return out.map((runs) => (runs.length ? runs : [{ ...p.runs[0], text: "" }]));
}

/** Maps an offset in the paragraph's joined text to the box text of paragraphRuns(p, breaks) (paragraphs joined by "\n"). */
export function rawToBox(p: Paragraph, breaks: number[]): (offset: number) => number {
  return (o) => {
    let shift = 0;
    for (const i of breaks) {
      const gapStart = p.lines[i].end, gapEnd = p.lines[i + 1].start;
      if (o <= gapStart) break;
      if (o < gapEnd) return gapStart + shift;
      shift += 1 - (gapEnd - gapStart);
    }
    return o + shift;
  };
}

/** The TextBox that redraws `p` in place: same lines, first baseline on the original one. `edit`
 *  changes the logical paragraphs first (Replace); `toBox` maps offsets of the paragraph's joined text. */
export function paragraphBox(
  p: Paragraph, metricsFor: MetricsFor,
  edit?: (paragraphs: Run[][], toBox: (offset: number) => number) => Run[][],
): TextBox {
  const width = paragraphWidth(p, metricsFor);
  const breaks = hardBreaks(p, width, metricsFor);
  const paragraphs = paragraphRuns(p, breaks);
  const box = relayout({
    rect: { x: p.rect.x, y: 0, w: width, h: 0 }, align: p.align, lineHeight: p.lineHeight,
    paragraphs: edit ? edit(paragraphs, rawToBox(p, breaks)) : paragraphs, layout: [],
  }, metricsFor);
  const first = box.layout[0]?.baseline ?? 0;
  return { ...box, rect: { ...box.rect, y: p.lines[0].baseline - first } };
}

export function substituteOf(f: FontRef, fonts: FontTable): BundledFont {
  return isOriginal(f) ? fonts[f.ref]?.substitute ?? ARIMO : f;
}

/** One step of font fallback: a run whose original font is not loaded or lacks a glyph of its text
 *  switches to the substitute; a run whose loaded bundled family lacks a glyph switches to Arimo
 *  (Latin, Greek, Cyrillic). Runs whose bundled font is not loaded yet stay as they are. */
export function resolveRunFonts(runs: Run[], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Run[] {
  return runs.map((r) => {
    const m = peek(r.font);
    if (m && covers(m, r.text)) return r;
    if (isOriginal(r.font)) return { ...r, font: substituteOf(r.font, fonts) };
    if (m && r.font.family !== ARIMO.family) return { ...r, font: { ...r.font, family: ARIMO.family } };
    return r;
  });
}

const fontsOf = (paragraphs: Run[][]) => boxFonts({ paragraphs } as TextBox);

/** Loads every font the paragraphs need and applies font fallback (original → substitute → Arimo).
 *  Rejects when a bundled font cannot be loaded. */
export async function prepareRuns(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore): Promise<Run[][]> {
  let out = paragraphs;
  for (let step = 0; step < 2; step++) {
    await Promise.allSettled(fontsOf(out).map((f) => store.load(f)));
    out = out.map((p) => resolveRunFonts(p, fonts, (f) => store.peek(f)));
  }
  await Promise.all(fontsOf(out).map((f) => store.load(f)));
  return out;
}

/** White covers hiding an edited paragraph's original lines on screen (the bake redacts them). */
export function maskRects(p: Paragraph): Rect[] {
  return p.lines.map((l) => ({
    x: l.rect.x - 0.5, y: l.baseline - MASK_ASCENT * l.size, w: l.rect.w + 1, h: (MASK_ASCENT + MASK_DESCENT) * l.size,
  }));
}
```

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: all pass — in particular every fixture paragraph (left, justify, center, Courier, right, address) is laid out on exactly its original lines.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/paragraphs.ts apps/web/src/lib/paragraphs.test.ts
git commit -m "feat(web): rebuild original paragraphs as text boxes on their own lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
