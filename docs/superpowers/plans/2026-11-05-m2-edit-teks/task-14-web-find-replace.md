# Task 14: Web — Find & Replace

**Files:**
- Create: `apps/web/src/lib/search.ts`, `apps/web/src/lib/search.test.ts`, `apps/web/src/lib/targets.ts`, `apps/web/src/lib/targets.test.ts`, `apps/web/src/components/editor/find/findStore.ts`, `find/replace.ts`, `find/replace.test.ts`, `find/MatchHighlights.tsx`, `find/FindBar.tsx` (all under `apps/web/src/components/editor/find/`)
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`, `text/install.ts`, `Header.tsx`, `useShortcuts.ts`, `Editor.tsx`; `apps/web/src/lib/strings.ts`

**Interfaces:**
- Consumes: Task 8 `runsText`, `normalizeRuns`, `sliceRuns`, `styleAt`, `textStore`, `paragraphsOf`; Task 9 `paragraphBox`, `prepareRuns`, `measureRange`, `substituteOf`; Task 10 `putObjects`, `isTextOp`; Task 12/13 `overlayHooks`, `afterTextCommitted`.
- Produces:
  ```ts
  // lib/search.ts
  export interface SearchTarget { key: string; pageKey: string; paragraphs: Run[][] }   // text = paragraphs joined by "\n"
  export interface Match { key: string; pageKey: string; start: number; end: number }
  export function boxText(paragraphs: Run[][]): string
  export function findMatches(targets: SearchTarget[], query: string, caseSensitive: boolean): Match[]   // non-overlapping, in target order
  export function replaceRange(paragraphs: Run[][], start: number, end: number, text: string): Run[][]  // style of the first replaced char
  export function replaceMatches(paragraphs: Run[][], ranges: { start: number; end: number }[], text: string): Run[][]
  export function matchSegments(box: TextBox, start: number, end: number): { line: number; segment: number; from: number; to: number }[]
  // lib/targets.ts
  export const opKey: (id: string) => string;                    // "op:<id>"
  export const paraKey: (pageKey: string, id: string) => string; // "para:<pageKey>:<paragraphId>"
  export function buildTargets(doc: EditorDoc, pages: Record<number, Paragraph[]>): SearchTarget[]   // page order, then top-to-bottom/left-to-right
  export function highlightRects(m: Match, doc: EditorDoc, pages: Record<number, Paragraph[]>, fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): Rect[]
  // find/findStore.ts
  export const findStore: StoreApi<{ open; query; replacement; caseSensitive; showReplace; matches: Match[]; current: number; fontsVersion: number; set(p): void }>;
  export function openFind(): void
  // find/replace.ts
  export function applyReplacements(matches: Match[], text: string): Promise<void>   // ONE putObjects call = one undo step
  ```
  Targets: unedited editable original paragraphs (`[p.runs]`, offsets in the joined text) and `text.add`/`text.edit` ops (their paragraphs). Case-insensitive search folds character by character so offsets stay valid. Replace on an original paragraph creates its `text.edit` (offsets mapped with `paragraphBox(…, edit)`), on an op updates its box; new text is re-resolved for glyph coverage (`prepareRuns`) and relaid out. UI: Ctrl/Cmd+F (also while typing) or the header "Cari" button opens a floating bar: input "Cari teks", "n dari N", `Aa` (case-sensitive), ↑/↓ (Enter / Shift+Enter), ▸ "Tampilkan ganti" → "Ganti dengan", "Ganti", "Ganti semua", ✕ "Tutup" / Esc. Matches are highlighted on the page (current orange, others yellow) and the current match's page scrolls into view.

- [ ] **Step 1: Failing pure tests**

`apps/web/src/lib/search.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Run, TextBox } from "@edith/ops";
import { boxText, findMatches, matchSegments, replaceMatches, replaceRange, type SearchTarget } from "@/lib/search";

const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const r = (text: string, color = "#000000"): Run => ({ text, font, size: 12, color });
const target = (key: string, ...paragraphs: Run[][]): SearchTarget => ({ key, pageKey: "o0", paragraphs });

