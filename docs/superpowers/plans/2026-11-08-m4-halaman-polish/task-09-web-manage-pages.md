# Task 9: Kelola Halaman modal

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 8 leaves, new files are complete.

**Goal:** Toolbar button "Kelola Halaman" opens a modal working on a copy of the document: multi-select (click, Shift+click range, Pilih semua/Batal pilih), Putar kiri/kanan, Duplikat, Pindah ◀/▶ (block move), Hapus, drag to reorder, Halaman kosong, Impor PDF; Simpan applies everything as one undo step, Batal discards.

**Files:**
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Create: `apps/web/src/components/editor/pages/ManagePagesModal.tsx`
- Modify: `apps/web/src/lib/pages.test.ts`
- Modify: `apps/web/src/lib/pages.ts`
- Modify: `apps/web/src/lib/strings.ts`

**Interfaces:**
- Consumes: Task 7 `lib/pages.ts`, `replaceDoc`, `addImport`; Task 8 `Thumbnail`, `pickPdf`.
- Produces:
- `pages/ManagePagesModal.tsx` (`role=dialog`, name "Kelola Halaman", tiles `data-testid=manage-page` + `data-page-key`); `lib/pages.insertIndex(doc, selected)`; strings `t.pages.{manage, actions, selected, selectAll, selectNone, duplicateShort, moveLeft, moveRight, pageN, cancel, save, importing}`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/src/lib/pages.test.ts`:

```diff
--- a/apps/web/src/lib/pages.test.ts
+++ b/apps/web/src/lib/pages.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from "vitest";
 import type { ContentOp } from "@edith/ops";
-import { blankSizeLike, clampCrop, deletePages, duplicatePages, importPages, movePage, rotatePages, setCrop, shiftPages } from "@/lib/pages";
+import { blankSizeLike, clampCrop, deletePages, duplicatePages, importPages, insertIndex, movePage, rotatePages, setCrop, shiftPages } from "@/lib/pages";
 import type { DocInfo, EditorDoc, PageEntry } from "@/store/editor";
 
 const D = "D".repeat(22), I = "I".repeat(22);
@@ -81,3 +81,10 @@ describe("page operations", () => {
     expect(setCrop(same, ["o0"], null, info)).toBe(same);
   });
 });
+
+describe("insertIndex", () => {
+  it("is after the last selected page, else the end", () => {
+    expect(insertIndex(doc(), new Set(["o0", "o1"]))).toBe(2);
+    expect(insertIndex(doc(), new Set())).toBe(3);
+  });
+});
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: `insertIndex` is not exported

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Toolbar.tsx`:

```diff
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -8,6 +8,7 @@ import { fitImage } from "@/lib/image";
 import { errorMessage, t } from "@/lib/strings";
 import { editorStore, useEditor, type Tool } from "@/store/editor";
 import { SignatureModal } from "./marks/SignatureModal";
+import { ManagePagesModal } from "./pages/ManagePagesModal";
 import { StampPicker } from "./marks/StampPicker";
 import { currentPage, placeObject } from "./placement";
 import { SplitButton } from "./SplitButton";
@@ -32,6 +33,7 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
   const file = useRef<HTMLInputElement>(null);
   const [stampOpen, setStampOpen] = useState(false);
   const [signatureOpen, setSignatureOpen] = useState(false);
+  const [pagesOpen, setPagesOpen] = useState(false);
   const s = editorStore.getState();
   const pick = (x: Tool) => s.setTool(x);
 
@@ -87,6 +89,11 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
       {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onNotice={onNotice} />}
       <ToolButton tool="note" label={t.annot.note} icon="🗒" active={tool} />
       <ToolButton tool="link" label={t.annot.link} icon="🔗" active={tool} />
+      <div className="flex-1" />
+      <button aria-label={t.pages.manage} title={t.pages.manage} onClick={() => setPagesOpen(true)} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
+        <span aria-hidden>▦</span><span className="hidden lg:inline">{t.pages.manage}</span>
+      </button>
+      {pagesOpen && <ManagePagesModal onClose={() => setPagesOpen(false)} />}
     </div>
   );
 }
