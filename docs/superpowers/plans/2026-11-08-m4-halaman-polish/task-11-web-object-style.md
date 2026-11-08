# Task 11: Rotation handle, opacity, dash and polygon/polyline/cloud tools

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 10 leaves, new files are complete.

**Goal:** Objects render with their opacity and rotation (Konva group turned around the rect centre — the same formula as the bake), the Transformer gets a rotation handle (snaps every 45°), point objects are rotated/resized by transforming their points; Bentuk▾ gains Poligon, Garis bersambung, Awan (click vertices; same-spot double-click, Enter or a click on the first vertex finishes; Esc cancels); the properties bar gets Gaya garis and Opasitas; the rich-text editor turns with a rotated text box; unfilled rects/ellipses get an 8 pt hit stroke.

**Files:**
- Modify: `apps/web/src/components/editor/ObjectShape.tsx`
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`
- Modify: `apps/web/src/components/editor/PropertiesBar.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Create: `apps/web/src/components/editor/shapes/usePolyTool.ts`
- Modify: `apps/web/src/components/editor/text/TextEditor.tsx`
- Modify: `apps/web/src/lib/strings.ts`

**Interfaces:**
- Consumes: Task 6 helpers and `geometry.ts`.
- Produces:
- `PageOverlay.objectGroupAttrs(op)`; `shapes/usePolyTool(pageKey, tool, scale) -> {active, preview, click, hover, finish, doubleClick}`; `ObjectShape` draws `dash`, polygon/polyline (`Line`), cloud (`Shape` + Béziers); strings `t.editor.{polygon, polyline, cloud, dash, dashSolid, dashDashed, dashDotted, opacity}`.

- [ ] **Step 1: Implement**

Modify `apps/web/src/components/editor/ObjectShape.tsx`:

