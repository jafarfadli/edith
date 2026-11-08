# Task 13: Text warnings: overflowing edited paragraphs, unsupported characters (M2 backlog owner decisions)

Owner decisions recorded in the M2 backlog:
1. A `text.edit` whose laid-out height (first to last baseline) exceeds the original paragraph's gets an orange dashed outline on the page, and the properties bar says why (following paragraphs are **not** pushed down).
2. When some character has no glyph even after the full fallback chain (original → substitute → Arimo → Noto Sans) — CJK, emoji, ✓ — the properties bar warns "beberapa karakter tidak didukung font ini" (`covers()` on the resolved runs). The bake stays permissive.

**Files:**
- Modify: `apps/web/src/components/editor/text/TextNode.tsx`
- Modify: `apps/web/src/components/editor/text/TextProps.tsx`
- Create: `apps/web/src/components/editor/text/useOverflow.ts`
- Modify: `apps/web/src/lib/paragraphs.test.ts`
- Modify: `apps/web/src/lib/paragraphs.ts`

**Interfaces:**
- Consumes: M2 `resolveLoadedRuns`, `covers`, `paragraphBox`, `paragraphsOf`, `session.paragraphs`, `TextProps` (re-renders on every editor transaction through `current`).
- Produces: `lib/paragraphs.ts` `overflowsOriginal(box, paragraph) -> boolean` (0.5 pt slack), `hasUnsupportedChars(paragraphs, fonts, peek) -> boolean` (false until the chain's fonts are loaded); `components/editor/text/useOverflow.ts` `useOverflow(op)`; `TextNode` outline (`name="overflow"`, `#ea580c`); `TextProps` status messages.

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/src/lib/paragraphs.test.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/paragraphs.test.ts
+++ b/apps/web/src/lib/paragraphs.test.ts
@@ -5,7 +5,7 @@ import type { FontRef, Run } from "@edith/ops";
 import type { DocFont, Paragraph, TextData } from "@/lib/api";
 import { fontKey, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
 import { runsText } from "@/lib/runs";
-import { hardBreaks, maskRects, paragraphBox, paragraphRuns, prepareRuns, rawToBox, resolveLoadedRuns, resolveRunFonts } from "@/lib/paragraphs";
+import { hardBreaks, hasUnsupportedChars, maskRects, overflowsOriginal, paragraphBox, paragraphRuns, prepareRuns, rawToBox, resolveLoadedRuns, resolveRunFonts } from "@/lib/paragraphs";
 
 const FONTS = path.resolve(__dirname, "../../../../packages/fonts/files");
 const metrics = new Map<string, FontMetrics>();
@@ -150,3 +150,33 @@ describe("maskRects", () => {
     expect(m.h).toBeCloseTo(1.2 * p.lines[0].size);
   });
 });
