# Task 10: Panels, menus, dialogs, notices and canvas colours in the design system

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions, **Design system**). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Everything Task 9 did not restyle speaks the same language: the sidebar (segmented Halaman | Anotasi tabs, thumbnails on the dark panel with an accent-tinted current page, hover-only page menu and "+"), the Anotasi panel (line icons instead of emoji), menus, the selection mini-bar, the find bar, the crop bar, notices (raised toast with an icon), the stamp picker (presets previewed on paper in their own colours), the signature dialog (typed signatures previewed on paper), Kelola Halaman (title row, an action strip with icons, footer with Batal/Simpan), the text properties (icon toggles for B/I/U/S and alignment), and the colours drawn on the canvas (selection, transformer, crop rectangle, paragraph outlines, overflow warning) — now the accent instead of the old teal `#0f766e`.

Shared class recipes live in `components/ui/styles.ts` (buttons, fields, dialog, popover, segmented control, toggles, swatches) so the same control looks the same everywhere; canvas colours that Konva needs as literals live in `lib/theme.ts` next to a note that they mirror the CSS tokens. `objectLabel()` returns an icon *key* (`"rect"`, `"note"` …) instead of an emoji; the panel maps keys to lucide icons.

**Files:**
- Create: `apps/web/src/components/ui/styles.ts`, `apps/web/src/lib/theme.ts`
- Modify: `apps/web/src/lib/objectLabels.ts`, `apps/web/src/lib/objectLabels.test.ts`
- Rewrite: `apps/web/src/components/editor/Notice.tsx`
- Modify (components): `AnnotationsPanel.tsx`, `ColorField.tsx`, `Editor.tsx`, `MenuButton.tsx`, `PageMenu.tsx`, `PageOverlay.tsx`, `PageView.tsx`, `PropertiesBar.tsx`, `Sidebar.tsx`, `Thumbnail.tsx`, `find/FindBar.tsx`, `marks/LinkPopover.tsx`, `marks/LinkTargetFields.tsx`, `marks/MarkupShape.tsx`, `marks/SignatureModal.tsx`, `marks/StampPicker.tsx`, `objects/SelectionMiniBar.tsx`, `pages/CropOverlay.tsx`, `pages/ManagePagesModal.tsx`, `text/ParagraphLayer.tsx`, `text/TextEditor.tsx`, `text/TextNode.tsx`, `text/TextProps.tsx` (all under `apps/web/src/components/editor/`)

**Interfaces:**
- Consumes: Task 9 tokens, `ICON`/`ICON_SM`, `Tip`.
- Produces:
  - `components/ui/styles.ts`: `BACKDROP DIALOG DIALOG_TITLE POPOVER MENU_ITEM BTN_PRIMARY BTN_SECONDARY BTN_QUIET BTN_DANGER BTN_ICON FIELD SEGMENTED PROP_LABEL` and `segment(on) toggle(on) swatch(on)`.
  - `lib/theme.ts`: `CANVAS.accent` (`#246bf6` = `--accent`), `CANVAS.cropShade`, `CANVAS.overflow`.
  - `ObjectIcon` union and `objectLabel(op): { icon: ObjectIcon; label; detail? }`.
  - `ColorField` gains `compact?: boolean` (no inline swatches; used by TextProps). (Task 11 replaces the swatches with a popover.)
- Test ids and accessible names unchanged.

- [ ] **Step 1: Write the failing test (icon keys)**

```diff
diff --git a/apps/web/src/lib/objectLabels.test.ts b/apps/web/src/lib/objectLabels.test.ts
index cdcf7df..a7a6249 100644
--- a/apps/web/src/lib/objectLabels.test.ts
+++ b/apps/web/src/lib/objectLabels.test.ts
@@ -9,11 +9,11 @@ const box = (text: string) => ({ rect: { x: 0, y: 0, w: 10, h: 10 }, lineHeight:
 
 describe("objectLabel", () => {
   it("names each kind, with a snippet where there is text", () => {
-    expect(objectLabel(op({ type: "text.add", box: box("Halo\ndunia") }))).toEqual({ icon: "T", label: "Teks", detail: "Halo dunia" });
-    expect(objectLabel(op({ type: "shape.add", kind: "cloud", points: [], stroke: "#000000", width: 1 }))).toEqual({ icon: "☁", label: "Awan" });
+    expect(objectLabel(op({ type: "text.add", box: box("Halo\ndunia") }))).toEqual({ icon: "text", label: "Teks", detail: "Halo dunia" });
+    expect(objectLabel(op({ type: "shape.add", kind: "cloud", points: [], stroke: "#000000", width: 1 }))).toEqual({ icon: "cloud", label: "Awan" });
     expect(objectLabel(op({ type: "stamp.add", preset: "disetujui", rect: {}, color: "#000000" })).detail).toBe("DISETUJUI");
     expect(objectLabel(op({ type: "stamp.add", custom: { text: "OK", date: "01/01/2026" }, rect: {}, color: "#000000" })).detail).toBe("OK 01/01/2026");
-    expect(objectLabel(op({ type: "annot.add", kind: "note", point: [0, 0], color: "#000000", content: "" }))).toEqual({ icon: "🗒", label: "Catatan", detail: undefined });
+    expect(objectLabel(op({ type: "annot.add", kind: "note", point: [0, 0], color: "#000000", content: "" }))).toEqual({ icon: "note", label: "Catatan", detail: undefined });
     expect(objectLabel(op({ type: "annot.add", kind: "strike", quads: [], color: "#000000" })).label).toBe("Coret");
     expect(objectLabel(op({ type: "link.add", rect: {}, target: { pageKey: "o1" } })).detail).toBeUndefined();
   });
```

Run: `npx vitest run src/lib/objectLabels.test.ts` (from `apps/web`)
Expected: FAIL — `expected { icon: 'T', … } to deeply equal { icon: 'text', … }`.

- [ ] **Step 2: Icon keys**

```diff
diff --git a/apps/web/src/lib/objectLabels.ts b/apps/web/src/lib/objectLabels.ts
index b8b3e4b..e786786 100644
--- a/apps/web/src/lib/objectLabels.ts
+++ b/apps/web/src/lib/objectLabels.ts
@@ -11,24 +11,28 @@ function snippet(text: string | null | undefined): string | undefined {
   return s.length > SNIPPET ? `${s.slice(0, SNIPPET - 1)}…` : s;
 }
 
+/** Which icon the Anotasi panel shows for an object (the panel maps it to a line icon). */
+export type ObjectIcon = "text" | "textEdit" | "image" | "signature" | "rect" | "ellipse" | "line" | "arrow" | "polygon" | "polyline" | "cloud"
+  | "ink" | "whiteout" | "redact" | "stamp" | "check" | "cross" | "link" | "note" | "highlight" | "underline" | "strike";
+
 /** How the Anotasi panel lists an object: an icon, its kind and (for text, notes, stamps, links) a snippet. */
-export function objectLabel(op: ContentOp): { icon: string; label: string; detail?: string } {
+export function objectLabel(op: ContentOp): { icon: ObjectIcon; label: string; detail?: string } {
   const L = t.objectKinds;
   switch (op.type) {
-    case "text.add": return { icon: "T", label: L.text, detail: snippet(plainText(op.box)) };
-    case "text.edit": return { icon: "✎", label: L.textEdit, detail: snippet(plainText(op.box)) };
-    case "image.add": return { icon: "🖼", label: L.image };
-    case "signature.add": return { icon: "✍", label: L.signature };
-    case "shape.add": return { icon: { rect: "□", ellipse: "○", line: "╱", arrow: "→", polygon: "⬠", polyline: "⌇", cloud: "☁" }[op.kind], label: L.shape[op.kind] };
-    case "ink.add": return { icon: "✎", label: L.ink };
-    case "whiteout.add": return { icon: "▭", label: L.whiteout };
-    case "redact.add": return { icon: "▮", label: L.redact };
-    case "stamp.add": return { icon: "🏷", label: L.stamp, detail: snippet(stampTexts(op).join(" ")) };
-    case "symbol.add": return { icon: op.kind === "check" ? "✓" : "✗", label: op.kind === "check" ? L.check : L.cross };
-    case "link.add": return { icon: "🔗", label: L.link, detail: "url" in op.target ? snippet(op.target.url) : undefined };
+    case "text.add": return { icon: "text", label: L.text, detail: snippet(plainText(op.box)) };
+    case "text.edit": return { icon: "textEdit", label: L.textEdit, detail: snippet(plainText(op.box)) };
+    case "image.add": return { icon: "image", label: L.image };
+    case "signature.add": return { icon: "signature", label: L.signature };
+    case "shape.add": return { icon: op.kind, label: L.shape[op.kind] };
+    case "ink.add": return { icon: "ink", label: L.ink };
+    case "whiteout.add": return { icon: "whiteout", label: L.whiteout };
+    case "redact.add": return { icon: "redact", label: L.redact };
+    case "stamp.add": return { icon: "stamp", label: L.stamp, detail: snippet(stampTexts(op).join(" ")) };
+    case "symbol.add": return { icon: op.kind, label: op.kind === "check" ? L.check : L.cross };
+    case "link.add": return { icon: "link", label: L.link, detail: "url" in op.target ? snippet(op.target.url) : undefined };
     case "annot.add": return op.kind === "note"
-      ? { icon: "🗒", label: L.note, detail: snippet(op.content) }
-      : { icon: "🖍", label: L.markup[op.kind] };
+      ? { icon: "note", label: L.note, detail: snippet(op.content) }
+      : { icon: op.kind, label: L.markup[op.kind] };
   }
 }
```

- [ ] **Step 3: Shared recipes and canvas colours**

```ts
/** Class recipes shared by every control, so buttons, fields, menus and dialogs look the same everywhere. */

/** Dialog backdrop (a darkened canvas) and the dialog surface. */
export const BACKDROP = "fixed inset-0 z-40 flex justify-center bg-base/70";
export const DIALOG = "flex flex-col rounded-xl bg-raised text-sm text-ink shadow-modal outline-none";
export const DIALOG_TITLE = "text-base font-medium text-ink";

/** Floating panels: menus, popovers, the find bar, the crop bar, the mini-bar. */
export const POPOVER = "rounded-lg bg-raised text-sm text-ink shadow-pop";
export const MENU_ITEM = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-hover disabled:pointer-events-none disabled:opacity-45";

/** Buttons: primary (the one main action of a surface), secondary, quiet (icon or text), danger. */
const BTN_BASE = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45";
export const BTN_PRIMARY = `${BTN_BASE} bg-accent text-accent-ink hover:bg-accent-hover`;
export const BTN_SECONDARY = `${BTN_BASE} bg-hover text-ink ring-1 ring-inset ring-line-strong hover:bg-line`;
export const BTN_QUIET = `${BTN_BASE} font-normal text-muted hover:bg-hover hover:text-ink`;
export const BTN_DANGER = `${BTN_BASE} font-normal text-danger-text hover:bg-danger/15`;
/** A square icon-only button (close, prev/next …). */
export const BTN_ICON = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:text-faint/60";

/** Text fields and selects on dark surfaces. */
export const FIELD = "h-8 rounded-md border border-line-strong bg-base/60 px-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none";

/** A segmented control (tabs, language, mode): the track and one segment. */
export const SEGMENTED = "flex rounded-md bg-base/60 p-0.5 ring-1 ring-inset ring-line";
export const segment = (on: boolean) =>
  `h-7 rounded-[5px] px-3 text-xs font-medium transition-colors ${on ? "bg-raised text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-ink"}`;

/** Toggle buttons in the properties bar (B, I, U, align …). */
export const toggle = (on: boolean) =>
  `grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors ${on ? "bg-accent/20 text-accent-text" : "text-muted hover:bg-hover hover:text-ink"}`;

/** A small field label in the properties bar. */
export const PROP_LABEL = "flex shrink-0 items-center gap-2 text-xs text-muted";

/** A colour dot (swatch) with the selected one ringed in the accent. */
export const swatch = (on: boolean) =>
  `h-5 w-5 shrink-0 rounded-full ring-1 ring-inset ring-line-strong ${on ? "outline outline-2 outline-offset-2 outline-accent-text" : ""}`;
```