describe("find", () => {
  const targets = [target("a", [r("Kata lama, "), r("lama", "#ff0000")]), target("b", [r("LAMA")], [r("tidak")])];

  it("is case-insensitive by default and case-sensitive on request", () => {
    expect(findMatches(targets, "lama", false).map((m) => [m.key, m.start])).toEqual([["a", 5], ["a", 11], ["b", 0]]);
    expect(findMatches(targets, "lama", true).map((m) => [m.key, m.start])).toEqual([["a", 5], ["a", 11]]);
  });

  it("matches across run boundaries", () => {
    const t = [target("x", [r("ka"), r("ta", "#ff0000")])];
    expect(findMatches(t, "kata", true)).toEqual([{ key: "x", pageKey: "o0", start: 0, end: 4 }]);
  });

  it("does not overlap matches and ignores an empty query", () => {
    expect(findMatches([target("x", [r("aaaa")])], "aa", true).map((m) => m.start)).toEqual([0, 2]);
    expect(findMatches(targets, "", false)).toEqual([]);
  });

  it("keeps offsets when lower-casing changes length", () => {
    expect(findMatches([target("x", [r("İstanbul ada")])], "ada", false)[0].start).toBe(9);
  });
});

describe("replace", () => {
  it("keeps the style of the first matched character, across runs", () => {
    const out = replaceRange([[r("ka"), r("ta lain", "#ff0000")]], 0, 4, "KATA");
    expect(out).toEqual([[r("KATA"), r(" lain", "#ff0000")]]);
  });

  it("works in a later paragraph", () => {
    const ps = [[r("satu")], [r("dua lama")]];
    expect(boxText(replaceRange(ps, 9, 13, "baru"))).toBe("satu\ndua baru");
  });

  it("replaces all matches of a target", () => {
    const ps = [[r("lama dan lama")]];
    const ms = findMatches([target("x", ...ps)], "lama", true);
    expect(boxText(replaceMatches(ps, ms, "baru sekali"))).toBe("baru sekali dan baru sekali");
  });

  it("joins paragraphs when the range spans them", () => {
    expect(replaceRange([[r("satu")], [r("dua")]], 2, 7, "-")).toEqual([[r("sa-a")]]);
  });

  it("can empty a paragraph", () => {
    expect(replaceRange([[r("lama")]], 0, 4, "")).toEqual([[r("")]]);
  });
});

describe("matchSegments", () => {
  it("maps a range onto wrapped, justified segments", () => {
    const box: TextBox = {
      rect: { x: 0, y: 0, w: 10, h: 10 }, align: "justify", lineHeight: 12,
      paragraphs: [[r("aa bb "), r("cc", "#ff0000")], [r("dd")]],
      layout: [
        { baseline: 10, segments: [{ x: 0, text: "aa", runIndex: 0 }, { x: 30, text: "bb", runIndex: 0 }] },
        { baseline: 22, segments: [{ x: 0, text: "cc", runIndex: 1 }] },
        { baseline: 34, segments: [{ x: 0, text: "dd", runIndex: 2 }] },
      ],
    };
    // "aa bb cc\ndd": "b cc" = 4..8, "dd" = 9..11
    expect(matchSegments(box, 4, 8)).toEqual([{ line: 0, segment: 1, from: 1, to: 2 }, { line: 1, segment: 0, from: 0, to: 2 }]);
    expect(matchSegments(box, 9, 11)).toEqual([{ line: 2, segment: 0, from: 0, to: 2 }]);
  });
});
```

`apps/web/src/lib/targets.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ContentOp, Run } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import type { FontMetrics } from "@/lib/fonts";
import { findMatches } from "@/lib/search";
import { buildTargets, highlightRects } from "@/lib/targets";
import type { EditorDoc } from "@/store/editor";

