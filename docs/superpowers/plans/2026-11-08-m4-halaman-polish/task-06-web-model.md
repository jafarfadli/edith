# Task 6: Web model: crop-aware coords, shared geometry, object helpers

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 5 leaves, new files are complete.

**Goal:** Pure web foundations: `coords.ts` understands a page crop, `geometry.ts` mirrors `bake/geometry.py`, `objects.ts` knows opacity/rotation/points/copy/align, `ToolStyle` gets `dash` and `opacity`, `Tool` gets polygon/polyline/cloud.

**Files:**
- Modify: `apps/web/src/lib/coords.test.ts`
- Modify: `apps/web/src/lib/coords.ts`
- Create: `apps/web/src/lib/geometry.test.ts`
- Create: `apps/web/src/lib/geometry.ts`
- Create: `apps/web/src/lib/objects.m4.test.ts`
- Modify: `apps/web/src/lib/objects.ts`
- Modify: `apps/web/src/store/editor.ts`

**Interfaces:**
- Consumes: Task 1 TS types; Task 2 contract numbers.
- Produces:
- `coords.ts`: `CropBox`, `PageGeom.crop?`, `pageBounds(g)`, `cropOffset(g, s) -> Pt`; `screenSize/toScreen/toPage` honour the crop; `groupTransform` returns `offsetX/offsetY` (= crop origin) too.
- `geometry.ts`: `dashPattern(dash, width) -> {dash, lineCap} | null`, `signedArea2`, `cloudBeziers`, `KAPPA`, `type Dash`, `type Bezier`.
- `objects.ts`: `clampToBounds`, `PolyTool`, `POLY_TOOLS`, `MIN_POLY_POINTS`, `CLOSE_RADIUS = 8`, `polyFromPoints(tool, points, style, pageKey, id)`, `hasOpacity`, `isPointOp`, `hasRotation`, `isRotatable`, `rotationOf`, `opacityOf`, `rotatePoint`, `visualBounds`, `mapPoints`, `isCopyable`, `copyOp(op, pageKey, id, dx, dy)`, `type Align`, `alignDelta(bounds, page, align)`; `createFromDrag` adds `dash`/`opacity` only when not default.
- `store/editor.ts`: `Tool` += `"polygon" | "polyline" | "cloud"`; `ToolStyle.dash`, `ToolStyle.opacity` (defaults `"solid"`, `1`).

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/src/lib/coords.test.ts`:

```diff
--- a/apps/web/src/lib/coords.test.ts
+++ b/apps/web/src/lib/coords.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from "vitest";
-import { groupTransform, normRotation, screenSize, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";
+import { cropOffset, groupTransform, normRotation, pageBounds, screenSize, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";
 
 const W = 200, H = 300;
 const g = (rotation: 0 | 90 | 180 | 270): PageGeom => ({ width: W, height: H, rotation });
@@ -52,3 +52,54 @@ describe("coords", () => {
     }
   });
 });
