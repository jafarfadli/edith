# Task 16: Object geometry + Konva overlay (render, select, move, resize, draw)

**Files:**
- Create: `apps/web/src/lib/objects.ts`, `apps/web/src/lib/objects.test.ts`, `apps/web/src/components/editor/PageOverlay.tsx`, `apps/web/src/components/editor/ObjectShape.tsx`, `apps/web/src/components/editor/useImageAsset.ts`
- Modify: `apps/web/src/components/editor/Editor.tsx` (pass overlay to `PageList`), `apps/web/package.json` (deps `konva`, `react-konva`)

**Interfaces:**
- Consumes: store (`useEditor`, `editorStore`, `ToolStyle`, `Tool`) (Task 12); `screenSize`, `groupTransform`, `PageGeom` (Task 10); `assetUrl` (Task 13); `newId` (Task 12); `OverlayRender` (Task 14).
- Produces:
```ts
// lib/objects.ts
export type Pt = [number, number];
export const MIN_DRAG = 3; // pt
export type DragTool = "rect" | "ellipse" | "line" | "arrow" | "whiteout" | "redact";
export const DRAG_TOOLS: ReadonlySet<string>;
export function normalizeRect(a: Pt, b: Pt): Rect;
export function opBounds(op: ContentOp): Rect;
export function moveOp<T extends ContentOp>(op: T, dx: number, dy: number): T;
export function resizeOp<T extends ContentOp>(op: T, to: Rect): T;  // text: only x, y, w change (Task 18 relayouts)
export function createFromDrag(tool: DragTool, a: Pt, b: Pt, style: ToolStyle, pageKey: string, id: string): ContentOp | null; // null if too small
export function arrowHead(width: number): { length: number; width: number }; // matches API: length=max(6, 4w), spread 25°
```
  - `PageOverlay` (default export, client-only) props `{ pageKey, geom, scale }`. Stage has `data-testid="overlay"`. While tool is `pan`, the overlay ignores pointer events.
  - `ObjectShape({ op, docId })` renders one op in page coordinates; returns `null` for `text.add` (Task 18 fills it in).
  - Overlay exposes an extension point for Task 18 in `PageOverlay.tsx`: `export const overlayHooks: { onTextPointerDown?(pageKey, at: Pt): void; renderText?(op: TextAdd, selected: boolean): React.ReactNode; resizeText?(op: TextAdd, to: Rect): TextAdd; onDoubleClick?(op: ContentOp): void }`. The transformer only offers left/right anchors for text.

Behavior:
- Tools `rect/ellipse/line/arrow/whiteout/redact`: press-drag-release creates the object, selects it, tool returns to `select`. A drag smaller than `MIN_DRAG` creates nothing.
- Tool `ink`: press-drag-release adds one `ink.add` with one path; tool stays `ink`.
- Tool `select`: click object selects; drag moves (commit on drag end); transformer handles resize (no rotation); click on empty area clears selection.
- Visual must match the bake: whiteout white; redact preview = its fill at 75% opacity with a dashed orange outline; line caps round; arrow head per `arrowHead`.

- [ ] **Step 1: Deps**

Run: `npm install -w apps/web konva@^10 react-konva@^19`
(If `konva@^10` is unavailable, install the latest `konva` that `react-konva@19` peer-depends on.)

- [ ] **Step 2: Failing geometry tests**