```

Create `apps/web/src/components/editor/pages/ManagePagesModal.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ApiError, getStructure, uploadDocument } from "@/lib/api";
import * as P from "@/lib/pages";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, pageGeom, useEditor, type EditorDoc, type PageEntry } from "@/store/editor";
import { Thumbnail } from "../Thumbnail";
import { pickPdf } from "./importPdf";

const THUMB = 104;

function Tile({ entry, index, checked, onToggle }: { entry: PageEntry; index: number; checked: boolean; onToggle: (shift: boolean) => void }) {
  const info = useEditor((s) => s.info)!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.pageKey });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      {...attributes} {...listeners} data-testid="manage-page" data-page-key={entry.pageKey} aria-pressed={checked}
      onClick={(e) => onToggle(e.shiftKey)}
      className={`relative flex cursor-pointer flex-col items-center gap-1 rounded-lg p-2 ${checked ? "bg-accent/10 ring-2 ring-accent" : "hover:bg-bg"}`}>
      <div className="grid place-items-center" style={{ width: THUMB, height: THUMB * 1.42 }}>
        <Thumbnail entry={entry} geom={pageGeom(entry, info)} width={THUMB} />
      </div>
      <input type="checkbox" readOnly checked={checked} aria-label={t.pages.pageN(index + 1)} tabIndex={-1}
        className="pointer-events-none absolute left-3 top-3 h-4 w-4 accent-[var(--accent)]" />
      <span className="text-xs text-muted">{index + 1}</span>
    </div>
  );
}