```diff
--- a/apps/web/src/components/editor/ObjectShape.tsx
+++ b/apps/web/src/components/editor/ObjectShape.tsx
@@ -1,7 +1,8 @@
 "use client";
 
-import { Arrow, Ellipse, Image as KImage, Line, Rect } from "react-konva";
+import { Arrow, Ellipse, Image as KImage, Line, Rect, Shape } from "react-konva";
 import type { ContentOp, Rect as R } from "@edith/ops";
+import { cloudBeziers, dashPattern, type Dash, type Pt } from "@/lib/geometry";
 import { arrowHead, NOTE_SIZE } from "@/lib/objects";
 import { symbolPaths } from "@/lib/symbols";
 import { MarkupShape } from "./marks/MarkupShape";
@@ -27,6 +28,23 @@ function ImageObject({ docId, assetId, rect }: { docId: string; assetId: string;
     : <Rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="#e3e6eb" />;
 }
 
+/** A cloud: its scalloped border (shared geometry with the bake) as one closed Bézier path. */
+function Cloud({ points, width, stroke, fill, dash }: { points: Pt[]; width: number; stroke?: string; fill?: string; dash: ReturnType<typeof dashPattern> }) {
+  const arcs = cloudBeziers(points, width);
+  return (
+    <Shape
+      sceneFunc={(ctx, shape) => {
+        ctx.beginPath();
+        if (arcs.length) ctx.moveTo(arcs[0][0][0], arcs[0][0][1]);
+        for (const [, c1, c2, p] of arcs) ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p[0], p[1]);
+        ctx.closePath();
+        ctx.fillStrokeShape(shape);
+      }}
+      stroke={stroke} strokeWidth={width} fill={fill} lineJoin="round" lineCap={dash?.lineCap ?? "round"} dash={dash?.dash} hitStrokeWidth={12}
+    />
+  );
+}
+
 export function ObjectShape({ op, docId }: { op: ContentOp; docId: string }) {
   const o = op as ContentOp & Record<string, unknown>;
   switch (op.type) {
@@ -67,11 +85,19 @@ export function ObjectShape({ op, docId }: { op: ContentOp; docId: string }) {
       )}</>;
     case "shape.add": {
       const stroke = o.stroke as string, width = o.width as number, fill = (o.fill as string | null) ?? undefined;
-      if (o.kind === "rect") { const r = o.rect as R; return <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} />; }
-      if (o.kind === "ellipse") { const r = o.rect as R; return <Ellipse x={r.x + r.w / 2} y={r.y + r.h / 2} radiusX={r.w / 2} radiusY={r.h / 2} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} />; }
+      const d = dashPattern(o.dash as Dash | undefined, width);
+      const dashProps = d ? { dash: d.dash, lineCap: d.lineCap } : {};
+      if (o.kind === "rect") { const r = o.rect as R; return <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} hitStrokeWidth={Math.max(width, 8)} {...dashProps} />; }
+      if (o.kind === "ellipse") { const r = o.rect as R; return <Ellipse x={r.x + r.w / 2} y={r.y + r.h / 2} radiusX={r.w / 2} radiusY={r.h / 2} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} hitStrokeWidth={Math.max(width, 8)} {...dashProps} />; }
+      if (o.kind === "cloud") return <Cloud points={o.points as Pt[]} width={width} stroke={width > 0 ? stroke : undefined} fill={fill} dash={d} />;
       const pts = (o.points as number[][]).flat();
-      if (o.kind === "arrow") { const h = arrowHead(width); return <Arrow points={pts} stroke={stroke} fill={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" pointerLength={h.length} pointerWidth={h.width} hitStrokeWidth={12} />; }
-      return <Line points={pts} stroke={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" hitStrokeWidth={12} />;
+      if (o.kind === "polygon" || o.kind === "polyline") {
+        const closed = o.kind === "polygon";
+        return <Line points={pts} closed={closed} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={closed ? fill : undefined}
+          lineJoin="round" lineCap="round" hitStrokeWidth={12} {...dashProps} />;
+      }
+      if (o.kind === "arrow") { const h = arrowHead(width); return <Arrow points={pts} stroke={stroke} fill={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" pointerLength={h.length} pointerWidth={h.width} hitStrokeWidth={12} {...dashProps} />; }
+      return <Line points={pts} stroke={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" hitStrokeWidth={12} {...dashProps} />;
     }
     default:
       return null;
```

Modify `apps/web/src/components/editor/PageOverlay.tsx`:

```diff
--- a/apps/web/src/components/editor/PageOverlay.tsx
+++ b/apps/web/src/components/editor/PageOverlay.tsx
@@ -7,17 +7,50 @@ import { useStore } from "zustand";
 import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
 import { groupTransform, pageBounds, screenSize, type PageGeom } from "@/lib/coords";
 import { newId } from "@/lib/id";
-import { clampToBounds, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, MARKUP_TOOLS, MIN_DRAG, moveOp, normalizeRect, noteAt, resizeOp, symbolAt, type DragTool, type Pt } from "@/lib/objects";
+import {
+  clampToBounds, createFromDrag, DRAG_TOOLS, hasRotation, inkWidth, isMarkup, isPointOp, isResizable, isRotatable, isTextOp, MARKUP_TOOLS, MIN_DRAG,
+  mapPoints, moveOp, normalizeRect, noteAt, opacityOf, opBounds, POLY_TOOLS, resizeOp, rotationOf, symbolAt, type DragTool, type PolyTool, type Pt,
+} from "@/lib/objects";
 import { charsStore } from "@/store/chars";
 import { editorStore, useEditor, type MarkupTool } from "@/store/editor";
 import { linkStore } from "./marks/linkStore";
 import { MarkupShape } from "./marks/MarkupShape";
 import { markupFromDrag, onMarkableText } from "./marks/markupTool";
 import { ObjectShape } from "./ObjectShape";
+import { usePolyTool } from "./shapes/usePolyTool";
 import { textEditStore } from "./text/textEdit";
 
 type TextOp = TextAdd | TextEdit;
 
+/** Konva attributes of an object's group: objects with a `rotation` turn around their rect's centre (the group's
+ *  origin sits there), and every drawn object has its opacity. */
+export function objectGroupAttrs(op: ContentOp) {
+  const opacity = opacityOf(op);
+  if (!hasRotation(op)) return { x: 0, y: 0, offsetX: 0, offsetY: 0, rotation: 0, opacity };
+  const b = opBounds(op);
+  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
+  return { x: cx, y: cy, offsetX: cx, offsetY: cy, rotation: rotationOf(op), opacity };
+}
+
+/** The op after its group was moved, resized or turned with the Transformer (`g`: the group's node). */
+function transformed(cur: ContentOp, g: Konva.Group, page: Konva.Group): ContentOp {
+  if (isPointOp(cur)) {
+    const m = g.getTransform().copy(); // group space (page coordinates before the change) → page space
+    return mapPoints(cur, ([x, y]) => { const p = m.point({ x, y }); return [p.x, p.y]; });
+  }
+  if (hasRotation(cur)) {
+    const b = opBounds(cur);
+    const w = b.w * Math.abs(g.scaleX()), h = b.h * Math.abs(g.scaleY());
+    const to = { x: g.x() - w / 2, y: g.y() - h / 2, w, h };
+    const rotation = Math.round(((g.rotation() % 360) + 360) % 360 * 100) / 100;
+    const sized = isTextOp(cur) && overlayHooks.resizeText ? overlayHooks.resizeText(cur, { ...to, y: g.y() - b.h / 2, h: b.h }) : resizeOp(cur, to);
+    return { ...sized, rotation: rotation > 180 ? rotation - 360 : rotation } as ContentOp;
+  }
+  const box = g.getClientRect({ relativeTo: page, skipStroke: true });
+  const to = { x: box.x, y: box.y, w: box.width, h: box.height };
+  return isTextOp(cur) && overlayHooks.resizeText ? overlayHooks.resizeText(cur, to) : resizeOp(cur, to);
+}
+
 /** Highlights multiply over the pdf.js canvas below (as their /BM /Multiply appearance does in a
  *  viewer), so text under them stays dark: the markup layer's canvas blends with the page. */
 function multiplyLayer(layer: Konva.Layer | null) {
@@ -70,6 +103,7 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
   }, [selection, mine]);
 
   useEffect(() => () => drawing.current?.stop(), []);
+  const poly = usePolyTool(pageKey, POLY_TOOLS.has(tool) ? (tool as PolyTool) : null, scale);
 
   // Text markup needs the page's character boxes.
   useEffect(() => {
@@ -169,6 +203,8 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
       s.setTool("select");
       s.select(note.id);
       linkStore.getState().setFocusNote(note.id); // the properties bar shows its text field
+    } else if (POLY_TOOLS.has(tool)) {
+      poly.click(at);
     } else if (tool === "link" || DRAG_TOOLS.has(tool)) {
       beginDraw(at, null);
     } else if (tool === "ink") {
@@ -186,6 +222,8 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
         width={size.width}
         height={size.height}
         onPointerDown={onDown}
+        onPointerMove={() => { if (poly.active) poly.hover(pos()); }}
+        onDblClick={() => poly.doubleClick()}
       >
         <Layer>
           <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale} offsetX={tr.offsetX} offsetY={tr.offsetY}>
@@ -194,6 +232,7 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
               <Group
                 key={op.id}
                 ref={(n) => { if (n) nodes.current.set(op.id, n); else nodes.current.delete(op.id); }}
+                {...objectGroupAttrs(op)}
                 draggable={tool === "select"}
                 listening={tool === "select"}
                 onPointerDown={(e) => {
@@ -204,22 +243,18 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
                 }}
                 onDragEnd={(e) => {
                   const g = e.currentTarget as Konva.Group;
-                  const dx = g.x(), dy = g.y();
-                  g.position({ x: 0, y: 0 });
                   const cur = editorStore.getState().doc.objects[op.id];
+                  const home = objectGroupAttrs(cur ?? op);
+                  const dx = g.x() - home.x, dy = g.y() - home.y;
+                  g.position({ x: home.x, y: home.y });
                   if (cur && (dx || dy)) editorStore.getState().updateObject(op.id, moveOp(cur, dx, dy));
                 }}
                 onTransformEnd={(e) => {
                   const g = e.currentTarget as Konva.Group;
-                  const box = g.getClientRect({ relativeTo: pageRef.current!, skipStroke: true });
-                  g.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
                   const cur = editorStore.getState().doc.objects[op.id];
-                  if (!cur) return;
-                  const to = { x: box.x, y: box.y, w: box.width, h: box.height };
-                  const next = isTextOp(cur) && overlayHooks.resizeText
-                    ? overlayHooks.resizeText(cur, to)
-                    : resizeOp(cur, to);
-                  editorStore.getState().updateObject(op.id, next);
+                  const next = cur ? transformed(cur, g, pageRef.current!) : null;
+                  g.setAttrs({ ...objectGroupAttrs(next ?? op), scaleX: 1, scaleY: 1 });
+                  if (next) editorStore.getState().updateObject(op.id, next);
                 }}
                 onDblClick={() => overlayHooks.onDoubleClick?.(op)}
               >
@@ -228,12 +263,16 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
                   : <ObjectShape op={op} docId={docId} />}
               </Group>
             ))}
-            {draft && !isMarkup(draft) && <ObjectShape op={draft} docId={docId} />}
+            {draft && !isMarkup(draft) && <Group opacity={opacityOf(draft)}><ObjectShape op={draft} docId={docId} /></Group>}
+            {poly.preview && <Group opacity={opacityOf(poly.preview)} listening={false}><ObjectShape op={poly.preview} docId={docId} /></Group>}
             {overlayHooks.renderOver?.(pageKey)}
           </Group>
           <Transformer
             ref={trRef}
-            rotateEnabled={false}
+            rotateEnabled={!!selection && isRotatable(objects[selection])}
+            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
+            rotationSnapTolerance={4}
+            flipEnabled={false}
             resizeEnabled={!selection || isResizable(objects[selection])}
             // A note's icon is as big as its selection box: pad it so the border shows outside the icon's.
             padding={selection && !isResizable(objects[selection]) ? 3 : 0}
```