const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const run = (text: string): Run => ({ text, font, size: 10, color: "#000000" });
const mono: FontMetrics = { unitsPerEm: 1000, ascent: 800, descent: 200, advance: () => 500 }; // 5 pt per char at 10 pt
const para = (id: string, y: number, text: string): Paragraph => ({
  id, rect: { x: 100, y, w: 200, h: 12 }, runs: [run(text)], align: "left", lineHeight: 12, editable: true,
  lines: [{ rect: { x: 100, y, w: 200, h: 12 }, baseline: y + 10, size: 10, start: 0, end: text.length }],
});
const box = (y: number, text: string) => ({
  rect: { x: 50, y, w: 200, h: 12 }, align: "left" as const, lineHeight: 12, paragraphs: [[run(text)]],
  layout: [{ baseline: 10, segments: [{ x: 0, text, runIndex: 0 }] }],
});
const doc: EditorDoc = {
  pages: [{ pageKey: "o0", src: { doc: "D", index: 0 }, rotate: 0 }, { pageKey: "u1", src: { blank: { width: 10, height: 10 } }, rotate: 0 }],
  objects: {
    e: { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g1", box: box(300, "diedit lama") } as ContentOp,
    t: { id: "t", type: "text.add", pageKey: "o0", box: box(50, "kotak lama") } as ContentOp,
    u: { id: "u", type: "text.add", pageKey: "u1", box: box(0, "lama di kosong") } as ContentOp,
  },
  order: ["e", "t", "u"],
};
const pages = { 0: [para("g0", 100, "asli lama"), para("g1", 300, "tergantikan lama")] };

describe("search targets", () => {
  it("lists unedited paragraphs and text ops by page and position", () => {
    expect(buildTargets(doc, pages).map((t) => t.key)).toEqual(["op:t", "para:o0:g0", "op:e", "op:u"]);
  });

  it("highlights a match in an original paragraph", () => {
    const [m] = findMatches(buildTargets(doc, pages).filter((t) => t.key === "para:o0:g0"), "lama", true);
    expect(highlightRects(m, doc, pages, {}, () => mono)).toEqual([{ x: 125, y: 100.5, w: 20, h: 12 }]);
  });

  it("highlights a match in a text op from its layout", () => {
    const [m] = findMatches(buildTargets(doc, pages).filter((t) => t.key === "op:t"), "lama", true);
    expect(highlightRects(m, doc, pages, {}, () => mono)).toEqual([{ x: 80, y: 50.5, w: 20, h: 12 }]);
  });

  it("falls back to the whole line before fonts load", () => {
    const [m] = findMatches(buildTargets(doc, pages).filter((t) => t.key === "para:o0:g0"), "lama", true);
    expect(highlightRects(m, doc, pages, {}, () => null)).toEqual([{ x: 100, y: 100.5, w: 200, h: 12 }]);
  });
});
```

Run: `npm test -w apps/web`
Expected: FAIL — cannot resolve `@/lib/search`, `@/lib/targets`.

- [ ] **Step 2: Search and targets**

`apps/web/src/lib/search.ts`:
```ts
import type { Run, TextBox } from "@edith/ops";
import { normalizeRuns, runsText, sliceRuns, styleAt } from "@/lib/runs";

/** Something searchable: an original paragraph or a text op. Its text is its paragraphs joined by "\n". */
export interface SearchTarget { key: string; pageKey: string; paragraphs: Run[][] }
export interface Match { key: string; pageKey: string; start: number; end: number }

export function boxText(paragraphs: Run[][]): string {
  return paragraphs.map(runsText).join("\n");
}

/** Lower-cases character by character so offsets stay valid ("İ" would grow when lower-cased whole). */
function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const lower = s[i].toLowerCase();
    out += lower.length === 1 ? lower : s[i];
  }
  return out;
}

export function findMatches(targets: SearchTarget[], query: string, caseSensitive: boolean): Match[] {
  if (!query) return [];
  const q = caseSensitive ? query : fold(query);
  const out: Match[] = [];
  for (const t of targets) {
    const text = caseSensitive ? boxText(t.paragraphs) : fold(boxText(t.paragraphs));
    for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
      out.push({ key: t.key, pageKey: t.pageKey, start: i, end: i + q.length });
    }
  }
  return out;
}

/** (paragraph index, offset in it) of box-text offset `o`. */
function locate(paragraphs: Run[][], o: number): [number, number] {
  let from = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const len = runsText(paragraphs[i]).length;
    if (o <= from + len) return [i, o - from];
    from += len + 1;
  }
  const last = paragraphs.length - 1;
  return [last, runsText(paragraphs[last]).length];
}

/** Replaces characters [start, end) of the box text with `text` in the style of the first replaced
 *  character. A range spanning paragraphs joins them. */
export function replaceRange(paragraphs: Run[][], start: number, end: number, text: string): Run[][] {
  const [pi, s] = locate(paragraphs, start);
  const [pj, e] = locate(paragraphs, end);
  const style = styleAt(paragraphs[pi], s);
  const tail = paragraphs[pj];
  const merged = normalizeRuns([...sliceRuns(paragraphs[pi], 0, s), { ...style, text }, ...sliceRuns(tail, e, runsText(tail).length)]);
  return [...paragraphs.slice(0, pi), merged, ...paragraphs.slice(pj + 1)];
}