```ts
/** Colours drawn on the canvas (Konva and inline styles cannot read CSS variables). They mirror tokens in
 *  app/globals.css: change both together. */
export const CANVAS = {
  /** --accent: selection outlines, transformer handles, the crop rectangle, editable-paragraph outlines. */
  accent: "#246bf6",
  /** Shade outside a crop: --base at 55 %. */
  cropShade: "rgba(14, 15, 18, 0.55)",
  /** --warn on paper: the outline of a text box that runs past its original paragraph. */
  overflow: "#d97706",
} as const;
```

- [ ] **Step 4: Sidebar, thumbnails, page menu, menus, Anotasi panel**

```diff
diff --git a/apps/web/src/components/editor/Sidebar.tsx b/apps/web/src/components/editor/Sidebar.tsx
index 23c5c4f..0f19810 100644
--- a/apps/web/src/components/editor/Sidebar.tsx
+++ b/apps/web/src/components/editor/Sidebar.tsx
@@ -3,10 +3,13 @@
 import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
 import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
 import { CSS } from "@dnd-kit/utilities";
+import { Plus } from "lucide-react";
 import { useState } from "react";
 import { listedCount } from "@/lib/objectLabels";
 import { t } from "@/lib/strings";
 import { editorStore, pageGeom, useEditor, type PageEntry } from "@/store/editor";
+import { ICON_SM } from "../ui/icon";
+import { SEGMENTED, segment } from "../ui/styles";
 import { AnnotationsPanel } from "./AnnotationsPanel";
 import { MenuButton } from "./MenuButton";
 import { PageMenu } from "./PageMenu";
@@ -19,10 +22,10 @@ function InsertButton({ after }: { after: string | null }) {
   const scroll = (k: string | undefined) => { if (k) setTimeout(() => scrollToPage(k), 50); };
   return (
     <div className="group mx-auto my-1 flex h-5 w-full items-center justify-center">
-      <MenuButton label={t.pages.insert} className="grid h-5 w-5 place-items-center rounded-full bg-surface text-xs text-muted opacity-0 ring-1 ring-line transition group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100" items={[
+      <MenuButton label={t.pages.insert} className="grid h-5 w-5 place-items-center rounded-full bg-raised text-muted opacity-0 ring-1 ring-line-strong transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100" items={[
         { label: t.pages.blank, run: () => scroll(editorStore.getState().insertBlankAfter(after)) },
         { label: t.pages.importPdf, run: () => void pickPdf().then(async (f) => { if (f) scroll((await importPdf(f, after))[0]); }) },
-      ]}>+</MenuButton>
+      ]}><Plus {...ICON_SM} /></MenuButton>
     </div>
   );
 }
@@ -38,11 +41,11 @@ function SortableThumb({ entry, index, count, active }: { entry: PageEntry; inde
         {...attributes}
         {...listeners}
         onClick={() => scrollToPage(entry.pageKey)}
-        className={`relative mx-auto w-fit cursor-pointer rounded-md p-1 ${active ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-line"}`}
+        className={`group/thumb relative mx-auto w-fit cursor-pointer rounded-md p-1.5 transition-colors ${active ? "bg-accent/15" : "hover:bg-hover"}`}
       >
         <Thumbnail entry={entry} geom={pageGeom(entry, info)} />
         <PageMenu pageKey={entry.pageKey} index={index} count={count} />
-        <p className="mt-1 text-center text-xs text-muted">{index + 1}</p>
+        <p className={`mt-1.5 text-center text-2xs tabular-nums ${active ? "font-medium text-accent-text" : "text-faint"}`}>{index + 1}</p>
       </div>
     </div>
   );