Modify `apps/web/src/components/editor/PropertiesBar.tsx`:

```diff
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -3,7 +3,8 @@
 import type { ContentOp } from "@edith/ops";
 import { useEffect, useRef } from "react";
 import { useStore } from "zustand";
-import { inkWidth, isMarkup, isTextOp, MARKUP_TOOLS } from "@/lib/objects";
+import type { Dash } from "@/lib/geometry";
+import { hasOpacity, inkWidth, isMarkup, isTextOp, MARKUP_TOOLS, opacityOf, POLY_TOOLS } from "@/lib/objects";
 import { t } from "@/lib/strings";
 import { useChars } from "@/store/chars";
 import { editorStore, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
@@ -20,7 +21,7 @@ type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | "symbol" |
 
 function kindOf(op: ContentOp | undefined, tool: string): Kind {
   if (op) {
-    if (op.type === "shape.add") return (op as { kind: string }).kind === "line" || (op as { kind: string }).kind === "arrow" ? "line" : "shape";
+    if (op.type === "shape.add") return ["line", "arrow", "polyline"].includes((op as { kind: string }).kind) ? "line" : "shape";
     if (op.type === "ink.add") return "ink";
     if (op.type === "redact.add") return "redact";
     if (isTextOp(op)) return "text";
@@ -34,14 +35,16 @@ function kindOf(op: ContentOp | undefined, tool: string): Kind {
   if (MARKUP_TOOLS.has(tool)) return "markup";
   if (tool === "check" || tool === "cross") return "symbol";
   if (tool === "note") return "note";
-  if (tool === "rect" || tool === "ellipse") return "shape";
-  if (tool === "line" || tool === "arrow") return "line";
+  if (tool === "rect" || tool === "ellipse" || tool === "polygon" || tool === "cloud") return "shape";
+  if (tool === "line" || tool === "arrow" || tool === "polyline") return "line";
   if (tool === "ink") return "ink";
   if (tool === "redact") return "redact";
   if (tool === "text") return "text";
   return null;
 }
 
+const DRAG_SHAPES: ReadonlySet<string> = new Set(["rect", "ellipse", "line", "arrow"]);
+
 export function PropertiesBar() {
   const selection = useEditor((s) => s.selection);
   const op = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
@@ -86,6 +89,20 @@ export function PropertiesBar() {
   const rawWidth = (o?.width as number | undefined) ?? style.width;
   const width = kind === "ink" ? inkWidth(rawWidth) : rawWidth;
   const fill = o ? ((o.fill as string | null | undefined) ?? null) : style.fill;
+  const dash = o ? ((o.dash as Dash | undefined) ?? "solid") : style.dash;
+  // Opacity: of the selected drawn object, or of the next shape a shape tool makes.
+  const showOpacity = o ? hasOpacity(o) : (kind === "shape" || kind === "line") && (DRAG_SHAPES.has(tool) || POLY_TOOLS.has(tool));
+  const opacity = o ? opacityOf(o) : style.opacity;
+
+  function setOpacity(v: number) {
+    if (o) s.updateObject(o.id, { opacity: v } as Partial<ContentOp>, { coalesce: `opacity:${o.id}` }); // a slider drag is one undo step
+    else s.setStyle({ opacity: v });
+  }
+
+  function setDash(v: Dash) {
+    if (o) s.updateObject(o.id, { dash: v } as Partial<ContentOp>);
+    else s.setStyle({ dash: v });
+  }
 
   function set(patch: { stroke?: string; width?: number; fill?: string | null; redactFill?: "black" | "white" }) {
     if (o) {
@@ -117,6 +134,16 @@ export function PropertiesBar() {
           </label>
         </>
       )}
+      {(kind === "shape" || kind === "line") && (
+        <label className="flex items-center gap-1.5 text-xs text-muted">
+          {t.editor.dash}
+          <select value={dash} aria-label={t.editor.dash} onChange={(e) => setDash(e.target.value as Dash)} className="rounded border border-line px-1 py-0.5 text-ink">
+            <option value="solid">{t.editor.dashSolid}</option>
+            <option value="dashed">{t.editor.dashDashed}</option>
+            <option value="dotted">{t.editor.dashDotted}</option>
+          </select>
+        </label>
+      )}
       {kind === "shape" && (
         <div className="flex items-center gap-2">
           <label className="flex items-center gap-1 text-xs text-muted">
@@ -161,6 +188,14 @@ export function PropertiesBar() {
         </div>
       )}
       {kind === "text" && textPropsSlot.render?.()}
+      {showOpacity && (
+        <label className="flex items-center gap-1.5 text-xs text-muted">
+          {t.editor.opacity}
+          <input type="range" min={0.1} max={1} step={0.05} value={opacity} aria-label={t.editor.opacity}
+            onChange={(e) => setOpacity(Number(e.target.value))} className="w-20 accent-[var(--accent)]" />
+          <span className="w-9 tabular-nums text-ink">{Math.round(opacity * 100)}%</span>
+        </label>
+      )}
       {kind === "text" && scanned && <span className="text-xs text-muted">{t.text.scanned}</span>}
       <div className="flex-1" />
       {selection && (
```

