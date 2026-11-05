# Task 8: Web — text data client, `textStore`, run utilities, decoration geometry

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/store/text.ts`, `apps/web/src/store/text.test.ts`, `apps/web/src/lib/runs.ts`, `apps/web/src/lib/runs.test.ts`, `apps/web/src/lib/textDecor.ts`, `apps/web/src/lib/textDecor.test.ts`

**Interfaces:**
- Consumes: Task 5 endpoints; Task 2 `FontStore.setOriginalSource`, ops types.
- Produces:
  ```ts
  // lib/api.ts
  export interface ParagraphLine { rect: Rect; baseline: number; size: number; start: number; end: number }
  export interface Paragraph { id: string; rect: Rect; lines: ParagraphLine[]; runs: Run[]; align: "left"|"center"|"right"|"justify"; lineHeight: number; editable: boolean }
  export interface DocFont { ref: string; name: string; embedded: boolean; format: string | null; reusable: boolean; family: string; bold: boolean; italic: boolean; substitute: BundledFont }
  export interface TextData { doc_id: string; pages: { index: number; paragraphs: Paragraph[] }[]; fonts: DocFont[] }
  export function getText(docId: string): Promise<TextData>
  export function fontFileUrl(docId: string, ref: string): string
  // store/text.ts
  export interface TextState { status: "idle"|"loading"|"ready"|"error"; docId: string | null; pages: Record<number, Paragraph[]>; fonts: Record<string, DocFont>; load(docId: string): Promise<void> }
  export const textStore: StoreApi<TextState>
  export function useText<T>(selector: (s: TextState) => T): T
  export function paragraphsOf(src: PageSrc, pages?: Record<number, Paragraph[]>): Paragraph[]   // [] for blank pages
  // lib/runs.ts
  export function runsText(runs: Run[]): string
  export function sameStyle(a: Run, b: Run): boolean          // missing bgColor/underline/strike = defaults
  export function normalizeRuns(runs: Run[]): Run[]            // merge same-style neighbours, drop empties (keeps one empty run)
  export function styleAt(runs: Run[], offset: number): Run    // run holding char `offset` (last run at the end)
  export function sliceRuns(runs: Run[], start: number, end: number): Run[]
  export function paragraphsEqual(a: Run[][], b: Run[][]): boolean
  // lib/textDecor.ts
  export const DECOR: { bgAscent: 0.9; bgDescent: 0.25; underlineTop: 0.075; strikeTop: -0.3; thickness: 0.06 }
  export interface Band { x: number; y: number; w: number; h: number }
  export function decorBands(x: number, baseline: number, width: number, run: Run): { bg?: Band; underline?: Band; strike?: Band }
  ```
  `textStore.load` sets the font store's original-font source to `fontFileUrl(docId, ref)` before fetching; on failure it logs a warning and sets `status: "error"` (the editor keeps working without original-text editing).

- [ ] **Step 1: Failing tests**

`apps/web/src/lib/runs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Run } from "@edith/ops";
import { normalizeRuns, paragraphsEqual, runsText, sliceRuns, styleAt } from "@/lib/runs";

const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const r = (text: string, color = "#000000", extra: Partial<Run> = {}): Run => ({ text, font, size: 12, color, ...extra });

describe("runs", () => {
  it("merges same-style neighbours and drops empty runs", () => {
    expect(normalizeRuns([r("a"), r(""), r("b"), r("c", "#ff0000")])).toEqual([r("ab"), r("c", "#ff0000")]);
    expect(normalizeRuns([r("", "#ff0000"), r("")])).toEqual([r("", "#ff0000")]);
  });

  it("treats missing decoration fields as defaults", () => {
    expect(normalizeRuns([r("a"), r("b", "#000000", { underline: false, bgColor: null })])).toEqual([r("ab")]);
  });

  it("slices across runs", () => {
    const runs = [r("abc"), r("def", "#ff0000")];
    expect(sliceRuns(runs, 2, 4)).toEqual([r("c"), r("d", "#ff0000")]);
    expect(sliceRuns(runs, 3, 3)).toEqual([]);
    expect(runsText(runs)).toBe("abcdef");
  });

  it("finds the style at an offset", () => {
    const runs = [r("ab"), r("cd", "#ff0000")];
    expect(styleAt(runs, 1).color).toBe("#000000");
    expect(styleAt(runs, 2).color).toBe("#ff0000");
    expect(styleAt(runs, 4).color).toBe("#ff0000");
  });

  it("compares paragraphs by text and style", () => {
    expect(paragraphsEqual([[r("a")]], [[{ ...r("a"), strike: false }]])).toBe(true);
    expect(paragraphsEqual([[r("a")]], [[r("a", "#ff0000")]])).toBe(false);
  });
});
```

`apps/web/src/lib/textDecor.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decorBands } from "@/lib/textDecor";