`apps/web/src/lib/objects.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { arrowHead, createFromDrag, moveOp, normalizeRect, opBounds, resizeOp } from "@/lib/objects";
import type { ToolStyle } from "@/store/editor";

const style: ToolStyle = { stroke: "#ff0000", fill: "#00ff00", width: 3, color: "#111111", fontFamily: "Arimo", fontSize: 14, bold: false, italic: false, align: "left" };

describe("objects", () => {
  it("normalizes rects from any drag direction", () => {
    expect(normalizeRect([10, 20], [0, 5])).toEqual({ x: 0, y: 5, w: 10, h: 15 });
  });

  it("creates shapes from drags", () => {
    expect(createFromDrag("rect", [0, 0], [50, 40], style, "o0", "a")).toEqual({
      id: "a", type: "shape.add", pageKey: "o0", kind: "rect", rect: { x: 0, y: 0, w: 50, h: 40 }, stroke: "#ff0000", fill: "#00ff00", width: 3,
    });
    expect(createFromDrag("arrow", [0, 0], [50, 40], style, "o0", "b")).toMatchObject({ kind: "arrow", points: [[0, 0], [50, 40]], fill: null });
    expect(createFromDrag("whiteout", [5, 5], [20, 30], style, "o0", "c")).toEqual({ id: "c", type: "whiteout.add", pageKey: "o0", rect: { x: 5, y: 5, w: 15, h: 25 } });
    expect(createFromDrag("redact", [5, 5], [20, 30], style, "o0", "d")).toMatchObject({ type: "redact.add", fill: "black" });
  });

  it("ignores tiny drags", () => {
    expect(createFromDrag("rect", [0, 0], [2, 2], style, "o0", "a")).toBeNull();
    expect(createFromDrag("line", [0, 0], [1, 2], style, "o0", "a")).toBeNull();
  });

  it("computes bounds", () => {
    const ink = { id: "i", type: "ink.add", pageKey: "o0", paths: [[[0, 0], [10, 5]], [[20, 30]]], color: "#000000", width: 2 } as ContentOp;
    expect(opBounds(ink)).toEqual({ x: 0, y: 0, w: 20, h: 30 });
    const line = createFromDrag("line", [30, 40], [10, 0], style, "o0", "l")!;
    expect(opBounds(line)).toEqual({ x: 10, y: 0, w: 20, h: 40 });
  });

  it("moves points and rects", () => {
    const line = createFromDrag("line", [0, 0], [10, 10], style, "o0", "l")!;
    expect((moveOp(line, 5, -2) as { points: number[][] }).points).toEqual([[5, -2], [15, 8]]);
    const r = createFromDrag("rect", [0, 0], [10, 10], style, "o0", "r")!;
    expect((moveOp(r, 1, 2) as { rect: unknown }).rect).toEqual({ x: 1, y: 2, w: 10, h: 10 });
  });

  it("resizes by scaling points", () => {
    const ink = { id: "i", type: "ink.add", pageKey: "o0", paths: [[[0, 0], [10, 10]]], color: "#000000", width: 2 } as ContentOp;
    expect((resizeOp(ink, { x: 100, y: 100, w: 20, h: 40 }) as { paths: number[][][] }).paths).toEqual([[[100, 100], [120, 140]]]);
    const r = createFromDrag("ellipse", [0, 0], [10, 10], style, "o0", "e")!;
    expect((resizeOp(r, { x: 1, y: 1, w: 5, h: 6 }) as { rect: unknown }).rect).toEqual({ x: 1, y: 1, w: 5, h: 6 });
  });

  it("arrow head matches the API formula", () => {
    expect(arrowHead(1).length).toBe(6);
    expect(arrowHead(3).length).toBe(12);
    expect(arrowHead(3).width).toBeCloseTo(2 * 12 * Math.tan((25 * Math.PI) / 180));
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL.

- [ ] **Step 3: objects.ts**

`apps/web/src/lib/objects.ts`:
```ts
import type { ContentOp, Rect } from "@edith/ops";
import type { ToolStyle } from "@/store/editor";

export type Pt = [number, number];
export const MIN_DRAG = 3;
export type DragTool = "rect" | "ellipse" | "line" | "arrow" | "whiteout" | "redact";
export const DRAG_TOOLS: ReadonlySet<string> = new Set(["rect", "ellipse", "line", "arrow", "whiteout", "redact"]);

type Any = ContentOp & Record<string, unknown>;

export function normalizeRect([ax, ay]: Pt, [bx, by]: Pt): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