+
+describe("coords with a crop", () => {
+  const crop = { x: 20, y: 30, w: 100, h: 150 };
+  const cg = (rotation: 0 | 90 | 180 | 270): PageGeom => ({ width: W, height: H, rotation, crop });
+
+  function applyCroppedGroup(p: Pt, t: ReturnType<typeof groupTransform>): Pt {
+    return applyGroup([p[0] - t.offsetX, p[1] - t.offsetY], t);
+  }
+
+  it("shows only the crop", () => {
+    expect(screenSize(cg(0), 2)).toEqual({ width: 200, height: 300 });
+    expect(screenSize(cg(90), 1)).toEqual({ width: 150, height: 100 });
+    expect(pageBounds(cg(0))).toEqual(crop);
+    expect(pageBounds(g(0))).toEqual({ x: 0, y: 0, w: W, h: H });
+  });
+
+  it("puts the crop's corner at the screen origin", () => {
+    expect(toScreen([20, 30], cg(0), 1)).toEqual([0, 0]);
+    expect(toScreen([20, 180], cg(90), 1)).toEqual([0, 0]); // bottom-left of the crop is top-left on screen
+    expect(toScreen([120, 30], cg(270), 1)).toEqual([0, 0]);
+  });
+
+  it("round-trips and agrees with groupTransform", () => {
+    for (const rot of [0, 90, 180, 270] as const) {
+      for (const s of [0.5, 1.5]) {
+        const p: Pt = [57, 101];
+        const back = toPage(toScreen(p, cg(rot), s), cg(rot), s);
+        expect(back[0]).toBeCloseTo(57);
+        expect(back[1]).toBeCloseTo(101);
+        const a = applyCroppedGroup(p, groupTransform(cg(rot), s)), b = toScreen(p, cg(rot), s);
+        expect(a[0]).toBeCloseTo(b[0]);
+        expect(a[1]).toBeCloseTo(b[1]);
+      }
+    }
+  });
+
+  it("offsets the full-page canvas so the crop shows", () => {
+    expect(cropOffset(g(0), 1)).toEqual([0, 0]);
+    expect(cropOffset(cg(0), 2)).toEqual([-40, -60]);
+    // 90°: the full page is H wide on screen; the crop's bottom edge (y = 180) maps to screen x = H - 180.
+    expect(cropOffset(cg(90), 1)).toEqual([-(H - 180), -20]);
+    for (const rot of [0, 90, 180, 270] as const) {
+      // The page point under the visible origin is the same whether drawn whole (shifted) or cropped.
+      const full: PageGeom = { width: W, height: H, rotation: rot };
+      const [ox, oy] = cropOffset(cg(rot), 1);
+      const p = toPage([-ox, -oy], full, 1), q = toPage([0, 0], cg(rot), 1);
+      expect(p[0]).toBeCloseTo(q[0]);
+      expect(p[1]).toBeCloseTo(q[1]);
+    }
+  });
+});
```

Create `apps/web/src/lib/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cloudBeziers, dashPattern, KAPPA, signedArea2, type Pt } from "@/lib/geometry";

// Shared contract with apps/api/tests/test_bake_shapes.py: same inputs, same numbers.
const SQUARE: Pt[] = [[0, 0], [20, 0], [20, 20], [0, 20]];

describe("geometry", () => {
  it("dash patterns", () => {
    expect(dashPattern("solid", 2)).toBeNull();
    expect(dashPattern(undefined, 2)).toBeNull();
    expect(dashPattern("dashed", 2)).toEqual({ dash: [6, 4], lineCap: "butt" });
    expect(dashPattern("dotted", 2)).toEqual({ dash: [0, 4], lineCap: "round" });
    expect(dashPattern("dashed", 0)).toEqual({ dash: [1.5, 1], lineCap: "butt" });
  });

  it("cloud of a square", () => {
    expect(signedArea2(SQUARE)).toBe(800);
    const arcs = cloudBeziers(SQUARE, 1);
    expect(arcs).toHaveLength(16);
    const k = KAPPA * 5;
    expect(arcs[0][0]).toEqual([0, 0]);
    expect(arcs[0][3]).toEqual([5, -5]);
    expect(arcs[0][1][0]).toBeCloseTo(0);
    expect(arcs[0][1][1]).toBeCloseTo(-k);
    expect(arcs[0][2][0]).toBeCloseTo(5 - k);
    expect(arcs[0][2][1]).toBeCloseTo(-5);
    expect(arcs[1][3]).toEqual([10, 0]);
    expect(arcs[15][3][0]).toBeCloseTo(0);
    expect(arcs[15][3][1]).toBeCloseTo(0);
  });

  it("bulges outward for either winding", () => {
    const ccw = [...SQUARE].reverse();
    expect(cloudBeziers(ccw, 1)[0][3]).toEqual([5, 25]);
    for (const b of cloudBeziers(ccw, 1).filter((_, i) => i % 2 === 0)) {
      const [x, y] = b[3];
      expect(x > 0 && x < 20 && y > 0 && y < 20).toBe(false);
    }
  });

  it("short and zero-length edges", () => {
    expect(cloudBeziers([[0, 0], [4, 0], [2, 3]], 1)).toHaveLength(6);
    expect(cloudBeziers([[0, 0], [0, 0], [4, 0], [2, 3]], 1)[0][0]).toEqual([0, 0]);
  });
});
```

Create `apps/web/src/lib/objects.m4.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import {
  alignDelta, clampToBounds, copyOp, createFromDrag, hasOpacity, hasRotation, isCopyable, isPointOp, isRotatable, mapPoints,
  opacityOf, polyFromPoints, rotatePoint, rotationOf, visualBounds,
} from "@/lib/objects";
import { DEFAULT_STYLE, type ToolStyle } from "@/store/editor";

