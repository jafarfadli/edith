# Task 7: Web rendering: stamps, symbols, signatures, notes, links, multiplied highlights

Draws every new op in the Konva overlay exactly as the bake does: stamps with the Task 2 layout contract (glyph by glyph at quantized offsets, like M1 `TextNode`), symbols with the shared unit paths, signatures as images, sticky notes as MuPDF's Note icon, links as a dashed click area (no appearance in the PDF), and text markup with MuPDF's appearance geometry.

**Highlights multiply.** In the PDF a highlight has `/BM /Multiply`, so the text under it stays dark. Konva draws into its own canvas over the pdf.js canvas, where `globalCompositeOperation` cannot reach the page, so text markup goes into a second Konva layer whose `<canvas>` has CSS `mix-blend-mode: multiply` (checked in Chromium: black text stays black under yellow). The layer sits over the objects (annotations are above page content). Markup cannot be dragged or resized (it is attached to its text); notes can be dragged but not resized.

**Files:**
- Modify: `apps/web/src/components/editor/ObjectShape.tsx`
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`
- Create: `apps/web/src/components/editor/marks/MarkupShape.tsx`
- Create: `apps/web/src/components/editor/marks/StampNode.tsx`
- Create: `apps/web/src/lib/markup.test.ts`
- Create: `apps/web/src/lib/markup.ts`
- Create: `apps/web/src/lib/stamps.test.ts`
- Create: `apps/web/src/lib/stamps.ts`
- Create: `apps/web/src/lib/symbols.test.ts`
- Create: `apps/web/src/lib/symbols.ts`

**Interfaces:**
- Consumes: Task 6 `isMarkup`, `isResizable`, `NOTE_SIZE`; Task 2 contracts; M1 `ObjectShape`, `PageOverlay`, `fontStore`, `charOffsets`, `cssFamily`, `textWidth`.
- Produces:
  - `lib/stamps.ts`: `STAMP_FONT`, `STAMP` constants (same values as Task 2), `STAMP_COLORS` (5: `#1d4ed8 #15803d #b91c1c #c2410c #111111`), `STAMP_PRESETS: {id, label, color}[]` (17), `StampLine`, `StampKind = Pick<StampAdd, "preset" | "custom">`, `stampTexts(kind)`, `borderWidth(w, h)`, `stampLayout(w, h, texts, metrics)`, `stampBorder(w, h) -> {x, y, w, h, width, radius}` (relative), `stampRect(kind, metrics, page)` (40 pt tall, 54 with a date/time line, centred).
  - `lib/symbols.ts`: `SYMBOL_PATHS`, `SYMBOL_WIDTH`, `symbolPaths(kind, rect) -> {paths, width}`.
  - `lib/markup.ts`: `markupLine(kind, quad) -> Rect` (line h/16 thick, centre h/7 or 3h/7 above the quad bottom).
  - `components/editor/marks/StampNode.tsx` (`StampNode({op})`), `marks/MarkupShape.tsx` (`MarkupShape({op, selected?})`); `ObjectShape` handles `signature.add`, `stamp.add`, `symbol.add`, `link.add`, `annot.add`.
  - `PageOverlay`: markups in a multiplying layer (selectable with the select tool); Transformer `resizeEnabled` only for `isResizable` ops.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/markup.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { markupLine } from "@/lib/markup";

