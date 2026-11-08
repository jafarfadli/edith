# Task 8: Render imported and cropped pages; insert menu; import flow

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 7 leaves, new files are complete.

**Goal:** Pages render from a per-document pdf.js store (imports load on demand); cropped pages show only the crop (whole page rendered, shifted and clipped); the Konva group uses the crop offset; the "+" between thumbnails offers Halaman kosong / Impor PDF; the thumbnail menu gains Duplikat; restored drafts re-fetch imports; placement of stamps/signatures/images uses the visible area. Also fixes `scrollToPage` (it found the thumbnail, not the page — found by the E2E).

**Files:**
- Modify: `apps/web/src/components/editor/Editor.tsx`
- Create: `apps/web/src/components/editor/MenuButton.tsx`
- Create: `apps/web/src/components/editor/PageCanvas.tsx`
- Modify: `apps/web/src/components/editor/PageList.tsx`
- Modify: `apps/web/src/components/editor/PageMenu.tsx`
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`
- Modify: `apps/web/src/components/editor/PageView.tsx`
- Modify: `apps/web/src/components/editor/Sidebar.tsx`
- Modify: `apps/web/src/components/editor/Thumbnail.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Modify: `apps/web/src/components/editor/ZoomPill.tsx`
- Modify: `apps/web/src/components/editor/marks/SignatureModal.tsx`
- Modify: `apps/web/src/components/editor/marks/StampPicker.tsx`
- Create: `apps/web/src/components/editor/pages/importPdf.ts`
- Modify: `apps/web/src/components/editor/placement.ts`
- Modify: `apps/web/src/lib/strings.ts`
- Create: `apps/web/src/store/pdfs.test.ts`
- Create: `apps/web/src/store/pdfs.ts`

**Interfaces:**
- Consumes: Task 7 store actions, `resolveImports`; Task 6 `cropOffset`, `pageBounds`, `clampToBounds`.
- Produces:
- `store/pdfs.ts`: `pdfStore {docs, put, load, reset}`, `usePdf(docId|null)`.
- `PageCanvas` (shared by `PageView` and `Thumbnail`; `pdf` props removed from `PageList`, `Sidebar`, `PageView`, `Thumbnail`); `Thumbnail` takes `width?`; `THUMB_W` exported.
- `MenuButton {label, items: MenuItem[], className, children}` (portal menu; PageMenu rebuilt on it).
- `pages/importPdf.ts`: `importPdf(file, afterKey) -> keys`, `pickPdf() -> File|null`.
- `placement.currentPage()` returns `{entry, geom, size}`; `placeObject` shifts by the crop origin.
- Strings `t.pages.{duplicate, insert, blank, importPdf, imported(n), importGone}`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/store/pdfs.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const loadPdf = vi.fn();
const destroyPdf = vi.fn();
vi.mock("@/lib/pdf", () => ({ loadPdf: (url: string) => loadPdf(url), destroyPdf: (d: unknown) => destroyPdf(d) }));

const { pdfStore } = await import("@/store/pdfs");

afterEach(() => { pdfStore.getState().reset(); vi.clearAllMocks(); });

describe("pdfStore", () => {
  it("loads each document once", async () => {
    const doc = { id: 1 };
    loadPdf.mockResolvedValue(doc);
    await Promise.all([pdfStore.getState().load("A"), pdfStore.getState().load("A")]);
    expect(loadPdf).toHaveBeenCalledTimes(1);
    expect(loadPdf).toHaveBeenCalledWith("http://localhost:8000/documents/A/file");
    expect(pdfStore.getState().docs.A).toBe(doc);
  });

  it("records failures and retries them", async () => {
    loadPdf.mockRejectedValueOnce(new Error("410"));
    await pdfStore.getState().load("B");
    expect(pdfStore.getState().docs.B).toBe("error");
    loadPdf.mockResolvedValueOnce({ id: 2 });
    await pdfStore.getState().load("B");
    expect(pdfStore.getState().docs.B).toEqual({ id: 2 });
  });

  it("destroys documents on reset, also one that finishes loading afterwards", async () => {
    const late = { id: 3 };
    let resolve!: (v: unknown) => void;
    loadPdf.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = pdfStore.getState().load("C");
    pdfStore.getState().put("M", { id: 4 } as never);
    pdfStore.getState().reset();
    expect(destroyPdf).toHaveBeenCalledWith({ id: 4 });
    resolve(late);
    await pending;
    expect(destroyPdf).toHaveBeenCalledWith(late);
    expect(pdfStore.getState().docs).toEqual({});
  });
});
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: `@/store/pdfs` not found

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Editor.tsx`:

```diff
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -11,11 +11,12 @@ import { loadDraft, saveDraft } from "@/lib/draft";
 import { noticeStore } from "@/lib/notices";
 import { isTextOp, moveOp } from "@/lib/objects";
 import { destroyPdf, loadPdf } from "@/lib/pdf";
