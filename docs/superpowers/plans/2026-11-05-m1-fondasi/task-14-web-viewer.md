# Task 14: Editor shell — pdf.js pages, header, zoom pill, download

**Files:**
- Create: `apps/web/src/app/edit/[docId]/page.tsx`, `apps/web/src/components/editor/Editor.tsx`, `apps/web/src/components/editor/Header.tsx`, `apps/web/src/components/editor/PageList.tsx`, `apps/web/src/components/editor/PageView.tsx`, `apps/web/src/components/editor/ZoomPill.tsx`, `apps/web/src/components/editor/Notice.tsx`, `apps/web/src/components/editor/useShortcuts.ts`, `apps/web/src/lib/pdf.ts`, `apps/web/src/lib/restore.ts`, `apps/web/src/lib/restore.test.ts`, `apps/web/src/lib/download.ts`
- Modify: `apps/web/scripts/sync-fonts.mjs` (also copy pdf.js worker), `.gitignore`, `apps/web/package.json` (dep `pdfjs-dist`)

**Interfaces:**
- Consumes: `editorStore`, `useEditor`, `pageGeom`, `EditorDoc` (Task 12); `compact` (Task 12); `loadDraft`, `saveDraft` (Task 12); `getStructure`, `fileUrl`, `exportPdf`, `ApiError` (Task 13); `screenSize` (Task 10); `t`, `errorMessage` (Task 1).
- Produces:
  - `lib/pdf.ts`: `loadPdf(url: string): Promise<PDFDocumentProxy>` (client only; worker at `/pdf.worker.min.mjs`).
  - `lib/restore.ts`: `restoreDraft(draft: EditorDoc | null, docId: string, pageCount: number): EditorDoc | null` — rewrites `src.doc` to `docId`; returns null if any doc page index ≥ `pageCount`.
  - `lib/download.ts`: `downloadBlob(blob: Blob, filename: string): void`.
  - `<PageView>` accepts `overlay?: (args: { pageKey: string; geom: PageGeom; scale: number }) => React.ReactNode` rendered absolutely over the page; Task 16 passes the Konva overlay through `<PageList overlay={...}>`.
  - `<Editor>` layout slots: `sidebar` (Task 15) and `toolbar` (Tasks 16–17) are rendered by Editor itself by importing those components once they exist; in this task render placeholders `<aside className="w-48 ..."/>` and `<div className="h-12 ..."/>`.
  - Each page wrapper has `data-testid="page"` and `data-page-key`.
  - Shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo, Delete/Backspace deletes selection, Esc clears selection and sets tool `select`. Ignored while focus is in `input`, `textarea`, `select` or `[contenteditable]`.

- [ ] **Step 1: pdf.js + worker copy**

Run: `npm install -w apps/web pdfjs-dist@^5`

Append to `apps/web/scripts/sync-fonts.mjs`:
```js
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
await cp(path.join(pdfjsDir, "build", "pdf.worker.min.mjs"), path.resolve(here, "../public/pdf.worker.min.mjs"));
console.log("pdf.js worker synced");
```
(Move the `import` line to the top of the file with the other imports.)

Add to `.gitignore`: `apps/web/public/pdf.worker.min.mjs`

`apps/web/src/lib/pdf.ts`:
```ts
import type { PDFDocumentProxy } from "pdfjs-dist";

let lib: Promise<typeof import("pdfjs-dist")> | null = null;

function pdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return m;
  });
  return lib;
}

export async function loadPdf(url: string): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  return m.getDocument({ url }).promise;
}
```

- [ ] **Step 2: Failing restore test**

`apps/web/src/lib/restore.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { restoreDraft } from "@/lib/restore";

describe("restoreDraft", () => {
  const draft = {
    pages: [
      { pageKey: "o1", src: { doc: "OLD", index: 1 }, rotate: 90 as const },
      { pageKey: "u-b", src: { blank: { width: 1, height: 1 } }, rotate: 0 as const },
    ],
    objects: {}, order: [],
  };

  it("rewrites doc ids", () => {
    const r = restoreDraft(draft, "NEW", 2)!;
    expect(r.pages[0].src).toEqual({ doc: "NEW", index: 1 });
    expect(r.pages[1].src).toEqual({ blank: { width: 1, height: 1 } });
  });

  it("rejects drafts referencing missing pages", () => {
    expect(restoreDraft(draft, "NEW", 1)).toBeNull();
    expect(restoreDraft(null, "NEW", 1)).toBeNull();
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL.

`apps/web/src/lib/restore.ts`:
```ts
import type { EditorDoc } from "@/store/editor";