Modify `apps/web/src/components/editor/Toolbar.tsx`:

```diff
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -81,6 +81,9 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
         { tool: "ellipse", label: t.editor.ellipse, icon: "○" },
         { tool: "line", label: t.editor.line, icon: "╱" },
         { tool: "arrow", label: t.editor.arrow, icon: "→" },
+        { tool: "polygon", label: t.editor.polygon, icon: "⬠" },
+        { tool: "polyline", label: t.editor.polyline, icon: "⌇" },
+        { tool: "cloud", label: t.editor.cloud, icon: "☁" },
       ]} />
       <ToolButton tool="check" label={t.annot.check} icon="✓" active={tool} />
       <ToolButton tool="cross" label={t.annot.cross} icon="✗" active={tool} />
```

Create `apps/web/src/components/editor/shapes/usePolyTool.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import type { ShapeAdd } from "@edith/ops";
import { newId } from "@/lib/id";
import { CLOSE_RADIUS, MIN_POLY_POINTS, polyFromPoints, type PolyTool, type Pt } from "@/lib/objects";
import { editorStore } from "@/store/editor";

/** The polygon/polyline/cloud tool on one page: each click adds a vertex; a double-click (two clicks on the same
 *  spot), Enter or a click on the first vertex finishes (then back to Pilih with the shape selected, like the other shape tools); Escape
 *  cancels. `preview` is the shape drawn so far, up to the pointer. */
export function usePolyTool(pageKey: string, tool: PolyTool | null, scale: number) {
  // The vertices belong to the tool they were clicked with: switching tools drops them.
  const [state, setState] = useState<{ tool: PolyTool | null; points: Pt[]; hover: Pt | null }>({ tool: null, points: [], hover: null });
  const points = state.tool === tool ? state.points : [];
  const hover = state.tool === tool ? state.hover : null;
  const reset = () => setState({ tool, points: [], hover: null });

  function finish(pts: Pt[] = points) {
    if (!tool) return;
    const op = polyFromPoints(tool, pts, editorStore.getState().style, pageKey, newId());
    reset();
    if (!op) return;
    const s = editorStore.getState();
    s.addObject(op);
    s.setTool("select");
    s.select(op.id);
  }

  function click(at: Pt) {
    if (!tool) return;
    const first = points[0];
    // A click on the first vertex closes the shape.
    if (first && points.length >= MIN_POLY_POINTS[tool] && Math.hypot(at[0] - first[0], at[1] - first[1]) * scale <= CLOSE_RADIUS) {
      finish(points);
      return;
    }
    setState({ tool, points: [...points, at], hover: null });
  }

  const active = !!tool && points.length > 0;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); finish(); }
      else if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  let preview: ShapeAdd | null = null;
  if (active) {
    const pts = hover ? [...points, hover] : points;
    const kind: PolyTool = tool === "polyline" || pts.length < 3 ? "polyline" : tool!;
    const style = editorStore.getState().style;
    preview = polyFromPoints(kind, pts.length === 1 ? [pts[0], [pts[0][0] + 0.5, pts[0][1]]] : pts, style, pageKey, "draft");
  }

  /** Konva reports two quick clicks anywhere as a double-click: only two on the same spot finish the shape. */
  function doubleClick() {
    const [a, b] = points.slice(-2);
    if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) * scale <= CLOSE_RADIUS) finish(points.slice(0, -1));
  }

  return {
    active, preview, click, finish: () => finish(), doubleClick,
    hover: (at: Pt) => setState((s) => (s.tool === tool && s.points.length ? { ...s, hover: at } : s)),
  };
}
```