-import { restoreDraft } from "@/lib/restore";
+import { resolveImports, restoreDraft } from "@/lib/restore";
 import { errorMessage, t } from "@/lib/strings";
 import { createDebounced } from "@/lib/autosave";
 import { boxFonts } from "@/lib/textbox";
 import { editorStore, pageGeom, useEditor, type EditorDoc } from "@/store/editor";
+import { pdfStore } from "@/store/pdfs";
 import { textStore } from "@/store/text";
 import { FormLayer } from "./forms/FormLayer";
 import { Header } from "./Header";
@@ -49,7 +50,6 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
 
   useEffect(() => {
     let cancelled = false;
-    let doc: PDFDocumentProxy | null = null;
     initialDoc.current = null;
     (async () => {
       let st;
@@ -60,10 +60,15 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
         return;
       }
       if (cancelled) return;
-      const draft = restoreDraft(loadDraft(st.sha256), docId, st.page_count);
-      editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages, fields: st.fields }, draft);
+      let draft = restoreDraft(loadDraft(st.sha256), docId, st.page_count);
+      // Pages of imported PDFs need those documents' page sizes; imports that expired lose their pages.
+      const resolved = draft?.imports?.length ? await resolveImports(draft, async (id) => (await getStructure(id)).pages) : null;
+      if (cancelled) return;
+      if (resolved) draft = resolved.doc;
+      editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages, fields: st.fields, imports: resolved?.imports }, draft);
       initialDoc.current = editorStore.getState().doc;
-      if (draft) setNotice({ kind: "info", text: t.editor.restored });
+      if (resolved?.missing) setNotice({ kind: "error", text: t.pages.importGone });
+      else if (draft) setNotice({ kind: "info", text: t.editor.restored });
       void textStore.getState().load(docId); // original paragraphs + fonts, in the background
       // Preload fonts of restored text boxes (in parallel with the PDF; TextNode also loads on demand).
       const texts = Object.values(editorStore.getState().doc.objects).filter(isTextOp);
@@ -71,7 +76,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
       try {
         const loaded = await loadPdf(fileUrl(docId));
         if (cancelled) { destroyPdf(loaded); return; }
-        doc = loaded;
+        pdfStore.getState().put(docId, loaded); // pages render from the store (imported PDFs load there on demand)
         setPdf(loaded);
       } catch {
         if (!cancelled) setFatal("network");
@@ -79,7 +84,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
     })();
     return () => {
       cancelled = true;
-      if (doc) destroyPdf(doc);
+      pdfStore.getState().reset(); // destroys the main PDF and every imported one
       setPdf(null);
       setFatal(null);
     };
@@ -143,7 +148,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
       <Toolbar onNotice={setNotice} />
       <PropertiesBar />
       <div className="flex min-h-0 flex-1">
-        {pdf ? <Sidebar pdf={pdf} /> : <aside className="w-48 shrink-0 border-r border-line bg-surface" />}
+        {pdf ? <Sidebar /> : <aside className="w-48 shrink-0 border-r border-line bg-surface" />}
         <main
           className="relative min-w-0 flex-1 overflow-auto bg-bg"
           id="page-scroller"
@@ -161,7 +166,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
           }}
           onPointerUp={() => { drag.current = null; }}
         >