const style: ToolStyle = { ...DEFAULT_STYLE, stroke: "#ff0000", fill: "#00ff00", width: 2 };
const rect = (extra: object = {}) => ({ id: "r", type: "shape.add", pageKey: "o0", kind: "rect", rect: { x: 100, y: 100, w: 200, h: 100 }, stroke: "#000000", fill: null, width: 1, ...extra }) as ContentOp;
const ink = { id: "i", type: "ink.add", pageKey: "o0", paths: [[[0, 0], [10, 0]]], color: "#000000", width: 2 } as ContentOp;

describe("objects (M4)", () => {
  it("adds dash and opacity to new shapes only when not the default", () => {
    expect(createFromDrag("rect", [0, 0], [50, 40], style, "o0", "a")).not.toHaveProperty("dash");
    const s = { ...style, dash: "dotted" as const, opacity: 0.5 };
    expect(createFromDrag("rect", [0, 0], [50, 40], s, "o0", "a")).toMatchObject({ dash: "dotted", opacity: 0.5 });
    expect(createFromDrag("line", [0, 0], [50, 40], s, "o0", "a")).toMatchObject({ dash: "dotted", opacity: 0.5 });
  });

  it("builds polygons, polylines and clouds from clicked points", () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 0.2], [5, 8]];
    expect(polyFromPoints("polygon", pts, style, "o0", "p")).toEqual({
      id: "p", type: "shape.add", pageKey: "o0", kind: "polygon", points: [[0, 0], [10, 0], [5, 8]], stroke: "#ff0000", fill: "#00ff00", width: 2,
    });
    expect(polyFromPoints("polyline", pts, style, "o0", "p")).toMatchObject({ kind: "polyline", fill: null });
    expect(polyFromPoints("cloud", pts.slice(0, 2), style, "o0", "p")).toBeNull();
    expect(polyFromPoints("polyline", pts.slice(0, 2), style, "o0", "p")).not.toBeNull();
  });

  it("knows which objects turn and fade", () => {
    expect([hasOpacity(rect()), hasRotation(rect()), isPointOp(rect()), isRotatable(rect())]).toEqual([true, true, false, true]);
    expect([hasOpacity(ink), hasRotation(ink), isPointOp(ink), isRotatable(ink)]).toEqual([true, false, true, true]);
    const white = { id: "w", type: "whiteout.add", pageKey: "o0", rect: { x: 0, y: 0, w: 1, h: 1 } } as ContentOp;
    expect([hasOpacity(white), isRotatable(white)]).toEqual([false, false]);
    expect(rotationOf(rect({ rotation: 30 }))).toBe(30);
    expect(opacityOf(rect())).toBe(1);
    expect(opacityOf(rect({ opacity: 0.25 }))).toBe(0.25);
  });

  it("rotates clockwise on screen", () => {
    const [x, y] = rotatePoint([10, 0], [0, 0], 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(10);
  });

  it("visual bounds include the rotation", () => {
    expect(visualBounds(rect())).toEqual({ x: 100, y: 100, w: 200, h: 100 });
    const b = visualBounds(rect({ rotation: 90 }));
    expect(b.x).toBeCloseTo(150);
    expect(b.y).toBeCloseTo(50);
    expect(b.w).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(200);
  });

  it("maps points of point objects", () => {
    expect((mapPoints(ink, ([x, y]) => [x + 1, y * 2]) as { paths: number[][][] }).paths).toEqual([[[1, 0], [11, 0]]]);
    expect(mapPoints(rect(), () => [0, 0])).toEqual(rect());
  });

  it("copies objects to another page with a new id", () => {
    const op = rect({ rotation: 15 });
    const copy = copyOp(op, "u-x", "new", 10, 10);
    expect(copy).toMatchObject({ id: "new", pageKey: "u-x", rotation: 15, rect: { x: 110, y: 110, w: 200, h: 100 } });
    expect(op).toEqual(rect({ rotation: 15 })); // the original is untouched
    const edit = { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g0", box: {} } as ContentOp;
    const hl = { id: "h", type: "annot.add", pageKey: "o0", kind: "highlight", quads: [], color: "#ffff00" } as unknown as ContentOp;
    expect([isCopyable(op), isCopyable(edit), isCopyable(hl)]).toEqual([true, false, false]);
  });

  it("aligns bounds to the sides of the page", () => {
    const page = { x: 0, y: 0, w: 600, h: 800 }, b = { x: 100, y: 200, w: 50, h: 20 };
    expect(alignDelta(b, page, "left")).toEqual([-100, 0]);
    expect(alignDelta(b, page, "center")).toEqual([175, 0]);
    expect(alignDelta(b, page, "right")).toEqual([450, 0]);
    expect(alignDelta(b, page, "top")).toEqual([0, -200]);
    expect(alignDelta(b, page, "middle")).toEqual([0, 190]);
    expect(alignDelta(b, page, "bottom")).toEqual([0, 580]);
  });

  it("clamps to the visible part of a cropped page", () => {
    expect(clampToBounds([5, 500], { x: 20, y: 30, w: 100, h: 150 })).toEqual([20, 180]);
  });
});
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: missing exports `cropOffset`, `pageBounds`, `@/lib/geometry`, `polyFromPoints` …

