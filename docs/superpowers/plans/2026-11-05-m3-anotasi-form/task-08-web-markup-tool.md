# Task 8: Highlight / Underline / Strike tool on original text

The "Penanda" split button (Stabilo / Garis bawah / Coret) selects original text by character: a press must land on a text line, a drag extends the selection to the nearest line (reading order of the extraction), and the release adds one `annot.add` with one quad per line (spaces at the line ends trimmed). Quads span the text background band of M2 (`baseline − 0.9·size … baseline + 0.25·size`). The tool stays active (spec). Lines of edited paragraphs are not markable — the bake removes their original glyphs. Character boxes are fetched per source page when a markup tool is active.

**Files:**
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`
- Modify: `apps/web/src/components/editor/PropertiesBar.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Create: `apps/web/src/components/editor/marks/markupTool.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/markup.test.ts`
- Modify: `apps/web/src/lib/markup.ts`
- Modify: `apps/web/src/lib/objects.ts`
- Create: `apps/web/src/store/chars.test.ts`
- Create: `apps/web/src/store/chars.ts`

**Interfaces:**
- Consumes: Task 5 route, Task 6 `getChars`, `MarkupTool`, `style.markup`, Task 7 multiply layer + `MarkupShape`; M2 `maskRects`, `paragraphsOf`.
- Produces:
  - `lib/markup.ts`: `MARK_ASCENT = 0.9`, `MARK_DESCENT = 0.25`, `CharLine`, `Caret {line, index}`, `usableLines(lines, hidden: Rect[])`, `caretAt(lines, pt, strict) -> Caret | null` (strict: on the line band, ≤ 2 pt past its ends), `markupQuads(lines, a, b) -> Rect[]`.
  - `store/chars.ts`: `charsStore` (`docId`, `pages: Record<index, CharLine[] | "loading" | "error">`, `load(docId, index)` — once per page, retried after an error, reset for another document), `useChars(selector)`, `charLines(index | null, pages?)`.
  - `lib/objects.ts`: `MARKUP_TOOLS`.
  - `components/editor/marks/markupTool.ts`: `markLines(pageKey)`, `onMarkableText(pageKey, at)`, `markupFromDrag(tool, pageKey, start, at, id) -> AnnotAdd | null`.
  - Toolbar "Penanda" split; PropertiesBar kind `"markup"` (color of the selected markup or of the active tool; hint `t.annot.noText` on a page without markable text).

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/src/lib/markup.test.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/markup.test.ts
+++ b/apps/web/src/lib/markup.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from "vitest";
-import { markupLine } from "@/lib/markup";
+import { caretAt, markupLine, markupQuads, usableLines, type CharLine } from "@/lib/markup";
 
 describe("markupLine", () => {
   it("matches MuPDF's underline/strike appearance (13.8 pt quad: width 0.8625, 1.971 / 5.914 above the bottom)", () => {
@@ -11,3 +11,44 @@ describe("markupLine", () => {
     expect([u.x, u.w]).toEqual([72, 100]);
   });
 });
+
+const line = (text: string, x0: number, baseline: number, size = 12, adv = 6): CharLine => ({
+  text, baseline, size, boxes: Array.from(text).map((_, i) => [x0 + i * adv, x0 + (i + 1) * adv] as [number, number]),
+});
+// "Hello world" at x 72 (6 pt per char), baseline 100; "second line" below it.
+const lines = [line("Hello world", 72, 100), line("second line", 72, 114.4)];
+
+describe("caretAt", () => {
+  it("finds the caret between characters on a press inside a line", () => {
+    expect(caretAt(lines, [72 + 6 * 6 + 1, 95], true)).toEqual({ line: 0, index: 6 }); // left half of "w": before it
+    expect(caretAt(lines, [72 + 6 * 6 + 4, 95], true)).toEqual({ line: 0, index: 7 }); // right half: after it
+    expect(caretAt(lines, [71, 95], true)).toEqual({ line: 0, index: 0 });
+  });
+  it("needs the line under a press but takes the nearest line while dragging", () => {
+    expect(caretAt(lines, [72, 60], true)).toBeNull();
+    expect(caretAt(lines, [300, 95], true)).toBeNull();
+    expect(caretAt(lines, [300, 95], false)).toEqual({ line: 0, index: 11 });
+    expect(caretAt(lines, [100, 200], false)).toEqual({ line: 1, index: 5 });
+    expect(caretAt([], [0, 0], false)).toBeNull();
+  });
+});
+
+describe("markupQuads", () => {
+  it("covers the selected characters with the text band, in either drag direction", () => {
+    const q = { x: 72 + 6 * 6, y: 100 - 0.9 * 12, w: 5 * 6, h: 100 + 0.25 * 12 - (100 - 0.9 * 12) };
+    expect(markupQuads(lines, { line: 0, index: 6 }, { line: 0, index: 11 })).toEqual([q]);
+    expect(markupQuads(lines, { line: 0, index: 11 }, { line: 0, index: 6 })).toEqual([q]);
+  });
+  it("makes one quad per line and trims spaces at the ends", () => {
+    const qs = markupQuads(lines, { line: 0, index: 5 }, { line: 1, index: 7 }); // " world" … "second "
+    expect(qs.map((r) => [r.x, r.w])).toEqual([[72 + 6 * 6, 30], [72, 36]]);
+    expect(markupQuads(lines, { line: 0, index: 5 }, { line: 0, index: 6 })).toEqual([]); // only a space
+  });
+});
+
+describe("usableLines", () => {
+  it("drops lines under hidden rects (edited paragraphs)", () => {
+    expect(usableLines(lines, [{ x: 70, y: 105, w: 100, h: 12 }]).map((l) => l.text)).toEqual(["Hello world"]);
+    expect(usableLines(lines, [])).toHaveLength(2);
+  });
+});
```

Create `apps/web/src/store/chars.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { charLines, charsStore } from "@/store/chars";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  charsStore.setState({ docId: null, pages: {} });
});