-          {info && pdf ? <PageList pdf={pdf} overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><LinkPopover {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
+          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><LinkPopover {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
         </main>
       </div>
       <FindBar />
```

Create `apps/web/src/components/editor/MenuButton.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem { label: string; run: () => void; disabled?: boolean; danger?: boolean }

const MENU_WIDTH = 176; // w-44

/** A button that opens a menu. The menu renders in a portal with fixed positioning so a narrow, scrolling
 *  parent (the sidebar) cannot clip it; it closes on an outside press, Escape, scroll or resize. */
export function MenuButton({ label, items, children, className }: { label: string; items: MenuItem[]; children: React.ReactNode; className?: string }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    // Capture phase: other handlers (another menu's button, dnd-kit) stop propagation.
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setAt(null);
    };
    const dismiss = () => setAt(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAt(null); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true); // the anchor moved
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (open) { setAt(null); return; }
    const r = button.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)) });
  }

  return (
    <>
      <button
        ref={button}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={className}
      >{children}</button>
      {at && createPortal(
        <div
          ref={menu}
          role="menu"
          style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line"
        >
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              onClick={() => { setAt(null); it.run(); }}
              className={`block w-full px-3 py-1.5 text-left hover:bg-bg disabled:opacity-40 ${it.danger ? "text-danger" : ""}`}>
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
```

Create `apps/web/src/components/editor/PageCanvas.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { RenderTask } from "pdfjs-dist";
import { cropOffset, screenSize, type PageGeom } from "@/lib/coords";
import type { PageEntry } from "@/store/editor";
import { usePdf } from "@/store/pdfs";

/** The pdf.js rendering of a page's source (the edited PDF or an imported one). A cropped page is rendered
 *  whole and shifted so only the crop shows (the parent clips it). Blank pages draw nothing. */
export function PageCanvas({ entry, geom, scale, label }: { entry: PageEntry; geom: PageGeom; scale: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pdf = usePdf("doc" in entry.src ? entry.src.doc : null);
  const full = screenSize({ ...geom, crop: null }, scale);
  const [left, top] = cropOffset(geom, scale);

  useEffect(() => {
    if (!pdf || !("doc" in entry.src) || !canvas.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const index = entry.src.index;
    (async () => {
      try {
        const page = await pdf.getPage(index + 1);
        if (cancelled || !canvas.current) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr, rotation: geom.rotation });
        const c = canvas.current;
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        task = page.render({ canvas: c, viewport });
        await task.promise;
      } catch (e) {
        if (cancelled || (e as { name?: string })?.name === "RenderingCancelledException") return;
        console.warn(`pdf.js ${label} render failed`, e);
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, entry.src, geom.rotation, scale, label]);

  if (!("doc" in entry.src)) return null;
  return <canvas ref={canvas} className="absolute" style={{ left, top, width: full.width, height: full.height }} />;
}
```

Modify `apps/web/src/components/editor/PageList.tsx`:

```diff
--- a/apps/web/src/components/editor/PageList.tsx
+++ b/apps/web/src/components/editor/PageList.tsx
@@ -1,12 +1,11 @@
 "use client";
 
 import { useCallback, useEffect, useRef } from "react";
-import type { PDFDocumentProxy } from "pdfjs-dist";
 import { pickVisible, pruneRatios } from "@/lib/visible";
 import { editorStore, pageGeom, useEditor } from "@/store/editor";
 import { PageView, type OverlayRender } from "./PageView";
 
-export function PageList({ pdf, overlay }: { pdf: PDFDocumentProxy; overlay?: OverlayRender }) {
+export function PageList({ overlay }: { overlay?: OverlayRender }) {
   const pages = useEditor((s) => s.doc.pages);
   const info = useEditor((s) => s.info)!;
   const zoom = useEditor((s) => s.zoom);
@@ -28,7 +27,7 @@ export function PageList({ pdf, overlay }: { pdf: PDFDocumentProxy; overlay?: Ov
   return (
     <div className="flex flex-col items-center gap-6 px-6 py-8">
       {pages.map((entry) => (
-        <PageView key={entry.pageKey} pdf={pdf} entry={entry} geom={pageGeom(entry, info)} scale={zoom} overlay={overlay} onVisible={onVisible} />
+        <PageView key={entry.pageKey} entry={entry} geom={pageGeom(entry, info)} scale={zoom} overlay={overlay} onVisible={onVisible} />
       ))}
     </div>
   );
```

Modify `apps/web/src/components/editor/PageMenu.tsx`:

```diff
--- a/apps/web/src/components/editor/PageMenu.tsx
+++ b/apps/web/src/components/editor/PageMenu.tsx
@@ -1,85 +1,22 @@
 "use client";
 
-import { useEffect, useRef, useState } from "react";
-import { createPortal } from "react-dom";
 import { t } from "@/lib/strings";
 import { editorStore } from "@/store/editor";
+import { MenuButton } from "./MenuButton";
+import { scrollToPage } from "./ZoomPill";
 
-const MENU_WIDTH = 176; // w-44
-
-/** The page menu renders in a portal with fixed positioning so the narrow, scrolling sidebar cannot clip it. */
 export function PageMenu({ pageKey, index, count }: { pageKey: string; index: number; count: number }) {
-  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
-  const button = useRef<HTMLButtonElement>(null);
-  const menu = useRef<HTMLDivElement>(null);
-  const open = at !== null;
-
-  useEffect(() => {
-    if (!open) return;
-    // Capture phase: other handlers (another page menu's button, dnd-kit) stop propagation.
-    const close = (e: PointerEvent) => {
-      const target = e.target as Node;
-      if (!menu.current?.contains(target) && !button.current?.contains(target)) setAt(null);
-    };
-    const dismiss = () => setAt(null);
-    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAt(null); };
-    window.addEventListener("pointerdown", close, true);
-    window.addEventListener("resize", dismiss);
-    window.addEventListener("scroll", dismiss, true); // the anchor moved
-    window.addEventListener("keydown", onKey);
-    return () => {
-      window.removeEventListener("pointerdown", close, true);
-      window.removeEventListener("resize", dismiss);
-      window.removeEventListener("scroll", dismiss, true);
-      window.removeEventListener("keydown", onKey);
-    };
-  }, [open]);
-
-  function toggle() {
-    if (open) { setAt(null); return; }
-    const r = button.current!.getBoundingClientRect();
-    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)) });
-  }
-
   const s = editorStore.getState();
-  const items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[] = [
-    { label: t.editor.rotateLeft, run: () => s.rotatePage(pageKey, -90) },
-    { label: t.editor.rotateRight, run: () => s.rotatePage(pageKey, 90) },
-    { label: t.editor.moveUp, run: () => s.movePage(pageKey, index - 1), disabled: index === 0 },
-    { label: t.editor.moveDown, run: () => s.movePage(pageKey, index + 1), disabled: index === count - 1 },
-    { label: t.editor.deletePage, run: () => s.deletePage(pageKey), disabled: count <= 1, danger: true },
-  ];
-
   return (
     <div className="absolute right-1 top-1">
-      <button
-        ref={button}
-        aria-label={t.editor.pageMenu}
-        aria-haspopup="menu"
-        aria-expanded={open}
-        onPointerDown={(e) => e.stopPropagation()}
-        onClick={(e) => { e.stopPropagation(); toggle(); }}
-        className="grid h-6 w-6 place-items-center rounded bg-white/90 text-muted shadow ring-1 ring-line hover:text-ink"
-      >⋮</button>
-      {at && createPortal(
-        <div
-          ref={menu}
-          role="menu"
-          style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
-          onPointerDown={(e) => e.stopPropagation()}
-          onClick={(e) => e.stopPropagation()}
-          className="fixed z-50 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line"
-        >
-          {items.map((it) => (
-            <button key={it.label} role="menuitem" disabled={it.disabled}
-              onClick={() => { it.run(); setAt(null); }}
-              className={`block w-full px-3 py-1.5 text-left hover:bg-bg disabled:opacity-40 ${it.danger ? "text-danger" : ""}`}>
-              {it.label}
-            </button>
-          ))}
-        </div>,
-        document.body,
-      )}
+      <MenuButton label={t.editor.pageMenu} className="grid h-6 w-6 place-items-center rounded bg-white/90 text-muted shadow ring-1 ring-line hover:text-ink" items={[
+        { label: t.editor.rotateLeft, run: () => s.rotatePage(pageKey, -90) },
+        { label: t.editor.rotateRight, run: () => s.rotatePage(pageKey, 90) },
+        { label: t.pages.duplicate, run: () => { const k = s.duplicatePage(pageKey); if (k) setTimeout(() => scrollToPage(k), 50); } },
+        { label: t.editor.moveUp, run: () => s.movePage(pageKey, index - 1), disabled: index === 0 },
+        { label: t.editor.moveDown, run: () => s.movePage(pageKey, index + 1), disabled: index === count - 1 },
+        { label: t.editor.deletePage, run: () => s.deletePage(pageKey), disabled: count <= 1, danger: true },
+      ]}>⋮</MenuButton>
     </div>
   );
 }
```

Modify `apps/web/src/components/editor/PageOverlay.tsx`:

```diff
--- a/apps/web/src/components/editor/PageOverlay.tsx
+++ b/apps/web/src/components/editor/PageOverlay.tsx
@@ -5,9 +5,9 @@ import type Konva from "konva";
 import { Group, Layer, Stage, Transformer } from "react-konva";
 import { useStore } from "zustand";
 import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
-import { groupTransform, screenSize, type PageGeom } from "@/lib/coords";
+import { groupTransform, pageBounds, screenSize, type PageGeom } from "@/lib/coords";
 import { newId } from "@/lib/id";
-import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, MARKUP_TOOLS, MIN_DRAG, moveOp, normalizeRect, noteAt, resizeOp, symbolAt, type DragTool, type Pt } from "@/lib/objects";
+import { clampToBounds, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, MARKUP_TOOLS, MIN_DRAG, moveOp, normalizeRect, noteAt, resizeOp, symbolAt, type DragTool, type Pt } from "@/lib/objects";
 import { charsStore } from "@/store/chars";
 import { editorStore, useEditor, type MarkupTool } from "@/store/editor";
 import { linkStore } from "./marks/linkStore";
@@ -81,7 +81,7 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
     const page = pageRef.current!;
     if (evt) page.getStage()?.setPointersPositions(evt);
     const p = page.getRelativePointerPosition()!;
-    return clampToPage([p.x, p.y], geom.width, geom.height);
+    return clampToBounds([p.x, p.y], pageBounds(geom));
   };
 
   function setDrawDraft(d: ContentOp | null) {
@@ -188,7 +188,7 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
         onPointerDown={onDown}
       >
         <Layer>
-          <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale}>
+          <Group ref={pageRef} x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale} offsetX={tr.offsetX} offsetY={tr.offsetY}>
             {overlayHooks.renderUnder?.(pageKey)}
             {objs.map((op) => (
               <Group
@@ -248,7 +248,7 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
           />
         </Layer>
         <Layer ref={multiplyLayer} listening={tool === "select"}>
-          <Group x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale}>
+          <Group x={tr.x} y={tr.y} rotation={tr.rotation} scaleX={tr.scale} scaleY={tr.scale} offsetX={tr.offsetX} offsetY={tr.offsetY}>
             {markups.map((op) => (
               <Group key={op.id} onPointerDown={(e) => {
                 e.cancelBubble = true;
```

Modify `apps/web/src/components/editor/PageView.tsx`:

```diff
--- a/apps/web/src/components/editor/PageView.tsx
+++ b/apps/web/src/components/editor/PageView.tsx
@@ -1,18 +1,17 @@
 "use client";
 
 import { useEffect, useRef, useState } from "react";
-import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
 import { screenSize, type PageGeom } from "@/lib/coords";
 import type { PageEntry } from "@/store/editor";
+import { PageCanvas } from "./PageCanvas";
 
 export type OverlayRender = (args: { pageKey: string; geom: PageGeom; scale: number }) => React.ReactNode;
 
-export function PageView({ pdf, entry, geom, scale, overlay, onVisible }: {
-  pdf: PDFDocumentProxy; entry: PageEntry; geom: PageGeom; scale: number;
+export function PageView({ entry, geom, scale, overlay, onVisible }: {
+  entry: PageEntry; geom: PageGeom; scale: number;
   overlay?: OverlayRender; onVisible?: (key: string, ratio: number) => void;
 }) {
   const wrap = useRef<HTMLDivElement>(null);
-  const canvas = useRef<HTMLCanvasElement>(null);
   const [near, setNear] = useState(false);
   const size = screenSize(geom, scale);
 
@@ -32,41 +31,15 @@ export function PageView({ pdf, entry, geom, scale, overlay, onVisible }: {
     return () => { io.disconnect(); vis.disconnect(); onVisible?.(entry.pageKey, 0); };
   }, [entry.pageKey, onVisible]);
 
-  useEffect(() => {
-    if (!near || !("doc" in entry.src) || !canvas.current) return;
-    let task: RenderTask | null = null;
-    let cancelled = false;
-    const index = entry.src.index;
-    (async () => {
-      try {
-        const page = await pdf.getPage(index + 1);
-        if (cancelled || !canvas.current) return;
-        const dpr = window.devicePixelRatio || 1;
-        const viewport = page.getViewport({ scale: scale * dpr, rotation: geom.rotation });
-        const c = canvas.current;
-        c.width = Math.floor(viewport.width);
-        c.height = Math.floor(viewport.height);
-        task = page.render({ canvas: c, viewport });
-        await task.promise;
-      } catch (e) {
-        if (cancelled || (e as { name?: string })?.name === "RenderingCancelledException") return;
-        console.warn("pdf.js render failed", e);
-      }
-    })();
-    return () => { cancelled = true; task?.cancel(); };
-  }, [near, pdf, entry.src, geom.rotation, scale]);
-
   return (
     <div
       ref={wrap}
       data-testid="page"
       data-page-key={entry.pageKey}
-      className="relative mx-auto bg-white shadow-sm ring-1 ring-line"
+      className="relative mx-auto overflow-hidden bg-white shadow-sm ring-1 ring-line"
       style={{ width: size.width, height: size.height }}
     >
-      {"doc" in entry.src && near && (
-        <canvas ref={canvas} className="absolute inset-0" style={{ width: size.width, height: size.height }} />
-      )}
+      {near && <PageCanvas entry={entry} geom={geom} scale={scale} label="page" />}
       {near && overlay?.({ pageKey: entry.pageKey, geom, scale })}
     </div>
   );
```

Modify `apps/web/src/components/editor/Sidebar.tsx`:

```diff
--- a/apps/web/src/components/editor/Sidebar.tsx
+++ b/apps/web/src/components/editor/Sidebar.tsx
@@ -3,27 +3,28 @@
 import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
 import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
 import { CSS } from "@dnd-kit/utilities";
-import type { PDFDocumentProxy } from "pdfjs-dist";
 import { t } from "@/lib/strings";
 import { editorStore, pageGeom, useEditor, type PageEntry } from "@/store/editor";
+import { MenuButton } from "./MenuButton";
 import { PageMenu } from "./PageMenu";
+import { importPdf, pickPdf } from "./pages/importPdf";
 import { Thumbnail } from "./Thumbnail";
 import { scrollToPage } from "./ZoomPill";
 
+/** "+" between pages: a blank page or the pages of another PDF go there. */
 function InsertButton({ after }: { after: string | null }) {
+  const scroll = (k: string | undefined) => { if (k) setTimeout(() => scrollToPage(k), 50); };
   return (
-    <button
-      aria-label={t.editor.insertBlank}
-      title={t.editor.insertBlank}
-      onClick={() => { const k = editorStore.getState().insertBlankAfter(after); setTimeout(() => scrollToPage(k), 50); }}
-      className="group mx-auto my-1 flex h-5 w-full items-center justify-center"
-    >
-      <span className="grid h-5 w-5 place-items-center rounded-full bg-surface text-xs text-muted opacity-0 ring-1 ring-line transition group-hover:opacity-100 group-focus-visible:opacity-100">+</span>
-    </button>
+    <div className="group mx-auto my-1 flex h-5 w-full items-center justify-center">
+      <MenuButton label={t.pages.insert} className="grid h-5 w-5 place-items-center rounded-full bg-surface text-xs text-muted opacity-0 ring-1 ring-line transition group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100" items={[
+        { label: t.pages.blank, run: () => scroll(editorStore.getState().insertBlankAfter(after)) },
+        { label: t.pages.importPdf, run: () => void pickPdf().then(async (f) => { if (f) scroll((await importPdf(f, after))[0]); }) },
+      ]}>+</MenuButton>
+    </div>
   );
 }
 
-function SortableThumb({ pdf, entry, index, count, active }: { pdf: PDFDocumentProxy; entry: PageEntry; index: number; count: number; active: boolean }) {
+function SortableThumb({ entry, index, count, active }: { entry: PageEntry; index: number; count: number; active: boolean }) {
   const info = useEditor((s) => s.info)!;
   const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.pageKey });
   return (
@@ -36,7 +37,7 @@ function SortableThumb({ pdf, entry, index, count, active }: { pdf: PDFDocumentP
         onClick={() => scrollToPage(entry.pageKey)}
         className={`relative mx-auto w-fit cursor-pointer rounded-md p-1 ${active ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-line"}`}
       >
-        <Thumbnail pdf={pdf} entry={entry} geom={pageGeom(entry, info)} />
+        <Thumbnail entry={entry} geom={pageGeom(entry, info)} />
         <PageMenu pageKey={entry.pageKey} index={index} count={count} />
         <p className="mt-1 text-center text-xs text-muted">{index + 1}</p>
       </div>
@@ -44,7 +45,7 @@ function SortableThumb({ pdf, entry, index, count, active }: { pdf: PDFDocumentP
   );
 }
 
-export function Sidebar({ pdf }: { pdf: PDFDocumentProxy }) {
+export function Sidebar() {
   const pages = useEditor((s) => s.doc.pages);
   const current = useEditor((s) => s.currentPage);
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
@@ -62,7 +63,7 @@ export function Sidebar({ pdf }: { pdf: PDFDocumentProxy }) {
           <InsertButton after={null} />
           {pages.map((entry, i) => (
             <div key={entry.pageKey}>
-              <SortableThumb pdf={pdf} entry={entry} index={i} count={pages.length} active={entry.pageKey === current} />
+              <SortableThumb entry={entry} index={i} count={pages.length} active={entry.pageKey === current} />
               <InsertButton after={entry.pageKey} />
             </div>
           ))}
```

Modify `apps/web/src/components/editor/Thumbnail.tsx`:

```diff
--- a/apps/web/src/components/editor/Thumbnail.tsx
+++ b/apps/web/src/components/editor/Thumbnail.tsx
@@ -1,45 +1,17 @@
 "use client";
 
-import { useEffect, useRef } from "react";
-import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
 import { screenSize, type PageGeom } from "@/lib/coords";
 import type { PageEntry } from "@/store/editor";
+import { PageCanvas } from "./PageCanvas";
 
-const THUMB_W = 120;
+export const THUMB_W = 120;
 
-export function Thumbnail({ pdf, entry, geom }: { pdf: PDFDocumentProxy; entry: PageEntry; geom: PageGeom }) {
-  const canvas = useRef<HTMLCanvasElement>(null);
-  const base = screenSize(geom, 1);
-  const scale = THUMB_W / base.width;
+export function Thumbnail({ entry, geom, width = THUMB_W }: { entry: PageEntry; geom: PageGeom; width?: number }) {
+  const scale = width / screenSize(geom, 1).width;
   const size = screenSize(geom, scale);
-
-  useEffect(() => {
-    if (!("doc" in entry.src) || !canvas.current) return;
-    let task: RenderTask | null = null;
-    let cancelled = false;
-    const index = entry.src.index;
-    (async () => {
-      try {
-        const page = await pdf.getPage(index + 1);
-        if (cancelled || !canvas.current) return;
-        const dpr = window.devicePixelRatio || 1;
-        const viewport = page.getViewport({ scale: scale * dpr, rotation: geom.rotation });
-        const c = canvas.current;
-        c.width = Math.floor(viewport.width);
-        c.height = Math.floor(viewport.height);
-        task = page.render({ canvas: c, viewport });
-        await task.promise;
-      } catch (e) {
-        if (cancelled || (e as { name?: string })?.name === "RenderingCancelledException") return;
-        console.warn("pdf.js thumbnail render failed", e);
-      }
-    })();
-    return () => { cancelled = true; task?.cancel(); };
-  }, [pdf, entry.src, geom.rotation, scale]);
-
   return (
-    <div className="relative bg-white ring-1 ring-line" style={{ width: size.width, height: size.height }}>
-      {"doc" in entry.src && <canvas ref={canvas} style={{ width: size.width, height: size.height }} />}
+    <div className="relative overflow-hidden bg-white ring-1 ring-line" style={{ width: size.width, height: size.height }}>
+      <PageCanvas entry={entry} geom={geom} scale={scale} label="thumbnail" />
     </div>
   );
 }
```

Modify `apps/web/src/components/editor/Toolbar.tsx`:

```diff
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -41,7 +41,7 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
     if (!f || !st.info || !at) return;
     try {
       const asset = await uploadAsset(st.info.docId, f);
-      const rect = fitImage(asset.width, asset.height, at.geom.width, at.geom.height);
+      const rect = fitImage(asset.width, asset.height, at.size.width, at.size.height);
       placeObject({ id: newId(), type: "image.add", pageKey: at.entry.pageKey, rect, assetId: asset.asset_id } as ContentOp);
     } catch (e) {
       onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
```

Modify `apps/web/src/components/editor/ZoomPill.tsx`:

```diff
--- a/apps/web/src/components/editor/ZoomPill.tsx
+++ b/apps/web/src/components/editor/ZoomPill.tsx
@@ -4,7 +4,8 @@ import { t } from "@/lib/strings";
 import { editorStore, useEditor } from "@/store/editor";
 
 export function scrollToPage(pageKey: string) {
-  document.querySelector(`[data-page-key="${pageKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
+  // The page itself, not its thumbnail (which carries the same data-page-key and comes first in the DOM).
+  document.querySelector(`[data-testid="page"][data-page-key="${pageKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
 }
 
 export function ZoomPill() {
```

Modify `apps/web/src/components/editor/marks/SignatureModal.tsx`:

```diff
--- a/apps/web/src/components/editor/marks/SignatureModal.tsx
+++ b/apps/web/src/components/editor/marks/SignatureModal.tsx
@@ -23,7 +23,7 @@ async function placeSignature(img: SignatureImage): Promise<void> {
   const at = currentPage();
   if (!st.info || !at) return;
   const asset = await uploadAsset(st.info.docId, dataUrlToBlob(img.dataUrl));
-  const op: SignatureAdd = { id: newId(), type: "signature.add", pageKey: at.entry.pageKey, rect: signatureRect(img.width, img.height, at.geom), assetId: asset.asset_id };
+  const op: SignatureAdd = { id: newId(), type: "signature.add", pageKey: at.entry.pageKey, rect: signatureRect(img.width, img.height, at.size), assetId: asset.asset_id };
   placeObject(op);
 }
```

Modify `apps/web/src/components/editor/marks/StampPicker.tsx`:

```diff
--- a/apps/web/src/components/editor/marks/StampPicker.tsx
+++ b/apps/web/src/components/editor/marks/StampPicker.tsx
@@ -13,7 +13,7 @@ export async function placeStamp(kind: StampKind, color: string): Promise<void>
   const metrics = await fontStore.load(STAMP_FONT);
   const at = currentPage();
   if (!at) return;
-  const op: StampAdd = { id: newId(), type: "stamp.add", pageKey: at.entry.pageKey, rect: stampRect(kind, metrics, at.geom), color, ...kind };
+  const op: StampAdd = { id: newId(), type: "stamp.add", pageKey: at.entry.pageKey, rect: stampRect(kind, metrics, at.size), color, ...kind };
   placeObject(op);
 }
```

Create `apps/web/src/components/editor/pages/importPdf.ts`:

```ts
import { ApiError, getStructure, uploadDocument } from "@/lib/api";
import { noticeStore } from "@/lib/notices";
import { errorMessage, t } from "@/lib/strings";
import { editorStore } from "@/store/editor";

/** Uploads `file` as another document and inserts all its pages after `afterKey` (null: before the first page)
 *  as one undo step. Returns the new pages' keys (none on failure; a notice says why). */
export async function importPdf(file: File, afterKey: string | null): Promise<string[]> {
  try {
    const up = await uploadDocument(file, file.name);
    const st = await getStructure(up.doc_id);
    const s = editorStore.getState();
    s.addImport(up.doc_id, st.pages);
    const keys = s.insertImportAfter(afterKey, up.doc_id);
    noticeStore.getState().show({ kind: "info", text: t.pages.imported(keys.length) });
    return keys;
  } catch (e) {
    noticeStore.getState().show({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
    return [];
  }
}

/** Opens the file picker for a PDF to import; resolves with the chosen file (or null). */
export function pickPdf(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.dataset.testid = "import-input";
    input.style.display = "none";
    input.addEventListener("change", () => { resolve(input.files?.[0] ?? null); input.remove(); });
    input.addEventListener("cancel", () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
```

Modify `apps/web/src/components/editor/placement.ts`:

```diff
--- a/apps/web/src/components/editor/placement.ts
+++ b/apps/web/src/components/editor/placement.ts
@@ -1,19 +1,26 @@
 import type { ContentOp } from "@edith/ops";
-import type { PageGeom } from "@/lib/coords";
+import { pageBounds, type PageGeom } from "@/lib/coords";
+import { moveOp } from "@/lib/objects";
 import { editorStore, pageGeom, type PageEntry } from "@/store/editor";
 
-/** The page in view (or the first one) and its geometry: where stamps, signatures and images go. */
-export function currentPage(): { entry: PageEntry; geom: PageGeom } | null {
+/** The page in view (or the first one), its geometry and the size of its visible part (its crop): where
+ *  stamps, signatures and images go. Rects made for `size` are placed with placeObject(). */
+export function currentPage(): { entry: PageEntry; geom: PageGeom; size: { width: number; height: number } } | null {
   const st = editorStore.getState();
   const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage) ?? st.doc.pages[0];
   if (!entry || !st.info) return null;
-  return { entry, geom: pageGeom(entry, st.info) };
+  const geom = pageGeom(entry, st.info);
+  const b = pageBounds(geom);
+  return { entry, geom, size: { width: b.w, height: b.h } };
 }
 
-/** Adds `op` and selects it with the select tool (it can be moved/resized right away). */
+/** Adds `op` — positioned relative to the visible part of its page — and selects it with the select tool
+ *  (it can be moved/resized right away). */
 export function placeObject(op: ContentOp): void {
   const st = editorStore.getState();
-  st.addObject(op);
+  const entry = st.doc.pages.find((p) => p.pageKey === op.pageKey);
+  const crop = entry?.crop;
+  st.addObject(crop ? moveOp(op, crop.x, crop.y) : op);
   st.setTool("select");
   st.select(op.id);
 }
```

Modify `apps/web/src/lib/strings.ts`:

```diff
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -94,6 +94,14 @@ export const t = {
     remove: "Hapus tanda tangan tersimpan", add: "Tambahkan", tooBig: "Tanda tangan ini terlalu besar untuk disimpan di browser",
     colors: { "#111111": "Hitam", "#1d4ed8": "Biru", "#b91c1c": "Merah" } as Record<string, string>,
   },
+  pages: {
+    duplicate: "Duplikat halaman",
+    insert: "Sisipkan halaman",
+    blank: "Halaman kosong",
+    importPdf: "Impor PDF",
+    imported: (n: number) => `${n} halaman diimpor`,
+    importGone: "Halaman dari PDF yang diimpor sudah tidak tersedia (sesi 1 jam berakhir). Impor ulang PDF-nya.",
+  },
   form: {
     flatten: "Ratakan form",
     flattenHint: "Isian form menjadi bagian halaman dan tidak bisa diubah lagi",
```

Create `apps/web/src/store/pdfs.ts`:

```ts
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { fileUrl } from "@/lib/api";
import { destroyPdf, loadPdf } from "@/lib/pdf";

/** pdf.js documents by doc id: the edited PDF and every imported one. Loaded once, on first use. */
export interface PdfsState {
  docs: Record<string, PDFDocumentProxy | "loading" | "error">;
  /** Registers an already loaded document (the editor's main PDF). */
  put(docId: string, pdf: PDFDocumentProxy): void;
  load(docId: string): Promise<void>;
  /** Destroys every document (the editor closed or opened another file). */
  reset(): void;
}

export const pdfStore = createStore<PdfsState>()((set, get) => ({
  docs: {},
  put(docId, pdf) { set({ docs: { ...get().docs, [docId]: pdf } }); },
  async load(docId) {
    const cur = get().docs[docId];
    if (cur !== undefined && cur !== "error") return;
    set({ docs: { ...get().docs, [docId]: "loading" } });
    let result: PDFDocumentProxy | "error";
    try {
      result = await loadPdf(fileUrl(docId));
    } catch (e) {
      console.warn("pdf: load failed", docId, e);
      result = "error";
    }
    if (get().docs[docId] !== "loading") { // reset meanwhile
      if (result !== "error") destroyPdf(result);
      return;
    }
    set({ docs: { ...get().docs, [docId]: result } });
  },
  reset() {
    for (const d of Object.values(get().docs)) if (typeof d === "object") destroyPdf(d);
    set({ docs: {} });
  },
}));

/** The pdf.js document of `docId` (null for blank pages or while loading); starts loading it when needed. */
export function usePdf(docId: string | null): PDFDocumentProxy | null {
  const d = useStore(pdfStore, (s) => (docId ? s.docs[docId] : undefined));
  if (docId && d === undefined) void pdfStore.getState().load(docId);
  return typeof d === "object" ? d : null;
}
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run e2e -w apps/web`
Expected: web 260 passed; tsc/eslint clean; existing E2E 6 passed

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/MenuButton.tsx apps/web/src/components/editor/PageCanvas.tsx apps/web/src/components/editor/PageList.tsx apps/web/src/components/editor/PageMenu.tsx apps/web/src/components/editor/PageOverlay.tsx apps/web/src/components/editor/PageView.tsx apps/web/src/components/editor/Sidebar.tsx apps/web/src/components/editor/Thumbnail.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/ZoomPill.tsx apps/web/src/components/editor/marks/SignatureModal.tsx apps/web/src/components/editor/marks/StampPicker.tsx apps/web/src/components/editor/pages/importPdf.ts apps/web/src/components/editor/placement.ts apps/web/src/lib/strings.ts apps/web/src/store/pdfs.test.ts apps/web/src/store/pdfs.ts
git commit -m "feat(web): render imported and cropped pages; insert blank or imported pages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