/** Kelola Halaman: page operations on a copy of the document; Simpan applies them as one undo step. */
export function ManagePagesModal({ onClose }: { onClose: () => void }) {
  const [original] = useState(() => editorStore.getState().doc);
  const [draft, setDraft] = useState<EditorDoc>(original);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const keys = [...selected].filter((k) => draft.pages.some((p) => p.pageKey === k));
  const none = keys.length === 0;

  useEffect(() => { box.current?.focus(); }, []);

  function toggle(key: string, shift: boolean) {
    const next = new Set(selected);
    if (shift && anchor) {
      const a = draft.pages.findIndex((p) => p.pageKey === anchor), b = draft.pages.findIndex((p) => p.pageKey === key);
      for (const p of draft.pages.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(p.pageKey);
    } else if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    setAnchor(key);
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const to = draft.pages.findIndex((p) => p.pageKey === e.over!.id);
    setDraft((d) => P.movePage(d, String(e.active.id), to));
  }

  async function importFile() {
    const file = await pickPdf();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const up = await uploadDocument(file, file.name);
      const st = await getStructure(up.doc_id);
      editorStore.getState().addImport(up.doc_id, st.pages); // the registry, not the document: Batal leaves no pages
      setDraft((d) => P.importPages(d, P.insertIndex(d, selected), up.doc_id, st.pages.length));
    } catch (e) {
      setError(errorMessage(e instanceof ApiError ? e.code : "generic"));
    } finally {
      setBusy(false);
    }
  }

  function insertBlank() {
    setDraft((d) => {
      const at = P.insertIndex(d, selected);
      return P.insertPages(d, at, [P.blankPage(P.blankSizeLike(d.pages[Math.max(at - 1, 0)], editorStore.getState().info))]);
    });
  }

  function save() {
    if (draft !== original) editorStore.getState().replaceDoc(draft);
    onClose();
  }

  const btn = "rounded-md px-2.5 py-1.5 hover:bg-bg disabled:opacity-40";
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onPointerDown={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t.pages.manage} data-testid="manage-pages"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
        className="flex max-h-[85vh] w-[56rem] max-w-[95vw] flex-col gap-3 rounded-xl bg-surface p-4 text-sm shadow-xl outline-none ring-1 ring-line">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t.pages.manage}</span>
          <span className="text-xs text-muted">{t.pages.selected(keys.length, draft.pages.length)}</span>
          <div className="flex-1" />
          <button className={btn} onClick={() => setSelected(new Set(draft.pages.map((p) => p.pageKey)))}>{t.pages.selectAll}</button>
          <button className={btn} disabled={none} onClick={() => setSelected(new Set())}>{t.pages.selectNone}</button>
        </div>
        <div role="toolbar" aria-label={t.pages.actions} className="flex flex-wrap items-center gap-1 border-y border-line py-2">
          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.rotatePages(d, keys, -90))}>⟲ {t.editor.rotateLeft}</button>
          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.rotatePages(d, keys, 90))}>⟳ {t.editor.rotateRight}</button>
          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.duplicatePages(d, keys))}>⧉ {t.pages.duplicateShort}</button>
          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.shiftPages(d, keys, -1))}>◀ {t.pages.moveLeft}</button>
          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.shiftPages(d, keys, 1))}>{t.pages.moveRight} ▶</button>
          <button className={`${btn} text-danger`} disabled={none || keys.length >= draft.pages.length}
            onClick={() => { setDraft((d) => P.deletePages(d, keys)); setSelected(new Set()); }}>🗑 {t.editor.delete}</button>
          <span className="mx-1 h-5 w-px bg-line" />
          <button className={btn} onClick={insertBlank}>＋ {t.pages.blank}</button>
          <button className={btn} disabled={busy} onClick={() => void importFile()}>⇪ {busy ? t.pages.importing : t.pages.importPdf}</button>
        </div>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={draft.pages.map((p) => p.pageKey)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
                {draft.pages.map((entry, i) => (
                  <Tile key={entry.pageKey} entry={entry} index={i} checked={selected.has(entry.pageKey)} onToggle={(shift) => toggle(entry.pageKey, shift)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 hover:bg-bg">{t.pages.cancel}</button>
          <button onClick={save} className="rounded-lg bg-accent px-4 py-2 text-accent-ink">{t.pages.save}</button>
        </div>
      </div>
    </div>
  );
}
```

Modify `apps/web/src/lib/pages.ts`:

```diff
--- a/apps/web/src/lib/pages.ts
+++ b/apps/web/src/lib/pages.ts
@@ -150,3 +150,10 @@ export function setCrop(doc: EditorDoc, keys: readonly string[], crop: CropBox |
   });
   return changed ? { ...doc, pages } : doc;
 }
+
+/** Where pages inserted in the Manage Pages modal go: after the last selected page, else at the end. */
+export function insertIndex(doc: EditorDoc, selected: ReadonlySet<string>): number {
+  let last = -1;
+  doc.pages.forEach((p, i) => { if (selected.has(p.pageKey)) last = i; });
+  return last < 0 ? doc.pages.length : last + 1;
+}
```

Modify `apps/web/src/lib/strings.ts`:

```diff
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -101,6 +101,18 @@ export const t = {
     importPdf: "Impor PDF",
     imported: (n: number) => `${n} halaman diimpor`,
     importGone: "Halaman dari PDF yang diimpor sudah tidak tersedia (sesi 1 jam berakhir). Impor ulang PDF-nya.",
+    importing: "Mengimpor…",
+    manage: "Kelola Halaman",
+    actions: "Aksi halaman",
+    selected: (n: number, total: number) => `${n} dari ${total} halaman dipilih`,
+    selectAll: "Pilih semua",
+    selectNone: "Batal pilih",
+    duplicateShort: "Duplikat",
+    moveLeft: "Pindah",
+    moveRight: "Pindah",
+    pageN: (n: number) => `Halaman ${n}`,
+    cancel: "Batal",
+    save: "Simpan",
   },
   form: {
     flatten: "Ratakan form",
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 261 passed; tsc/eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/pages/ManagePagesModal.tsx apps/web/src/lib/pages.test.ts apps/web/src/lib/pages.ts apps/web/src/lib/strings.ts
git commit -m "feat(web): Kelola Halaman modal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