const lines = [{ text: "Hi", boxes: [[72, 78], [78, 81]], baseline: 100, size: 12 }];

describe("charsStore", () => {
  it("fetches a page once and caches it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ doc_id: "D", index: 2, lines }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([charsStore.getState().load("D", 2), charsStore.getState().load("D", 2)]);
    await charsStore.getState().load("D", 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/documents/D/pages/2/chars", undefined);
    expect(charLines(2)).toEqual(lines);
    expect(charLines(0)).toEqual([]);
    expect(charLines(null)).toEqual([]);
  });

  it("retries after an error and forgets another document's pages", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await charsStore.getState().load("D", 0);
    expect(charsStore.getState().pages[0]).toBe("error");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ lines }), { status: 200 })));
    await charsStore.getState().load("D", 0);
    expect(charLines(0)).toEqual(lines);
    await charsStore.getState().load("E", 1);
    expect(charsStore.getState().pages[0]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/web && npx vitest run src/lib/markup.test.ts src/store/chars.test.ts`
Expected: `Tests  5 failed | 1 passed (6)` — `markupQuads is not a function`, `usableLines is not a function`, and `Cannot find module '@/store/chars'`.

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/PageOverlay.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/PageOverlay.tsx
+++ b/apps/web/src/components/editor/PageOverlay.tsx
@@ -7,9 +7,11 @@ import { useStore } from "zustand";
 import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
 import { groupTransform, screenSize, type PageGeom } from "@/lib/coords";
 import { newId } from "@/lib/id";
-import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
-import { editorStore, useEditor } from "@/store/editor";
+import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, MARKUP_TOOLS, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
+import { charsStore } from "@/store/chars";
+import { editorStore, useEditor, type MarkupTool } from "@/store/editor";
 import { MarkupShape } from "./marks/MarkupShape";
+import { markupFromDrag, onMarkableText } from "./marks/markupTool";
 import { ObjectShape } from "./ObjectShape";
 import { textEditStore } from "./text/textEdit";
 
@@ -40,6 +42,10 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
   const selection = useEditor((s) => s.selection);
   const tool = useEditor((s) => s.tool);
   const docId = useEditor((s) => s.info?.docId ?? "");
+  const srcIndex = useEditor((s) => {
+    const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
+    return entry && "doc" in entry.src ? entry.src.index : null;
+  });
   // renderText reads the editing id at render time (the edited op is hidden), so re-render when it changes.
   useStore(textEditStore, (s) => s.editing?.id);
   const pageRef = useRef<Konva.Group>(null);
@@ -62,6 +68,11 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
 
   useEffect(() => () => drawing.current?.stop(), []);
 
+  // Text markup needs the page's character boxes.
+  useEffect(() => {
+    if (MARKUP_TOOLS.has(tool) && docId && srcIndex !== null) void charsStore.getState().load(docId, srcIndex);
+  }, [tool, docId, srcIndex]);
+
   /** Page-relative pointer position (clamped to the page); `evt` updates it from an event outside Konva. */
   const pos = (evt?: PointerEvent): Pt => {
     const page = pageRef.current!;
@@ -87,6 +98,8 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
     if (!cur) return;
     if (tool === "ink") {
       if (cur.draft) setDrawDraft(extendInk(cur.draft, at));
+    } else if (MARKUP_TOOLS.has(tool)) {
+      setDrawDraft(markupFromDrag(tool as MarkupTool, pageKey, cur.start, at, "draft"));
     } else if (DRAG_TOOLS.has(tool)) {
       setDrawDraft(createFromDrag(tool as DragTool, cur.start, at, editorStore.getState().style, pageKey, "draft"));
     }
@@ -99,6 +112,9 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
     const s = editorStore.getState();
     if (tool === "ink" && cur.draft) {
       s.addObject({ ...extendInk(cur.draft, at), id: newId() } as ContentOp);
+    } else if (MARKUP_TOOLS.has(tool)) {
+      const op = markupFromDrag(tool as MarkupTool, pageKey, cur.start, at, newId());
+      if (op) s.addObject(op); // the markup tools stay active
     } else if (DRAG_TOOLS.has(tool)) {
       const op = createFromDrag(tool as DragTool, cur.start, at, s.style, pageKey, newId());
       if (op) { s.addObject(op); s.setTool("select"); s.select(op.id); }
@@ -135,7 +151,9 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
     }
     const at = pos();
     if (tool === "text") { overlayHooks.onTextPointerDown?.(pageKey, at); return; }
-    if (DRAG_TOOLS.has(tool)) {
+    if (MARKUP_TOOLS.has(tool)) {
+      if (onMarkableText(pageKey, at)) beginDraw(at, null);
+    } else if (DRAG_TOOLS.has(tool)) {
       beginDraw(at, null);
     } else if (tool === "ink") {
       beginDraw(at, { id: "draft", type: "ink.add", pageKey, paths: [[at]], color: s.style.stroke, width: inkWidth(s.style.width) } as ContentOp);
@@ -146,7 +164,7 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
     <div
       data-testid="overlay"
       className="absolute inset-0"
-      style={{ pointerEvents: tool === "pan" ? "none" : "auto", cursor: tool === "select" ? "default" : "crosshair" }}
+      style={{ pointerEvents: tool === "pan" ? "none" : "auto", cursor: tool === "select" ? "default" : MARKUP_TOOLS.has(tool) ? "text" : "crosshair" }}
     >
       <Stage
         width={size.width}
```

Modify `apps/web/src/components/editor/PropertiesBar.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -2,15 +2,16 @@
 
 import type { ContentOp } from "@edith/ops";
 import { useStore } from "zustand";
-import { inkWidth, isTextOp } from "@/lib/objects";
+import { inkWidth, isMarkup, isTextOp, MARKUP_TOOLS } from "@/lib/objects";
 import { t } from "@/lib/strings";
-import { editorStore, useEditor, type ToolStyle } from "@/store/editor";
+import { useChars } from "@/store/chars";
+import { editorStore, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
 import { ColorField } from "./ColorField";
 import { textEditStore } from "./text/textEdit";
 
 export const textPropsSlot: { render?: () => React.ReactNode } = {};
 
-type Kind = "shape" | "line" | "ink" | "redact" | "text" | null;
+type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | null;
 
 function kindOf(op: ContentOp | undefined, tool: string): Kind {
   if (op) {
@@ -18,8 +19,10 @@ function kindOf(op: ContentOp | undefined, tool: string): Kind {
     if (op.type === "ink.add") return "ink";
     if (op.type === "redact.add") return "redact";
     if (isTextOp(op)) return "text";
+    if (isMarkup(op)) return "markup";
     return null;
   }
+  if (MARKUP_TOOLS.has(tool)) return "markup";
   if (tool === "rect" || tool === "ellipse") return "shape";
   if (tool === "line" || tool === "arrow") return "line";
   if (tool === "ink") return "ink";
@@ -40,9 +43,22 @@ export function PropertiesBar() {
     const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
     return tool === "text" && !!entry && "doc" in entry.src && st.info?.pages[entry.src.index]?.hasText === false;
   });
+  // The markup tools on a page without original text (or only rotated text): nothing to mark.
+  const currentSrc = useEditor((st) => {
+    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
+    return entry && "doc" in entry.src ? entry.src.index : -1;
+  });
+  const currentLines = useChars((cs) => cs.pages[currentSrc]);
+  const noText = MARKUP_TOOLS.has(tool) && Array.isArray(currentLines) && currentLines.length === 0;
   const o = op as (ContentOp & Record<string, unknown>) | undefined;
   const s = editorStore.getState();
 
+  /** Color of the selected object (its `color` field), or of what the tool makes next. */
+  function setColor(v: string) {
+    if (o) s.updateObject(o.id, { color: v } as Partial<ContentOp>, { coalesce: `props:${o.id}` });
+    else if (MARKUP_TOOLS.has(tool)) s.setStyle({ markup: { ...style.markup, [tool]: v } });
+  }
+
   const stroke = (o?.type === "ink.add" ? (o.color as string) : (o?.stroke as string | undefined)) ?? style.stroke;
   const rawWidth = (o?.width as number | undefined) ?? style.width;
   const width = kind === "ink" ? inkWidth(rawWidth) : rawWidth;
@@ -96,6 +112,11 @@ export function PropertiesBar() {
           </select>
         </label>
       )}
+      {kind === "markup" && (
+        <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.markup[tool as MarkupTool] ?? style.markup.highlight}
+          onChange={(v) => setColor(v)} />
+      )}
+      {kind === "markup" && noText && <span className="text-xs text-muted">{t.annot.noText}</span>}
       {kind === "text" && textPropsSlot.render?.()}
       {kind === "text" && scanned && <span className="text-xs text-muted">{t.text.scanned}</span>}
       <div className="flex-1" />
```

Modify `apps/web/src/components/editor/Toolbar.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -60,6 +60,11 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
         { tool: "whiteout", label: t.editor.whiteout, icon: "▭" },
         { tool: "redact", label: t.editor.redact, icon: "▮" },
       ]} />
+      <SplitButton label={t.annot.markup} active={tool} onPick={pick} options={[
+        { tool: "highlight", label: t.annot.highlight, icon: "🖍" },
+        { tool: "underline", label: t.annot.underline, icon: "U̲" },
+        { tool: "strike", label: t.annot.strike, icon: "S̶" },
+      ]} />
       <ToolButton tool="ink" label={t.editor.draw} icon="✎" active={tool} />
       <button aria-label={t.editor.image} title={t.editor.image} onClick={() => file.current?.click()} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
         <span aria-hidden>🖼</span><span className="hidden lg:inline">{t.editor.image}</span>
```

Create `apps/web/src/components/editor/marks/markupTool.ts`:
```ts
import type { AnnotAdd, TextEdit } from "@edith/ops";
import { caretAt, markupQuads, usableLines, type CharLine } from "@/lib/markup";
import { maskRects } from "@/lib/paragraphs";
import { editorStore, type MarkupTool } from "@/store/editor";
import { charLines } from "@/store/chars";
import { paragraphsOf } from "@/store/text";

type Pt = [number, number];

/** The original lines of `pageKey` that text markup can go on (loaded ones; edited paragraphs excluded). */
export function markLines(pageKey: string): CharLine[] {
  const s = editorStore.getState();
  const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
  if (!entry || !("doc" in entry.src)) return [];
  const edited = new Set(Object.values(s.doc.objects)
    .filter((op): op is TextEdit => op.type === "text.edit" && op.pageKey === pageKey).map((op) => op.paragraphId));
  const hidden = paragraphsOf(entry.src).filter((p) => edited.has(p.id)).flatMap(maskRects);
  return usableLines(charLines(entry.src.index), hidden);
}

/** True when a press at `at` lands on markable text. */
export function onMarkableText(pageKey: string, at: Pt): boolean {
  return caretAt(markLines(pageKey), at, true) !== null;
}

/** The markup a drag from `start` to `at` makes (null when it covers no character). */
export function markupFromDrag(tool: MarkupTool, pageKey: string, start: Pt, at: Pt, id: string): AnnotAdd | null {
  const lines = markLines(pageKey);
  const a = caretAt(lines, start, true);
  const b = caretAt(lines, at, false);
  if (!a || !b) return null;
  const [first, ...rest] = markupQuads(lines, a, b);
  if (!first) return null;
  return { id, type: "annot.add", pageKey, kind: tool, quads: [first, ...rest], color: editorStore.getState().style.markup[tool] };
}
```

Modify `apps/web/src/lib/api.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -1,4 +1,5 @@
 import type { BundledFont, ExportRequest, Rect, RenderPageRequest, Run } from "@edith/ops";
+import type { CharLine } from "@/lib/markup";
 import type { StructurePage } from "@/store/editor";
 
 export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
@@ -33,8 +34,7 @@ export interface FormField {
   /** 0 = auto. */
   fontSize: number;
 }
-/** One horizontal line of original text: `boxes[i]` = `[x0, x1]` of the i-th code point of `text`. */
-export interface CharLine { text: string; boxes: [number, number][]; baseline: number; size: number }
+export type { CharLine } from "@/lib/markup";
 
 export interface UploadResult { doc_id: string; sha256: string; page_count: number }
 export interface Structure { doc_id: string; sha256: string; page_count: number; pages: StructurePage[]; fields: FormField[] }
```

Modify `apps/web/src/lib/markup.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/markup.ts
+++ b/apps/web/src/lib/markup.ts
@@ -7,3 +7,73 @@ export function markupLine(kind: "underline" | "strike", q: Rect): Rect {
   const centre = q.y + q.h - (kind === "underline" ? q.h / 7 : (3 * q.h) / 7);
   return { x: q.x, y: centre - t / 2, w: q.w, h: t };
 }
+
+/** A markup quad spans the text background band: baseline − 0.9·size … baseline + 0.25·size (DECOR in textDecor.ts). */
+export const MARK_ASCENT = 0.9;
+export const MARK_DESCENT = 0.25;
+/** A press this close (pt) to the ends of a line still starts a selection on it. */
+const SLOP = 2;
+
+/** One horizontal line of original text (GET /documents/{id}/pages/{index}/chars): `boxes[i]` is
+ *  `[x0, x1]` of the i-th code point of `text` (iterate with Array.from, not string indexes). */
+export interface CharLine { text: string; boxes: [number, number][]; baseline: number; size: number }
+/** A position between characters: before character `index` of line `line` (index = length: after the last). */
+export interface Caret { line: number; index: number }
+type Pt = [number, number];
+
+function band(l: CharLine): { top: number; bottom: number } {
+  return { top: l.baseline - MARK_ASCENT * l.size, bottom: l.baseline + MARK_DESCENT * l.size };
+}
+
+const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
+
+/** The lines that can be marked: original lines not hidden under `hidden` rects (edited paragraphs,
+ *  whose original glyphs the bake removes). */
+export function usableLines(lines: CharLine[], hidden: Rect[]): CharLine[] {
+  return lines.filter((l) => {
+    const { top, bottom } = band(l);
+    const r = { x: l.boxes[0][0], y: top, w: l.boxes[l.boxes.length - 1][1] - l.boxes[0][0], h: bottom - top };
+    return !hidden.some((h) => overlaps(r, h));
+  });
+}
+
+function indexAt(l: CharLine, x: number): number {
+  let i = 0;
+  while (i < l.boxes.length && (l.boxes[i][0] + l.boxes[i][1]) / 2 < x) i++;
+  return i;
+}
+
+/** The caret at `p`. `strict` (a press): only on a line, between its ends. Otherwise (a drag): the
+ *  nearest line, vertically first. Null when there is no such line. */
+export function caretAt(lines: CharLine[], [x, y]: Pt, strict: boolean): Caret | null {
+  let best: { line: number; d: number } | null = null;
+  lines.forEach((l, i) => {
+    const { top, bottom } = band(l);
+    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
+    const x0 = l.boxes[0][0], x1 = l.boxes[l.boxes.length - 1][1];
+    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
+    if (strict && (dy > 0 || dx > SLOP)) return;
+    const d = dy * 1e4 + dx;
+    if (!best || d < best.d) best = { line: i, d };
+  });
+  const found = best as { line: number; d: number } | null;
+  return found ? { line: found.line, index: indexAt(lines[found.line], x) } : null;
+}
+
+/** One quad per line between carets `a` and `b` (either order), without the spaces at its ends. */
+export function markupQuads(lines: CharLine[], a: Caret, b: Caret): Rect[] {
+  const [from, to] = a.line < b.line || (a.line === b.line && a.index <= b.index) ? [a, b] : [b, a];
+  const out: Rect[] = [];
+  for (let li = from.line; li <= to.line; li++) {
+    const l = lines[li];
+    const chars = Array.from(l.text);
+    let start = li === from.line ? from.index : 0;
+    let end = li === to.line ? to.index : chars.length;
+    while (start < end && /\s/.test(chars[start])) start++;
+    while (end > start && /\s/.test(chars[end - 1])) end--;
+    if (start >= end) continue;
+    const { top, bottom } = band(l);
+    out.push({ x: l.boxes[start][0], y: top, w: l.boxes[end - 1][1] - l.boxes[start][0], h: bottom - top });
+  }
+  return out;
+}
```

Modify `apps/web/src/lib/objects.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/objects.ts
+++ b/apps/web/src/lib/objects.ts
@@ -5,6 +5,8 @@ export type Pt = [number, number];
 export const MIN_DRAG = 3;
 export type DragTool = "rect" | "ellipse" | "line" | "arrow" | "whiteout" | "redact";
 export const DRAG_TOOLS: ReadonlySet<string> = new Set(["rect", "ellipse", "line", "arrow", "whiteout", "redact"]);
+/** Tools that select original text and add a text-markup annotation (they stay active). */
+export const MARKUP_TOOLS: ReadonlySet<string> = new Set(["highlight", "underline", "strike"]);
 
 /** Ink needs a positive width (the API rejects 0); the shared stroke slider allows 0 for shapes. */
 export const MIN_INK_WIDTH = 0.5;
```

Create `apps/web/src/store/chars.ts`:
```ts
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { getChars } from "@/lib/api";
import type { CharLine } from "@/lib/markup";

/** Character boxes of original pages (text markup), fetched per source page on first use. */
export interface CharsState {
  docId: string | null;
  /** Source page index → its lines; "loading" while fetched; "error" when it failed. */
  pages: Record<number, CharLine[] | "loading" | "error">;
  load(docId: string, index: number): Promise<void>;
}

export const charsStore = createStore<CharsState>()((set, get) => ({
  docId: null, pages: {},
  async load(docId, index) {
    if (get().docId !== docId) set({ docId, pages: {} });
    const cur = get().pages[index];
    if (cur !== undefined && cur !== "error") return;
    set({ pages: { ...get().pages, [index]: "loading" } });
    let result: CharLine[] | "error";
    try {
      result = await getChars(docId, index);
    } catch (e) {
      console.warn("chars: load failed", e);
      result = "error";
    }
    if (get().docId === docId) set({ pages: { ...get().pages, [index]: result } });
  },
}));

export function useChars<T>(selector: (s: CharsState) => T): T {
  return useStore(charsStore, selector);
}

const NONE: CharLine[] = [];

/** Loaded lines of a source page (none while loading, after an error, or for blank pages). */
export function charLines(index: number | null, pages: CharsState["pages"] = charsStore.getState().pages): CharLine[] {
  const v = index === null ? undefined : pages[index];
  return Array.isArray(v) ? v : NONE;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run src/lib/markup.test.ts src/store/chars.test.ts`
Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Full check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: `Tests  190 passed (190)`; tsc prints nothing; eslint reports no problems. API untouched (`cd apps/api && uv run pytest -q` still `295 passed`).

- [ ] **Step 6: Try it in the browser**

`npm run dev:api` + `npm run dev:web`, upload `apps/web/e2e/fixtures/text.pdf` (any text PDF works), click **Penanda**, drag across a word: a yellow highlight appears with the text still black under it; switch to **Garis bawah** via ▾ and drag across another word: a red line under it. Edit a paragraph (double-click with Pilih) and try to highlight it: nothing happens.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/PageOverlay.tsx apps/web/src/components/editor/PropertiesBar.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/marks/markupTool.ts apps/web/src/lib/api.ts apps/web/src/lib/markup.test.ts apps/web/src/lib/markup.ts apps/web/src/lib/objects.ts apps/web/src/store/chars.test.ts apps/web/src/store/chars.ts
git commit -m "feat(web): highlight, underline and strike original text" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