- [ ] **Step 3: Implement**

Modify `apps/web/src/lib/coords.ts`:

```diff
--- a/apps/web/src/lib/coords.ts
+++ b/apps/web/src/lib/coords.ts
@@ -1,22 +1,35 @@
 export type Rotation = 0 | 90 | 180 | 270;
-export interface PageGeom { width: number; height: number; rotation: Rotation }
+export interface CropBox { x: number; y: number; w: number; h: number }
+/** `width`/`height`: the page's unrotated size; `crop`: its visible part (pages.layout crop), in page coordinates. */
+export interface PageGeom { width: number; height: number; rotation: Rotation; crop?: CropBox | null }
 export type Pt = [number, number];
 
 export function normRotation(deg: number): Rotation {
   return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;
 }
 
+/** The visible part of the page in page coordinates (the whole page when it is not cropped). */
+export function pageBounds(g: PageGeom): CropBox {
+  return g.crop ?? { x: 0, y: 0, w: g.width, h: g.height };
+}
+
+/** The visible part as a page of its own: coordinates relative to its top-left corner. */
+function visible(g: PageGeom): { geom: PageGeom; dx: number; dy: number } {
+  if (!g.crop) return { geom: g, dx: 0, dy: 0 };
+  return { geom: { width: g.crop.w, height: g.crop.h, rotation: g.rotation }, dx: g.crop.x, dy: g.crop.y };
+}
+
 export function screenSize(g: PageGeom, scale: number) {
+  const { width, height } = visible(g).geom;
   const swap = g.rotation === 90 || g.rotation === 270;
   return {
-    width: (swap ? g.height : g.width) * scale,
-    height: (swap ? g.width : g.height) * scale,
+    width: (swap ? height : width) * scale,
+    height: (swap ? width : height) * scale,
   };
 }
 
-export function toScreen([x, y]: Pt, g: PageGeom, s: number): Pt {
-  const { width: W, height: H } = g;
-  switch (g.rotation) {
+function rotateToScreen(x: number, y: number, W: number, H: number, rotation: Rotation, s: number): Pt {
+  switch (rotation) {
     case 0: return [x * s, y * s];
     case 90: return [(H - y) * s, x * s];
     case 180: return [(W - x) * s, (H - y) * s];
@@ -24,23 +37,44 @@ export function toScreen([x, y]: Pt, g: PageGeom, s: number): Pt {
   }
 }
 
+export function toScreen([x, y]: Pt, g: PageGeom, s: number): Pt {
+  const v = visible(g);
+  return rotateToScreen(x - v.dx, y - v.dy, v.geom.width, v.geom.height, g.rotation, s);
+}
+
 export function toPage([X, Y]: Pt, g: PageGeom, s: number): Pt {
-  const { width: W, height: H } = g;
+  const v = visible(g);
+  const { width: W, height: H } = v.geom;
   const x = X / s, y = Y / s;
+  let p: Pt;
   switch (g.rotation) {
-    case 0: return [x, y];
-    case 90: return [y, H - x];
-    case 180: return [W - x, H - y];
-    case 270: return [W - y, x];
+    case 0: p = [x, y]; break;
+    case 90: p = [y, H - x]; break;
+    case 180: p = [W - x, H - y]; break;
+    case 270: p = [W - y, x]; break;
   }
+  return [p[0] + v.dx, p[1] + v.dy];
 }
 
+/** Konva attributes of the group that holds a page's objects (page coordinates inside). */
 export function groupTransform(g: PageGeom, s: number) {
-  const { width: W, height: H } = g;
+  const v = visible(g);
+  const { width: W, height: H } = v.geom;
+  const offset = { offsetX: v.dx, offsetY: v.dy };
   switch (g.rotation) {
-    case 0: return { x: 0, y: 0, rotation: 0, scale: s };
-    case 90: return { x: H * s, y: 0, rotation: 90, scale: s };
-    case 180: return { x: W * s, y: H * s, rotation: 180, scale: s };
-    case 270: return { x: 0, y: W * s, rotation: 270, scale: s };
+    case 0: return { x: 0, y: 0, rotation: 0, scale: s, ...offset };
+    case 90: return { x: H * s, y: 0, rotation: 90, scale: s, ...offset };
+    case 180: return { x: W * s, y: H * s, rotation: 180, scale: s, ...offset };
+    case 270: return { x: 0, y: W * s, rotation: 270, scale: s, ...offset };
   }
 }
+
+/** Where the whole (uncropped) page's top-left corner lies relative to the visible part, in screen pixels:
+ *  a canvas with the whole page rendered on it goes there. */
+export function cropOffset(g: PageGeom, s: number): Pt {
+  if (!g.crop) return [0, 0];
+  const full: PageGeom = { width: g.width, height: g.height, rotation: g.rotation };
+  const { x, y, w, h } = g.crop;
+  const corners = ([[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as Pt[]).map((p) => toScreen(p, full, s));
+  return [-Math.min(...corners.map((c) => c[0])), -Math.min(...corners.map((c) => c[1]))];
+}
```