+
+describe("overflowsOriginal", () => {
+  const p = paragraphs[0];
+  it("is false for the unchanged paragraph and true when the text needs another line", () => {
+    const box = paragraphBox(p, bundled);
+    expect(overflowsOriginal(box, p)).toBe(false);
+    const longer = paragraphBox(p, bundled, (ps) => [[...ps[0], { ...ps[0][0], text: " tambahan kalimat yang cukup panjang untuk satu baris lagi" }], ...ps.slice(1)]);
+    expect(longer.layout.length).toBeGreaterThan(box.layout.length);
+    expect(overflowsOriginal(longer, p)).toBe(true);
+  });
+  it("is false when the edit got shorter", () => {
+    const shorter = paragraphBox(p, bundled, (ps) => [[{ ...ps[0][0], text: "Pendek." }]]);
+    expect(overflowsOriginal(shorter, p)).toBe(false);
+  });
+});
+
+describe("hasUnsupportedChars", () => {
+  const notoAbcz: FontMetrics = { ...onlyAbc, hasGlyph: (cp) => "abcz ".includes(String.fromCodePoint(cp)) };
+  const peek = (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? notoAbcz : onlyAbc);
+  it("is false when the fallback chain covers every character", () => {
+    expect(hasUnsupportedChars([[run("abz")]], fonts, peek)).toBe(false); // z: Noto Sans has it
+    expect(hasUnsupportedChars([[run("ab c\n")]], fonts, peek)).toBe(false);
+  });
+  it("is true when even the last fallback lacks a glyph", () => {
+    expect(hasUnsupportedChars([[run("ab✓")]], fonts, peek)).toBe(true);
+  });
+  it("waits for the fonts of the chain", () => {
+    expect(hasUnsupportedChars([[run("ab✓")]], fonts, (f) => (isOriginal(f) ? onlyAbc : null))).toBe(false);
+  });
+});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/web && npx vitest run src/lib/paragraphs.test.ts`
Expected: `Tests  5 failed | 26 passed (31)` — `hasUnsupportedChars is not a function` / `overflowsOriginal is not a function`.

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/text/TextNode.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/text/TextNode.tsx
+++ b/apps/web/src/components/editor/text/TextNode.tsx
@@ -7,6 +7,9 @@ import { charOffsets, cssFamily, fontKey, fontStore, textWidth } from "@/lib/fon
 import { decorBands } from "@/lib/textDecor";
 import { boxFonts } from "@/lib/textbox";
 import { fontsReady } from "./textEdit";
+import { useOverflow } from "./useOverflow";
+
+const OVERFLOW = "#ea580c";
 
 /** Draws a text box glyph-by-glyph at the PDF-quantized offsets — the same positions the API bakes —
  *  with backgrounds under and underline/strike over the glyphs, as the bake does. */
@@ -26,11 +29,17 @@ export function TextNode({ op, hidden }: { op: TextAdd | TextEdit; hidden: boole
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [keys, ready]);
 
+  const overflow = useOverflow(op);
   const runs = box.paragraphs.flat();
   const { x, y, w, h } = box.rect;
   return (
     <>
       <Rect x={x} y={y} width={w} height={h} fill="transparent" />
+      {overflow && !hidden && (
+        // Owner decision (M2 backlog): longer text is not pushed down; show that it may cover what follows.
+        <Rect name="overflow" x={x - 2} y={y - 2} width={w + 4} height={h + 4} stroke={OVERFLOW} strokeWidth={1.5}
+          strokeScaleEnabled={false} dash={[6, 3]} listening={false} />
+      )}
       {ready && !hidden && (
         <Shape
           listening={false}
```

Modify `apps/web/src/components/editor/text/TextProps.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/text/TextProps.tsx
+++ b/apps/web/src/components/editor/text/TextProps.tsx
@@ -5,13 +5,14 @@ import { useStore } from "zustand";
 import type { TextAdd } from "@edith/ops";
 import { fontStore } from "@/lib/fonts";
 import { isTextOp } from "@/lib/objects";
-import { prepareRuns } from "@/lib/paragraphs";
+import { hasUnsupportedChars, prepareRuns } from "@/lib/paragraphs";
 import { applyPatch, attrsOf, docToRuns, fontStyle, type RunAttrs } from "@/lib/richtext";
 import { t } from "@/lib/strings";
 import { boxFonts, relayout, withStyle, type BoxPatch } from "@/lib/textbox";
 import { editorStore, useEditor, type ToolStyle } from "@/store/editor";
 import { textStore, useText } from "@/store/text";
 import { ColorField } from "../ColorField";
+import { useOverflow } from "./useOverflow";
 import { session, textEditStore } from "./textEdit";
 
 /** Restyles the whole selected text op (no session open). Repeated changes within a second are one undo step. */
@@ -92,6 +93,10 @@ export function TextProps() {
   useEffect(() => { fontStore.families().then(setFamilies).catch(() => {}); }, []);
 
   const box = editing?.box ?? (isTextOp(selected) ? selected.box : null);
+  const overflow = useOverflow(!editing && isTextOp(selected) ? selected : undefined);
+  // TextProps re-renders on every editor transaction (`current`), so the session's runs are fresh here.
+  const shown = editing ? session.paragraphs ?? editing.box.paragraphs : box?.paragraphs;
+  const unsupported = !!shown && hasUnsupportedChars(shown, fonts, (f) => fontStore.peek(f));
   const attrs: RunAttrs = (editing && current) ?? (box ? attrsOf(box.paragraphs[0][0]) : toolAttrs(style));
   const fs = fontStyle(attrs.font, fonts);
   const align = box?.align ?? style.align;
@@ -138,6 +143,8 @@ export function TextProps() {
         <button key={a} type="button" aria-label={alignLabel[a]} aria-pressed={align === a}
           className={toggle(align === a)} onClick={() => set({ align: a })}>{ALIGN_ICON[a]}</button>
       ))}
+      {unsupported && <span role="status" className="whitespace-nowrap text-xs text-danger">⚠ {t.text.unsupported}</span>}
+      {overflow && <span role="status" className="whitespace-nowrap text-xs text-[#ea580c]">⚠ {t.text.overflow}</span>}
     </div>
   );
 }
```