export function restoreDraft(draft: EditorDoc | null, docId: string, pageCount: number): EditorDoc | null {
  if (!draft || !Array.isArray(draft.pages) || draft.pages.length === 0) return null;
  const pages = [];
  for (const p of draft.pages) {
    if ("doc" in p.src) {
      if (p.src.index >= pageCount) return null;
      pages.push({ ...p, src: { doc: docId, index: p.src.index } });
    } else {
      pages.push(p);
    }
  }
  return { ...draft, pages };
}
```

`apps/web/src/lib/download.ts`:
```ts
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

Run: `npm test -w apps/web` → Expected: PASS.

- [ ] **Step 3: Route + Editor**

`apps/web/src/app/edit/[docId]/page.tsx`:
```tsx
import { Editor } from "@/components/editor/Editor";

export default async function EditPage({ params, searchParams }: {
  params: Promise<{ docId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { docId } = await params;
  const { name } = await searchParams;
  return <Editor docId={docId} initialName={name ?? "document.pdf"} />;
}
```

`apps/web/src/components/editor/Notice.tsx`:
```tsx
"use client";

export function Notice({ kind, children, onClose }: { kind: "error" | "info"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div role={kind === "error" ? "alert" : "status"}
      className={`fixed left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg ${kind === "error" ? "bg-danger text-white" : "bg-ink text-white"}`}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} aria-label="Tutup" className="opacity-80 hover:opacity-100">✕</button>}
    </div>
  );
}
```

`apps/web/src/components/editor/useShortcuts.ts`:
```ts
"use client";

import { useEffect } from "react";
import { editorStore } from "@/store/editor";

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
}

export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      if (extra?.(e)) return;
      const s = editorStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); s.undo(); }
      else if ((mod && k === "z" && e.shiftKey) || (e.ctrlKey && k === "y")) { e.preventDefault(); s.redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) { e.preventDefault(); s.deleteObject(s.selection); }
      else if (e.key === "Escape") { s.select(null); s.setTool("select"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [extra]);
}
```

`apps/web/src/components/editor/Editor.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ApiError, fileUrl, getStructure } from "@/lib/api";
import { loadDraft, saveDraft } from "@/lib/draft";
import { loadPdf } from "@/lib/pdf";
import { restoreDraft } from "@/lib/restore";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { Header } from "./Header";
import { Notice } from "./Notice";
import { PageList } from "./PageList";
import { ZoomPill } from "./ZoomPill";
import { useShortcuts } from "./useShortcuts";

export function Editor({ docId, initialName }: { docId: string; initialName: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const info = useEditor((s) => s.info);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await getStructure(docId);
        const draft = restoreDraft(loadDraft(st.sha256), docId, st.page_count);
        editorStore.getState().init({ docId, sha256: st.sha256, fileName: initialName, pages: st.pages }, draft);
        if (draft) setNotice({ kind: "info", text: t.editor.restored });
        const doc = await loadPdf(fileUrl(docId));
        if (!cancelled) setPdf(doc);
      } catch (e) {
        if (!cancelled) setFatal(e instanceof ApiError ? e.code : "generic");
      }
    })();
    return () => { cancelled = true; };
  }, [docId, initialName]);

  // Autosave the undoable document, debounced.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = editorStore.subscribe((s, prev) => {
      if (s.doc === prev.doc || !s.info) return;
      clearTimeout(timer);
      timer = setTimeout(() => saveDraft(s.info!.sha256, s.doc), 500);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, []);

  useShortcuts();

  if (fatal) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p role="alert" className="max-w-md text-lg">{errorMessage(fatal)}</p>
        <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-accent-ink">{t.upload.choose}</Link>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <Header onNotice={setNotice} />
      <div className="h-12 shrink-0 border-b border-line bg-surface" data-slot="toolbar" />
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 shrink-0 border-r border-line bg-surface" data-slot="sidebar" />
        <main className="relative min-w-0 flex-1 overflow-auto bg-bg" id="page-scroller">
          {info && pdf ? <PageList pdf={pdf} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
        </main>
      </div>
      <ZoomPill />
      {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Notice>}
    </div>
  );
}
```