/** Replaces several non-overlapping ranges (any order). */
export function replaceMatches(paragraphs: Run[][], ranges: { start: number; end: number }[], text: string): Run[][] {
  return [...ranges].sort((a, b) => b.start - a.start).reduce((ps, m) => replaceRange(ps, m.start, m.end, text), paragraphs);
}

/** Pieces of [start, end) inside the laid-out segments of `box`: segment `[line, segment]`, chars `from`–`to` of its text. */
export function matchSegments(box: TextBox, start: number, end: number): { line: number; segment: number; from: number; to: number }[] {
  const runs = box.paragraphs.flat();
  const runStart: number[] = [];
  let offset = 0;
  box.paragraphs.forEach((p) => {
    p.forEach((r) => { runStart.push(offset); offset += r.text.length; });
    offset += 1; // "\n"
  });
  const cursor = runs.map(() => 0);
  const out: { line: number; segment: number; from: number; to: number }[] = [];
  box.layout.forEach((line, li) => line.segments.forEach((seg, si) => {
    const run = runs[seg.runIndex];
    if (!run) return;
    const local = run.text.indexOf(seg.text, cursor[seg.runIndex]);
    if (local < 0) return;
    cursor[seg.runIndex] = local + seg.text.length;
    const g = runStart[seg.runIndex] + local;
    const from = Math.max(start, g), to = Math.min(end, g + seg.text.length);
    if (from < to) out.push({ line: li, segment: si, from: from - g, to: to - g });
  }));
  return out;
}
```

`apps/web/src/lib/targets.ts`:
```ts
import type { ContentOp, Rect, Run, TextAdd, TextBox, TextEdit } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { charOffsets, textWidth, type FontMetrics } from "@/lib/fonts";
import { isTextOp } from "@/lib/objects";
import { measureRange, substituteOf, type FontTable } from "@/lib/paragraphs";
import { matchSegments, type Match, type SearchTarget } from "@/lib/search";
import type { EditorDoc } from "@/store/editor";

type Peek = (f: Run["font"]) => FontMetrics | null;
const HL_ASCENT = 0.95, HL_HEIGHT = 1.2; // highlight band around the baseline (× size)

/** Key of a search target: `op:<id>` for a text op, `para:<pageKey>:<paragraphId>` for an original paragraph. */
export const opKey = (id: string) => `op:${id}`;
export const paraKey = (pageKey: string, id: string) => `para:${pageKey}:${id}`;

/** Everything Find searches, in page order then reading order (top to bottom, left to right). */
export function buildTargets(doc: EditorDoc, pages: Record<number, Paragraph[]>): SearchTarget[] {
  const out: SearchTarget[] = [];
  for (const entry of doc.pages) {
    const ops = doc.order.map((id) => doc.objects[id]).filter((op): op is TextAdd | TextEdit => isTextOp(op) && op.pageKey === entry.pageKey);
    const edited = new Set(ops.filter((op): op is TextEdit => op.type === "text.edit").map((op) => op.paragraphId));
    const items: { x: number; y: number; target: SearchTarget }[] = [];
    if ("doc" in entry.src) {
      for (const p of pages[entry.src.index] ?? []) {
        if (p.editable && !edited.has(p.id)) items.push({ x: p.rect.x, y: p.rect.y, target: { key: paraKey(entry.pageKey, p.id), pageKey: entry.pageKey, paragraphs: [p.runs] } });
      }
    }
    for (const op of ops) items.push({ x: op.box.rect.x, y: op.box.rect.y, target: { key: opKey(op.id), pageKey: entry.pageKey, paragraphs: op.box.paragraphs } });
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    out.push(...items.map((i) => i.target));
  }
  return out;
}

/** Page rectangles to highlight for `m`; empty when the fonts to measure it are not loaded. */
export function highlightRects(m: Match, doc: EditorDoc, pages: Record<number, Paragraph[]>, fonts: FontTable, peek: Peek): Rect[] {
  if (m.key.startsWith("op:")) {
    const op = doc.objects[m.key.slice(3)] as ContentOp | undefined;
    return isTextOp(op) ? boxRects(op.box, m, peek) : [];
  }
  const [, pageKey, id] = m.key.split(":");
  const entry = doc.pages.find((p) => p.pageKey === pageKey);
  const p = entry && "doc" in entry.src ? pages[entry.src.index]?.find((x) => x.id === id) : undefined;
  return p ? paragraphRects(p, m, (f) => peek(f) ?? peek(substituteOf(f, fonts))) : [];
}

