# Task 10: Crop tool

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 9 leaves, new files are complete.

**Goal:** Toolbar "Crop" edits the crop of the page in view: the page shows whole, the outside is shaded, a dashed rect moves/resizes inside the page; the bar applies it to this page or all pages (clamped per page), removes it, or cancels (also Esc).

**Files:**
- Modify: `apps/web/src/components/editor/Editor.tsx`
- Modify: `apps/web/src/components/editor/PageList.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Create: `apps/web/src/components/editor/pages/CropOverlay.tsx`
- Create: `apps/web/src/components/editor/pages/cropStore.test.ts`
- Create: `apps/web/src/components/editor/pages/cropStore.ts`
- Modify: `apps/web/src/lib/strings.ts`

**Interfaces:**
- Consumes: Task 7 `setCrop`, `clampCrop`; Task 6 `groupTransform`.
- Produces:
- `pages/cropStore.ts`: `cropStore {pageKey, rect, open, setRect, close}`, `applyCrop(all)`, `clearCrop()`, `CROP_INSET = 0.05`; `pages/CropOverlay.tsx` (default export, dynamic import; `data-testid=crop-overlay`, bar `crop-bar`); `PageList` passes the uncropped geom for the page being cropped; strings `t.crop.*`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/editor/pages/cropStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { editorStore, type DocInfo } from "@/store/editor";
import { applyCrop, clearCrop, cropStore } from "./cropStore";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "s", fileName: "a.pdf",
  pages: [0, 1].map((i) => ({ index: i, width: i ? 300 : 600, height: 800, rotation: 0, hasText: true })),
};

beforeEach(() => { editorStore.getState().init(info); cropStore.getState().close(); });

describe("crop editing", () => {
  it("starts from the page inset by 5 %", () => {
    cropStore.getState().open("o0");
    expect(cropStore.getState()).toMatchObject({ pageKey: "o0", rect: { x: 30, y: 40, w: 540, h: 720 } });
  });

  it("applies to this page or to all pages, clamped to each", () => {
    cropStore.getState().open("o0");
    cropStore.getState().setRect({ x: 100, y: 100, w: 400, h: 500 });
    applyCrop(false);
    expect(editorStore.getState().doc.pages.map((p) => p.crop ?? null)).toEqual([{ x: 100, y: 100, w: 400, h: 500 }, null]);
    expect(cropStore.getState().pageKey).toBeNull();
    cropStore.getState().open("o0"); // resumes from the existing crop
    expect(cropStore.getState().rect).toEqual({ x: 100, y: 100, w: 400, h: 500 });
    applyCrop(true);
    expect(editorStore.getState().doc.pages[1].crop).toEqual({ x: 100, y: 100, w: 200, h: 500 });
  });

  it("removes a crop", () => {
    editorStore.getState().setCrop(["o0"], { x: 1, y: 1, w: 100, h: 100 });
    cropStore.getState().open("o0");
    clearCrop();
    expect(editorStore.getState().doc.pages[0].crop).toBeUndefined();
  });
});
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: `./cropStore` not found

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Editor.tsx`:

```diff
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -35,6 +35,7 @@ const PageOverlay = dynamic(async () => {
 }, { ssr: false });
 const TextEditor = dynamic(() => import("./text/TextEditor").then((m) => m.TextEditor), { ssr: false });
 const LinkPopover = dynamic(() => import("./marks/LinkPopover").then((m) => m.LinkPopover), { ssr: false });
+const CropOverlay = dynamic(() => import("./pages/CropOverlay"), { ssr: false });
 const FindBar = dynamic(() => import("./find/FindBar").then((m) => m.FindBar), { ssr: false });
 
 const INFO_NOTICE_MS = 5000;
@@ -166,7 +167,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
           }}
           onPointerUp={() => { drag.current = null; }}
         >
-          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><LinkPopover {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
+          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><LinkPopover {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
         </main>
       </div>
       <FindBar />
```

Modify `apps/web/src/components/editor/PageList.tsx`:

```diff
--- a/apps/web/src/components/editor/PageList.tsx
+++ b/apps/web/src/components/editor/PageList.tsx
@@ -1,14 +1,17 @@
 "use client";
 
 import { useCallback, useEffect, useRef } from "react";
+import { useStore } from "zustand";
 import { pickVisible, pruneRatios } from "@/lib/visible";
 import { editorStore, pageGeom, useEditor } from "@/store/editor";
+import { cropStore } from "./pages/cropStore";
 import { PageView, type OverlayRender } from "./PageView";
 
 export function PageList({ overlay }: { overlay?: OverlayRender }) {
   const pages = useEditor((s) => s.doc.pages);
   const info = useEditor((s) => s.info)!;
   const zoom = useEditor((s) => s.zoom);
+  const cropping = useStore(cropStore, (s) => s.pageKey);
   const ratios = useRef(new Map<string, number>());
 
   const keys = useRef<ReadonlySet<string>>(new Set(pages.map((p) => p.pageKey)));
@@ -27,7 +30,8 @@ export function PageList({ overlay }: { overlay?: OverlayRender }) {
   return (
     <div className="flex flex-col items-center gap-6 px-6 py-8">
       {pages.map((entry) => (
-        <PageView key={entry.pageKey} entry={entry} geom={pageGeom(entry, info)} scale={zoom} overlay={overlay} onVisible={onVisible} />
+        // The page whose crop is being edited shows whole.
+        <PageView key={entry.pageKey} entry={entry} geom={pageGeom(entry.pageKey === cropping ? { ...entry, crop: null } : entry, info)} scale={zoom} overlay={overlay} onVisible={onVisible} />
       ))}
     </div>
   );
```

Modify `apps/web/src/components/editor/Toolbar.tsx`:

```diff
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -8,6 +8,7 @@ import { fitImage } from "@/lib/image";
 import { errorMessage, t } from "@/lib/strings";
 import { editorStore, useEditor, type Tool } from "@/store/editor";
 import { SignatureModal } from "./marks/SignatureModal";
+import { cropStore } from "./pages/cropStore";
 import { ManagePagesModal } from "./pages/ManagePagesModal";
 import { StampPicker } from "./marks/StampPicker";
 import { currentPage, placeObject } from "./placement";
@@ -94,6 +95,10 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
         <span aria-hidden>▦</span><span className="hidden lg:inline">{t.pages.manage}</span>
       </button>
       {pagesOpen && <ManagePagesModal onClose={() => setPagesOpen(false)} />}
+      <button aria-label={t.crop.title} title={t.crop.title} onClick={() => { const at = currentPage(); if (at) cropStore.getState().open(at.entry.pageKey); }}
+        className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
+        <span aria-hidden>⛶</span><span className="hidden lg:inline">{t.crop.title}</span>
+      </button>
     </div>
   );
 }
```

Create `apps/web/src/components/editor/pages/CropOverlay.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type Konva from "konva";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";
import { useStore } from "zustand";
import { groupTransform, screenSize, type CropBox, type PageGeom } from "@/lib/coords";
import { clampCrop } from "@/lib/pages";
import { t } from "@/lib/strings";
import { useEditor } from "@/store/editor";
import { applyCrop, clearCrop, cropStore } from "./cropStore";

const SHADE = "rgba(15,23,42,0.45)";

/** The crop being edited on this page: the rest of the page is shaded, the crop rect can be moved and resized
 *  (kept inside the page), and a bar applies it to this page or to all pages. `geom` is the uncropped page. */
export default function CropOverlay({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const rect = useStore(cropStore, (s) => (s.pageKey === pageKey ? s.rect : null));
  const cropped = useEditor((s) => !!s.doc.pages.find((p) => p.pageKey === pageKey)?.crop);
  const node = useRef<Konva.Rect>(null);
  const tr = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (!rect) return;
    tr.current?.nodes(node.current ? [node.current] : []);
    tr.current?.getLayer()?.batchDraw();
  }, [rect]);

  useEffect(() => {
    if (!rect) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cropStore.getState().close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rect]);

  if (!rect) return null;
  const size = screenSize(geom, scale);
  const g = groupTransform(geom, scale);
  const W = geom.width, H = geom.height;
  const put = (r: CropBox) => { const c = clampCrop(r, { width: W, height: H }); if (c) cropStore.getState().setRect(c); };

  return (
    <div className="absolute inset-0" style={{ zIndex: 20 }} data-testid="crop-overlay">
      <Stage width={size.width} height={size.height}>
        <Layer>
          <Group x={g.x} y={g.y} rotation={g.rotation} scaleX={g.scale} scaleY={g.scale}>
            <Rect x={0} y={0} width={W} height={rect.y} fill={SHADE} listening={false} />
            <Rect x={0} y={rect.y + rect.h} width={W} height={H - rect.y - rect.h} fill={SHADE} listening={false} />
            <Rect x={0} y={rect.y} width={rect.x} height={rect.h} fill={SHADE} listening={false} />
            <Rect x={rect.x + rect.w} y={rect.y} width={W - rect.x - rect.w} height={rect.h} fill={SHADE} listening={false} />
            <Rect ref={node} name="crop-rect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} stroke="#0f766e" strokeWidth={1.5}
              strokeScaleEnabled={false} dash={[6, 4]} fill="rgba(0,0,0,0.001)" draggable
              onDragMove={(e) => {
                const n = e.target;
                const x = Math.min(Math.max(n.x(), 0), W - rect.w), y = Math.min(Math.max(n.y(), 0), H - rect.h);
                n.position({ x, y });
                cropStore.getState().setRect({ ...rect, x, y });
              }}
              onTransformEnd={(e) => {
                const n = e.target;
                const next = { x: n.x(), y: n.y(), w: n.width() * n.scaleX(), h: n.height() * n.scaleY() };
                n.setAttrs({ scaleX: 1, scaleY: 1 });
                put(next);
              }} />
          </Group>
          <Transformer ref={tr} rotateEnabled={false} flipEnabled={false} keepRatio={false} ignoreStroke
            borderStroke="#0f766e" anchorStroke="#0f766e" anchorSize={9} />
        </Layer>
      </Stage>
      <div role="toolbar" aria-label={t.crop.title} data-testid="crop-bar"
        className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-surface p-1 text-sm shadow-lg ring-1 ring-line">
        <button onClick={() => applyCrop(false)} className="rounded-md bg-accent px-2.5 py-1 text-accent-ink">{t.crop.thisPage}</button>
        <button onClick={() => applyCrop(true)} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.allPages}</button>
        {cropped && <button onClick={clearCrop} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.remove}</button>}
        <button onClick={() => cropStore.getState().close()} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.cancel}</button>
      </div>
    </div>
  );
}
```