- [ ] **Step 4: Header (download)**

`apps/web/src/components/editor/Header.tsx`:
```tsx
"use client";

import { useState } from "react";
import { ApiError, exportPdf } from "@/lib/api";
import { compact } from "@/lib/compact";
import { downloadBlob } from "@/lib/download";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";

export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; text: string }) => void }) {
  const info = useEditor((s) => s.info);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileName = name ?? info?.fileName ?? "document.pdf";

  async function download() {
    const s = editorStore.getState();
    if (!s.info) return;
    setBusy(true);
    try {
      const blob = await exportPdf(s.info.docId, { ops: compact(s.doc), flatten_forms: false, filename: fileName });
      downloadBlob(blob, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("generic", 0);
      if (err.code === "bake_failed" && typeof err.extra.op_id === "string") {
        s.setTool("select");
        s.select(err.extra.op_id);
      }
      onNotice({ kind: "error", text: errorMessage(err.code) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <span className="font-semibold text-accent">{t.appName}</span>
      <input
        aria-label={t.editor.fileName}
        value={fileName}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 max-w-xs flex-1 truncate rounded-md border border-transparent px-2 py-1 text-sm hover:border-line focus:border-accent focus:outline-none"
      />
      <div className="flex-1" />
      <button
        onClick={download}
        disabled={busy || !info}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60"
      >
        {busy ? t.editor.downloading : t.editor.download}
      </button>
    </header>
  );
}
```

- [ ] **Step 5: PageList + PageView (virtualized)**

`apps/web/src/components/editor/PageView.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { screenSize, type PageGeom } from "@/lib/coords";
import type { PageEntry } from "@/store/editor";

export type OverlayRender = (args: { pageKey: string; geom: PageGeom; scale: number }) => React.ReactNode;

export function PageView({ pdf, entry, geom, scale, overlay, onVisible }: {
  pdf: PDFDocumentProxy; entry: PageEntry; geom: PageGeom; scale: number;
  overlay?: OverlayRender; onVisible?: (key: string, ratio: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const size = screenSize(geom, scale);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { setNear(e.isIntersecting); },
      { root: document.getElementById("page-scroller"), rootMargin: "100% 0px" },
    );
    const vis = new IntersectionObserver(
      ([e]) => onVisible?.(entry.pageKey, e.intersectionRatio),
      { root: document.getElementById("page-scroller"), threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(el);
    vis.observe(el);
    return () => { io.disconnect(); vis.disconnect(); };
  }, [entry.pageKey, onVisible]);

  useEffect(() => {
    if (!near || !("doc" in entry.src) || !canvas.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const index = entry.src.index;
    (async () => {
      const page = await pdf.getPage(index + 1);
      if (cancelled || !canvas.current) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * dpr, rotation: geom.rotation });
      const c = canvas.current;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      task = page.render({ canvas: c, viewport });
      try { await task.promise; } catch { /* cancelled */ }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [near, pdf, entry.src, geom.rotation, scale]);

  return (
    <div
      ref={wrap}
      data-testid="page"
      data-page-key={entry.pageKey}
      className="relative mx-auto bg-white shadow-sm ring-1 ring-line"
      style={{ width: size.width, height: size.height }}
    >
      {"doc" in entry.src && near && (
        <canvas ref={canvas} className="absolute inset-0" style={{ width: size.width, height: size.height }} />
      )}
      {near && overlay?.({ pageKey: entry.pageKey, geom, scale })}
    </div>
  );
}
```

Note: if the installed pdfjs-dist version's `render` requires `canvasContext` instead of `canvas`, pass `{ canvasContext: c.getContext("2d")!, viewport }`.