function boxRects(box: TextBox, m: Match, peek: Peek): Rect[] {
  const runs = box.paragraphs.flat();
  return matchSegments(box, m.start, m.end).flatMap(({ line, segment, from, to }) => {
    const l = box.layout[line], seg = l.segments[segment], r = runs[seg.runIndex];
    const metrics = peek(r.font);
    if (!metrics) return [];
    const offs = [...charOffsets(seg.text, metrics, r.size), textWidth(seg.text, metrics, r.size)];
    return [{ x: box.rect.x + seg.x + offs[from], y: box.rect.y + l.baseline - HL_ASCENT * r.size, w: offs[to] - offs[from], h: HL_HEIGHT * r.size }];
  });
}

function paragraphRects(p: Paragraph, m: Match, peek: Peek): Rect[] {
  const metricsFor = (f: Run["font"]) => { const x = peek(f); if (!x) throw new Error("font not loaded"); return x; };
  return p.lines.flatMap((l) => {
    const a = Math.max(m.start, l.start), b = Math.min(m.end, l.end);
    if (a >= b) return [];
    const y = l.baseline - HL_ASCENT * l.size, h = HL_HEIGHT * l.size;
    try {
      const x0 = measureRange(p.runs, l.start, a, metricsFor, false);
      const x1 = measureRange(p.runs, l.start, b, metricsFor, false);
      return [{ x: l.rect.x + x0, y, w: x1 - x0, h }];
    } catch {
      return [{ x: l.rect.x, y, w: l.rect.w, h }]; // fonts not loaded yet: the whole line
    }
  });
}
```

Run: `npm test -w apps/web`
Expected: the search and targets tests pass.

- [ ] **Step 3: Replace (failing test first)**

`apps/web/src/components/editor/find/replace.test.ts`:
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { fontStore, metricsFromBuffer } from "@/lib/fonts";
import { findMatches } from "@/lib/search";
import { buildTargets } from "@/lib/targets";
import { editorStore, type DocInfo } from "@/store/editor";
import { textStore } from "@/store/text";
import { applyReplacements } from "./replace";

const arimo = metricsFromBuffer(readFileSync(path.resolve(__dirname, "../../../../../../packages/fonts/files/Arimo-Regular.ttf")));
const info: DocInfo = { docId: "D".repeat(22), sha256: "abc", fileName: "a.pdf", pages: [{ index: 0, width: 595, height: 842, rotation: 0, hasText: true }] };
const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const para: Paragraph = {
  id: "g0", rect: { x: 72, y: 88, w: 200, h: 16 }, align: "left", lineHeight: 14, editable: true,
  runs: [{ text: "kata lama di sini", font, size: 12, color: "#000000" }],
  lines: [{ rect: { x: 72, y: 88, w: 200, h: 16 }, baseline: 100, size: 12, start: 0, end: 17 }],
};
const box = (text: string) => ({ rect: { x: 72, y: 300, w: 200, h: 14 }, align: "left" as const, lineHeight: 14,
  paragraphs: [[{ text, font, size: 12, color: "#ff0000" }]], layout: [] });

beforeEach(() => {
  editorStore.getState().init(info);
  textStore.setState({ status: "ready", pages: { 0: [para] }, fonts: {} });
  vi.spyOn(fontStore, "load").mockResolvedValue(arimo);
  vi.spyOn(fontStore, "peek").mockReturnValue(arimo);
  vi.spyOn(fontStore, "get").mockReturnValue(arimo);
});
afterEach(() => vi.restoreAllMocks());

describe("applyReplacements", () => {
  it("replaces in original paragraphs and text ops as one undo step", async () => {
    editorStore.getState().addObject({ id: "t", type: "text.add", pageKey: "o0", box: box("lama dan lama") } as ContentOp);
    const st = editorStore.getState();
    const matches = findMatches(buildTargets(st.doc, textStore.getState().pages), "lama", true);
    expect(matches).toHaveLength(3);
    const before = editorStore.getState().past.length;
    await applyReplacements(matches, "baru");
    const after = editorStore.getState();
    expect(after.past.length).toBe(before + 1);
    const edit = Object.values(after.doc.objects).find((o) => o.type === "text.edit") as TextEdit;
    expect(edit).toMatchObject({ pageKey: "o0", paragraphId: "g0" });
    expect(edit.box.paragraphs[0].map((r) => r.text).join("")).toBe("kata baru di sini");
    expect(edit.box.rect.y + edit.box.layout[0].baseline).toBeCloseTo(100);
    const t = after.doc.objects.t as TextAdd;
    expect(t.box.paragraphs[0]).toEqual([{ text: "baru dan baru", font, size: 12, color: "#ff0000" }]);
    expect(t.box.layout.length).toBe(1);
    editorStore.getState().undo();
    expect(Object.values(editorStore.getState().doc.objects).some((o) => o.type === "text.edit")).toBe(false);
    expect((editorStore.getState().doc.objects.t as TextAdd).box.paragraphs[0][0].text).toBe("lama dan lama");
  });

  it("replaces only the given match", async () => {
    const st = editorStore.getState();
    const [m] = findMatches(buildTargets(st.doc, textStore.getState().pages), "di", true);
    await applyReplacements([m], "DI");
    const edit = Object.values(editorStore.getState().doc.objects)[0] as TextEdit;
    expect(edit.box.paragraphs[0].map((r) => r.text).join("")).toBe("kata lama DI sini");
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL — cannot resolve `./replace`.

`apps/web/src/components/editor/find/findStore.ts`:
```ts
"use client";