const run = { text: "x", font: { kind: "bundled" as const, family: "Arimo" }, size: 20, color: "#000000" };

describe("decorBands", () => {
  it("matches the API bake geometry (bake/text.py BG_ASCENT, UNDERLINE_TOP, STRIKE_TOP, DECOR_THICKNESS)", () => {
    const d = decorBands(105, 215, 50, { ...run, bgColor: "#ffff00", underline: true, strike: true });
    expect(d.bg).toEqual({ x: 105, y: 197, w: 50, h: 23 });
    expect(d.underline!.y).toBeCloseTo(216.5);
    expect(d.underline!.h).toBeCloseTo(1.2);
    expect(d.strike!.y).toBeCloseTo(209);
  });

  it("is empty for a plain run", () => {
    expect(decorBands(0, 0, 10, run)).toEqual({});
  });
});
```

`apps/web/src/store/text.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocFont, Paragraph } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import { paragraphsOf, textStore } from "@/store/text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  textStore.setState({ status: "idle", docId: null, pages: {}, fonts: {} });
});

const para: Paragraph = { id: "g0", rect: { x: 0, y: 0, w: 10, h: 10 }, lines: [], runs: [], align: "left", lineHeight: 12, editable: true };
const font: DocFont = {
  ref: "f5", name: "Helvetica", embedded: false, format: null, reusable: false, family: "helvetica", bold: false, italic: false,
  substitute: { kind: "bundled", family: "Arimo", bold: false, italic: false },
};

describe("textStore", () => {
  it("loads paragraphs and fonts and points the font store at the document", async () => {
    const body = { doc_id: "D", pages: [{ index: 0, paragraphs: [para] }, { index: 1, paragraphs: [] }], fonts: [font] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const source = vi.spyOn(fontStore, "setOriginalSource");
    await textStore.getState().load("D");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/documents/D/text", undefined);
    expect(textStore.getState()).toMatchObject({ status: "ready", docId: "D", fonts: { f5: font } });
    expect(paragraphsOf({ doc: "D", index: 0 })).toEqual([para]);
    expect(paragraphsOf({ blank: { width: 1, height: 1 } })).toEqual([]);
    const url = source.mock.calls[0][0]!;
    expect(url("f5")).toBe("http://localhost:8000/documents/D/fonts/f5");
  });

  it("marks a failed load as error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await textStore.getState().load("D");
    expect(textStore.getState().status).toBe("error");
  });
});
```

Run: `npm test -w apps/web`
Expected: FAIL — cannot resolve `@/lib/runs`, `@/lib/textDecor`, `@/store/text`.

- [ ] **Step 2: API client**

In `apps/web/src/lib/api.ts`:
- Change the first import to `import type { BundledFont, ExportRequest, Rect, RenderPageRequest, Run } from "@edith/ops";`
- Before `export interface UploadResult` add:
```ts
/** One original line of a paragraph; `start`/`end` index the paragraph's joined run text (end excludes trailing spaces). */
export interface ParagraphLine { rect: Rect; baseline: number; size: number; start: number; end: number }
export interface Paragraph {
  id: string; rect: Rect; lines: ParagraphLine[]; runs: Run[];
  align: "left" | "center" | "right" | "justify"; lineHeight: number; editable: boolean;
}
export interface DocFont {
  ref: string; name: string; embedded: boolean; format: string | null; reusable: boolean;
  family: string; bold: boolean; italic: boolean; substitute: BundledFont;
}
export interface TextData { doc_id: string; pages: { index: number; paragraphs: Paragraph[] }[]; fonts: DocFont[] }
```
- After `getStructure` add:
```ts
export async function getText(docId: string): Promise<TextData> {
  return (await request(`/documents/${docId}/text`)).json();
}

export function fontFileUrl(docId: string, ref: string): string {
  return `${API_URL}/documents/${docId}/fonts/${ref}`;
}
```

- [ ] **Step 3: Text store**

`apps/web/src/store/text.ts`:
```ts
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { fontFileUrl, getText, type DocFont, type Paragraph } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import type { PageSrc } from "@/store/editor";

/** Original text of the open document (GET /documents/{id}/text), loaded once after the editor opens. */
export interface TextState {
  status: "idle" | "loading" | "ready" | "error";
  docId: string | null;
  pages: Record<number, Paragraph[]>;
  fonts: Record<string, DocFont>;
  load(docId: string): Promise<void>;
}