function boundsOfPoints(pts: number[][]): Rect {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function opBounds(op: ContentOp): Rect {
  const o = op as Any;
  switch (op.type) {
    case "text.add": return (o.box as { rect: Rect }).rect;
    case "ink.add": return boundsOfPoints((o.paths as number[][][]).flat());
    case "shape.add": return o.points ? boundsOfPoints(o.points as number[][]) : (o.rect as Rect);
    default: return o.rect as Rect;
  }
}

export function moveOp<T extends ContentOp>(op: T, dx: number, dy: number): T {
  const o = op as Any;
  const mv = (p: number[]) => [p[0] + dx, p[1] + dy];
  const mr = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
  switch (op.type) {
    case "text.add": { const box = o.box as { rect: Rect }; return { ...op, box: { ...box, rect: mr(box.rect) } }; }
    case "ink.add": return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(mv)) };
    case "shape.add": return o.points ? { ...op, points: (o.points as number[][]).map(mv) } : { ...op, rect: mr(o.rect as Rect) };
    default: return { ...op, rect: mr(o.rect as Rect) };
  }
}

export function resizeOp<T extends ContentOp>(op: T, to: Rect): T {
  const o = op as Any;
  const b = opBounds(op);
  const sx = b.w ? to.w / b.w : 1, sy = b.h ? to.h / b.h : 1;
  const sc = (p: number[]) => [to.x + (p[0] - b.x) * sx, to.y + (p[1] - b.y) * sy];
  switch (op.type) {
    case "text.add": { const box = o.box as { rect: Rect }; return { ...op, box: { ...box, rect: { ...box.rect, x: to.x, y: to.y, w: to.w } } }; }
    case "ink.add": return { ...op, paths: (o.paths as number[][][]).map((path) => path.map(sc)) };
    case "shape.add": return o.points ? { ...op, points: (o.points as number[][]).map(sc) } : { ...op, rect: to };
    default: return { ...op, rect: to };
  }
}

export function createFromDrag(tool: DragTool, a: Pt, b: Pt, style: ToolStyle, pageKey: string, id: string): ContentOp | null {
  const r = normalizeRect(a, b);
  if (tool === "line" || tool === "arrow") {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_DRAG) return null;
    return { id, type: "shape.add", pageKey, kind: tool, points: [a, b], stroke: style.stroke, fill: null, width: style.width } as ContentOp;
  }
  if (r.w < MIN_DRAG || r.h < MIN_DRAG) return null;
  if (tool === "whiteout") return { id, type: "whiteout.add", pageKey, rect: r } as ContentOp;
  if (tool === "redact") return { id, type: "redact.add", pageKey, rect: r, fill: "black" } as ContentOp;
  return { id, type: "shape.add", pageKey, kind: tool, rect: r, stroke: style.stroke, fill: style.fill, width: style.width } as ContentOp;
}

export function arrowHead(width: number) {
  const length = Math.max(6, width * 4);
  return { length, width: 2 * length * Math.tan((25 * Math.PI) / 180) };
}
```

Run: `npm test -w apps/web` → Expected: PASS.

- [ ] **Step 4: Image hook + ObjectShape**

`apps/web/src/components/editor/useImageAsset.ts`:
```ts
"use client";

import { useEffect, useState } from "react";
import { assetUrl } from "@/lib/api";

const cache = new Map<string, HTMLImageElement>();

export function useImageAsset(docId: string, assetId: string): HTMLImageElement | undefined {
  const key = `${docId}/${assetId}`;
  const [img, setImg] = useState(() => cache.get(key));
  useEffect(() => {
    if (cache.has(key)) { setImg(cache.get(key)); return; }
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => { cache.set(key, el); setImg(el); };
    el.src = assetUrl(docId, assetId);
  }, [key, docId, assetId]);
  return img;
}
```

`apps/web/src/components/editor/ObjectShape.tsx`:
```tsx
"use client";

import { Arrow, Ellipse, Image as KImage, Line, Rect } from "react-konva";
import type { ContentOp, Rect as R } from "@edith/ops";
import { arrowHead } from "@/lib/objects";
import { useImageAsset } from "./useImageAsset";

function ImageObject({ docId, assetId, rect }: { docId: string; assetId: string; rect: R }) {
  const img = useImageAsset(docId, assetId);
  return img
    ? <KImage image={img} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
    : <Rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="#e3e6eb" />;
}