describe("markupLine", () => {
  it("matches MuPDF's underline/strike appearance (13.8 pt quad: width 0.8625, 1.971 / 5.914 above the bottom)", () => {
    const q = { x: 72, y: 89.2, w: 100, h: 13.8 };
    const u = markupLine("underline", q), s = markupLine("strike", q);
    expect(u.h).toBeCloseTo(0.8625, 4);
    expect(u.y + u.h / 2).toBeCloseTo(103 - 1.9714, 3);
    expect(s.y + s.h / 2).toBeCloseTo(103 - 5.9143, 3);
    expect([u.x, u.w]).toEqual([72, 100]);
  });
});
```

Create `apps/web/src/lib/stamps.test.ts`:
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { metricsFromBuffer, textWidth } from "@/lib/fonts";
import { borderWidth, STAMP_PRESETS, stampBorder, stampLayout, stampRect, stampTexts } from "@/lib/stamps";

const bold = metricsFromBuffer(readFileSync(path.resolve(__dirname, "../../../../packages/fonts/files/Arimo-Bold.ttf")));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

describe("stamps", () => {
  it("has the 17 presets of the spec", () => {
    expect(STAMP_PRESETS).toHaveLength(17);
    expect(new Set(STAMP_PRESETS.map((p) => p.id)).size).toBe(17);
    expect(stampTexts({ preset: "not-for-public-release" })).toEqual(["NOT FOR PUBLIC RELEASE"]);
  });

  it("joins date and time on a second line", () => {
    expect(stampTexts({ custom: { text: "DIPERIKSA", date: "05/11/2026", time: "14:30" } })).toEqual(["DIPERIKSA", "05/11/2026 14:30"]);
    expect(stampTexts({ custom: { text: "OK", date: null, time: "09:00" } })).toEqual(["OK", "09:00"]);
    expect(stampTexts({ custom: { text: "OK" } })).toEqual(["OK"]);
  });

  it("lays out like the bake (same numbers as apps/api/tests/test_bake_marks.py)", () => {
    const [one] = stampLayout(140, 40, ["APPROVED"], bold);
    expect([r4(one.size), r4(one.x), r4(one.baseline)]).toEqual([20, 13.93, 26.88]);
    const [label, sub] = stampLayout(160, 54, ["DIPERIKSA", "05/11/2026 14:30"], bold);
    expect([r4(label.size), r4(label.x), r4(label.baseline)]).toEqual([19.44, 27.1232, 27]);
    expect([r4(sub.size), r4(sub.x), r4(sub.baseline)]).toEqual([10.8, 37.6856, 42.12]);
    const [narrow] = stampLayout(120, 40, ["NOT FOR PUBLIC RELEASE"], bold);
    expect([r4(narrow.size), r4(narrow.x)]).toEqual([7.8897, 6.8]);
    expect([borderWidth(140, 40), borderWidth(10, 4)]).toEqual([2, 0.5]);
  });

  it("insets the border by half its width", () => {
    expect(stampBorder(140, 40)).toEqual({ x: 1, y: 1, w: 138, h: 38, width: 2, radius: 0.2 * 38 });
  });

  it("sizes a new stamp to its label, centred on the page", () => {
    const r = stampRect({ preset: "approved" }, bold, { width: 595, height: 842 });
    expect(r.h).toBe(40);
    expect(r.w).toBeCloseTo(textWidth("APPROVED", bold, 20) + 2 * (0.12 * 40 + 2) + 1, 6);
    expect(r.x).toBeCloseTo((595 - r.w) / 2, 6);
    const [line] = stampLayout(r.w, r.h, ["APPROVED"], bold);
    expect(line.size).toBe(20); // the label is not shrunk
    expect(stampRect({ custom: { text: "OK", date: "05/11/2026" } }, bold, { width: 595, height: 842 }).h).toBe(54);
  });
});
```

Create `apps/web/src/lib/symbols.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { symbolPaths } from "@/lib/symbols";

describe("symbols", () => {
  it("scales the unit paths into the rect (same numbers as apps/api/tests/test_bake_marks.py)", () => {
    const check = symbolPaths("check", { x: 10, y: 20, w: 50, h: 40 });
    expect(check.paths.map((p) => p.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6])))
      .toEqual([[[16, 40.8], [30, 52], [54, 28]]]);
    expect(check.width).toBeCloseTo(4.8, 9);
    expect(symbolPaths("cross", { x: 0, y: 0, w: 100, h: 100 }).paths).toEqual([[[18, 18], [82, 82]], [[82, 18], [18, 82]]]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/web && npx vitest run src/lib/stamps.test.ts src/lib/symbols.test.ts src/lib/markup.test.ts`
Expected: `Test Files  3 failed (3)` — `Cannot find module '@/lib/stamps'` (and `symbols`, `markup`).

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/ObjectShape.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/ObjectShape.tsx
+++ b/apps/web/src/components/editor/ObjectShape.tsx
@@ -2,9 +2,24 @@
 
 import { Arrow, Ellipse, Image as KImage, Line, Rect } from "react-konva";
 import type { ContentOp, Rect as R } from "@edith/ops";