import { createStore } from "zustand/vanilla";
import type { Match } from "@/lib/search";

export interface FindState {
  open: boolean; query: string; replacement: string; caseSensitive: boolean; showReplace: boolean;
  /** Matches over the current document (kept fresh by FindBar) and the highlighted one. */
  matches: Match[]; current: number;
  /** Bumped when fonts used to measure highlights finish loading. */
  fontsVersion: number;
  set(p: Partial<Omit<FindState, "set">>): void;
}

export const findStore = createStore<FindState>()((set) => ({
  open: false, query: "", replacement: "", caseSensitive: false, showReplace: false, matches: [], current: 0, fontsVersion: 0,
  set: (p) => set(p),
}));

export function openFind(): void {
  findStore.getState().set({ open: true });
}
```

`apps/web/src/components/editor/find/replace.ts`:
```ts
"use client";

import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { isTextOp } from "@/lib/objects";
import { paragraphBox, prepareRuns } from "@/lib/paragraphs";
import { replaceMatches, type Match } from "@/lib/search";
import { relayout } from "@/lib/textbox";
import { editorStore } from "@/store/editor";
import { paragraphsOf, textStore } from "@/store/text";

const metrics = (f: Parameters<typeof fontStore.get>[0]) => fontStore.get(f);

/** Replaces `matches` with `text` (style of each match's first character) as ONE undo step: text ops
 *  are updated, original paragraphs become text.edit ops. */
export async function applyReplacements(matches: Match[], text: string): Promise<void> {
  const byKey = new Map<string, Match[]>();
  for (const m of matches) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
  const { doc } = editorStore.getState();
  const { pages, fonts } = textStore.getState();
  const out: ContentOp[] = [];
  for (const [key, ms] of byKey) {
    if (key.startsWith("op:")) {
      const op = doc.objects[key.slice(3)];
      if (!isTextOp(op)) continue;
      const paragraphs = await prepareRuns(replaceMatches(op.box.paragraphs, ms, text), fonts);
      out.push({ ...op, box: relayout({ ...op.box, paragraphs }, metrics) } as TextAdd | TextEdit);
    } else {
      const [, pageKey, id] = key.split(":");
      const entry = doc.pages.find((p) => p.pageKey === pageKey);
      const p = entry ? paragraphsOf(entry.src, pages).find((x) => x.id === id) : undefined;
      if (!p) continue;
      const [runs] = await prepareRuns([p.runs], fonts);
      const box = paragraphBox({ ...p, runs }, metrics,
        (ps, toBox) => replaceMatches(ps, ms.map((m) => ({ start: toBox(m.start), end: toBox(m.end) })), text));
      const paragraphs = await prepareRuns(box.paragraphs, fonts); // the new text may lack glyphs in the original font
      out.push({ id: newId(), type: "text.edit", pageKey, paragraphId: id, box: relayout({ ...box, paragraphs }, metrics) } as TextEdit);
    }
  }
  editorStore.getState().putObjects(out);
}
```

Run: `npm test -w apps/web` → Expected: all pass.

- [ ] **Step 4: Find bar and highlights**

`apps/web/src/components/editor/find/MatchHighlights.tsx`:
```tsx
"use client";