`apps/web/src/components/editor/PageList.tsx`:
```tsx
"use client";

import { useCallback, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { editorStore, pageGeom, useEditor } from "@/store/editor";
import { PageView, type OverlayRender } from "./PageView";

export function PageList({ pdf, overlay }: { pdf: PDFDocumentProxy; overlay?: OverlayRender }) {
  const pages = useEditor((s) => s.doc.pages);
  const info = useEditor((s) => s.info)!;
  const zoom = useEditor((s) => s.zoom);
  const ratios = useRef(new Map<string, number>());

  const onVisible = useCallback((key: string, ratio: number) => {
    ratios.current.set(key, ratio);
    let best: string | null = null, bestRatio = 0;
    for (const [k, r] of ratios.current) if (r > bestRatio) { best = k; bestRatio = r; }
    if (best && best !== editorStore.getState().currentPage) editorStore.getState().setCurrentPage(best);
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 px-6 py-8">
      {pages.map((entry) => (
        <PageView key={entry.pageKey} pdf={pdf} entry={entry} geom={pageGeom(entry, info)} scale={zoom} overlay={overlay} onVisible={onVisible} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: ZoomPill**

`apps/web/src/components/editor/ZoomPill.tsx`:
```tsx
"use client";

import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";

export function scrollToPage(pageKey: string) {
  document.querySelector(`[data-page-key="${pageKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ZoomPill() {
  const zoom = useEditor((s) => s.zoom);
  const pages = useEditor((s) => s.doc.pages);
  const current = useEditor((s) => s.currentPage);
  const tool = useEditor((s) => s.tool);
  const idx = Math.max(0, pages.findIndex((p) => p.pageKey === current));
  const go = (d: number) => { const p = pages[idx + d]; if (p) scrollToPage(p.pageKey); };
  const s = editorStore.getState();
  const btn = "grid h-8 w-8 place-items-center rounded-full hover:bg-white/15 disabled:opacity-40";

  return (
    <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink px-2 py-1 text-sm text-white shadow-lg">
      <button className={btn} onClick={() => go(-1)} disabled={idx === 0} aria-label="Halaman sebelumnya">‹</button>
      <span data-testid="page-indicator" className="min-w-14 text-center tabular-nums">{pages.length ? idx + 1 : 0}/{pages.length}</span>
      <button className={btn} onClick={() => go(1)} disabled={idx >= pages.length - 1} aria-label="Halaman berikutnya">›</button>
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button className={btn} onClick={() => s.setZoom(Math.round((zoom - 0.1) * 10) / 10)} aria-label={t.editor.zoomOut}>−</button>
      <span className="min-w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button className={btn} onClick={() => s.setZoom(Math.round((zoom + 0.1) * 10) / 10)} aria-label={t.editor.zoomIn}>+</button>
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button className={`${btn} ${tool === "pan" ? "bg-white/20" : ""}`} onClick={() => s.setTool(tool === "pan" ? "select" : "pan")} aria-label={t.editor.pan} aria-pressed={tool === "pan"}>✋</button>
    </div>
  );
}
```

Pan mode: in `Editor.tsx`, on `#page-scroller` add pointer handlers when `tool === "pan"`: on `pointerdown` remember `clientX/Y` and `scrollLeft/Top`; on `pointermove` with buttons=1 set `scrollLeft/Top = start - delta`; set `cursor: grab`. Implement inline:
```tsx
// inside Editor, before return:
const tool = useEditor((s) => s.tool);
const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
// on <main id="page-scroller">:
// style={{ cursor: tool === "pan" ? "grab" : undefined }}
// onPointerDown={(e) => { if (tool !== "pan") return; const el = e.currentTarget; drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }; }}
// onPointerMove={(e) => { if (!drag.current || e.buttons !== 1) return; const el = e.currentTarget; el.scrollLeft = drag.current.l - (e.clientX - drag.current.x); el.scrollTop = drag.current.t - (e.clientY - drag.current.y); }}
// onPointerUp={() => { drag.current = null; }}
```
Add `useRef` to the React import.

- [ ] **Step 7: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run build -w apps/web` → all succeed.

Manual (API + web running): upload a multi-page PDF → editor shows all pages rendered crisply, indicator updates while scrolling, zoom ± works, ✋ drag scrolls, Unduh downloads an identical PDF named after the file. Upload an encrypted PDF → upload page shows the "terkunci" message. Stop the API and reload the editor → "Tidak dapat terhubung ke server." with a button back to upload.

- [ ] **Step 8: Commit**

```bash
git add apps/web .gitignore package-lock.json
git commit -m "feat(web): add editor shell with pdf.js pages, zoom and download

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