-import { arrowHead } from "@/lib/objects";
+import { arrowHead, NOTE_SIZE } from "@/lib/objects";
+import { symbolPaths } from "@/lib/symbols";
+import { MarkupShape } from "./marks/MarkupShape";
+import { StampNode } from "./marks/StampNode";
 import { useImageAsset } from "./useImageAsset";
 
+const LINK_COLOR = "#2563eb";
+
+/** MuPDF's Note icon: a filled square with a black border and four text lines. */
+function NoteIcon({ x, y, color }: { x: number; y: number; color: string }) {
+  return (
+    <>
+      <Rect x={x + 0.5} y={y + 0.5} width={NOTE_SIZE - 1} height={NOTE_SIZE - 1} fill={color} stroke="#000000" strokeWidth={1} />
+      {[4, 6, 8, 10].map((dy) => <Rect key={dy} x={x + 4} y={y + dy} width={8} height={1} fill="#000000" listening={false} />)}
+    </>
+  );
+}
+
 function ImageObject({ docId, assetId, rect }: { docId: string; assetId: string; rect: R }) {
   const img = useImageAsset(docId, assetId);
   return img
@@ -23,8 +38,26 @@ export function ObjectShape({ op, docId }: { op: ContentOp; docId: string }) {
       const r = o.rect as R;
       return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill={o.fill === "white" ? "#ffffff" : "#000000"} opacity={0.75} stroke="#c2410c" strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />;
     }
-    case "image.add":
+    case "image.add": case "signature.add":
       return <ImageObject docId={docId} assetId={o.assetId as string} rect={o.rect as R} />;
+    case "stamp.add":
+      return <StampNode op={op} />;
+    case "symbol.add": {
+      const { paths, width } = symbolPaths(op.kind, op.rect);
+      return <>
+        <Rect x={op.rect.x} y={op.rect.y} width={op.rect.w} height={op.rect.h} fill="transparent" />
+        {paths.map((p, i) => <Line key={i} points={p.flat()} stroke={op.color} strokeWidth={width} lineCap="round" lineJoin="round" listening={false} />)}
+      </>;
+    }
+    case "link.add": {
+      const r = op.rect;
+      // Links have no appearance in the PDF; on screen a light box shows where the click area is.
+      return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(37,99,235,0.08)" stroke={LINK_COLOR} strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />;
+    }
+    case "annot.add":
+      return op.kind === "note"
+        ? <NoteIcon x={op.point![0]} y={op.point![1]} color={op.color} />
+        : <MarkupShape op={op} />;
     case "ink.add":
       return <>{(o.paths as number[][][]).map((path, i) =>
         path.length === 1
```

Modify `apps/web/src/components/editor/PageOverlay.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/PageOverlay.tsx
+++ b/apps/web/src/components/editor/PageOverlay.tsx
@@ -7,13 +7,20 @@ import { useStore } from "zustand";
 import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
 import { groupTransform, screenSize, type PageGeom } from "@/lib/coords";
 import { newId } from "@/lib/id";
-import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isTextOp, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
+import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
 import { editorStore, useEditor } from "@/store/editor";
+import { MarkupShape } from "./marks/MarkupShape";
 import { ObjectShape } from "./ObjectShape";
 import { textEditStore } from "./text/textEdit";
 
 type TextOp = TextAdd | TextEdit;
 
+/** Highlights multiply over the pdf.js canvas below (as their /BM /Multiply appearance does in a
+ *  viewer), so text under them stays dark: the markup layer's canvas blends with the page. */
+function multiplyLayer(layer: Konva.Layer | null) {
+  if (layer) layer.getNativeCanvasElement().style.mixBlendMode = "multiply";
+}
+
 export const overlayHooks: {
   onTextPointerDown?: (pageKey: string, at: Pt) => void;
   renderText?: (op: TextOp, selected: boolean) => React.ReactNode;
@@ -43,6 +50,9 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
   const drawing = useRef<{ start: Pt; draft: ContentOp | null; stop: () => void } | null>(null);
 
   const mine = order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey);
+  // Text markup is drawn in its own (multiplying) layer, over the objects: in the PDF it is an annotation.
+  const objs = mine.filter((op) => !isMarkup(op));
+  const markups = mine.filter(isMarkup);
 
   useEffect(() => {
     const node = selection ? nodes.current.get(selection) : undefined;
@@ -146,7 +156,7 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
         <Layer>
           <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale}>
             {overlayHooks.renderUnder?.(pageKey)}
-            {mine.map((op) => (
+            {objs.map((op) => (
               <Group
                 key={op.id}
                 ref={(n) => { if (n) nodes.current.set(op.id, n); else nodes.current.delete(op.id); }}
@@ -184,12 +194,13 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
                   : <ObjectShape op={op} docId={docId} />}
               </Group>
             ))}
-            {draft && <ObjectShape op={draft} docId={docId} />}
+            {draft && !isMarkup(draft) && <ObjectShape op={draft} docId={docId} />}
             {overlayHooks.renderOver?.(pageKey)}
           </Group>
           <Transformer
             ref={trRef}
             rotateEnabled={false}
+            resizeEnabled={!!selection && isResizable(objects[selection])}
             ignoreStroke
             keepRatio={false}
             enabledAnchors={selection && isTextOp(objects[selection])
@@ -200,6 +211,20 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
             anchorSize={8}
           />
         </Layer>
+        <Layer ref={multiplyLayer} listening={tool === "select"}>
+          <Group x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale}>
+            {markups.map((op) => (
+              <Group key={op.id} onPointerDown={(e) => {
+                e.cancelBubble = true;
+                textEditStore.getState().selectParagraph(null);
+                editorStore.getState().select(op.id);
+              }}>
+                <MarkupShape op={op} selected={selection === op.id} />
+              </Group>
+            ))}
+            {draft && isMarkup(draft) && <MarkupShape op={draft} />}
+          </Group>
+        </Layer>
       </Stage>
     </div>
   );
```

Create `apps/web/src/components/editor/marks/MarkupShape.tsx`:
```tsx
"use client";

import { Rect } from "react-konva";
import type { AnnotAdd } from "@edith/ops";
import { markupLine } from "@/lib/markup";

/** Text markup as MuPDF draws it: a highlight fills each quad (its layer multiplies it over the page),
 *  underline/strike draw a line per quad (the whole quad stays clickable). */
export function MarkupShape({ op, selected = false }: { op: AnnotAdd; selected?: boolean }) {
  const quads = op.quads ?? [];
  return (
    <>
      {quads.map((q, i) => (
        <Rect key={i} x={q.x} y={q.y} width={q.w} height={q.h} fill={op.kind === "highlight" ? op.color : "transparent"} />
      ))}
      {op.kind !== "highlight" && op.kind !== "note" && quads.map((q, i) => {
        const l = markupLine(op.kind as "underline" | "strike", q);
        return <Rect key={`l${i}`} x={l.x} y={l.y} width={l.w} height={l.h} fill={op.color} listening={false} />;
      })}
      {selected && quads.map((q, i) => (
        <Rect key={`s${i}`} x={q.x - 1} y={q.y - 1} width={q.w + 2} height={q.h + 2} stroke="#0f766e" strokeWidth={1}
          strokeScaleEnabled={false} dash={[4, 3]} listening={false} />
      ))}
    </>
  );
}
```

Create `apps/web/src/components/editor/marks/StampNode.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Rect, Shape } from "react-konva";
import type { StampAdd } from "@edith/ops";
import { charOffsets, cssFamily, fontStore } from "@/lib/fonts";
import { STAMP_FONT, stampBorder, stampLayout, stampTexts } from "@/lib/stamps";

/** A stamp as the bake draws it: rounded border, then the lines glyph by glyph at PDF-quantized offsets. */
export function StampNode({ op }: { op: StampAdd }) {
  const [metrics, setMetrics] = useState(() => fontStore.peek(STAMP_FONT));
  useEffect(() => {
    if (metrics) return;
    let alive = true;
    fontStore.load(STAMP_FONT).then((m) => { if (alive) setMetrics(m); }).catch((e) => console.warn("stamp font failed", e));
    return () => { alive = false; };
  }, [metrics]);

  const { x, y, w, h } = op.rect;
  const b = stampBorder(w, h);
  return (
    <>
      <Rect x={x + b.x} y={y + b.y} width={b.w} height={b.h} cornerRadius={b.radius} stroke={op.color} strokeWidth={b.width} fill="transparent" />
      {metrics && (
        <Shape
          listening={false}
          sceneFunc={(ctx) => {
            const c = ctx._context as CanvasRenderingContext2D & { fontKerning?: string };
            c.save();
            c.textBaseline = "alphabetic";
            if ("fontKerning" in c) c.fontKerning = "none";
            c.fillStyle = op.color;
            for (const line of stampLayout(w, h, stampTexts(op), metrics)) {
              c.font = `${line.size}px "${cssFamily(STAMP_FONT)}"`;
              const offs = charOffsets(line.text, metrics, line.size);
              let i = 0;
              for (const ch of line.text) c.fillText(ch, x + line.x + offs[i++], y + line.baseline);
            }
            c.restore();
          }}
        />
      )}
    </>
  );
}
```

Create `apps/web/src/lib/markup.ts`:
```ts
import type { Rect } from "@edith/ops";

/** Where MuPDF's appearance stream draws an underline/strike in quad `q`: a line q.h/16 thick whose
 *  centre is q.h/7 (underline) or 3·q.h/7 (strike) above the quad's bottom. */
export function markupLine(kind: "underline" | "strike", q: Rect): Rect {
  const t = q.h / 16;
  const centre = q.y + q.h - (kind === "underline" ? q.h / 7 : (3 * q.h) / 7);
  return { x: q.x, y: centre - t / 2, w: q.w, h: t };
}
```

Create `apps/web/src/lib/stamps.ts`:
```ts
import type { BundledFont, Rect, StampAdd, StampPreset } from "@edith/ops";
import { textWidth, type FontMetrics } from "@/lib/fonts";

/** Stamp geometry — shared contract with apps/api/edith/bake/stamps.py (same names, same numbers). */
export const STAMP_FONT: BundledFont = { kind: "bundled", family: "Arimo", bold: true, italic: false };
export const STAMP = {
  capHeight: 0.688, border: 0.05, radius: 0.2, pad: 0.12,
  oneLineSize: 0.5, labelSize: 0.36, subSize: 0.2, labelBaseline: 0.5, subBaseline: 0.78,
} as const;

/** The 5 stamp colors (custom stamps pick one; presets have their own). */
export const STAMP_COLORS = ["#1d4ed8", "#15803d", "#b91c1c", "#c2410c", "#111111"] as const;
const [BLUE, GREEN, RED, ORANGE] = STAMP_COLORS;

export const STAMP_PRESETS: { id: StampPreset; label: string; color: string }[] = [
  { id: "approved", label: "APPROVED", color: GREEN },
  { id: "not-approved", label: "NOT APPROVED", color: RED },
  { id: "draft", label: "DRAFT", color: BLUE },
  { id: "final", label: "FINAL", color: GREEN },
  { id: "completed", label: "COMPLETED", color: GREEN },
  { id: "confidential", label: "CONFIDENTIAL", color: RED },
  { id: "for-public-release", label: "FOR PUBLIC RELEASE", color: GREEN },
  { id: "not-for-public-release", label: "NOT FOR PUBLIC RELEASE", color: RED },
  { id: "for-comment", label: "FOR COMMENT", color: BLUE },
  { id: "void", label: "VOID", color: RED },
  { id: "preliminary-results", label: "PRELIMINARY RESULTS", color: BLUE },
  { id: "information-only", label: "INFORMATION ONLY", color: BLUE },
  { id: "witness", label: "WITNESS", color: BLUE },
  { id: "initial-here", label: "INITIAL HERE", color: ORANGE },
  { id: "sign-here", label: "SIGN HERE", color: ORANGE },
  { id: "accepted", label: "ACCEPTED", color: GREEN },
  { id: "rejected", label: "REJECTED", color: RED },
];
const LABELS = new Map(STAMP_PRESETS.map((p) => [p.id, p.label]));

export interface StampLine { text: string; size: number; x: number; baseline: number }
export type StampKind = Pick<StampAdd, "preset" | "custom">;

/** The label, then the date/time line (custom stamps that have one). */
export function stampTexts(s: StampKind): string[] {
  if (s.preset) return [LABELS.get(s.preset) ?? s.preset];
  const c = s.custom!;
  const sub = [c.date, c.time].filter(Boolean).join(" ");
  return sub ? [c.text, sub] : [c.text];
}

export function borderWidth(w: number, h: number): number {
  return Math.max(0.5, STAMP.border * Math.min(w, h));
}

/** Sizes and positions (relative to the rect) of the stamp's lines in a `w` × `h` rect. */
export function stampLayout(w: number, h: number, texts: string[], m: FontMetrics): StampLine[] {
  const unit = (t: string) => textWidth(t, m, 1);
  const avail = Math.max(w - 2 * (STAMP.pad * h + borderWidth(w, h)), 1);
  const fit = (t: string, size: number) => (unit(t) > 0 ? Math.min(size, avail / unit(t)) : size);
  const rows: [string, number, number][] = [];
  if (texts.length === 1) {
    const s = fit(texts[0], STAMP.oneLineSize * h);
    rows.push([texts[0], s, h / 2 + (STAMP.capHeight * s) / 2]);
  } else {
    rows.push([texts[0], fit(texts[0], STAMP.labelSize * h), STAMP.labelBaseline * h]);
    rows.push([texts[1], fit(texts[1], STAMP.subSize * h), STAMP.subBaseline * h]);
  }
  return rows.map(([text, size, baseline]) => ({ text, size, x: (w - unit(text) * size) / 2, baseline }));
}

/** The border rect (inset by half the border width) and its corner radius, relative to the stamp rect. */
export function stampBorder(w: number, h: number): { x: number; y: number; w: number; h: number; width: number; radius: number } {
  const bw = borderWidth(w, h);
  const iw = w - bw, ih = h - bw;
  return { x: bw / 2, y: bw / 2, w: iw, h: ih, width: bw, radius: STAMP.radius * Math.min(iw, ih) };
}

/** Default rect of a new stamp, centred on the page: 40 pt tall (54 with a date/time line), as wide as the label needs. */
export function stampRect(s: StampKind, m: FontMetrics, page: { width: number; height: number }): Rect {
  const texts = stampTexts(s);
  const h = texts.length === 1 ? 40 : 54;
  const size = (texts.length === 1 ? STAMP.oneLineSize : STAMP.labelSize) * h;
  const pad = 2 * (STAMP.pad * h + borderWidth(200, h));
  const w = Math.max(60, Math.max(...texts.map((t, i) => textWidth(t, m, i === 0 ? size : STAMP.subSize * h))) + pad + 1);
  return { x: (page.width - w) / 2, y: (page.height - h) / 2, w, h };
}
```

Create `apps/web/src/lib/symbols.ts`:
```ts
import type { Rect, SymbolAdd } from "@edith/ops";

/** Check/cross geometry — shared contract with apps/api/edith/bake/symbols.py: points in the unit
 *  square of the rect, stroke width × the rect's shorter side, round caps and joins. */
export const SYMBOL_PATHS: Record<SymbolAdd["kind"], [number, number][][]> = {
  check: [[[0.12, 0.52], [0.4, 0.8], [0.88, 0.2]]],
  cross: [[[0.18, 0.18], [0.82, 0.82]], [[0.82, 0.18], [0.18, 0.82]]],
};
export const SYMBOL_WIDTH = 0.12;

export function symbolPaths(kind: SymbolAdd["kind"], r: Rect): { paths: [number, number][][]; width: number } {
  const paths = SYMBOL_PATHS[kind].map((path) => path.map(([u, v]) => [r.x + u * r.w, r.y + v * r.h] as [number, number]));
  return { paths, width: SYMBOL_WIDTH * Math.min(r.w, r.h) };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run src/lib/stamps.test.ts src/lib/symbols.test.ts src/lib/markup.test.ts`
Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: Full check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: `Tests  183 passed (183)`; tsc prints nothing; eslint reports no problems. API untouched (`cd apps/api && uv run pytest -q` still `295 passed`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor/ObjectShape.tsx apps/web/src/components/editor/PageOverlay.tsx apps/web/src/components/editor/marks/MarkupShape.tsx apps/web/src/components/editor/marks/StampNode.tsx apps/web/src/lib/markup.test.ts apps/web/src/lib/markup.ts apps/web/src/lib/stamps.test.ts apps/web/src/lib/stamps.ts apps/web/src/lib/symbols.test.ts apps/web/src/lib/symbols.ts
git commit -m "feat(web): draw stamps, symbols, signatures, notes, links and multiplied text markup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