Create `apps/web/src/lib/geometry.ts`:

```ts
/** Shape geometry shared with apps/api/edith/bake/geometry.py — change both together (both test suites
 *  pin the same numbers). Dash patterns are multiples of w' = max(width, 0.5): dashed [3w', 2w'] with butt
 *  caps, dotted [0, 2w'] with round caps. A cloud splits each edge of its closed polygon into
 *  n = floor(len / arc + 0.5) (at least 1) chords, arc = CLOUD_ARC + CLOUD_ARC_PER_WIDTH · width, and draws a
 *  half circle bulging out of the polygon on each chord as two cubic Béziers. */
export type Pt = [number, number];
export type Bezier = [Pt, Pt, Pt, Pt];
export type Dash = "solid" | "dashed" | "dotted";

export const KAPPA = 0.5522847498;
export const CLOUD_ARC = 8;
export const CLOUD_ARC_PER_WIDTH = 2;

export function dashPattern(dash: Dash | undefined, width: number): { dash: number[]; lineCap: "butt" | "round" } | null {
  const w = Math.max(width, 0.5);
  if (dash === "dashed") return { dash: [3 * w, 2 * w], lineCap: "butt" };
  if (dash === "dotted") return { dash: [0, 2 * w], lineCap: "round" };
  return null;
}

/** Twice the signed area (shoelace); > 0 means clockwise on screen (y grows down). */
export function signedArea2(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

export function cloudBeziers(points: readonly Pt[], width: number): Bezier[] {
  const arc = CLOUD_ARC + CLOUD_ARC_PER_WIDTH * width;
  const clockwise = signedArea2(points) > 0;
  const out: Bezier[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = points[i], [qx, qy] = points[(i + 1) % n];
    const length = Math.hypot(qx - px, qy - py);
    if (length === 0) continue;
    const ux = (qx - px) / length, uy = (qy - py) / length;
    const [nx, ny] = clockwise ? [uy, -ux] : [-uy, ux]; // outward normal
    const count = Math.max(1, Math.floor(length / arc + 0.5));
    for (let k = 0; k < count; k++) {
      const ax = px + ((qx - px) * k) / count, ay = py + ((qy - py) * k) / count;
      const bx = px + ((qx - px) * (k + 1)) / count, by = py + ((qy - py) * (k + 1)) / count;
      const r = length / count / 2;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const top: Pt = [mx + r * nx, my + r * ny];
      const kr = KAPPA * r;
      out.push([[ax, ay], [ax + kr * nx, ay + kr * ny], [top[0] - kr * ux, top[1] - kr * uy], top]);
      out.push([top, [top[0] + kr * ux, top[1] + kr * uy], [bx + kr * nx, by + kr * ny], [bx, by]]);
    }
  }
  return out;
}
```