@@ -52,16 +55,15 @@ export function Sidebar() {
   const [tab, setTab] = useState<"pages" | "annotations">("pages");
   const count = useEditor((s) => listedCount(s.doc));
   const tabBtn = (k: typeof tab, label: string) => (
-    <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
-      className={`flex-1 rounded-md px-2 py-1 text-xs ${tab === k ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-bg"}`}>{label}</button>
+    <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 ${segment(tab === k)}`}>{label}</button>
   );
   return (
-    <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-surface" aria-label={t.editor.pages}>
-      <div role="tablist" className="flex gap-1 border-b border-line p-1.5">
+    <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel" aria-label={t.editor.pages}>
+      <div role="tablist" className={`m-2 ${SEGMENTED}`}>
         {tabBtn("pages", t.panel.pages)}
         {tabBtn("annotations", count ? `${t.panel.annotations} (${count})` : t.panel.annotations)}
       </div>
-      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
+      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
         {tab === "pages" ? <PageThumbs /> : <AnnotationsPanel />}
       </div>
     </aside>
```

```diff
diff --git a/apps/web/src/components/editor/Thumbnail.tsx b/apps/web/src/components/editor/Thumbnail.tsx
index 01d86cc..4270138 100644
--- a/apps/web/src/components/editor/Thumbnail.tsx
+++ b/apps/web/src/components/editor/Thumbnail.tsx
@@ -10,7 +10,7 @@ export function Thumbnail({ entry, geom, width = THUMB_W }: { entry: PageEntry;
   const scale = width / screenSize(geom, 1).width;
   const size = screenSize(geom, scale);
   return (
-    <div className="relative overflow-hidden bg-white ring-1 ring-line" style={{ width: size.width, height: size.height }}>
+    <div className="relative overflow-hidden bg-paper shadow-page" style={{ width: size.width, height: size.height }}>
       <PageCanvas entry={entry} geom={geom} scale={scale} label="thumbnail" />
     </div>
   );
```

```diff
diff --git a/apps/web/src/components/editor/PageView.tsx b/apps/web/src/components/editor/PageView.tsx
index c097f37..11f5bb1 100644
--- a/apps/web/src/components/editor/PageView.tsx
+++ b/apps/web/src/components/editor/PageView.tsx
@@ -36,7 +36,7 @@ export function PageView({ entry, geom, scale, overlay, onVisible }: {
       ref={wrap}
       data-testid="page"
       data-page-key={entry.pageKey}
-      className="relative mx-auto overflow-hidden bg-white shadow-sm ring-1 ring-line"
+      className="relative mx-auto overflow-hidden bg-paper shadow-page"
       style={{ width: size.width, height: size.height }}
     >
       {near && <PageCanvas entry={entry} geom={geom} scale={scale} label="page" />}
```

```diff
diff --git a/apps/web/src/components/editor/PageMenu.tsx b/apps/web/src/components/editor/PageMenu.tsx
index 044803b..ac21022 100644
--- a/apps/web/src/components/editor/PageMenu.tsx
+++ b/apps/web/src/components/editor/PageMenu.tsx
@@ -1,22 +1,24 @@
 "use client";
 
+import { EllipsisVertical } from "lucide-react";
 import { t } from "@/lib/strings";
 import { editorStore } from "@/store/editor";
+import { ICON_SM } from "../ui/icon";
 import { MenuButton } from "./MenuButton";
 import { scrollToPage } from "./ZoomPill";
 
 export function PageMenu({ pageKey, index, count }: { pageKey: string; index: number; count: number }) {
   const s = editorStore.getState();
   return (
-    <div className="absolute right-1 top-1">
-      <MenuButton label={t.editor.pageMenu} className="grid h-6 w-6 place-items-center rounded bg-white/90 text-muted shadow ring-1 ring-line hover:text-ink" items={[
+    <div className="absolute right-2.5 top-2.5">
+      <MenuButton label={t.editor.pageMenu} className="grid h-6 w-6 place-items-center rounded-md bg-raised text-muted opacity-0 shadow-pop transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/thumb:opacity-100 aria-expanded:opacity-100" items={[
         { label: t.editor.rotateLeft, run: () => s.rotatePage(pageKey, -90) },
         { label: t.editor.rotateRight, run: () => s.rotatePage(pageKey, 90) },
         { label: t.pages.duplicate, run: () => { const k = s.duplicatePage(pageKey); if (k) setTimeout(() => scrollToPage(k), 50); } },
         { label: t.editor.moveUp, run: () => s.movePage(pageKey, index - 1), disabled: index === 0 },
         { label: t.editor.moveDown, run: () => s.movePage(pageKey, index + 1), disabled: index === count - 1 },
         { label: t.editor.deletePage, run: () => s.deletePage(pageKey), disabled: count <= 1, danger: true },
-      ]}>⋮</MenuButton>
+      ]}><EllipsisVertical {...ICON_SM} /></MenuButton>
     </div>
   );
 }
```

```diff
diff --git a/apps/web/src/components/editor/MenuButton.tsx b/apps/web/src/components/editor/MenuButton.tsx
index 0d4e448..1577080 100644
--- a/apps/web/src/components/editor/MenuButton.tsx
+++ b/apps/web/src/components/editor/MenuButton.tsx
@@ -2,11 +2,12 @@
 
 import { useEffect, useRef, useState } from "react";
 import { createPortal } from "react-dom";
+import { MENU_ITEM, POPOVER } from "../ui/styles";
 
 export interface MenuItem { label: string; run: () => void; disabled?: boolean; danger?: boolean }
 
-const MENU_WIDTH = 176; // w-44
-const ITEM_HEIGHT = 32; // py-1.5 + text-sm line
+const MENU_WIDTH = 192;
+const ITEM_HEIGHT = 32; // h-8
 
 /** A button that opens a menu. The menu renders in a portal with fixed positioning so a narrow, scrolling
  *  parent (the sidebar) cannot clip it; it closes on an outside press, Escape, scroll or resize. */
@@ -65,12 +66,12 @@ export function MenuButton({ label, items, children, className }: { label: strin
           style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
           onPointerDown={(e) => e.stopPropagation()}
           onClick={(e) => e.stopPropagation()}
-          className="fixed z-50 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line"
+          className={`fixed z-50 p-1 ${POPOVER}`}
         >
           {items.map((it) => (
             <button key={it.label} role="menuitem" disabled={it.disabled}
               onClick={() => { setAt(null); it.run(); }}
-              className={`block w-full px-3 py-1.5 text-left hover:bg-bg disabled:opacity-40 ${it.danger ? "text-danger" : ""}`}>
+              className={`${MENU_ITEM} ${it.danger ? "text-danger-text" : "text-ink"}`}>
               {it.label}
             </button>
           ))}
```

```diff
diff --git a/apps/web/src/components/editor/AnnotationsPanel.tsx b/apps/web/src/components/editor/AnnotationsPanel.tsx
index d186e12..06bf4e7 100644
--- a/apps/web/src/components/editor/AnnotationsPanel.tsx
+++ b/apps/web/src/components/editor/AnnotationsPanel.tsx
@@ -1,12 +1,23 @@
 "use client";
 
 import type { ContentOp } from "@edith/ops";
+import {
+  ArrowUpRight, Check, Circle, Cloud, Eraser, EyeOff, Highlighter, Image, Link2, MessageSquare, Pencil, Pentagon, Signature, Slash,
+  Spline, Square, Stamp, Strikethrough, Type, Underline, X, type LucideIcon,
+} from "lucide-react";
 import { useRef } from "react";
-import { listedObjects, objectLabel } from "@/lib/objectLabels";
+import { listedObjects, objectLabel, type ObjectIcon } from "@/lib/objectLabels";
 import { t } from "@/lib/strings";
 import { editorStore, useEditor } from "@/store/editor";
+import { ICON_SM } from "../ui/icon";
 import { scrollToPage } from "./ZoomPill";
 
+const ICONS: Record<ObjectIcon, LucideIcon> = {
+  text: Type, textEdit: Type, image: Image, signature: Signature, rect: Square, ellipse: Circle, line: Slash, arrow: ArrowUpRight,
+  polygon: Pentagon, polyline: Spline, cloud: Cloud, ink: Pencil, whiteout: Eraser, redact: EyeOff, stamp: Stamp, check: Check, cross: X,
+  link: Link2, note: MessageSquare, highlight: Highlighter, underline: Underline, strike: Strikethrough,
+};
+
 /** Every object added to the document, grouped by page in page order: a click goes to it and selects it. */
 export function AnnotationsPanel() {
   const pages = useEditor((s) => s.doc.pages);
@@ -16,7 +27,7 @@ export function AnnotationsPanel() {
   const groups = listedObjects({ pages, order, objects });
   const root = useRef<HTMLDivElement>(null);
 
-  if (!groups.length) return <div ref={root} tabIndex={-1} className="outline-none"><p className="px-2 py-4 text-xs text-muted">{t.panel.empty}</p></div>;
+  if (!groups.length) return <div ref={root} tabIndex={-1} className="outline-none"><p className="px-2 py-4 text-xs leading-relaxed text-faint">{t.panel.empty}</p></div>;
 
   function remove(op: ContentOp) {
     const items = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-testid=annotation-item]") ?? []);
@@ -37,22 +48,23 @@ export function AnnotationsPanel() {
   }
 
   return (
-    <div ref={root} tabIndex={-1} className="flex flex-col gap-3 outline-none" data-testid="annotations-panel">
+    <div ref={root} tabIndex={-1} className="flex flex-col gap-4 outline-none" data-testid="annotations-panel">
       {groups.map((g) => (
         <section key={g.pageKey} aria-label={t.pages.pageN(g.n)}>
-          <h3 className="px-1 pb-1 text-xs font-medium text-muted">{t.pages.pageN(g.n)}</h3>
+          <h3 className="px-2 pb-1 text-2xs font-medium uppercase tracking-wider text-faint">{t.pages.pageN(g.n)}</h3>
           <ul className="flex flex-col gap-0.5">
             {g.ops.map((op) => {
               const { icon, label, detail } = objectLabel(op);
+              const Icon = ICONS[icon];
               return (
-                <li key={op.id} className={`group flex items-center rounded-md ${selection === op.id ? "bg-accent/10" : "hover:bg-bg"}`}>
-                  <button onClick={() => go(op)} data-testid="annotation-item" data-op-id={op.id} className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs">
-                    <span aria-hidden className="w-4 shrink-0 text-center">{icon}</span>
+                <li key={op.id} className={`group flex items-center rounded-md ${selection === op.id ? "bg-accent/20 text-accent-text" : "text-ink hover:bg-hover"}`}>
+                  <button onClick={() => go(op)} data-testid="annotation-item" data-op-id={op.id} className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs">
+                    <Icon {...ICON_SM} className="shrink-0 text-muted" />
                     <span className="shrink-0">{label}</span>
-                    {detail && <span className="truncate text-muted">{detail}</span>}
+                    {detail && <span className="truncate text-faint">{detail}</span>}
                   </button>
                   <button aria-label={t.panel.deleteItem(label)} title={t.editor.delete} onClick={() => remove(op)}
-                    className="px-1.5 text-xs text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">✕</button>
+                    className="grid h-8 w-7 place-items-center text-faint opacity-0 hover:text-danger-text focus-visible:opacity-100 group-hover:opacity-100"><X {...ICON_SM} /></button>
                 </li>
               );
             })}
```

```diff
diff --git a/apps/web/src/components/editor/Editor.tsx b/apps/web/src/components/editor/Editor.tsx
index 82d78a3..d21fb7c 100644
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -157,7 +157,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
     <div className="flex h-dvh flex-col bg-panel">
       <Header onNotice={setNotice}><Toolbar onNotice={setNotice} /></Header>
       <div className="flex min-h-0 flex-1">
-        {pdf ? <Sidebar /> : <aside className="w-48 shrink-0 border-r border-line bg-panel" />}
+        {pdf ? <Sidebar /> : <aside className="w-52 shrink-0 border-r border-line bg-panel" />}
         <div className="relative min-w-0 flex-1">
           <PropertiesBar />
           <main
```

- [ ] **Step 5: Notices, mini-bar, find bar, crop bar**

```tsx
"use client";

import { CircleAlert, Info, X } from "lucide-react";
import type { NoticeMsg } from "@/lib/notices";
import { t } from "@/lib/strings";
import { ICON } from "../ui/icon";
import { POPOVER } from "../ui/styles";

/** A toast at the bottom of the window: an error stays until closed, info goes away by itself (Editor). */
export function Notice({ kind, children, action, onClose }: {
  kind: "error" | "info"; children: React.ReactNode; action?: NoticeMsg["action"]; onClose?: () => void;
}) {
  const Icon = kind === "error" ? CircleAlert : Info;
  return (
    <div role={kind === "error" ? "alert" : "status"}
      className={`fixed bottom-16 left-1/2 z-50 flex max-w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 py-2 pl-3 pr-2 ${POPOVER}`}>
      <Icon {...ICON} className={`shrink-0 ${kind === "error" ? "text-danger-text" : "text-accent-text"}`} />
      <span className="min-w-0 flex-1">{children}</span>
      {action && (
        <button onClick={() => { onClose?.(); action.run(); }}
          className="h-7 shrink-0 rounded-md px-2.5 text-xs font-medium text-accent-text hover:bg-hover">
          {action.label}
        </button>
      )}
      {onClose && (
        <button onClick={onClose} aria-label={t.editor.close} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink">
          <X {...ICON} />
        </button>
      )}
    </div>
  );
}
```

```diff
diff --git a/apps/web/src/components/editor/objects/SelectionMiniBar.tsx b/apps/web/src/components/editor/objects/SelectionMiniBar.tsx
index 0b99d2d..2ea7c69 100644
--- a/apps/web/src/components/editor/objects/SelectionMiniBar.tsx
+++ b/apps/web/src/components/editor/objects/SelectionMiniBar.tsx
@@ -1,10 +1,13 @@
 "use client";
 
+import { Copy, Ellipsis, Trash2 } from "lucide-react";
 import { useStore } from "zustand";
 import { toScreen, type PageGeom, type Pt } from "@/lib/coords";
 import { isCopyable, visualBounds, type Align } from "@/lib/objects";
 import { t } from "@/lib/strings";
 import { editorStore, useEditor } from "@/store/editor";
+import { ICON } from "../../ui/icon";
+import { POPOVER } from "../../ui/styles";
 import { MenuButton } from "../MenuButton";
 import { textEditStore } from "../text/textEdit";
 import { alignSelection, copySelection, duplicateSelection, hasClipboard, pasteClipboard } from "./clipboard";
@@ -29,21 +32,21 @@ export function SelectionMiniBar({ pageKey, geom, scale }: { pageKey: string; ge
   const y = top - BAR_H - 8 >= 0 ? top - BAR_H - 8 : bottom + 8; // above the object, below it at the page top
   const copyable = isCopyable(op);
   const s = editorStore.getState();
-  const btn = "grid h-7 min-w-7 place-items-center rounded px-1.5 hover:bg-bg";
+  const btn = "grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink";
 
   return (
     <div role="toolbar" aria-label={t.objects.bar} data-testid="mini-bar" onPointerDown={(e) => e.stopPropagation()}
-      className="absolute flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-surface p-0.5 text-sm shadow-lg ring-1 ring-line"
+      className={`absolute flex -translate-x-1/2 items-center gap-0.5 p-0.5 ${POPOVER}`}
       style={{ left, top: y, height: BAR_H, zIndex: 15 }}>
-      {copyable && <button aria-label={t.objects.duplicate} title={t.objects.duplicate} className={btn} onClick={() => duplicateSelection()}>⧉</button>}
-      <button aria-label={t.editor.delete} title={t.editor.delete} className={`${btn} text-danger`} onClick={() => s.deleteObject(op.id)}>🗑</button>
+      {copyable && <button aria-label={t.objects.duplicate} title={t.objects.duplicate} className={btn} onClick={() => duplicateSelection()}><Copy {...ICON} /></button>}
+      <button aria-label={t.editor.delete} title={t.editor.delete} className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-danger/15 hover:text-danger-text" onClick={() => s.deleteObject(op.id)}><Trash2 {...ICON} /></button>
       {copyable && (
         <MenuButton label={t.objects.more} className={btn} items={[
           { label: t.objects.copy, run: () => { copySelection(); } },
           { label: t.objects.paste, run: () => { pasteClipboard(); }, disabled: !hasClipboard() },
           { label: t.objects.duplicate, run: () => { duplicateSelection(); } },
           ...ALIGNS.map(([a, label]) => ({ label, run: () => alignSelection(a) })),
-        ]}>⋯</MenuButton>
+        ]}><Ellipsis {...ICON} /></MenuButton>
       )}
     </div>
   );
```

```diff
diff --git a/apps/web/src/components/editor/find/FindBar.tsx b/apps/web/src/components/editor/find/FindBar.tsx
index db58f80..02b3826 100644
--- a/apps/web/src/components/editor/find/FindBar.tsx
+++ b/apps/web/src/components/editor/find/FindBar.tsx
@@ -1,5 +1,6 @@
 "use client";
 
+import { ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, X } from "lucide-react";
 import { useEffect, useRef, useState } from "react";
 import { useStore } from "zustand";
 import type { BundledFont } from "@edith/ops";
@@ -12,6 +13,8 @@ import { editorStore, useEditor } from "@/store/editor";
 import { textStore, useText } from "@/store/text";
 import { commitOpenSession, whenTextCommitted } from "../text/textEdit";
 import { isFindKey } from "../useShortcuts";
+import { ICON } from "../../ui/icon";
+import { BTN_QUIET, BTN_ICON, FIELD, POPOVER, toggle } from "../../ui/styles";
 import { findStore } from "./findStore";
 import { applyReplacements } from "./replace";
 
@@ -91,39 +94,38 @@ export function FindBar() {
     }
   };
   const close = () => f.set({ open: false, matches: [] });
-  const btn = "h-8 rounded-md px-2 text-sm hover:bg-bg disabled:opacity-40";
 
   return (
     <div role="search" aria-label={t.find.title} data-testid="find-bar"
-      className="fixed right-4 top-28 z-30 flex w-[26rem] flex-col gap-2 rounded-xl border border-line bg-surface p-2 shadow-lg"
+      className={`fixed right-4 top-[3.75rem] z-30 flex w-[27rem] max-w-[calc(100vw-2rem)] flex-col gap-1.5 p-1.5 ${POPOVER}`}
       onKeyDown={(e) => {
         if (e.key === "Escape") { e.preventDefault(); close(); }
         if (isFindKey(e)) return; // the window shortcut re-focuses the query
         e.stopPropagation();
       }}>
       <div className="flex items-center gap-1">
-        <button type="button" aria-label={t.find.toggleReplace} aria-expanded={f.showReplace} className={btn}
-          onClick={() => f.set({ showReplace: !f.showReplace })}>{f.showReplace ? "▾" : "▸"}</button>
+        <button type="button" aria-label={t.find.toggleReplace} aria-expanded={f.showReplace} className={BTN_ICON}
+          onClick={() => f.set({ showReplace: !f.showReplace })}>{f.showReplace ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}</button>
         <input ref={input} aria-label={t.find.query} value={f.query} placeholder={t.find.query}
           onChange={(e) => f.set({ query: e.target.value, current: 0 })}
           onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); } }}
-          className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-sm" />
-        <span className="w-20 text-center text-xs tabular-nums text-muted" aria-live="polite">
+          className={`${FIELD} min-w-0 flex-1`} />
+        <span className="w-16 shrink-0 text-center text-xs tabular-nums text-muted" aria-live="polite">
           {status === "loading" ? t.find.loading : t.find.count(n ? f.current + 1 : 0, n)}
         </span>
         <button type="button" aria-label={t.find.caseSensitive} aria-pressed={f.caseSensitive} title={t.find.caseSensitive}
-          className={`${btn} ${f.caseSensitive ? "bg-accent/10 text-accent" : ""}`} onClick={() => f.set({ caseSensitive: !f.caseSensitive })}>Aa</button>
-        <button type="button" aria-label={t.find.prev} disabled={!n} className={btn} onClick={() => go(-1)}>↑</button>
-        <button type="button" aria-label={t.find.next} disabled={!n} className={btn} onClick={() => go(1)}>↓</button>
-        <button type="button" aria-label={t.editor.close} className={btn} onClick={close}>✕</button>
+          className={toggle(f.caseSensitive)} onClick={() => f.set({ caseSensitive: !f.caseSensitive })}><CaseSensitive {...ICON} /></button>
+        <button type="button" aria-label={t.find.prev} disabled={!n} className={BTN_ICON} onClick={() => go(-1)}><ArrowUp {...ICON} /></button>
+        <button type="button" aria-label={t.find.next} disabled={!n} className={BTN_ICON} onClick={() => go(1)}><ArrowDown {...ICON} /></button>
+        <button type="button" aria-label={t.editor.close} className={BTN_ICON} onClick={close}><X {...ICON} /></button>
       </div>
       {f.showReplace && (
-        <div className="flex items-center gap-1 pl-9">
+        <div className="flex items-center gap-1 pl-9 pr-1">
           <input aria-label={t.find.replacement} value={f.replacement} placeholder={t.find.replacement}
             onChange={(e) => f.set({ replacement: e.target.value })}
-            className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-sm" />
-          <button type="button" disabled={!n || busy} className={btn} onClick={() => void replace(false)}>{t.find.replace}</button>
-          <button type="button" disabled={!n || busy} className={btn} onClick={() => void replace(true)}>{t.find.replaceAll}</button>
+            className={`${FIELD} min-w-0 flex-1`} />
+          <button type="button" disabled={!n || busy} className={BTN_QUIET} onClick={() => void replace(false)}>{t.find.replace}</button>
+          <button type="button" disabled={!n || busy} className={BTN_QUIET} onClick={() => void replace(true)}>{t.find.replaceAll}</button>
         </div>
       )}
     </div>
```

```diff
diff --git a/apps/web/src/components/editor/pages/CropOverlay.tsx b/apps/web/src/components/editor/pages/CropOverlay.tsx
index d971667..60989df 100644
--- a/apps/web/src/components/editor/pages/CropOverlay.tsx
+++ b/apps/web/src/components/editor/pages/CropOverlay.tsx
@@ -9,8 +9,12 @@ import { MIN_CROP } from "@/lib/pages";
 import { t } from "@/lib/strings";
 import { useEditor } from "@/store/editor";
 import { applyCrop, clearCrop, cropStore, fitRect } from "./cropStore";
+import { Check } from "lucide-react";
+import { CANVAS } from "@/lib/theme";
+import { ICON } from "../../ui/icon";
+import { BTN_PRIMARY, BTN_QUIET, POPOVER } from "../../ui/styles";
 
-const SHADE = "rgba(15,23,42,0.45)";
+const SHADE = CANVAS.cropShade;
 
 /** The crop being edited on this page: the rest of the page is shaded, the crop rect can be moved and resized
  *  (kept inside the page), and a bar applies it to this page or to all pages. `geom` is the uncropped page. */
@@ -58,7 +62,7 @@ export default function CropOverlay({ pageKey, geom, scale }: { pageKey: string;
             <Rect x={0} y={rect.y + rect.h} width={W} height={H - rect.y - rect.h} fill={SHADE} listening={false} />
             <Rect x={0} y={rect.y} width={rect.x} height={rect.h} fill={SHADE} listening={false} />
             <Rect x={rect.x + rect.w} y={rect.y} width={W - rect.x - rect.w} height={rect.h} fill={SHADE} listening={false} />
-            <Rect ref={node} name="crop-rect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} stroke="#0f766e" strokeWidth={1.5}
+            <Rect ref={node} name="crop-rect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} stroke={CANVAS.accent} strokeWidth={1.5}
               strokeScaleEnabled={false} dash={[6, 4]} fill="rgba(0,0,0,0.001)" draggable
               onDragMove={(e) => {
                 const n = e.target;
@@ -75,15 +79,16 @@ export default function CropOverlay({ pageKey, geom, scale }: { pageKey: string;
           </Group>
           <Transformer ref={tr} rotateEnabled={false} flipEnabled={false} keepRatio={false} ignoreStroke
             boundBoxFunc={(old, box) => (box.width < MIN_CROP * scale || box.height < MIN_CROP * scale ? old : box)}
-            borderStroke="#0f766e" anchorStroke="#0f766e" anchorSize={9} />
+            borderStroke={CANVAS.accent} anchorStroke={CANVAS.accent} anchorSize={9} />
         </Layer>
       </Stage>
       <div role="toolbar" aria-label={t.crop.title} data-testid="crop-bar"
-        className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-surface p-1 text-sm shadow-lg ring-1 ring-line">
-        <button ref={apply} onClick={() => applyCrop(false)} className="rounded-md bg-accent px-2.5 py-1 text-accent-ink">{t.crop.thisPage}</button>
-        <button onClick={() => applyCrop(true)} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.allPages}</button>
-        {cropped && <button onClick={clearCrop} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.remove}</button>}
-        <button onClick={() => cropStore.getState().close()} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.cancel}</button>
+        className={`absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap p-1 ${POPOVER}`}>
+        <button ref={apply} onClick={() => applyCrop(false)} className={BTN_PRIMARY}><Check {...ICON} />{t.crop.thisPage}</button>
+        <button onClick={() => applyCrop(true)} className={BTN_QUIET}>{t.crop.allPages}</button>
+        {cropped && <button onClick={clearCrop} className={BTN_QUIET}>{t.crop.remove}</button>}
+        <span aria-hidden className="mx-0.5 h-5 w-px bg-line-strong" />
+        <button onClick={() => cropStore.getState().close()} className={BTN_QUIET}>{t.crop.cancel}</button>
       </div>
     </div>
   );
```

- [ ] **Step 6: Dialogs**

```diff
diff --git a/apps/web/src/components/editor/marks/StampPicker.tsx b/apps/web/src/components/editor/marks/StampPicker.tsx
index 5e21bb9..318d23e 100644
--- a/apps/web/src/components/editor/marks/StampPicker.tsx
+++ b/apps/web/src/components/editor/marks/StampPicker.tsx
@@ -1,11 +1,14 @@
 "use client";
 
+import { X } from "lucide-react";
 import { useEffect, useRef, useState } from "react";
 import type { StampAdd } from "@edith/ops";
 import { fontStore } from "@/lib/fonts";
 import { newId } from "@/lib/id";
 import { STAMP_COLORS, STAMP_FONT, STAMPS_EN, STAMPS_ID, stampDate, stampRect, stampTime, type StampKind } from "@/lib/stamps";
 import { t } from "@/lib/strings";
+import { ICON } from "../../ui/icon";
+import { BACKDROP, BTN_ICON, BTN_PRIMARY, DIALOG, DIALOG_TITLE, SEGMENTED, segment, swatch } from "../../ui/styles";
 import { currentPage, placeObject } from "../placement";
 
 /** Puts a stamp of `kind` in the middle of the page in view, selected (never wider than the page). */
@@ -40,33 +43,34 @@ export function StampPicker({ onClose }: { onClose: () => void }) {
   }
 
   return (
-    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-24" onPointerDown={onClose}>
+    <div className={`${BACKDROP} items-start pt-24`} onPointerDown={onClose}>
       <div ref={box} tabIndex={-1} role="dialog" aria-label={t.stamp.title} data-testid="stamp-picker" onPointerDown={(e) => e.stopPropagation()}
         onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
-        className="w-[34rem] rounded-xl outline-none bg-surface p-4 shadow-xl ring-1 ring-line">
-        <div className="mb-3 flex items-center gap-2">
-          <span className="font-medium">{t.stamp.title}</span>
+        className={`${DIALOG} w-[34rem] max-w-[calc(100vw-2rem)] gap-4 p-4`}>
+        <div className="flex items-center gap-2">
+          <span className={DIALOG_TITLE}>{t.stamp.title}</span>
           <div className="flex-1" />
-          <div role="tablist" className="flex rounded-md ring-1 ring-line text-sm">
+          <div role="tablist" className={SEGMENTED}>
             {(["presets", "custom"] as const).map((k) => (
               <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
-                className={`px-3 py-1 ${tab === k ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>{k === "presets" ? t.stamp.presets : t.stamp.custom}</button>
+                className={segment(tab === k)}>{k === "presets" ? t.stamp.presets : t.stamp.custom}</button>
             ))}
           </div>