Modify `apps/web/src/components/editor/text/TextEditor.tsx`:

```diff
--- a/apps/web/src/components/editor/text/TextEditor.tsx
+++ b/apps/web/src/components/editor/text/TextEditor.tsx
@@ -11,7 +11,9 @@ import type { Editor } from "@tiptap/core";
 import { toScreen, type PageGeom } from "@/lib/coords";
 import { cssFamily, fontKey, fontStore } from "@/lib/fonts";
 import { attrsOf, docToRuns, runsToDoc, type RunAttrs } from "@/lib/richtext";
+import { rotationOf } from "@/lib/objects";
 import { boxFonts, boxLineHeight } from "@/lib/textbox";
+import { useEditor as useEditorStore } from "@/store/editor";
 import { isFindKey } from "../useShortcuts";
 import { createRunMark } from "./runMark";
 import { commitOpenSession, preloadSessionFonts, session, textEditStore, type Editing } from "./textEdit";
@@ -35,6 +37,8 @@ function RichArea({ editing, geom, scale }: { editing: Editing; geom: PageGeom;
   // Style of text that has none yet (an empty box, pasted text); fixed for the session.
   const [fallback] = useState(() => attrsOf(editing.box.paragraphs[0][0]));
   const editingId = editing.id;
+  // A rotated text box is edited turned the same way (around its rect's centre).
+  const turn = useEditorStore((s) => rotationOf(s.doc.objects[editing.id]));
   // Fonts this session asked for (a failing original is not re-fetched on every keystroke).
   const [requested] = useState(() => new Set<string>());
 
@@ -113,7 +117,10 @@ function RichArea({ editing, geom, scale }: { editing: Editing; geom: PageGeom;
         position: "absolute", left, top, zIndex: 10,
         // +1 pt: the browser measures unquantized advances, slightly wider than the layout's.
         width: (box.rect.w + 1) * scale, minHeight: box.lineHeight * scale,
-        transform: `rotate(${geom.rotation}deg)`, transformOrigin: "top left",
+        transform: turn
+          ? `rotate(${geom.rotation}deg) translate(${(box.rect.w * scale) / 2}px, ${(box.rect.h * scale) / 2}px) rotate(${turn}deg) translate(${(-box.rect.w * scale) / 2}px, ${(-box.rect.h * scale) / 2}px)`
+          : `rotate(${geom.rotation}deg)`,
+        transformOrigin: "top left",
         ["--edith-scale" as string]: scale,
         fontFamily: `"${cssFamily(fallback.font)}"`, fontSize: fallback.size * scale, color: fallback.color,
         lineHeight: `${box.lineHeight * scale}px`, textAlign: box.align ?? "left",
```