Modify `apps/web/src/lib/objects.ts`:

```diff
--- a/apps/web/src/lib/objects.ts
+++ b/apps/web/src/lib/objects.ts
@@ -1,4 +1,5 @@
-import type { AnnotAdd, ContentOp, Rect, SymbolAdd, TextAdd, TextEdit } from "@edith/ops";
+import type { AnnotAdd, ContentOp, Rect, ShapeAdd, SymbolAdd, TextAdd, TextEdit } from "@edith/ops";
+import type { CropBox } from "@/lib/coords";
 import type { ToolStyle } from "@/store/editor";
 
 export type Pt = [number, number];
@@ -17,6 +18,11 @@ export function clampToPage([x, y]: Pt, width: number, height: number): Pt {
   return [Math.min(Math.max(x, 0), width), Math.min(Math.max(y, 0), height)];
 }
 
+/** `clampToPage` for the visible part of a (cropped) page. */
+export function clampToBounds([x, y]: Pt, b: CropBox): Pt {
+  return [Math.min(Math.max(x, b.x), b.x + b.w), Math.min(Math.max(y, b.y), b.y + b.h)];
+}
+
 type Any = ContentOp & Record<string, unknown>;
 
 export function normalizeRect([ax, ay]: Pt, [bx, by]: Pt): Rect {
@@ -111,15 +117,116 @@ export function createFromDrag(tool: DragTool, a: Pt, b: Pt, style: ToolStyle, p
   const r = normalizeRect(a, b);
   if (tool === "line" || tool === "arrow") {
     if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_DRAG) return null;
-    return { id, type: "shape.add", pageKey, kind: tool, points: [a, b], stroke: style.stroke, fill: null, width: style.width } as ContentOp;
+    return { id, type: "shape.add", pageKey, kind: tool, points: [a, b], stroke: style.stroke, fill: null, width: style.width, ...shapeExtras(style) } as ContentOp;
   }
   if (r.w < MIN_DRAG || r.h < MIN_DRAG) return null;
   if (tool === "whiteout") return { id, type: "whiteout.add", pageKey, rect: r } as ContentOp;
   if (tool === "redact") return { id, type: "redact.add", pageKey, rect: r, fill: "black" } as ContentOp;
-  return { id, type: "shape.add", pageKey, kind: tool, rect: r, stroke: style.stroke, fill: style.fill, width: style.width } as ContentOp;
+  return { id, type: "shape.add", pageKey, kind: tool, rect: r, stroke: style.stroke, fill: style.fill, width: style.width, ...shapeExtras(style) } as ContentOp;
 }
 
 export function arrowHead(width: number) {
   const length = Math.max(6, width * 4);
   return { length, width: 2 * length * Math.tan((25 * Math.PI) / 180) };
 }
+
+/** Dash and opacity of new shapes, only when not the defaults (ops stay as small as before M4). */
+function shapeExtras(style: ToolStyle): Partial<ShapeAdd> {
+  return { ...(style.dash !== "solid" ? { dash: style.dash } : {}), ...(style.opacity < 1 ? { opacity: style.opacity } : {}) };
+}
+
+export type PolyTool = "polygon" | "polyline" | "cloud";
+export const POLY_TOOLS: ReadonlySet<string> = new Set(["polygon", "polyline", "cloud"]);
+/** Polygon/polyline/cloud tools: a click adds a vertex; a double-click, Enter or a click on the first vertex finishes. */
+export const MIN_POLY_POINTS: Record<PolyTool, number> = { polygon: 3, cloud: 3, polyline: 2 };
+/** Pixels on screen within which a click on the first vertex closes the shape. */
+export const CLOSE_RADIUS = 8;
+
+/** The shape made of the clicked vertices (consecutive duplicates dropped), or null when there are too few. */
+export function polyFromPoints(tool: PolyTool, points: readonly Pt[], style: ToolStyle, pageKey: string, id: string): ShapeAdd | null {
+  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) >= 0.5);
+  if (pts.length < MIN_POLY_POINTS[tool]) return null;
+  return {
+    id, type: "shape.add", pageKey, kind: tool, points: pts.map((p) => [p[0], p[1]] as [number, number]),
+    stroke: style.stroke, fill: tool === "polyline" ? null : style.fill, width: style.width, ...shapeExtras(style),
+  };
+}
+
+/** Objects drawn on the page (they have `opacity`); text.edit, whiteout, redaction, links and annotations have not. */
+export function hasOpacity(op: ContentOp | undefined): boolean {
+  return !!op && ["text.add", "image.add", "signature.add", "stamp.add", "symbol.add", "shape.add", "ink.add"].includes(op.type);
+}
+
+/** Objects made of points (ink, lines, polygons): rotating one moves its points instead of setting `rotation`. */
+export function isPointOp(op: ContentOp | undefined): boolean {
+  return op?.type === "ink.add" || (op?.type === "shape.add" && !!(op as ShapeAdd).points);
+}
+
+/** Objects placed by a rect that turn around its centre with a `rotation` field. */
+export function hasRotation(op: ContentOp | undefined): boolean {
+  return !!op && hasOpacity(op) && !isPointOp(op);
+}
+
+/** Objects with a rotation handle. */
+export function isRotatable(op: ContentOp | undefined): boolean {
+  return hasRotation(op) || isPointOp(op);
+}
+
+export function rotationOf(op: ContentOp | undefined): number {
+  return hasRotation(op) ? ((op as { rotation?: number }).rotation ?? 0) : 0;
+}
+
+export function opacityOf(op: ContentOp | undefined): number {
+  return hasOpacity(op) ? ((op as { opacity?: number }).opacity ?? 1) : 1;
+}
+
+/** `p` turned `deg` degrees clockwise (on screen) around `c`. */
+export function rotatePoint([x, y]: Pt, [cx, cy]: Pt, deg: number): Pt {
+  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
+  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
+}
+
+/** What the object covers on the page, its rotation included. */
+export function visualBounds(op: ContentOp): Rect {
+  const b = opBounds(op);
+  const deg = rotationOf(op);
+  if (!deg) return b;
+  const c: Pt = [b.x + b.w / 2, b.y + b.h / 2];
+  const pts = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => rotatePoint(p, c, deg));
+  return boundsOfPoints(pts);
+}
+
+/** A point-based op with every point mapped through `f` (Konva's transform after a rotate/resize). */
+export function mapPoints<T extends ContentOp>(op: T, f: (p: Pt) => Pt): T {
+  const o = op as Any;
+  const m = (p: number[]) => f([p[0], p[1]]);
+  if (op.type === "ink.add") return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(m)) };
+  if (op.type === "shape.add" && o.points) return { ...op, points: (o.points as number[][]).map(m) };
+  return op;
+}
+
+/** Objects the mini-bar can copy, duplicate and align: everything except edited paragraphs and text markup,
+ *  which belong to the text of their page. */
+export function isCopyable(op: ContentOp | undefined): boolean {
+  return !!op && op.type !== "text.edit" && !isMarkup(op);
+}
+
+/** A copy of `op` on `pageKey` with a new id, moved by (dx, dy). */
+export function copyOp(op: ContentOp, pageKey: string, id: string, dx = 0, dy = 0): ContentOp {
+  const clone = structuredClone(op) as ContentOp;
+  return moveOp({ ...clone, id, pageKey } as ContentOp, dx, dy);
+}
+
+export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";
+
+/** How far to move an object whose (screen) bounds are `b` so it lines up with side `a` of `page` (screen). */
+export function alignDelta(b: Rect, page: Rect, a: Align): Pt {
+  switch (a) {
+    case "left": return [page.x - b.x, 0];
+    case "center": return [page.x + (page.w - b.w) / 2 - b.x, 0];
+    case "right": return [page.x + page.w - b.w - b.x, 0];
+    case "top": return [0, page.y - b.y];
+    case "middle": return [0, page.y + (page.h - b.h) / 2 - b.y];
+    case "bottom": return [0, page.y + page.h - b.h - b.y];
+  }
+}
```