Create `apps/web/src/components/editor/pages/cropStore.ts`:

```ts
import { createStore } from "zustand/vanilla";
import type { CropBox } from "@/lib/coords";
import { pageBounds } from "@/lib/coords";
import { editorStore, pageGeom } from "@/store/editor";

/** The crop being edited: the page shows whole, with the crop rect over it, until applied or cancelled. */
export interface CropState {
  pageKey: string | null;
  rect: CropBox | null;
  /** Starts cropping `pageKey` from its current crop, or from the page inset by 5 %. */
  open(pageKey: string): void;
  setRect(rect: CropBox): void;
  close(): void;
}

export const CROP_INSET = 0.05;

export const cropStore = createStore<CropState>()((set) => ({
  pageKey: null, rect: null,
  open(pageKey) {
    const s = editorStore.getState();
    const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
    if (!entry || !s.info) return;
    const g = pageGeom(entry, s.info);
    const b = pageBounds(g);
    const rect = entry.crop ? b : { x: g.width * CROP_INSET, y: g.height * CROP_INSET, w: g.width * (1 - 2 * CROP_INSET), h: g.height * (1 - 2 * CROP_INSET) };
    s.select(null);
    s.setTool("select");
    set({ pageKey, rect });
  },
  setRect: (rect) => set({ rect }),
  close: () => set({ pageKey: null, rect: null }),
}));

/** Applies the edited crop to its page, or to every page ("semua halaman"), as one undo step. */
export function applyCrop(all: boolean): void {
  const { pageKey, rect } = cropStore.getState();
  if (!pageKey || !rect) return;
  const s = editorStore.getState();
  s.setCrop(all ? s.doc.pages.map((p) => p.pageKey) : [pageKey], rect);
  cropStore.getState().close();
}

/** Removes the crop of the page being edited. */
export function clearCrop(): void {
  const { pageKey } = cropStore.getState();
  if (pageKey) editorStore.getState().setCrop([pageKey], null);
  cropStore.getState().close();
}
```

Modify `apps/web/src/lib/strings.ts`:

```diff
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -114,6 +114,13 @@ export const t = {
     cancel: "Batal",
     save: "Simpan",
   },
+  crop: {
+    title: "Crop",
+    thisPage: "Terapkan ke halaman ini",
+    allPages: "Terapkan ke semua halaman",
+    remove: "Hapus crop",
+    cancel: "Batal",
+  },
   form: {
     flatten: "Ratakan form",
     flattenHint: "Isian form menjadi bagian halaman dan tidak bisa diubah lagi",
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 264 passed; tsc/eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/PageList.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/pages/CropOverlay.tsx apps/web/src/components/editor/pages/cropStore.test.ts apps/web/src/components/editor/pages/cropStore.ts apps/web/src/lib/strings.ts
git commit -m "feat(web): crop this page or all pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
