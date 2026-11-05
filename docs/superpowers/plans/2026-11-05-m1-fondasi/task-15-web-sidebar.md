# Task 15: Thumbnail sidebar with page operations

**Files:**
- Create: `apps/web/src/components/editor/Sidebar.tsx`, `apps/web/src/components/editor/Thumbnail.tsx`, `apps/web/src/components/editor/PageMenu.tsx`
- Modify: `apps/web/src/components/editor/Editor.tsx` (replace sidebar placeholder), `apps/web/package.json` (deps)

**Interfaces:**
- Consumes: store actions `rotatePage`, `deletePage`, `insertBlankAfter`, `movePage`, `currentPage`, `pageGeom` (Task 12); `scrollToPage` from `ZoomPill.tsx` (Task 14); `screenSize` (Task 10); `t` (Task 1).
- Produces: `<Sidebar pdf={PDFDocumentProxy} />`. Test ids: each thumbnail `data-testid="thumb"` with `data-page-key`; menu button `aria-label="Menu halaman"`; menu items are `role="menuitem"` with labels from `t.editor` (`rotateLeft`, `rotateRight`, `moveUp`, `moveDown`, `deletePage`); insert buttons `aria-label={t.editor.insertBlank}` (one before the first page and one after every page).

Thumbnails show the source page only (added objects are not drawn in thumbnails in M1).

- [ ] **Step 1: Deps**

Run: `npm install -w apps/web @dnd-kit/core@^6 @dnd-kit/sortable@^10 @dnd-kit/utilities@^3`

- [ ] **Step 2: Thumbnail**

`apps/web/src/components/editor/Thumbnail.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { screenSize, type PageGeom } from "@/lib/coords";
import type { PageEntry } from "@/store/editor";

const THUMB_W = 120;

export function Thumbnail({ pdf, entry, geom }: { pdf: PDFDocumentProxy; entry: PageEntry; geom: PageGeom }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = screenSize(geom, 1);
  const scale = THUMB_W / base.width;
  const size = screenSize(geom, scale);

  useEffect(() => {
    if (!("doc" in entry.src) || !canvas.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const index = entry.src.index;
    (async () => {
      const page = await pdf.getPage(index + 1);
      if (cancelled || !canvas.current) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr, rotation: geom.rotation });
      canvas.current.width = Math.floor(viewport.width);
      canvas.current.height = Math.floor(viewport.height);
      task = page.render({ canvas: canvas.current, viewport });
      try { await task.promise; } catch { /* cancelled */ }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, entry.src, geom.rotation, scale]);

  return (
    <div className="relative bg-white ring-1 ring-line" style={{ width: size.width, height: size.height }}>
      {"doc" in entry.src && <canvas ref={canvas} style={{ width: size.width, height: size.height }} />}
    </div>
  );
}
```
(Use `canvasContext` instead of `canvas` if Task 14 needed that change.)

- [ ] **Step 3: Page menu**

`apps/web/src/components/editor/PageMenu.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/strings";
import { editorStore } from "@/store/editor";

export function PageMenu({ pageKey, index, count }: { pageKey: string; index: number; count: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const s = editorStore.getState();
  const items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[] = [
    { label: t.editor.rotateLeft, run: () => s.rotatePage(pageKey, -90) },
    { label: t.editor.rotateRight, run: () => s.rotatePage(pageKey, 90) },
    { label: t.editor.moveUp, run: () => s.movePage(pageKey, index - 1), disabled: index === 0 },
    { label: t.editor.moveDown, run: () => s.movePage(pageKey, index + 1), disabled: index === count - 1 },
    { label: t.editor.deletePage, run: () => s.deletePage(pageKey), disabled: count <= 1, danger: true },
  ];

  return (
    <div ref={ref} className="absolute right-1 top-1">
      <button
        aria-label="Menu halaman"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="grid h-6 w-6 place-items-center rounded bg-white/90 text-muted shadow ring-1 ring-line hover:text-ink"
      >⋮</button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); it.run(); setOpen(false); }}
              className={`block w-full px-3 py-1.5 text-left hover:bg-bg disabled:opacity-40 ${it.danger ? "text-danger" : ""}`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Sidebar with sortable thumbnails**

`apps/web/src/components/editor/Sidebar.tsx`:
```tsx
"use client";

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { t } from "@/lib/strings";
import { editorStore, pageGeom, useEditor, type PageEntry } from "@/store/editor";
import { PageMenu } from "./PageMenu";
import { Thumbnail } from "./Thumbnail";
import { scrollToPage } from "./ZoomPill";