Modify `apps/web/src/lib/strings.ts`:

```diff
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -61,6 +61,14 @@ export const t = {
     options: "pilihan",
     black: "Hitam",
     white: "Putih",
+    polygon: "Poligon",
+    polyline: "Garis bersambung",
+    cloud: "Awan",
+    dash: "Gaya garis",
+    dashSolid: "Penuh",
+    dashDashed: "Putus-putus",
+    dashDotted: "Titik-titik",
+    opacity: "Opasitas",
   },
   text: {
     underline: "Garis bawah",
```


- [ ] **Step 2: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 264 passed; tsc/eslint clean (behaviour covered by Task 18's E2E)

- [ ] **Step 3: Check in the browser**

`npm run dev:api` + `npm run dev:web`, open a PDF: draw a rect, drag its rotation handle (snaps at 45°), set Opasitas 50 % and Gaya garis Putus-putus; draw a Poligon (click 3 points, click the first), an Awan (4 clicks + Enter), a Garis bersambung (double-click the last point); move/resize/rotate each; double-click a rotated text box and type. Undo/redo each step. Download and open the PDF: same positions, dashes, transparency.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor/ObjectShape.tsx apps/web/src/components/editor/PageOverlay.tsx apps/web/src/components/editor/PropertiesBar.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/shapes/usePolyTool.ts apps/web/src/components/editor/text/TextEditor.tsx apps/web/src/lib/strings.ts
git commit -m "feat(web): rotate objects, opacity, dashed strokes, polygons and clouds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