-          <button aria-label={t.editor.close} onClick={onClose} className="rounded-md px-2 py-1 hover:bg-bg">✕</button>
+          <button aria-label={t.editor.close} onClick={onClose} className={BTN_ICON}><X {...ICON} /></button>
         </div>
         {tab === "presets" ? (
           <>
-            <div role="radiogroup" aria-label={t.stamp.langLabel} className="mb-2 flex w-fit rounded-md ring-1 ring-line text-sm">
+            <div role="radiogroup" aria-label={t.stamp.langLabel} className={`mb-3 w-fit ${SEGMENTED}`}>
               {(["id", "en"] as const).map((l) => (
                 <button key={l} role="radio" aria-checked={lang === l} onClick={() => setLang(l)}
-                  className={`px-3 py-1 ${lang === l ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>{l === "id" ? t.stamp.langId : t.stamp.langEn}</button>
+                  className={segment(lang === l)}>{l === "id" ? t.stamp.langId : t.stamp.langEn}</button>
               ))}
             </div>
-            <div className="grid grid-cols-3 gap-2">
+            {/* Previews on paper, in the stamp's own colour: as they will look on the page. */}
+            <div className="grid grid-cols-3 gap-2 rounded-lg bg-paper p-2">
               {(lang === "id" ? STAMPS_ID : STAMPS_EN).map((p) => (
                 <button key={p.id} aria-label={p.label} onClick={() => pick({ preset: p.id as StampAdd["preset"] }, p.color)}
-                  className="rounded-md border-2 px-2 py-1.5 text-xs font-bold hover:bg-bg" style={{ borderColor: p.color, color: p.color }}>
+                  className="truncate rounded-md border-2 px-2 py-1.5 text-xs font-bold tracking-wide transition-transform hover:scale-[1.03]" style={{ borderColor: p.color, color: p.color }}>
                   {p.label}
                 </button>
               ))}
@@ -76,19 +80,19 @@ export function StampPicker({ onClose }: { onClose: () => void }) {
           <div className="flex flex-col gap-3 text-sm">
             <input aria-label={t.stamp.text} value={text} maxLength={60} autoFocus onChange={(e) => setText(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
-              className="rounded border border-line px-2 py-1.5 font-bold" style={{ color }} />
+              className="h-10 rounded-md border border-line-strong bg-paper px-2 text-base font-bold focus:border-accent focus:outline-none" style={{ color }} />
             <div className="flex items-center gap-4">
-              <label className="flex items-center gap-1"><input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />{t.stamp.date}</label>
-              <label className="flex items-center gap-1"><input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} />{t.stamp.time}</label>
+              <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />{t.stamp.date}</label>
+              <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} />{t.stamp.time}</label>
               <div className="flex-1" />
-              <div role="radiogroup" aria-label={t.editor.color} className="flex gap-1">
+              <div role="radiogroup" aria-label={t.editor.color} className="flex gap-2">
                 {STAMP_COLORS.map((c) => (
                   <button key={c} role="radio" aria-checked={color === c} aria-label={`${t.editor.color} ${c}`} onClick={() => setColor(c)}
-                    className={`h-6 w-6 rounded-full ring-1 ring-line ${color === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
+                    className={swatch(color === c)} style={{ background: c }} />
                 ))}
               </div>
             </div>
-            <button onClick={addCustom} disabled={!text.trim()} className="self-end rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-50">{t.stamp.add}</button>
+            <button onClick={addCustom} disabled={!text.trim()} className={`${BTN_PRIMARY} self-end`}>{t.stamp.add}</button>
           </div>
         )}
       </div>
```

```diff
diff --git a/apps/web/src/components/editor/marks/SignatureModal.tsx b/apps/web/src/components/editor/marks/SignatureModal.tsx
index c486d61..92689ff 100644
--- a/apps/web/src/components/editor/marks/SignatureModal.tsx
+++ b/apps/web/src/components/editor/marks/SignatureModal.tsx
@@ -1,5 +1,6 @@
 "use client";
 
+import { X } from "lucide-react";
 import { useEffect, useRef, useState } from "react";
 import type { SignatureAdd } from "@edith/ops";
 import { ApiError, uploadAsset } from "@/lib/api";
@@ -10,6 +11,8 @@ import {
 } from "@/lib/signatures";
 import { errorMessage, t } from "@/lib/strings";
 import { editorStore } from "@/store/editor";
+import { ICON } from "../../ui/icon";
+import { BACKDROP, BTN_ICON, BTN_PRIMARY, BTN_QUIET, DIALOG, DIALOG_TITLE, FIELD, SEGMENTED, segment, swatch } from "../../ui/styles";
 import { currentPage, placeObject } from "../placement";
 import { cropDrawing, loadUpload, renderTyped, scriptFont, type SignatureImage } from "./signatureCanvas";
 
@@ -29,10 +32,10 @@ async function placeSignature(img: SignatureImage): Promise<void> {
 
 function Colors({ value, onChange }: { value: string; onChange: (c: string) => void }) {
   return (
-    <div role="radiogroup" aria-label={t.editor.color} className="flex gap-1">
+    <div role="radiogroup" aria-label={t.editor.color} className="flex gap-2">
       {SIGNATURE_COLORS.map((c) => (
         <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={t.signature.colors[c]} onClick={() => onChange(c)}
-          className={`h-6 w-6 rounded-full ring-1 ring-line ${value === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
+          className={swatch(value === c)} style={{ background: c }} />
       ))}
     </div>
   );
@@ -46,7 +49,7 @@ function DrawPad({ color, canvasRef }: { color: string; canvasRef: React.RefObje
   };
   return (
     <canvas ref={canvasRef} width={PAD_W} height={PAD_H} data-testid="signature-pad"
-      className="w-full touch-none rounded-md bg-white ring-1 ring-line" style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
+      className="w-full touch-none rounded-lg bg-paper" style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
       onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); }}
       onPointerMove={(e) => {
         if (!last.current) return;
@@ -99,14 +102,14 @@ export function SignatureModal({ onClose, onNotice }: { onClose: () => void; onN
   }
 
   return (
-    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-20" onPointerDown={onClose}>
+    <div className={`${BACKDROP} items-start pt-20`} onPointerDown={onClose}>
       <div ref={box} tabIndex={-1} role="dialog" aria-label={t.signature.title} data-testid="signature-modal" onPointerDown={(e) => e.stopPropagation()}
         onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
-        className="flex w-[34rem] flex-col outline-none gap-3 rounded-xl bg-surface p-4 text-sm shadow-xl ring-1 ring-line">
+        className={`${DIALOG} w-[34rem] max-w-[calc(100vw-2rem)] gap-4 p-4`}>
         <div className="flex items-center gap-2">
-          <span className="font-medium">{t.signature.title}</span>
+          <span className={DIALOG_TITLE}>{t.signature.title}</span>
           <div className="flex-1" />
-          <button aria-label={t.editor.close} onClick={onClose} className="rounded-md px-2 py-1 hover:bg-bg">✕</button>
+          <button aria-label={t.editor.close} onClick={onClose} className={BTN_ICON}><X {...ICON} /></button>
         </div>
         {saved.length > 0 && (
           <section aria-label={t.signature.saved} className="flex flex-col gap-1">
@@ -115,21 +118,21 @@ export function SignatureModal({ onClose, onNotice }: { onClose: () => void; onN
               {saved.map((sig) => (
                 <div key={sig.id} className="relative">
                   <button aria-label={t.signature.use} disabled={busy} onClick={() => run(async () => sig, false)}
-                    className="h-14 w-36 rounded-md bg-white p-1 ring-1 ring-line hover:ring-accent">
+                    className="h-14 w-36 rounded-md bg-paper p-1 ring-2 ring-transparent transition-shadow hover:ring-accent">
                     {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from localStorage */}
                     <img src={sig.dataUrl} alt="" className="h-full w-full object-contain" />
                   </button>
                   <button aria-label={t.signature.remove} onClick={() => setSaved(removeSignature(sig.id))}
-                    className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-surface text-xs ring-1 ring-line hover:text-danger">✕</button>
+                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-raised text-muted shadow-pop hover:text-danger-text"><X size={12} strokeWidth={2} aria-hidden /></button>
                 </div>
               ))}
             </div>
           </section>
         )}
-        <div role="tablist" className="flex self-start rounded-md ring-1 ring-line">
+        <div role="tablist" className={`self-start ${SEGMENTED}`}>
           {(["draw", "type", "upload"] as const).map((k) => (
             <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
-              className={`px-3 py-1 ${tab === k ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>{t.signature[k]}</button>
+              className={segment(tab === k)}>{t.signature[k]}</button>
           ))}
         </div>
         {tab === "draw" && (
@@ -138,18 +141,18 @@ export function SignatureModal({ onClose, onNotice }: { onClose: () => void; onN
             <div className="flex items-center gap-2">
               <Colors value={color} onChange={setColor} />
               <div className="flex-1" />
-              <button type="button" onClick={() => pad.current?.getContext("2d")!.clearRect(0, 0, PAD_W, PAD_H)} className="rounded-md px-2 py-1 hover:bg-bg">{t.signature.clear}</button>
+              <button type="button" onClick={() => pad.current?.getContext("2d")!.clearRect(0, 0, PAD_W, PAD_H)} className={BTN_QUIET}>{t.signature.clear}</button>
             </div>
           </div>
         )}
         {tab === "type" && (
           <div className="flex flex-col gap-2">
             <input aria-label={t.signature.name} placeholder={t.signature.name} value={name} autoFocus onChange={(e) => setName(e.target.value)}
-              className="rounded border border-line px-2 py-1.5" />
+              className={FIELD} />
             <div role="radiogroup" aria-label={t.signature.font} className="grid grid-cols-2 gap-2">
               {SIGNATURE_FONTS.map((f) => (
                 <button key={f} type="button" role="radio" aria-checked={family === f} aria-label={f} onClick={() => setFamily(f)}
-                  className={`truncate rounded-md px-2 py-2 text-2xl ring-1 ${family === f ? "ring-accent" : "ring-line"}`}
+                  className={`truncate rounded-md bg-paper px-2 py-2 text-2xl ring-2 ${family === f ? "ring-accent" : "ring-transparent hover:ring-line-strong"}`}
                   style={{ fontFamily: `"${cssFamily(scriptFont(f))}"`, color }}>
                   {name.trim() || f}
                 </button>
@@ -160,12 +163,13 @@ export function SignatureModal({ onClose, onNotice }: { onClose: () => void; onN
         )}
         {tab === "upload" && (
           <input type="file" accept="image/png,image/jpeg" aria-label={t.signature.upload} data-testid="signature-file"
-            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
+            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
+            className="text-sm text-muted file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border-0 file:bg-hover file:px-3 file:text-ink file:ring-1 file:ring-inset file:ring-line-strong" />
         )}
         <div className="flex items-center gap-2">
-          <label className="flex items-center gap-1.5"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />{t.signature.save}</label>
+          <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />{t.signature.save}</label>
           <div className="flex-1" />
-          <button onClick={() => run(make, save)} disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-50">{t.signature.add}</button>
+          <button onClick={() => run(make, save)} disabled={busy} className={BTN_PRIMARY}>{t.signature.add}</button>
         </div>
       </div>
     </div>
```

```diff
diff --git a/apps/web/src/components/editor/pages/ManagePagesModal.tsx b/apps/web/src/components/editor/pages/ManagePagesModal.tsx
index 3c123e4..ad83cad 100644
--- a/apps/web/src/components/editor/pages/ManagePagesModal.tsx
+++ b/apps/web/src/components/editor/pages/ManagePagesModal.tsx
@@ -1,5 +1,6 @@
 "use client";
 
+import { ArrowLeft, ArrowRight, CopyPlus, FilePlus2, FileUp, RotateCcw, RotateCw, Trash2 } from "lucide-react";
 import { useEffect, useRef, useState } from "react";
 import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
 import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
@@ -10,6 +11,8 @@ import { errorMessage, t } from "@/lib/strings";
 import { editorStore, pageGeom, useEditor, type EditorDoc, type PageEntry } from "@/store/editor";
 import { textStore } from "@/store/text";
 import { Thumbnail } from "../Thumbnail";
+import { ICON } from "../../ui/icon";
+import { BACKDROP, BTN_DANGER, BTN_PRIMARY, BTN_QUIET, DIALOG, DIALOG_TITLE } from "../../ui/styles";
 import { pickPdf } from "./importPdf";
 
 const THUMB = 104;
@@ -22,13 +25,13 @@ function Tile({ entry, index, checked, onToggle }: { entry: PageEntry; index: nu
       {...attributes} {...listeners} data-testid="manage-page" data-page-key={entry.pageKey} aria-pressed={checked}
       onClick={(e) => onToggle(e.shiftKey)}
       onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(e.shiftKey); } }}
-      className={`relative flex cursor-pointer flex-col items-center gap-1 rounded-lg p-2 ${checked ? "bg-accent/10 ring-2 ring-accent" : "hover:bg-bg"}`}>
+      className={`relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-2 transition-colors ${checked ? "bg-accent/15 ring-2 ring-inset ring-accent" : "hover:bg-hover"}`}>
       <div className="grid place-items-center" style={{ width: THUMB, height: THUMB * 1.42 }}>
         <Thumbnail entry={entry} geom={pageGeom(entry, info)} width={THUMB} />
       </div>
       <input type="checkbox" readOnly checked={checked} aria-label={t.pages.pageN(index + 1)} tabIndex={-1}
-        className="pointer-events-none absolute left-3 top-3 h-4 w-4 accent-[var(--accent)]" />
-      <span className="text-xs text-muted">{index + 1}</span>
+        className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4" />
+      <span className={`text-2xs tabular-nums ${checked ? "font-medium text-accent-text" : "text-faint"}`}>{index + 1}</span>
     </div>
   );
 }
@@ -108,34 +111,33 @@ export function ManagePagesModal({ onClose }: { onClose: () => void }) {
     onClose();
   }
 
-  const btn = "rounded-md px-2.5 py-1.5 hover:bg-bg disabled:opacity-40";
   return (
-    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onPointerDown={close}>
+    <div className={`${BACKDROP} items-center`} onPointerDown={close}>
       <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t.pages.manage} data-testid="manage-pages"
         onPointerDown={(e) => e.stopPropagation()}
         onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") close(); }}
-        className="flex max-h-[85vh] w-[56rem] max-w-[95vw] flex-col gap-3 rounded-xl bg-surface p-4 text-sm shadow-xl outline-none ring-1 ring-line">
-        <div className="flex items-center gap-2">
-          <span className="font-medium">{t.pages.manage}</span>
-          <span className="text-xs text-muted">{t.pages.selected(keys.length, draft.pages.length)}</span>
+        className={`${DIALOG} max-h-[85vh] w-[56rem] max-w-[95vw]`}>
+        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
+          <span className={DIALOG_TITLE}>{t.pages.manage}</span>
+          <span className="text-xs tabular-nums text-faint">{t.pages.selected(keys.length, draft.pages.length)}</span>
           <div className="flex-1" />
-          <button className={btn} onClick={() => setSel(new Set(draft.pages.map((p) => p.pageKey)))}>{t.pages.selectAll}</button>
-          <button className={btn} disabled={none} onClick={() => setSel(new Set())}>{t.pages.selectNone}</button>
+          <button className={BTN_QUIET} onClick={() => setSel(new Set(draft.pages.map((p) => p.pageKey)))}>{t.pages.selectAll}</button>
+          <button className={BTN_QUIET} disabled={none} onClick={() => setSel(new Set())}>{t.pages.selectNone}</button>
         </div>
-        <div role="toolbar" aria-label={t.pages.actions} className="flex flex-wrap items-center gap-1 border-y border-line py-2">
-          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.rotatePages(d, keys, -90))}>⟲ {t.editor.rotateLeft}</button>
-          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.rotatePages(d, keys, 90))}>⟳ {t.editor.rotateRight}</button>
-          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.duplicatePages(d, keys))}>⧉ {t.pages.duplicateShort}</button>
-          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.shiftPages(d, keys, -1))}>◀ {t.pages.moveLeft}</button>
-          <button className={btn} disabled={none} onClick={() => setDraft((d) => P.shiftPages(d, keys, 1))}>{t.pages.moveRight} ▶</button>
-          <button className={`${btn} text-danger`} disabled={none || keys.length >= draft.pages.length}
-            onClick={() => { setDraft((d) => P.deletePages(d, keys)); setSel(new Set()); }}>🗑 {t.editor.delete}</button>
-          <span className="mx-1 h-5 w-px bg-line" />
-          <button className={btn} onClick={insertBlank}>＋ {t.pages.blank}</button>
-          <button className={btn} disabled={busy} onClick={() => void importFile()}>⇪ {busy ? t.pages.importing : t.pages.importPdf}</button>
+        <div role="toolbar" aria-label={t.pages.actions} className="flex flex-wrap items-center gap-0.5 border-y border-line bg-panel px-3 py-1.5">
+          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.rotatePages(d, keys, -90))}><RotateCcw {...ICON} />{t.editor.rotateLeft}</button>
+          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.rotatePages(d, keys, 90))}><RotateCw {...ICON} />{t.editor.rotateRight}</button>
+          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.duplicatePages(d, keys))}><CopyPlus {...ICON} />{t.pages.duplicateShort}</button>
+          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.shiftPages(d, keys, -1))}><ArrowLeft {...ICON} />{t.pages.moveLeft}</button>
+          <button className={BTN_QUIET} disabled={none} onClick={() => setDraft((d) => P.shiftPages(d, keys, 1))}>{t.pages.moveRight}<ArrowRight {...ICON} /></button>
+          <button className={BTN_DANGER} disabled={none || keys.length >= draft.pages.length}
+            onClick={() => { setDraft((d) => P.deletePages(d, keys)); setSel(new Set()); }}><Trash2 {...ICON} />{t.editor.delete}</button>
+          <span aria-hidden className="mx-1.5 h-5 w-px bg-line-strong" />
+          <button className={BTN_QUIET} onClick={insertBlank}><FilePlus2 {...ICON} />{t.pages.blank}</button>
+          <button className={BTN_QUIET} disabled={busy} onClick={() => void importFile()}><FileUp {...ICON} />{busy ? t.pages.importing : t.pages.importPdf}</button>
         </div>