import { Rect } from "react-konva";
import { useStore } from "zustand";
import { fontStore } from "@/lib/fonts";
import { highlightRects } from "@/lib/targets";
import { useEditor } from "@/store/editor";
import { useText } from "@/store/text";
import { findStore } from "./findStore";

/** Find matches on one page: all in yellow, the current one in orange. */
export function MatchHighlights({ pageKey }: { pageKey: string }) {
  const open = useStore(findStore, (s) => s.open);
  const matches = useStore(findStore, (s) => s.matches);
  const current = useStore(findStore, (s) => s.current);
  useStore(findStore, (s) => s.fontsVersion); // re-measure once fonts loaded
  const doc = useEditor((s) => s.doc);
  const pages = useText((s) => s.pages);
  const fonts = useText((s) => s.fonts);
  if (!open) return null;
  return (
    <>
      {matches.flatMap((m, i) => (m.pageKey !== pageKey ? [] : highlightRects(m, doc, pages, fonts, (f) => fontStore.peek(f)).map((r, k) => (
        <Rect key={`${i}-${k}`} x={r.x} y={r.y} width={r.w} height={r.h} listening={false}
          fill={i === current ? "#f97316" : "#facc15"} opacity={0.4} />
      ))))}
    </>
  );
}
```

`apps/web/src/components/editor/find/FindBar.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { BundledFont } from "@edith/ops";
import { fontKey, fontStore } from "@/lib/fonts";
import { substituteOf } from "@/lib/paragraphs";
import { findMatches } from "@/lib/search";
import { t } from "@/lib/strings";
import { buildTargets } from "@/lib/targets";
import { useEditor } from "@/store/editor";
import { textStore, useText } from "@/store/text";
import { afterTextCommitted } from "../text/textEdit";
import { findStore } from "./findStore";
import { applyReplacements } from "./replace";

function reveal(pageKey: string) {
  document.querySelector(`[data-page-key="${pageKey}"]`)?.scrollIntoView({ block: "center" });
}