export function ObjectShape({ op, docId }: { op: ContentOp; docId: string }) {
  const o = op as ContentOp & Record<string, unknown>;
  switch (op.type) {
    case "whiteout.add": {
      const r = o.rect as R;
      return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#ffffff" />;
    }
    case "redact.add": {
      const r = o.rect as R;
      return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill={o.fill === "white" ? "#ffffff" : "#000000"} opacity={0.75} stroke="#c2410c" strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />;
    }
    case "image.add":
      return <ImageObject docId={docId} assetId={o.assetId as string} rect={o.rect as R} />;
    case "ink.add":
      return <>{(o.paths as number[][][]).map((path, i) =>
        path.length === 1
          ? <Ellipse key={i} x={path[0][0]} y={path[0][1]} radiusX={(o.width as number) / 2} radiusY={(o.width as number) / 2} fill={o.color as string} />
          : <Line key={i} points={path.flat()} stroke={o.color as string} strokeWidth={o.width as number} lineCap="round" lineJoin="round" hitStrokeWidth={12} />,
      )}</>;
    case "shape.add": {
      const stroke = o.stroke as string, width = o.width as number, fill = (o.fill as string | null) ?? undefined;
      if (o.kind === "rect") { const r = o.rect as R; return <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} />; }
      if (o.kind === "ellipse") { const r = o.rect as R; return <Ellipse x={r.x + r.w / 2} y={r.y + r.h / 2} radiusX={r.w / 2} radiusY={r.h / 2} stroke={width > 0 ? stroke : undefined} strokeWidth={width} fill={fill} />; }
      const pts = (o.points as number[][]).flat();
      if (o.kind === "arrow") { const h = arrowHead(width); return <Arrow points={pts} stroke={stroke} fill={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" pointerLength={h.length} pointerWidth={h.width} hitStrokeWidth={12} />; }
      return <Line points={pts} stroke={stroke} strokeWidth={Math.max(width, 0.5)} lineCap="round" hitStrokeWidth={12} />;
    }
    default:
      return null;
  }
}
```

- [ ] **Step 5: PageOverlay**

`apps/web/src/components/editor/PageOverlay.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Layer, Stage, Transformer } from "react-konva";
import type { ContentOp, TextAdd } from "@edith/ops";
import { groupTransform, screenSize, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import { createFromDrag, DRAG_TOOLS, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
import { editorStore, useEditor } from "@/store/editor";
import { ObjectShape } from "./ObjectShape";

export const overlayHooks: {
  onTextPointerDown?: (pageKey: string, at: Pt) => void;
  renderText?: (op: TextAdd, selected: boolean) => React.ReactNode;
  resizeText?: (op: TextAdd, to: { x: number; y: number; w: number; h: number }) => TextAdd;
  onDoubleClick?: (op: ContentOp) => void;
} = {};

export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const size = screenSize(geom, scale);
  const tr = groupTransform(geom, scale);
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const docId = useEditor((s) => s.info?.docId ?? "");
  const pageRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const start = useRef<Pt | null>(null);
  const [draft, setDraft] = useState<ContentOp | null>(null);

  const mine = order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === pageKey);

  useEffect(() => {
    const node = selection ? nodes.current.get(selection) : undefined;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [selection, mine]);

  const pos = (): Pt => {
    const p = pageRef.current!.getRelativePointerPosition()!;
    return [p.x, p.y];
  };

  function onDown(e: Konva.KonvaEventObject<PointerEvent>) {
    const s = editorStore.getState();
    if (tool === "select") {
      if (e.target === e.target.getStage()) s.select(null);
      return;
    }
    const at = pos();
    if (tool === "text") { overlayHooks.onTextPointerDown?.(pageKey, at); return; }
    if (DRAG_TOOLS.has(tool)) {
      start.current = at;
      setDraft(null);
    } else if (tool === "ink") {
      start.current = at;
      setDraft({ id: "draft", type: "ink.add", pageKey, paths: [[at]], color: s.style.stroke, width: s.style.width } as ContentOp);
    }
  }

  function onMove() {
    if (!start.current) return;
    const s = editorStore.getState();
    const at = pos();
    if (tool === "ink") {
      setDraft((d) => d && ({ ...d, paths: [[...((d as { paths: number[][][] }).paths[0]), at]] } as ContentOp));
    } else if (DRAG_TOOLS.has(tool)) {
      setDraft(createFromDrag(tool as DragTool, start.current, at, s.style, pageKey, "draft"));
    }
  }

  function onUp() {
    if (!start.current) return;
    const s = editorStore.getState();
    const at = pos();
    if (tool === "ink" && draft) {
      s.addObject({ ...draft, id: newId() } as ContentOp);
    } else if (DRAG_TOOLS.has(tool)) {
      const op = createFromDrag(tool as DragTool, start.current, at, s.style, pageKey, newId());
      if (op) { s.addObject(op); s.setTool("select"); s.select(op.id); }
    }
    start.current = null;
    setDraft(null);
  }

  return (
    <Stage
      data-testid="overlay"
      width={size.width}
      height={size.height}
      className="absolute inset-0"
      style={{ pointerEvents: tool === "pan" ? "none" : "auto", cursor: tool === "select" ? "default" : "crosshair" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <Layer>
        <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale}>
          {mine.map((op) => (
            <Group
              key={op.id}
              ref={(n) => { if (n) nodes.current.set(op.id, n); else nodes.current.delete(op.id); }}
              draggable={tool === "select"}
              listening={tool === "select"}
              onPointerDown={(e) => { if (tool === "select") { e.cancelBubble = true; editorStore.getState().select(op.id); } }}
              onDragEnd={(e) => {
                const g = e.target as Konva.Group;
                const dx = g.x(), dy = g.y();
                g.position({ x: 0, y: 0 });
                const cur = editorStore.getState().doc.objects[op.id];
                if (cur && (dx || dy)) editorStore.getState().updateObject(op.id, moveOp(cur, dx, dy));
              }}
              onTransformEnd={(e) => {
                const g = e.target as Konva.Group;
                const box = g.getClientRect({ relativeTo: pageRef.current!, skipStroke: true });
                g.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
                const cur = editorStore.getState().doc.objects[op.id];
                if (!cur) return;
                const to = { x: box.x, y: box.y, w: box.width, h: box.height };
                const next = cur.type === "text.add" && overlayHooks.resizeText
                  ? overlayHooks.resizeText(cur as TextAdd, to)
                  : resizeOp(cur, to);
                editorStore.getState().updateObject(op.id, next);
              }}
              onDblClick={() => overlayHooks.onDoubleClick?.(op)}
            >
              {op.type === "text.add"
                ? overlayHooks.renderText?.(op as TextAdd, selection === op.id) ?? null
                : <ObjectShape op={op} docId={docId} />}
            </Group>
          ))}
          {draft && <ObjectShape op={draft} docId={docId} />}
        </Group>
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          ignoreStroke
          keepRatio={false}
          enabledAnchors={selection && objects[selection]?.type === "text.add"
            ? ["middle-left", "middle-right"]
            : ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]}
          borderStroke="#0f766e"
          anchorStroke="#0f766e"
          anchorSize={8}
        />
      </Layer>
    </Stage>
  );
}
```

- [ ] **Step 6: Wire into Editor**

In `apps/web/src/components/editor/Editor.tsx` add:
```tsx
import dynamic from "next/dynamic";
const PageOverlay = dynamic(() => import("./PageOverlay"), { ssr: false });
```
and render `<PageList pdf={pdf} overlay={(a) => <PageOverlay {...a} />} />`.

Konva must never load on the server; `ssr: false` guarantees that. If the Next build still tries to bundle the Node `canvas` package, add to `apps/web/next.config.ts`: `turbopack: { resolveAlias: { canvas: "./src/empty.ts" } }` and `webpack: (c) => { c.resolve.alias.canvas = false; return c; }`, with `apps/web/src/empty.ts` containing `export {};`.

Manual check (the toolbar arrives in Task 17): temporarily add `useEffect(() => editorStore.getState().setTool("rect"), [pdf]);` to `Editor.tsx`, run the app, drag on a page → a red rectangle appears and is selected; drag it → it moves; drag a transformer handle → it resizes; Ctrl+Z undoes. Then **remove the temporary line**.

- [ ] **Step 7: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run build -w apps/web` → succeed.

- [ ] **Step 8: Commit**

```bash
git add apps/web package-lock.json
git commit -m "feat(web): add Konva object overlay with select, move, resize and drawing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