-        {error && <p role="alert" className="text-danger">{error}</p>}
-        <div className="min-h-0 flex-1 overflow-y-auto">
+        {error && <p role="alert" className="px-4 pt-3 text-danger-text">{error}</p>}
+        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas/40 p-3">
           <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
             <SortableContext items={draft.pages.map((p) => p.pageKey)} strategy={rectSortingStrategy}>
               <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
@@ -146,9 +148,9 @@ export function ManagePagesModal({ onClose }: { onClose: () => void }) {
             </SortableContext>
           </DndContext>
         </div>
-        <div className="flex justify-end gap-2">
-          <button disabled={busy} onClick={close} className="rounded-lg px-4 py-2 hover:bg-bg disabled:opacity-40">{t.pages.cancel}</button>
-          <button disabled={busy} onClick={save} className="rounded-lg bg-accent px-4 py-2 text-accent-ink disabled:opacity-40">{t.pages.save}</button>
+        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
+          <button disabled={busy} onClick={close} className={BTN_QUIET}>{t.pages.cancel}</button>
+          <button disabled={busy} onClick={save} className={BTN_PRIMARY}>{t.pages.save}</button>
         </div>
       </div>
     </div>
```

The hidden link popover gets the new tokens too (it is not mounted, but must not reference removed colour names):

```diff
diff --git a/apps/web/src/components/editor/marks/LinkPopover.tsx b/apps/web/src/components/editor/marks/LinkPopover.tsx
index 1eea05d..4e057b3 100644
--- a/apps/web/src/components/editor/marks/LinkPopover.tsx
+++ b/apps/web/src/components/editor/marks/LinkPopover.tsx
@@ -53,11 +53,11 @@ function PopoverBody({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom
         const el = e.target as HTMLElement;
         if (e.key === "Enter" && (el.tagName === "INPUT" || el.tagName === "SELECT")) { e.preventDefault(); save(); }
       }}
-      className="absolute z-20 flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-lg ring-1 ring-line" style={{ left, top }}>
+      className="absolute z-20 flex flex-col gap-2 rounded-lg bg-raised p-3 shadow-pop" style={{ left, top }}>
       <span className="text-sm font-medium">{t.link.title}</span>
       <LinkTargetFields target={target} onChange={setTarget} autoFocus />
       <div className="flex justify-end gap-2 text-sm">
-        <button type="button" onClick={close} className="rounded-md px-3 py-1 hover:bg-bg">{t.link.cancel}</button>
+        <button type="button" onClick={close} className="rounded-md px-3 py-1 hover:bg-hover">{t.link.cancel}</button>
         <button type="button" onClick={save} disabled={!target} className="rounded-md bg-accent px-3 py-1 text-accent-ink disabled:opacity-50">{t.link.save}</button>
       </div>
     </div>
```

```diff
diff --git a/apps/web/src/components/editor/marks/LinkTargetFields.tsx b/apps/web/src/components/editor/marks/LinkTargetFields.tsx
index 9d2d9ea..e65dd2c 100644
--- a/apps/web/src/components/editor/marks/LinkTargetFields.tsx
+++ b/apps/web/src/components/editor/marks/LinkTargetFields.tsx
@@ -29,7 +29,7 @@ export function LinkTargetFields({ target, onChange, autoFocus = false }: {
         {(["url", "page"] as const).map((m) => (
           <button key={m} type="button" role="radio" aria-checked={mode === m}
             onClick={() => { setMode(m); onChange(m === "url" ? (normalizeUrl(url) ? { url: normalizeUrl(url)! } : null) : pageKey ? { pageKey } : null); }}
-            className={`px-2 py-1 ${mode === m ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>
+            className={`px-2 py-1 ${mode === m ? "bg-accent/10 text-accent" : "hover:bg-hover"}`}>
             {m === "url" ? t.link.toUrl : t.link.toPage}
           </button>
         ))}
@@ -40,7 +40,7 @@ export function LinkTargetFields({ target, onChange, autoFocus = false }: {
             onChange={(e) => typeUrl(e.target.value)}
             onBlur={() => setInvalid(url.trim() !== "" && normalizeUrl(url) === null)}
             className="w-56 rounded border border-line px-1.5 py-1 text-ink" />
-          {invalid && <span role="alert" className="text-danger">{t.link.invalidUrl}</span>}
+          {invalid && <span role="alert" className="text-danger-text">{t.link.invalidUrl}</span>}
         </>
       ) : (
         <select aria-label={t.link.page} value={pageKey} onChange={(e) => { if (e.target.value) onChange({ pageKey: e.target.value }); }}
```

- [ ] **Step 7: Properties bar controls, text properties, colour field**

```diff
diff --git a/apps/web/src/components/editor/PropertiesBar.tsx b/apps/web/src/components/editor/PropertiesBar.tsx
index 07d0149..2b3ae8c 100644
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -11,6 +11,7 @@ import { editorStore, sourcePage, useEditor, type MarkupTool, type ToolStyle } f
 import { srcKey } from "@/lib/sources";
 import { STAMP_COLORS } from "@/lib/stamps";
 import { ICON } from "../ui/icon";
+import { BTN_DANGER, FIELD, PROP_LABEL, swatch } from "../ui/styles";
 import { ColorField } from "./ColorField";
 import { textEditStore } from "./text/textEdit";
 
@@ -120,18 +121,18 @@ export function PropertiesBar() {
       {(kind === "shape" || kind === "line" || kind === "ink") && (
         <>
           <ColorField label={t.editor.color} value={stroke} onChange={(v) => set({ stroke: v })} />
-          <label className="flex items-center gap-1.5 text-xs text-muted">
+          <label className={PROP_LABEL}>
             {t.editor.strokeWidth}
             <input type="range" min={kind === "shape" ? 0 : 1} max={20} step={0.5} value={width} aria-label={t.editor.strokeWidth}
-              onChange={(e) => set({ width: Number(e.target.value) })} className="w-24 accent-[var(--accent)]" />
-            <span className="w-8 tabular-nums text-ink">{width}</span>
+              onChange={(e) => set({ width: Number(e.target.value) })} className="w-24" />
+            <span className="w-7 tabular-nums text-ink">{width}</span>
           </label>
         </>
       )}
       {(kind === "shape" || kind === "line") && (
-        <label className="flex items-center gap-1.5 text-xs text-muted">
+        <label className={PROP_LABEL}>
           {t.editor.dash}
-          <select value={dash} aria-label={t.editor.dash} onChange={(e) => setDash(e.target.value as Dash)} className="rounded border border-line px-1 py-0.5 text-ink">
+          <select value={dash} aria-label={t.editor.dash} onChange={(e) => setDash(e.target.value as Dash)} className={`${FIELD} h-7 pr-1`}>
             <option value="solid">{t.editor.dashSolid}</option>
             <option value="dashed">{t.editor.dashDashed}</option>
             <option value="dotted">{t.editor.dashDotted}</option>
@@ -140,7 +141,7 @@ export function PropertiesBar() {
       )}
       {kind === "shape" && (
         <div className="flex items-center gap-2">
-          <label className="flex items-center gap-1 text-xs text-muted">
+          <label className={PROP_LABEL}>
             <input type="checkbox" checked={fill === null} onChange={(e) => set({ fill: e.target.checked ? null : "#ffffff" })} />
             {t.editor.noFill}
           </label>
@@ -148,9 +149,9 @@ export function PropertiesBar() {
         </div>
       )}
       {kind === "redact" && o && (
-        <label className="flex items-center gap-1.5 text-xs text-muted">
+        <label className={PROP_LABEL}>
           {t.editor.fill}
-          <select value={o.fill as string} onChange={(e) => set({ redactFill: e.target.value as "black" | "white" })} className="rounded border border-line px-1 py-0.5 text-ink">
+          <select value={o.fill as string} onChange={(e) => set({ redactFill: e.target.value as "black" | "white" })} className={`${FIELD} h-7 pr-1`}>
             <option value="black">{t.editor.black}</option>
             <option value="white">{t.editor.white}</option>
           </select>
@@ -160,32 +161,32 @@ export function PropertiesBar() {
         <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.markup[tool as MarkupTool] ?? style.markup.highlight}
           onChange={(v) => setColor(v)} />
       )}
-      {kind === "markup" && noText && <span className="text-xs text-muted">{t.annot.noText}</span>}
+      {kind === "markup" && noText && <span className="text-xs text-warn">{t.annot.noText}</span>}
       {kind === "symbol" && <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.symbolColor} onChange={setColor} />}
       {kind === "stamp" && o && (
-        <div role="radiogroup" aria-label={t.editor.color} className="flex items-center gap-1">
+        <div role="radiogroup" aria-label={t.editor.color} className="flex items-center gap-1.5">
           {STAMP_COLORS.map((c) => (
             <button key={c} role="radio" aria-checked={o.color === c} aria-label={`${t.editor.color} ${c}`} onClick={() => setColor(c)}
-              className={`h-5 w-5 rounded-full ring-1 ring-line ${o.color === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
+              className={swatch(o.color === c)} style={{ background: c }} />
           ))}
         </div>
       )}
       {kind === "text" && textPropsSlot.render?.()}
       {showOpacity && (
-        <label className="flex items-center gap-1.5 text-xs text-muted">
+        <label className={PROP_LABEL}>
           {t.editor.opacity}
           <input type="range" min={0.1} max={1} step={0.05} value={opacity} aria-label={t.editor.opacity}
-            onChange={(e) => setOpacity(Number(e.target.value))} className="w-20 accent-[var(--accent)]" />
-          <span className="w-9 tabular-nums text-ink">{Math.round(opacity * 100)}%</span>
+            onChange={(e) => setOpacity(Number(e.target.value))} className="w-20" />
+          <span className="w-8 tabular-nums text-ink">{Math.round(opacity * 100)}%</span>
         </label>
       )}
-      {kind === "text" && scanned && <span className="text-xs text-muted">{t.text.scanned}</span>}
+      {kind === "text" && scanned && <span className="text-xs text-warn">{t.text.scanned}</span>}
       {selection && (
         // Deleting a text.edit op brings the original paragraph back.
         <>
           <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
           <button onClick={() => s.deleteObject(selection)} aria-label={op?.type === "text.edit" ? t.text.revert : t.editor.delete}
-            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-danger-text hover:bg-danger/15">
+            className={BTN_DANGER}>
             {op?.type === "text.edit" ? <Undo2 {...ICON} /> : <Trash2 {...ICON} />}
             {op?.type === "text.edit" ? t.text.revert : t.editor.delete}
           </button>
```

```diff
diff --git a/apps/web/src/components/editor/ColorField.tsx b/apps/web/src/components/editor/ColorField.tsx
index 92eeb77..a64e0e8 100644
--- a/apps/web/src/components/editor/ColorField.tsx
+++ b/apps/web/src/components/editor/ColorField.tsx
@@ -1,16 +1,22 @@
 "use client";
 
+import { PROP_LABEL, swatch } from "../ui/styles";
+
 const SWATCHES = ["#111111", "#ffffff", "#e11d48", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];
 
-export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
+/** A colour chip (the native picker) plus, on wide screens and unless `compact`, a few swatches. */
+export function ColorField({ label, value, onChange, compact = false }: { label: string; value: string; onChange: (v: string) => void; compact?: boolean }) {
   return (
-    <label className="flex items-center gap-1.5 text-xs text-muted">
+    <label className={PROP_LABEL}>
       {label}
-      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-8 cursor-pointer rounded border border-line bg-transparent p-0.5" />
-      <span className="hidden gap-0.5 xl:flex">
+      <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-line-strong" style={{ background: value }}>
+        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
+          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
+      </span>
+      <span className={compact ? "hidden" : "hidden gap-1 xl:flex"}>
         {SWATCHES.map((c) => (
           <button key={c} type="button" aria-label={`${label} ${c}`} onClick={() => onChange(c)}
-            className={`h-4 w-4 rounded-full ring-1 ring-line ${value.toLowerCase() === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
+            className={swatch(value.toLowerCase() === c)} style={{ background: c }} />
         ))}
       </span>
     </label>
```

```diff
diff --git a/apps/web/src/components/editor/text/TextProps.tsx b/apps/web/src/components/editor/text/TextProps.tsx
index f17ccd2..cb554d1 100644
--- a/apps/web/src/components/editor/text/TextProps.tsx
+++ b/apps/web/src/components/editor/text/TextProps.tsx
@@ -1,5 +1,6 @@
 "use client";
 
+import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Ban, Bold, Italic, Strikethrough, TriangleAlert, Underline } from "lucide-react";
 import { useEffect, useState } from "react";
 import { useStore } from "zustand";
 import type { TextAdd } from "@edith/ops";
@@ -11,6 +12,8 @@ import { t } from "@/lib/strings";
 import { boxFonts, relayout, withStyle, type BoxPatch } from "@/lib/textbox";
 import { editorStore, useEditor, type ToolStyle } from "@/store/editor";
 import { textStore, useText } from "@/store/text";
+import { ICON, ICON_SM } from "../../ui/icon";
+import { FIELD, toggle } from "../../ui/styles";
 import { ColorField } from "../ColorField";
 import { useOverflow } from "./useOverflow";
 import { session, textEditStore } from "./textEdit";
@@ -62,7 +65,7 @@ function applyToSession(patch: BoxPatch) {
 }
 
 const ALIGNS = ["left", "center", "right", "justify"] as const;
-const ALIGN_ICON = { left: "⇤", center: "↔", right: "⇥", justify: "☰" } as const;
+const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const;
 
 function toolAttrs(s: ToolStyle): RunAttrs {
   return { font: { kind: "bundled", family: s.fontFamily, bold: s.bold, italic: s.italic }, size: s.fontSize, color: s.color, bgColor: null, underline: false, strike: false };
@@ -79,7 +82,7 @@ function SizeField({ value, onChange }: { value: number; onChange: (v: number) =
         if (e.target.value !== "" && v >= 4 && v <= 200) onChange(v);
       }}
       onBlur={() => setDraft(null)}
-      className="w-16 rounded border border-line px-1 py-1" />
+      className={`${FIELD} w-16 pr-1 tabular-nums`} />
   );
 }
 
@@ -114,37 +117,40 @@ export function TextProps() {
     else void applyToSelected(patch);
   }
 
-  const toggle = (on: boolean) => `h-8 w-8 rounded-md ${on ? "bg-accent/10 text-accent" : "hover:bg-bg"}`;
   const alignLabel = { left: t.editor.alignLeft, center: t.editor.alignCenter, right: t.editor.alignRight, justify: t.text.alignJustify };
   const original = fs.original ? fonts[fs.original] : undefined;
   return (
     <div
       data-text-props
-      className="flex flex-wrap items-center gap-2"
+      className="flex items-center gap-1.5"
       // Keep focus in the rich editor for buttons (a select/input takes focus; the session stays open).
       onMouseDown={(e) => { const tag = (e.target as HTMLElement).tagName; if (tag !== "SELECT" && tag !== "INPUT") e.preventDefault(); }}
     >
       <select aria-label={t.editor.font} value={original ? `orig:${original.ref}` : fs.family}
         onChange={(e) => { if (!e.target.value.startsWith("orig:")) set({ family: e.target.value }); }}
-        className="max-w-40 rounded border border-line px-1 py-1">
+        className={`${FIELD} max-w-44 pr-1`}>
         {original && <option value={`orig:${original.ref}`}>{t.text.originalFont(original.name)}</option>}
         {families.map((f) => <option key={f} value={f}>{f}</option>)}
       </select>
       <SizeField value={attrs.size} onChange={(v) => set({ size: v })} />
-      <button type="button" aria-label={t.editor.bold} aria-pressed={fs.bold} className={`${toggle(fs.bold)} font-bold`} onClick={() => set({ bold: !fs.bold })}>B</button>
-      <button type="button" aria-label={t.editor.italic} aria-pressed={fs.italic} className={`${toggle(fs.italic)} italic`} onClick={() => set({ italic: !fs.italic })}>I</button>
-      <button type="button" aria-label={t.text.underline} aria-pressed={attrs.underline} className={`${toggle(attrs.underline)} underline`} onClick={() => set({ underline: !attrs.underline })}>U</button>
-      <button type="button" aria-label={t.text.strike} aria-pressed={attrs.strike} className={`${toggle(attrs.strike)} line-through`} onClick={() => set({ strike: !attrs.strike })}>S</button>
-      <ColorField label={t.editor.color} value={attrs.color} onChange={(v) => set({ color: v })} />
-      <ColorField label={t.text.background} value={attrs.bgColor ?? "#ffff00"} onChange={(v) => set({ bgColor: v })} />
+      <button type="button" aria-label={t.editor.bold} aria-pressed={fs.bold} className={toggle(fs.bold)} onClick={() => set({ bold: !fs.bold })}><Bold {...ICON} /></button>
+      <button type="button" aria-label={t.editor.italic} aria-pressed={fs.italic} className={toggle(fs.italic)} onClick={() => set({ italic: !fs.italic })}><Italic {...ICON} /></button>
+      <button type="button" aria-label={t.text.underline} aria-pressed={attrs.underline} className={toggle(attrs.underline)} onClick={() => set({ underline: !attrs.underline })}><Underline {...ICON} /></button>
+      <button type="button" aria-label={t.text.strike} aria-pressed={attrs.strike} className={toggle(attrs.strike)} onClick={() => set({ strike: !attrs.strike })}><Strikethrough {...ICON} /></button>
+      <ColorField compact label={t.editor.color} value={attrs.color} onChange={(v) => set({ color: v })} />
+      <ColorField compact label={t.text.background} value={attrs.bgColor ?? "#ffff00"} onChange={(v) => set({ bgColor: v })} />
       <button type="button" aria-label={t.text.noBackground} aria-pressed={attrs.bgColor === null} className={toggle(attrs.bgColor === null)}
-        onClick={() => set({ bgColor: null })}>⌀</button>
-      {ALIGNS.map((a) => (
-        <button key={a} type="button" aria-label={alignLabel[a]} aria-pressed={align === a}
-          className={toggle(align === a)} onClick={() => set({ align: a })}>{ALIGN_ICON[a]}</button>
-      ))}
-      {unsupported && <span role="status" className="text-xs text-danger">⚠ {t.text.unsupported}</span>}
-      {overflow && <span role="status" className="text-xs text-[#ea580c]">⚠ {t.text.overflow}</span>}
+        onClick={() => set({ bgColor: null })}><Ban {...ICON} /></button>
+      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
+      {ALIGNS.map((a) => {
+        const Icon = ALIGN_ICON[a];
+        return (
+          <button key={a} type="button" aria-label={alignLabel[a]} aria-pressed={align === a}
+            className={toggle(align === a)} onClick={() => set({ align: a })}><Icon {...ICON} /></button>
+        );
+      })}
+      {unsupported && <span role="status" className="flex items-center gap-1 text-xs text-danger-text"><TriangleAlert {...ICON_SM} />{t.text.unsupported}</span>}
+      {overflow && <span role="status" className="flex items-center gap-1 text-xs text-warn"><TriangleAlert {...ICON_SM} />{t.text.overflow}</span>}
     </div>
   );
 }
```

- [ ] **Step 8: Colours drawn on the canvas**

```diff
diff --git a/apps/web/src/components/editor/PageOverlay.tsx b/apps/web/src/components/editor/PageOverlay.tsx
index a9d5efb..f9e0348 100644
--- a/apps/web/src/components/editor/PageOverlay.tsx
+++ b/apps/web/src/components/editor/PageOverlay.tsx
@@ -19,6 +19,7 @@ import { markupFromDrag, onMarkableText } from "./marks/markupTool";
 import { ObjectShape } from "./ObjectShape";
 import { usePolyTool } from "./shapes/usePolyTool";
 import { textEditStore } from "./text/textEdit";
+import { CANVAS } from "@/lib/theme";
 
 type TextOp = TextAdd | TextEdit;
 
@@ -301,8 +302,8 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
             enabledAnchors={selection && isTextOp(objects[selection])
               ? ["middle-left", "middle-right"]
               : ["top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right"]}
-            borderStroke="#0f766e"
-            anchorStroke="#0f766e"
+            borderStroke={CANVAS.accent}
+            anchorStroke={CANVAS.accent}
             anchorSize={8}
           />
         </Layer>
```

```diff
diff --git a/apps/web/src/components/editor/marks/MarkupShape.tsx b/apps/web/src/components/editor/marks/MarkupShape.tsx
index acae0af..e6056f1 100644
--- a/apps/web/src/components/editor/marks/MarkupShape.tsx
+++ b/apps/web/src/components/editor/marks/MarkupShape.tsx
@@ -3,6 +3,7 @@
 import { Rect } from "react-konva";
 import type { AnnotAdd } from "@edith/ops";
 import { markupLine } from "@/lib/markup";
+import { CANVAS } from "@/lib/theme";
 
 /** Text markup as MuPDF draws it: a highlight fills each quad (its layer multiplies it over the page),
  *  underline/strike draw a line per quad (the whole quad stays clickable). */
@@ -19,7 +20,7 @@ export function MarkupShape({ op, selected = false }: { op: AnnotAdd; selected?:
         return <Rect key={`l${i}`} x={l.x} y={l.y} width={l.w} height={l.h} fill={op.color} listening={false} />;
       })}
       {selected && quads.map((q, i) => (
-        <Rect key={`s${i}`} x={q.x - 1} y={q.y - 1} width={q.w + 2} height={q.h + 2} stroke="#0f766e" strokeWidth={1}
+        <Rect key={`s${i}`} x={q.x - 1} y={q.y - 1} width={q.w + 2} height={q.h + 2} stroke={CANVAS.accent} strokeWidth={1}
           strokeScaleEnabled={false} dash={[4, 3]} listening={false} />
       ))}
     </>
```

```diff
diff --git a/apps/web/src/components/editor/text/ParagraphLayer.tsx b/apps/web/src/components/editor/text/ParagraphLayer.tsx
index 8460141..0287ea0 100644
--- a/apps/web/src/components/editor/text/ParagraphLayer.tsx
+++ b/apps/web/src/components/editor/text/ParagraphLayer.tsx
@@ -10,8 +10,9 @@ import { maskRects } from "@/lib/paragraphs";
 import { editorStore, useEditor } from "@/store/editor";
 import { paragraphsOf, useText } from "@/store/text";
 import { materializeParagraph, startParagraphEdit, textEditStore } from "./textEdit";
+import { CANVAS } from "@/lib/theme";
 
-const OUTLINE = "#0f766e";
+const OUTLINE = CANVAS.accent;
 /** Screen pixels the pointer must move before a press on the selected paragraph becomes a drag. */
 const DRAG_DISTANCE = 3;
```

```diff
diff --git a/apps/web/src/components/editor/text/TextEditor.tsx b/apps/web/src/components/editor/text/TextEditor.tsx
index 365f14c..80a6fbf 100644
--- a/apps/web/src/components/editor/text/TextEditor.tsx
+++ b/apps/web/src/components/editor/text/TextEditor.tsx
@@ -17,6 +17,7 @@ import { useEditor as useEditorStore } from "@/store/editor";
 import { isFindKey } from "../useShortcuts";
 import { createRunMark } from "./runMark";
 import { commitOpenSession, preloadSessionFonts, session, textEditStore, type Editing } from "./textEdit";
+import { CANVAS } from "@/lib/theme";
 
 export function TextEditor({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
   const editing = useStore(textEditStore, (s) => s.editing);
@@ -126,7 +127,7 @@ function RichArea({ editing, geom, scale }: { editing: Editing; geom: PageGeom;
         lineHeight: `${box.lineHeight * scale}px`, textAlign: box.align ?? "left",
         fontKerning: "none", fontVariantLigatures: "none", letterSpacing: 0,
         whiteSpace: "pre-wrap", overflowWrap: "break-word",
-        outline: "1px dashed #0f766e", background: editing.kind === "text.edit" ? "#ffffff" : "rgba(255,255,255,0.85)",
+        outline: `1px dashed ${CANVAS.accent}`, background: editing.kind === "text.edit" ? "#ffffff" : "rgba(255,255,255,0.85)",
       }}
     >
       <EditorContent editor={editor} />
```

```diff
diff --git a/apps/web/src/components/editor/text/TextNode.tsx b/apps/web/src/components/editor/text/TextNode.tsx
index c10aa12..e0fa04d 100644
--- a/apps/web/src/components/editor/text/TextNode.tsx
+++ b/apps/web/src/components/editor/text/TextNode.tsx
@@ -8,8 +8,9 @@ import { decorBands } from "@/lib/textDecor";
 import { boxFonts } from "@/lib/textbox";
 import { fontsReady } from "./textEdit";
 import { useOverflow } from "./useOverflow";
+import { CANVAS } from "@/lib/theme";
 
-const OVERFLOW = "#ea580c";
+const OVERFLOW = CANVAS.overflow;
 
 /** Draws a text box glyph-by-glyph at the PDF-quantized offsets — the same positions the API bakes —
  *  with backgrounds under and underline/strike over the glyphs, as the bake does. */
```

- [ ] **Step 9: Run the suites and look at it**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 309 passed, tsc/eslint clean.

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web`
Expected: 10 passed.

Check: `grep -rnE "bg-bg|bg-surface|#0f766e" apps/web/src/components` finds only `UploadDropzone.tsx` (Task 12) — no other component uses the legacy names or the old teal.

- [ ] **Step 10: Commit**

```bash
git checkout apps/web/tsconfig.json; rm -f apps/web/AGENTS.md
git add apps/web/src/components apps/web/src/lib/objectLabels.ts apps/web/src/lib/objectLabels.test.ts apps/web/src/lib/theme.ts
git commit -m "feat(web): dark panels, menus, dialogs, notices, find bar and canvas colours in the new design system" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