Create `apps/web/src/components/editor/text/useOverflow.ts`:
```ts
"use client";

import type { TextAdd, TextEdit } from "@edith/ops";
import { overflowsOriginal } from "@/lib/paragraphs";
import { useEditor } from "@/store/editor";
import { paragraphsOf, useText } from "@/store/text";

/** True when `op` is an edited paragraph whose text is now taller than the original paragraph. */
export function useOverflow(op: TextAdd | TextEdit | undefined): boolean {
  const src = useEditor((s) => (op ? s.doc.pages.find((p) => p.pageKey === op.pageKey)?.src : undefined));
  const paragraph = useText((s) => (op?.type === "text.edit" && src ? paragraphsOf(src, s.pages).find((p) => p.id === op.paragraphId) : undefined));
  return op?.type === "text.edit" && !!paragraph && overflowsOriginal(op.box, paragraph);
}
```

Modify `apps/web/src/lib/paragraphs.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/paragraphs.ts
+++ b/apps/web/src/lib/paragraphs.ts
@@ -157,3 +157,28 @@ export function maskRects(p: Paragraph): Rect[] {
     x: l.rect.x - 0.5, y: l.baseline - MASK_ASCENT * l.size, w: l.rect.w + 1, h: (MASK_ASCENT + MASK_DESCENT) * l.size,
   }));
 }
+
+/** Slack (pt) before an edited paragraph counts as taller than the original. */
+const OVERFLOW_SLACK = 0.5;
+
+/** True when the edited paragraph's laid-out height (first to last baseline) exceeds the original
+ *  paragraph's: it may run into the text below, which is not moved (owner decision, M2 backlog). */
+export function overflowsOriginal(box: TextBox, p: Paragraph): boolean {
+  const lines = box.layout;
+  if (lines.length < 2 || !p.lines.length) return false;
+  const height = lines[lines.length - 1].baseline - lines[0].baseline;
+  const original = p.lines[p.lines.length - 1].baseline - p.lines[0].baseline;
+  return height > original + OVERFLOW_SLACK;
+}
+
+/** True when some character has no glyph even after the whole font fallback (original → substitute →
+ *  Arimo → Noto Sans) with the loaded fonts: the bake draws it with a builtin font or as a box (CJK,
+ *  emoji, ✓ …). False while a font of the chain is not loaded yet. */
+export function hasUnsupportedChars(paragraphs: Run[][], fonts: FontTable, peek: (f: FontRef) => FontMetrics | null): boolean {
+  const resolved = resolveLoadedRuns(paragraphs, fonts, peek);
+  if (!resolved) return false;
+  return resolved.flat().some((r) => {
+    const m = peek(r.font);
+    return !!m && !covers(m, r.text.replace(/[\n\r\t]/g, ""));
+  });
+}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run src/lib/paragraphs.test.ts`
Expected: `Tests  31 passed (31)`.

- [ ] **Step 5: Full check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: `Tests  209 passed (209)`; tsc prints nothing; eslint reports no problems. API untouched (`cd apps/api && uv run pytest -q` still `295 passed`).

- [ ] **Step 6: Try it in the browser**

Dev app with `apps/web/e2e/fixtures/text.pdf`: double-click the first paragraph, add a long sentence, click away → orange dashed outline; select it → "Teks lebih panjang …" in the properties bar. Type `漢字` in a text box → "⚠ beberapa karakter tidak didukung font ini".

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/text/TextNode.tsx apps/web/src/components/editor/text/TextProps.tsx apps/web/src/components/editor/text/useOverflow.ts apps/web/src/lib/paragraphs.test.ts apps/web/src/lib/paragraphs.ts
git commit -m "feat(web): warn about overflowing edits and characters no font can draw" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
