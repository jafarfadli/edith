# Task 12: Selection mini-bar, clipboard, align, shortcuts

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 11 leaves, new files are complete.

**Goal:** A floating bar over the selected object: Duplikat, Hapus, ⋯ (Salin, Tempel, Duplikat, six Ratakan-ke-halaman items, in screen orientation); Ctrl/Cmd+C/V/D; Ctrl/Cmd+Z/Shift+Z/Ctrl+Y inside a form field undo the document instead of the input (M3 backlog).

**Files:**
- Modify: `apps/web/src/components/editor/Editor.tsx`
- Create: `apps/web/src/components/editor/objects/SelectionMiniBar.tsx`
- Create: `apps/web/src/components/editor/objects/clipboard.test.ts`
- Create: `apps/web/src/components/editor/objects/clipboard.ts`
- Create: `apps/web/src/components/editor/useShortcuts.test.ts`
- Modify: `apps/web/src/components/editor/useShortcuts.ts`
- Modify: `apps/web/src/lib/strings.ts`

**Interfaces:**
- Consumes: Task 6 `copyOp`, `alignDelta`, `visualBounds`; Task 8 `MenuButton`.
- Produces:
- `objects/clipboard.ts`: `copySelection() -> bool`, `pasteClipboard() -> id|null`, `duplicateSelection() -> id|null`, `alignSelection(align)`, `hasClipboard()`, `clearClipboard()`, `PASTE_OFFSET = 10`; `objects/SelectionMiniBar.tsx` (`data-testid=mini-bar`); `useShortcuts.undoKey(e)`; strings `t.objects.*`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/editor/objects/clipboard.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { visualBounds } from "@/lib/objects";
import { editorStore, type DocInfo } from "@/store/editor";
import { alignSelection, clearClipboard, copySelection, duplicateSelection, hasClipboard, pasteClipboard, PASTE_OFFSET } from "./clipboard";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "s", fileName: "a.pdf",
  pages: [0, 1].map((i) => ({ index: i, width: 600, height: 800, rotation: i === 1 ? 90 : 0, hasText: true })),
};
const box = (extra: object = {}) => ({ id: "r", type: "shape.add", pageKey: "o0", kind: "rect", rect: { x: 100, y: 200, w: 50, h: 20 }, stroke: "#000000", fill: null, width: 1, ...extra }) as ContentOp;
const s = () => editorStore.getState();
const rectOf = (id: string) => (s().doc.objects[id] as { rect: { x: number; y: number } }).rect;

beforeEach(() => { s().init(info); clearClipboard(); s().addObject(box()); s().select("r"); s().setCurrentPage("o0"); });