Modify `apps/web/src/store/editor.ts`:

```diff
--- a/apps/web/src/store/editor.ts
+++ b/apps/web/src/store/editor.ts
@@ -3,6 +3,7 @@ import { useStore } from "zustand";
 import type { ContentOp, TextEdit } from "@edith/ops";
 import type { FormField } from "@/lib/api";
 import { normRotation, type PageGeom, type Rotation } from "@/lib/coords";
+import type { Dash } from "@/lib/geometry";
 import { newId } from "@/lib/id";
 
 export interface StructurePage { index: number; width: number; height: number; rotation: number; hasText: boolean }
@@ -14,13 +15,15 @@ export type FormValue = string | boolean;
 export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue> }
 export type MarkupTool = "highlight" | "underline" | "strike";
 export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan"
-  | MarkupTool | "check" | "cross" | "note" | "link";
+  | MarkupTool | "check" | "cross" | "note" | "link" | "polygon" | "polyline" | "cloud";
 export interface ToolStyle {
   stroke: string; fill: string | null; width: number; color: string;
   fontFamily: string; fontSize: number; bold: boolean; italic: boolean;
   align: "left" | "center" | "right" | "justify";
   /** Colors of new text markup, symbols and notes. */
   markup: Record<MarkupTool, string>; symbolColor: string; noteColor: string;
+  /** Stroke style and opacity of new shapes. */
+  dash: Dash; opacity: number;
 }
 
 export interface EditorState {
@@ -52,6 +55,7 @@ export const DEFAULT_STYLE: ToolStyle = {
   stroke: "#e11d48", fill: null, width: 2, color: "#111111",
   fontFamily: "Arimo", fontSize: 14, bold: false, italic: false, align: "left",
   markup: { highlight: "#ffeb3b", underline: "#e11d48", strike: "#e11d48" }, symbolColor: "#1d4ed8", noteColor: "#facc15",
+  dash: "solid", opacity: 1,
 };
 
 export function pageGeom(entry: PageEntry, info: DocInfo): PageGeom {
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 243 passed; tsc/eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/coords.test.ts apps/web/src/lib/coords.ts apps/web/src/lib/geometry.test.ts apps/web/src/lib/geometry.ts apps/web/src/lib/objects.m4.test.ts apps/web/src/lib/objects.ts apps/web/src/store/editor.ts
git commit -m "feat(web): crop-aware coordinates, shared shape geometry and object helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