export const textStore = createStore<TextState>()((set, get) => ({
  status: "idle", docId: null, pages: {}, fonts: {},
  async load(docId) {
    set({ status: "loading", docId, pages: {}, fonts: {} });
    fontStore.setOriginalSource((ref) => fontFileUrl(docId, ref));
    try {
      const data = await getText(docId);
      if (get().docId !== docId) return;
      set({
        status: "ready",
        pages: Object.fromEntries(data.pages.map((p) => [p.index, p.paragraphs])),
        fonts: Object.fromEntries(data.fonts.map((f) => [f.ref, f])),
      });
    } catch (e) {
      console.warn("text extraction failed; original text cannot be edited", e);
      if (get().docId === docId) set({ status: "error" });
    }
  },
}));

export function useText<T>(selector: (s: TextState) => T): T {
  return useStore(textStore, selector);
}

const NONE: Paragraph[] = [];

/** Original paragraphs of a page source (none for blank pages or before loading). */
export function paragraphsOf(src: PageSrc, pages: Record<number, Paragraph[]> = textStore.getState().pages): Paragraph[] {
  return "doc" in src ? pages[src.index] ?? NONE : NONE;
}
```

- [ ] **Step 4: Run utilities and decoration geometry**

`apps/web/src/lib/runs.ts`:
```ts
import type { Run } from "@edith/ops";

export function runsText(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

/** Same character style (everything but the text). */
export function sameStyle(a: Run, b: Run): boolean {
  return JSON.stringify(a.font) === JSON.stringify(b.font) && a.size === b.size && a.color === b.color
    && (a.bgColor ?? null) === (b.bgColor ?? null) && !!a.underline === !!b.underline && !!a.strike === !!b.strike;
}

/** Merges neighbours with the same style and drops empty runs; an empty paragraph keeps one empty run. */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) out[out.length - 1] = { ...last, text: last.text + r.text };
    else out.push(r);
  }
  return out.length ? out : runs.length ? [{ ...runs[0], text: "" }] : [];
}

/** The run holding character `offset` (the last run when `offset` is the end). */
export function styleAt(runs: Run[], offset: number): Run {
  let pos = 0;
  for (const r of runs) {
    if (offset < pos + r.text.length) return r;
    pos += r.text.length;
  }
  return runs[runs.length - 1];
}

/** The parts of `runs` covering characters [start, end). */
export function sliceRuns(runs: Run[], start: number, end: number): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const a = Math.max(start, pos), b = Math.min(end, pos + r.text.length);
    if (a < b) out.push({ ...r, text: r.text.slice(a - pos, b - pos) });
    pos += r.text.length;
  }
  return out;
}

export function paragraphsEqual(a: Run[][], b: Run[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return p.length === q.length && p.every((r, k) => r.text === q[k].text && sameStyle(r, q[k]));
  });
}
```

`apps/web/src/lib/textDecor.ts`:
```ts
import type { Run } from "@edith/ops";

/** Decoration geometry in multiples of the run's size, relative to the baseline (y grows down).
 *  Shared contract with apps/api/edith/bake/text.py (BG_ASCENT, …) — change both together. */
export const DECOR = { bgAscent: 0.9, bgDescent: 0.25, underlineTop: 0.075, strikeTop: -0.3, thickness: 0.06 } as const;

export interface Band { x: number; y: number; w: number; h: number }

/** Background, underline and strike bands of a segment drawn at (x, baseline) with advance `width`. */
export function decorBands(x: number, baseline: number, width: number, run: Run): { bg?: Band; underline?: Band; strike?: Band } {
  const s = run.size;
  const band = (top: number, h: number): Band => ({ x, y: baseline + top * s, w: width, h: h * s });
  return {
    ...(run.bgColor ? { bg: band(-DECOR.bgAscent, DECOR.bgAscent + DECOR.bgDescent) } : {}),
    ...(run.underline ? { underline: band(DECOR.underlineTop, DECOR.thickness) } : {}),
    ...(run.strike ? { strike: band(DECOR.strikeTop, DECOR.thickness) } : {}),
  };
}
```

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: all pass, 0 lint problems.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/store/text.ts apps/web/src/store/text.test.ts apps/web/src/lib/runs.ts apps/web/src/lib/runs.test.ts apps/web/src/lib/textDecor.ts apps/web/src/lib/textDecor.test.ts
git commit -m "feat(web): load original text and fonts; run and decoration helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