function InsertButton({ after }: { after: string | null }) {
  return (
    <button
      aria-label={t.editor.insertBlank}
      title={t.editor.insertBlank}
      onClick={() => { const k = editorStore.getState().insertBlankAfter(after); setTimeout(() => scrollToPage(k), 50); }}
      className="group mx-auto my-1 flex h-5 w-full items-center justify-center"
    >
      <span className="grid h-5 w-5 place-items-center rounded-full bg-surface text-xs text-muted opacity-0 ring-1 ring-line transition group-hover:opacity-100 group-focus-visible:opacity-100">+</span>
    </button>
  );
}

function SortableThumb({ pdf, entry, index, count, active }: { pdf: PDFDocumentProxy; entry: PageEntry; index: number; count: number; active: boolean }) {
  const info = useEditor((s) => s.info)!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.pageKey });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>
      <div
        data-testid="thumb"
        data-page-key={entry.pageKey}
        {...attributes}
        {...listeners}
        onClick={() => scrollToPage(entry.pageKey)}
        className={`relative mx-auto w-fit cursor-pointer rounded-md p-1 ${active ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-line"}`}
      >
        <Thumbnail pdf={pdf} entry={entry} geom={pageGeom(entry, info)} />
        <PageMenu pageKey={entry.pageKey} index={index} count={count} />
        <p className="mt-1 text-center text-xs text-muted">{index + 1}</p>
      </div>
    </div>
  );
}

export function Sidebar({ pdf }: { pdf: PDFDocumentProxy }) {
  const pages = useEditor((s) => s.doc.pages);
  const current = useEditor((s) => s.currentPage);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const to = pages.findIndex((p) => p.pageKey === e.over!.id);
    editorStore.getState().movePage(String(e.active.id), to);
  }

  return (
    <aside className="w-48 shrink-0 overflow-y-auto border-r border-line bg-surface px-2 py-3" aria-label={t.editor.pages}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={pages.map((p) => p.pageKey)} strategy={verticalListSortingStrategy}>
          <InsertButton after={null} />
          {pages.map((entry, i) => (
            <div key={entry.pageKey}>
              <SortableThumb pdf={pdf} entry={entry} index={i} count={pages.length} active={entry.pageKey === current} />
              <InsertButton after={entry.pageKey} />
            </div>
          ))}
        </SortableContext>
      </DndContext>
    </aside>
  );
}
```

In `Editor.tsx` replace the sidebar placeholder `<aside ... data-slot="sidebar" />` with:
```tsx
{pdf ? <Sidebar pdf={pdf} /> : <aside className="w-48 shrink-0 border-r border-line bg-surface" />}
```
and add `import { Sidebar } from "./Sidebar";`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p apps/web && npm run build -w apps/web` → succeed.

Manual: with a 3-page PDF — rotate page 2 right (main view and thumbnail rotate), drag page 3 to top, insert a blank page after page 1, delete a page, Ctrl+Z undoes each step in reverse, Unduh → downloaded PDF has the same order/rotation/blank page as the screen.

- [ ] **Step 6: Commit**

```bash
git add apps/web package-lock.json
git commit -m "feat(web): add page thumbnail sidebar with reorder, rotate, insert and delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