export function FindBar() {
  const f = useStore(findStore);
  const doc = useEditor((s) => s.doc);
  const pages = useText((s) => s.pages);
  const status = useText((s) => s.status);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!f.open) return;
    input.current?.focus();
    input.current?.select();
    // Highlights of original paragraphs are measured with the bundled fonts their runs show in: load them.
    const { fonts, pages: all } = textStore.getState();
    const needed = new Map<string, BundledFont>();
    for (const ps of Object.values(all)) for (const p of ps) for (const r of p.runs) {
      const sub = substituteOf(r.font, fonts);
      needed.set(fontKey(sub), sub);
    }
    void Promise.allSettled([...needed.values()].map((font) => fontStore.load(font)))
      .then(() => findStore.getState().set({ fontsVersion: findStore.getState().fontsVersion + 1 }));
  }, [f.open]);

  useEffect(() => {
    if (!f.open) return;
    const matches = findMatches(buildTargets(doc, pages), f.query, f.caseSensitive);
    findStore.getState().set({ matches, current: Math.min(findStore.getState().current, Math.max(0, matches.length - 1)) });
  }, [f.open, f.query, f.caseSensitive, doc, pages]);

  if (!f.open) return null;
  const n = f.matches.length;
  const go = (delta: number) => {
    if (!n) return;
    const current = (f.current + delta + n) % n;
    f.set({ current });
    reveal(f.matches[current].pageKey);
  };
  const replace = async (all: boolean) => {
    if (!n || busy) return;
    setBusy(true);
    try {
      await new Promise<void>((resolve) => afterTextCommitted(resolve));
      await applyReplacements(all ? f.matches : [f.matches[f.current]], f.replacement);
    } catch (err) {
      console.warn("replace failed", err);
    } finally {
      setBusy(false);
    }
  };
  const close = () => f.set({ open: false, matches: [] });
  const btn = "h-8 rounded-md px-2 text-sm hover:bg-bg disabled:opacity-40";

  return (
    <div role="search" aria-label={t.find.title} data-testid="find-bar"
      className="fixed right-4 top-28 z-30 flex w-[26rem] flex-col gap-2 rounded-xl border border-line bg-surface p-2 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
        e.stopPropagation();
      }}>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={t.find.toggleReplace} aria-expanded={f.showReplace} className={btn}
          onClick={() => f.set({ showReplace: !f.showReplace })}>{f.showReplace ? "▾" : "▸"}</button>
        <input ref={input} aria-label={t.find.query} value={f.query} placeholder={t.find.query}
          onChange={(e) => f.set({ query: e.target.value, current: 0 })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); } }}
          className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-sm" />
        <span className="w-20 text-center text-xs tabular-nums text-muted" aria-live="polite">
          {status === "loading" ? t.find.loading : t.find.count(n ? f.current + 1 : 0, n)}
        </span>
        <button type="button" aria-label={t.find.caseSensitive} aria-pressed={f.caseSensitive} title={t.find.caseSensitive}
          className={`${btn} ${f.caseSensitive ? "bg-accent/10 text-accent" : ""}`} onClick={() => f.set({ caseSensitive: !f.caseSensitive })}>Aa</button>
        <button type="button" aria-label={t.find.prev} disabled={!n} className={btn} onClick={() => go(-1)}>↑</button>
        <button type="button" aria-label={t.find.next} disabled={!n} className={btn} onClick={() => go(1)}>↓</button>
        <button type="button" aria-label={t.editor.close} className={btn} onClick={close}>✕</button>
      </div>
      {f.showReplace && (
        <div className="flex items-center gap-1 pl-9">
          <input aria-label={t.find.replacement} value={f.replacement} placeholder={t.find.replacement}
            onChange={(e) => f.set({ replacement: e.target.value })}
            className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-sm" />
          <button type="button" disabled={!n || busy} className={btn} onClick={() => void replace(false)}>{t.find.replace}</button>
          <button type="button" disabled={!n || busy} className={btn} onClick={() => void replace(true)}>{t.find.replaceAll}</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire it in**

`apps/web/src/lib/strings.ts`: after the `text: { … },` group add:
```ts
  find: {
    open: "Cari",
    title: "Cari dan ganti",
    query: "Cari teks",
    replacement: "Ganti dengan",
    toggleReplace: "Tampilkan ganti",
    caseSensitive: "Cocokkan huruf besar/kecil",
    prev: "Sebelumnya",
    next: "Berikutnya",
    replace: "Ganti",
    replaceAll: "Ganti semua",
    loading: "Memuat…",
    count: (n: number, total: number) => `${n} dari ${total}`,
  },
```

`apps/web/src/components/editor/PageOverlay.tsx`: add to the `overlayHooks` type
```ts
  /** Konva nodes drawn over the page's objects (search highlights). */
  renderOver?: (pageKey: string) => React.ReactNode;
```
and render `{overlayHooks.renderOver?.(pageKey)}` as the last child of the page `<Group ref={pageRef} …>` (after `{draft && …}`).

`apps/web/src/components/editor/text/install.ts`: `import { MatchHighlights } from "../find/MatchHighlights";` and, after the `renderUnder` line, add
```ts
  overlayHooks.renderOver = (pageKey) => createElement(MatchHighlights, { pageKey });
```

`apps/web/src/components/editor/useShortcuts.ts`: `import { openFind } from "./find/findStore";` and make the first statement of `onKey`
```ts
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); return; }
```
(before the `isTyping` check, so Ctrl/Cmd+F works while a text field has focus).

`apps/web/src/components/editor/Header.tsx`: `import { openFind } from "./find/findStore";` and before the download button add:
```tsx
      <button onClick={openFind} disabled={!info} className="rounded-lg px-3 py-2 text-sm hover:bg-bg disabled:opacity-60">
        🔍 {t.find.open}
      </button>
```

`apps/web/src/components/editor/Editor.tsx`: below the `TextEditor` dynamic import add
```ts
const FindBar = dynamic(() => import("./find/FindBar").then((m) => m.FindBar), { ssr: false });
```
and render `<FindBar />` right before `<ZoomPill />`.

- [ ] **Step 6: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run e2e -w apps/web`
Expected: all pass.

Manual: open a PDF with repeated words → Ctrl/Cmd+F → type a word → "1 dari N", all matches yellow, current orange; ↓ moves and scrolls; Aa toggles case; ▸ → "Ganti dengan" → "Ganti" replaces the current one (style of its first letter kept), "Ganti semua" replaces the rest; one Ctrl+Z restores them all.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): find and replace across original paragraphs and text boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