describe("clipboard", () => {
  it("pastes on the same page a little further each time", () => {
    expect(copySelection()).toBe(true);
    const a = pasteClipboard()!, b = pasteClipboard()!;
    expect(rectOf(a)).toMatchObject({ x: 100 + PASTE_OFFSET, y: 200 + PASTE_OFFSET });
    expect(rectOf(b)).toMatchObject({ x: 100 + 2 * PASTE_OFFSET, y: 200 + 2 * PASTE_OFFSET });
    expect(s().selection).toBe(b);
  });

  it("pastes at the same place on another page", () => {
    copySelection();
    s().setCurrentPage("o1");
    const id = pasteClipboard()!;
    expect(s().doc.objects[id]).toMatchObject({ pageKey: "o1", rect: { x: 100, y: 200 } });
  });

  it("keeps a paste inside a smaller (cropped) page", () => {
    s().updateObject("r", { rect: { x: 500, y: 700, w: 50, h: 20 } } as Partial<ContentOp>);
    copySelection();
    s().setCrop(["o1"], { x: 0, y: 0, w: 300, h: 300 });
    s().setCurrentPage("o1");
    const id = pasteClipboard()!;
    expect(rectOf(id)).toMatchObject({ x: 250, y: 280 });
  });

  it("does not copy edited paragraphs; nothing to paste before a copy", () => {
    expect(hasClipboard()).toBe(false);
    expect(pasteClipboard()).toBeNull();
    s().addObject({ id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g0", box: { rect: { x: 0, y: 0, w: 1, h: 1 }, lineHeight: 1, paragraphs: [], layout: [] } } as ContentOp);
    s().select("e");
    expect(copySelection()).toBe(false);
  });

  it("duplicates next to the original and selects the copy", () => {
    const id = duplicateSelection()!;
    expect(rectOf(id)).toMatchObject({ x: 110, y: 210 });
    expect(s().selection).toBe(id);
    expect(hasClipboard()).toBe(false);
  });

  it("aligns to the page as seen on screen", () => {
    alignSelection("right");
    expect(rectOf("r")).toMatchObject({ x: 550, y: 200 });
    alignSelection("bottom");
    expect(rectOf("r")).toMatchObject({ x: 550, y: 780 });
    // A rotated object lines up by what it covers.
    s().updateObject("r", { rotation: 90, rect: { x: 100, y: 200, w: 50, h: 20 } } as Partial<ContentOp>);
    alignSelection("left");
    expect(visualBounds(s().doc.objects.r).x).toBeCloseTo(0);
  });

  it("aligns on a rotated page by the screen's left edge", () => {
    s().addObject(box({ id: "q", pageKey: "o1" }));
    s().select("q");
    alignSelection("left"); // page turned 90°: the screen's left edge is the page's bottom (y = 800)
    expect(rectOf("q")).toMatchObject({ x: 100, y: 780 });
  });
});
```

Create `apps/web/src/components/editor/useShortcuts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { undoKey } from "./useShortcuts";

const key = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

describe("undoKey", () => {
  it("recognizes undo and redo on both platforms", () => {
    expect(undoKey(key("z", { ctrlKey: true }))).toBe("undo");
    expect(undoKey(key("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(undoKey(key("y", { ctrlKey: true }))).toBe("redo");
    expect(undoKey(key("y", { metaKey: true }))).toBeNull();
    expect(undoKey(key("z"))).toBeNull();
  });
});
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: `./clipboard` not found

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Editor.tsx`:

```diff
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -22,6 +22,7 @@ import { FormLayer } from "./forms/FormLayer";
 import { Header } from "./Header";
 import { Notice } from "./Notice";
 import { PageList } from "./PageList";
+import { SelectionMiniBar } from "./objects/SelectionMiniBar";
 import { PropertiesBar } from "./PropertiesBar";
 import { Sidebar } from "./Sidebar";
 import { Toolbar } from "./Toolbar";
@@ -167,7 +168,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
           }}
           onPointerUp={() => { drag.current = null; }}
         >
-          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><LinkPopover {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
+          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><LinkPopover {...a} /><SelectionMiniBar {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
         </main>
       </div>
       <FindBar />
```

Create `apps/web/src/components/editor/objects/SelectionMiniBar.tsx`:

```tsx
"use client";

import { useStore } from "zustand";
import { toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { isCopyable, visualBounds, type Align } from "@/lib/objects";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { MenuButton } from "../MenuButton";
import { textEditStore } from "../text/textEdit";
import { alignSelection, copySelection, duplicateSelection, hasClipboard, pasteClipboard } from "./clipboard";

const BAR_H = 34;
const ALIGNS: [Align, string][] = [
  ["left", t.objects.alignLeft], ["center", t.objects.alignCenter], ["right", t.objects.alignRight],
  ["top", t.objects.alignTop], ["middle", t.objects.alignMiddle], ["bottom", t.objects.alignBottom],
];

/** Floating bar over the selected object: Duplikat, Hapus and ⋯ (Salin, Tempel, Duplikat, Ratakan ke halaman). */
export function SelectionMiniBar({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const op = useEditor((s) => (s.selection && s.tool === "select" ? s.doc.objects[s.selection] : undefined));
  const editing = useStore(textEditStore, (s) => !!s.editing);
  if (!op || op.pageKey !== pageKey || editing) return null;

  const b = visualBounds(op);
  const corners = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => toScreen(p, geom, scale));
  const left = (Math.min(...corners.map((c) => c[0])) + Math.max(...corners.map((c) => c[0]))) / 2;
  const top = Math.min(...corners.map((c) => c[1]));
  const bottom = Math.max(...corners.map((c) => c[1]));
  const y = top - BAR_H - 8 >= 0 ? top - BAR_H - 8 : bottom + 8; // above the object, below it at the page top
  const copyable = isCopyable(op);
  const s = editorStore.getState();
  const btn = "grid h-7 min-w-7 place-items-center rounded px-1.5 hover:bg-bg";

  return (
    <div role="toolbar" aria-label={t.objects.bar} data-testid="mini-bar" onPointerDown={(e) => e.stopPropagation()}
      className="absolute flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-surface p-0.5 text-sm shadow-lg ring-1 ring-line"
      style={{ left, top: y, height: BAR_H, zIndex: 15 }}>
      {copyable && <button aria-label={t.objects.duplicate} title={t.objects.duplicate} className={btn} onClick={() => duplicateSelection()}>⧉</button>}
      <button aria-label={t.editor.delete} title={t.editor.delete} className={`${btn} text-danger`} onClick={() => s.deleteObject(op.id)}>🗑</button>
      {copyable && (
        <MenuButton label={t.objects.more} className={btn} items={[
          { label: t.objects.copy, run: () => { copySelection(); } },
          { label: t.objects.paste, run: () => { pasteClipboard(); }, disabled: !hasClipboard() },
          { label: t.objects.duplicate, run: () => { duplicateSelection(); } },
          ...ALIGNS.map(([a, label]) => ({ label, run: () => alignSelection(a) })),
        ]}>⋯</MenuButton>
      )}
    </div>
  );
}
```

Create `apps/web/src/components/editor/objects/clipboard.ts`:

```ts
import type { ContentOp } from "@edith/ops";
import { pageBounds, screenSize, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { newId } from "@/lib/id";
import { alignDelta, copyOp, isCopyable, moveOp, visualBounds, type Align } from "@/lib/objects";
import { editorStore, pageGeom } from "@/store/editor";

/** The editor's own clipboard (objects, not the system clipboard): Salin/Tempel/Duplikat of the mini-bar and
 *  Ctrl/Cmd+C, V, D. */
export const PASTE_OFFSET = 10; // pt: a paste or duplicate on the same page lands this far down-right

let clip: { op: ContentOp; pastes: number } | null = null;

export function hasClipboard(): boolean {
  return clip !== null;
}

function selected(): ContentOp | null {
  const s = editorStore.getState();
  const op = s.selection ? s.doc.objects[s.selection] : undefined;
  return op && isCopyable(op) ? op : null;
}

function geomOf(pageKey: string): PageGeom | null {
  const s = editorStore.getState();
  const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
  return entry && s.info ? pageGeom(entry, s.info) : null;
}

/** `op` moved (as little as possible) so that it lies inside the visible part of its page. */
function keepOnPage(op: ContentOp, g: PageGeom): ContentOp {
  const b = visualBounds(op), p = pageBounds(g);
  const dx = Math.min(Math.max(b.x, p.x), Math.max(p.x + p.w - b.w, p.x)) - b.x;
  const dy = Math.min(Math.max(b.y, p.y), Math.max(p.y + p.h - b.h, p.y)) - b.y;
  return dx || dy ? moveOp(op, dx, dy) : op;
}

function place(op: ContentOp): string {
  const s = editorStore.getState();
  s.addObject(op);
  s.setTool("select");
  s.select(op.id);
  return op.id;
}

export function copySelection(): boolean {
  const op = selected();
  if (!op) return false;
  clip = { op: structuredClone(op), pastes: 0 };
  return true;
}

/** Pastes the clipboard on the page in view: where it was on another page, a little further each time on the
 *  same page. Returns the new object's id. */
export function pasteClipboard(): string | null {
  const s = editorStore.getState();
  const pageKey = s.currentPage ?? s.doc.pages[0]?.pageKey;
  const g = pageKey ? geomOf(pageKey) : null;
  if (!clip || !pageKey || !g) return null;
  const same = clip.op.pageKey === pageKey && s.doc.pages.some((p) => p.pageKey === clip!.op.pageKey);
  const shift = same ? PASTE_OFFSET * ++clip.pastes : 0;
  return place(keepOnPage(copyOp(clip.op, pageKey, newId(), shift, shift), g));
}

/** A copy of the selected object next to it on its page (the clipboard is left alone). */
export function duplicateSelection(): string | null {
  const op = selected();
  const g = op ? geomOf(op.pageKey) : null;
  if (!op || !g) return null;
  return place(keepOnPage(copyOp(op, op.pageKey, newId(), PASTE_OFFSET, PASTE_OFFSET), g));
}

/** Lines the selected object up with a side (or the middle) of its page as seen on screen (rotation and crop
 *  included). */
export function alignSelection(a: Align): void {
  const s = editorStore.getState();
  const op = selected();
  const g = op ? geomOf(op.pageKey) : null;
  if (!op || !g) return;
  const b = visualBounds(op);
  const corners = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => toScreen(p, g, 1));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const screen = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const size = screenSize(g, 1);
  const [dx, dy] = alignDelta(screen, { x: 0, y: 0, w: size.width, h: size.height }, a);
  if (!dx && !dy) return;
  const [x0, y0] = toPage([0, 0], g, 1), [x1, y1] = toPage([dx, dy], g, 1);
  s.updateObject(op.id, moveOp(op, x1 - x0, y1 - y0));
}

/** Test hook: forget the clipboard. */
export function clearClipboard(): void {
  clip = null;
}
```

Modify `apps/web/src/components/editor/useShortcuts.ts`:

```diff
--- a/apps/web/src/components/editor/useShortcuts.ts
+++ b/apps/web/src/components/editor/useShortcuts.ts
@@ -4,6 +4,7 @@ import { useEffect } from "react";
 import { editorStore } from "@/store/editor";
 import { openFind } from "./find/findStore";
 import { linkStore } from "./marks/linkStore";
+import { copySelection, duplicateSelection, pasteClipboard } from "./objects/clipboard";
 import { afterTextCommitted, textEditStore } from "./text/textEdit";
 
 export function isTyping(target: EventTarget | null): boolean {
@@ -12,6 +13,14 @@ export function isTyping(target: EventTarget | null): boolean {
   return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
 }
 
+/** Undo/redo keys: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. */
+export function undoKey(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; key: string }): "undo" | "redo" | null {
+  const k = e.key.toLowerCase();
+  if ((e.metaKey || e.ctrlKey) && k === "z") return e.shiftKey ? "redo" : "undo";
+  if (e.ctrlKey && k === "y") return "redo";
+  return null;
+}
+
 /** Ctrl/Cmd+F: opens Find, also from text fields and the rich editor. */
 export function isFindKey(e: { metaKey: boolean; ctrlKey: boolean; key: string }): boolean {
   return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f";
@@ -21,6 +30,10 @@ export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
   useEffect(() => {
     function onKey(e: KeyboardEvent) {
       if (isFindKey(e)) { e.preventDefault(); openFind(); return; } // before the typing check
+      // In a form field the document's undo, not the input's own (which would desync the controlled value).
+      const formField = (e.target as HTMLElement | null)?.closest?.("[data-field]");
+      const undo = undoKey(e);
+      if (formField && undo) { e.preventDefault(); editorStore.getState()[undo](); return; }
       if (isTyping(e.target)) return;
       if (extra?.(e)) return;
       const s = editorStore.getState();
@@ -29,6 +42,9 @@ export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
       if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().undo()); }
       else if ((mod && k === "z" && e.shiftKey) || (e.ctrlKey && k === "y")) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().redo()); }
       else if (mod && k === "k" && !e.shiftKey && !e.altKey) { e.preventDefault(); s.setTool("link"); }
+      else if (mod && k === "c" && !e.shiftKey && !e.altKey) { if (copySelection()) e.preventDefault(); } // else: the browser's copy
+      else if (mod && k === "v" && !e.shiftKey && !e.altKey) { if (pasteClipboard()) e.preventDefault(); }
+      else if (mod && k === "d" && !e.shiftKey && !e.altKey) { e.preventDefault(); duplicateSelection(); } // not the bookmark dialog
       else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) { e.preventDefault(); s.deleteObject(s.selection); }
       else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); linkStore.getState().close(); }
     }
```

Modify `apps/web/src/lib/strings.ts`:

```diff
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -122,6 +122,19 @@ export const t = {
     cancel: "Batal",
     save: "Simpan",
   },
+  objects: {
+    bar: "Aksi objek",
+    duplicate: "Duplikat",
+    more: "Lainnya",
+    copy: "Salin",
+    paste: "Tempel",
+    alignLeft: "Ratakan ke kiri halaman",
+    alignCenter: "Ratakan ke tengah (horizontal)",
+    alignRight: "Ratakan ke kanan halaman",
+    alignTop: "Ratakan ke atas halaman",
+    alignMiddle: "Ratakan ke tengah (vertikal)",
+    alignBottom: "Ratakan ke bawah halaman",
+  },
   crop: {
     title: "Crop",
     thisPage: "Terapkan ke halaman ini",
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 272 passed; tsc/eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/objects/SelectionMiniBar.tsx apps/web/src/components/editor/objects/clipboard.test.ts apps/web/src/components/editor/objects/clipboard.ts apps/web/src/components/editor/useShortcuts.test.ts apps/web/src/components/editor/useShortcuts.ts apps/web/src/lib/strings.ts
git commit -m "feat(web): selection mini-bar, copy/paste/duplicate and align to page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
