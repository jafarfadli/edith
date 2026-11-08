# Task 10: Stamp picker (17 presets, custom text with date/time, 5 colors)

**Gambar▾** becomes a split button with two actions, *Unggah gambar* (the M1 image upload) and *Stamp*. `SplitButton` options may now be actions (`run`) instead of tools; Escape closes its menu (M1 backlog, Task 17). The **StampPicker** dialog places the chosen stamp in the middle of the page in view, selected; custom stamps take a text plus optional date (dd/mm/yyyy) and time (HH:MM) as of now, in one of the 5 stamp colors. A selected stamp's color is changed with the 5 swatches in the properties bar.

**Files:**
- Modify: `apps/web/src/components/editor/PropertiesBar.tsx`
- Modify: `apps/web/src/components/editor/SplitButton.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Create: `apps/web/src/components/editor/marks/StampPicker.tsx`
- Create: `apps/web/src/components/editor/placement.ts`
- Modify: `apps/web/src/lib/stamps.test.ts`
- Modify: `apps/web/src/lib/stamps.ts`

**Interfaces:**
- Consumes: Task 7 `STAMP_PRESETS`, `STAMP_COLORS`, `STAMP_FONT`, `stampRect`; M1 `fontStore.load`, `uploadAsset`, `fitImage`.
- Produces:
  - `lib/stamps.ts`: `stampDate(d) -> "dd/mm/yyyy"`, `stampTime(d) -> "HH:MM"`.
  - `components/editor/placement.ts`: `currentPage() -> {entry, geom} | null`, `placeObject(op)` (add + select tool + select) — also used by the image upload now and by Task 11.
  - `marks/StampPicker.tsx`: `placeStamp(kind, color)`, `StampPicker({onClose})` (dialog "Pilih stamp", tabs "Standar"/"Kustom", preset buttons named by their label, textbox "Teks stamp", button "Tambahkan stamp").
  - `SplitButton`: `SplitOption {tool?, key?, label, icon, run?}`, `onPick` optional.
  - PropertiesBar kind `"stamp"`.

- [ ] **Step 1: Write the failing tests**

Modify `apps/web/src/lib/stamps.test.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/stamps.test.ts
+++ b/apps/web/src/lib/stamps.test.ts
@@ -2,7 +2,7 @@ import { readFileSync } from "node:fs";
 import path from "node:path";
 import { describe, expect, it } from "vitest";
 import { metricsFromBuffer, textWidth } from "@/lib/fonts";
-import { borderWidth, STAMP_PRESETS, stampBorder, stampLayout, stampRect, stampTexts } from "@/lib/stamps";
+import { borderWidth, STAMP_PRESETS, stampBorder, stampDate, stampLayout, stampRect, stampTexts, stampTime } from "@/lib/stamps";
 
 const bold = metricsFromBuffer(readFileSync(path.resolve(__dirname, "../../../../packages/fonts/files/Arimo-Bold.ttf")));
 const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
@@ -44,4 +44,9 @@ describe("stamps", () => {
     expect(line.size).toBe(20); // the label is not shrunk
     expect(stampRect({ custom: { text: "OK", date: "05/11/2026" } }, bold, { width: 595, height: 842 }).h).toBe(54);
   });
+
+  it("formats the date and time lines", () => {
+    const d = new Date(2026, 10, 5, 9, 7);
+    expect([stampDate(d), stampTime(d)]).toEqual(["05/11/2026", "09:07"]);
+  });
 });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/web && npx vitest run src/lib/stamps.test.ts`
Expected: `Tests  1 failed | 5 passed (6)` — `stampDate is not a function`.

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/PropertiesBar.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -7,13 +7,14 @@ import { t } from "@/lib/strings";
 import { useChars } from "@/store/chars";
 import { editorStore, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
 import type { LinkTarget } from "@/lib/links";
+import { STAMP_COLORS } from "@/lib/stamps";
 import { ColorField } from "./ColorField";
 import { LinkTargetFields } from "./marks/LinkTargetFields";
 import { textEditStore } from "./text/textEdit";
 
 export const textPropsSlot: { render?: () => React.ReactNode } = {};
 
-type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | "symbol" | "note" | "link" | null;
+type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | "symbol" | "note" | "link" | "stamp" | null;
 
 function kindOf(op: ContentOp | undefined, tool: string): Kind {
   if (op) {
@@ -25,6 +26,7 @@ function kindOf(op: ContentOp | undefined, tool: string): Kind {
     if (op.type === "symbol.add") return "symbol";
     if (op.type === "annot.add") return "note";
     if (op.type === "link.add") return "link";
+    if (op.type === "stamp.add") return "stamp";
     return null;
   }
   if (MARKUP_TOOLS.has(tool)) return "markup";
@@ -138,6 +140,14 @@ export function PropertiesBar() {
         <LinkTargetFields key={o.id} target={o.target as LinkTarget}
           onChange={(target) => { if (target) s.updateObject(o.id, { target } as Partial<ContentOp>, { coalesce: `link:${o.id}` }); }} />
       )}
+      {kind === "stamp" && o && (
+        <div role="radiogroup" aria-label={t.editor.color} className="flex items-center gap-1">
+          {STAMP_COLORS.map((c) => (
+            <button key={c} role="radio" aria-checked={o.color === c} aria-label={`${t.editor.color} ${c}`} onClick={() => setColor(c)}
+              className={`h-5 w-5 rounded-full ring-1 ring-line ${o.color === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
+          ))}
+        </div>
+      )}
       {kind === "text" && textPropsSlot.render?.()}
       {kind === "text" && scanned && <span className="text-xs text-muted">{t.text.scanned}</span>}
       <div className="flex-1" />
```

Modify `apps/web/src/components/editor/SplitButton.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/SplitButton.tsx
+++ b/apps/web/src/components/editor/SplitButton.tsx
@@ -4,16 +4,20 @@ import { useEffect, useRef, useState } from "react";
 import { t } from "@/lib/strings";
 import type { Tool } from "@/store/editor";
 
-export interface SplitOption { tool: Tool; label: string; icon: string }
+/** A sub-tool (`tool`) or an action (`run`, e.g. "upload an image"); actions need a `key`. */
+export interface SplitOption { tool?: Tool; key?: string; label: string; icon: string; run?: () => void }
+
+const keyOf = (o: SplitOption) => o.tool ?? o.key ?? o.label;
 
 export function SplitButton({ label, options, active, onPick }: {
-  label: string; options: SplitOption[]; active: Tool; onPick: (t: Tool) => void;
+  label: string; options: SplitOption[]; active: Tool; onPick?: (t: Tool) => void;
 }) {
   const [memory, setMemory] = useState<SplitOption>(options[0]);
   const [open, setOpen] = useState(false);
   const ref = useRef<HTMLDivElement>(null);
-  const current = options.find((o) => o.tool === active) ?? memory;
-  const pressed = options.some((o) => o.tool === active);
+  const current = options.find((o) => o.tool !== undefined && o.tool === active) ?? memory;
+  const pressed = options.some((o) => o.tool !== undefined && o.tool === active);
+  const choose = (o: SplitOption) => { if (o.run) o.run(); else if (o.tool) onPick?.(o.tool); };
 
   useEffect(() => {
     if (!open) return;
@@ -24,17 +28,17 @@ export function SplitButton({ label, options, active, onPick }: {
   }, [open]);
 
   return (
-    <div ref={ref} className="relative flex">
-      <button aria-label={label} aria-pressed={pressed} title={`${label}: ${current.label}`} onClick={() => onPick(current.tool)}
+    <div ref={ref} className="relative flex" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}>
+      <button aria-label={label} aria-pressed={pressed} title={`${label}: ${current.label}`} onClick={() => choose(current)}
         className={`flex h-9 items-center gap-1 rounded-l-md px-2 text-sm ${pressed ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>
         <span aria-hidden>{current.icon}</span><span className="hidden lg:inline">{current.label}</span>
       </button>
       <button aria-label={`${label} ${t.editor.options}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
         className="h-9 rounded-r-md px-1 text-xs text-muted hover:bg-bg">▾</button>
       {open && (
-        <div role="menu" className="absolute left-0 top-10 z-30 w-40 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
+        <div role="menu" className="absolute left-0 top-10 z-30 w-44 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
           {options.map((o) => (
-            <button key={o.tool} role="menuitem" onClick={() => { setMemory(o); setOpen(false); onPick(o.tool); }}
+            <button key={keyOf(o)} role="menuitem" onClick={() => { setMemory(o); setOpen(false); choose(o); }}
               className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg">
               <span aria-hidden>{o.icon}</span>{o.label}
             </button>
```

Modify `apps/web/src/components/editor/Toolbar.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -1,12 +1,14 @@
 "use client";
 
-import { useRef } from "react";
+import { useRef, useState } from "react";
 import type { ContentOp } from "@edith/ops";
 import { ApiError, uploadAsset } from "@/lib/api";
 import { newId } from "@/lib/id";
 import { fitImage } from "@/lib/image";
 import { errorMessage, t } from "@/lib/strings";
-import { editorStore, pageGeom, useEditor, type Tool } from "@/store/editor";
+import { editorStore, useEditor, type Tool } from "@/store/editor";
+import { StampPicker } from "./marks/StampPicker";
+import { currentPage, placeObject } from "./placement";
 import { SplitButton } from "./SplitButton";
 import { afterTextCommitted } from "./text/textEdit";
 
@@ -27,21 +29,18 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
   const canUndo = useEditor((s) => s.past.length > 0);
   const canRedo = useEditor((s) => s.future.length > 0);
   const file = useRef<HTMLInputElement>(null);
+  const [stampOpen, setStampOpen] = useState(false);
   const s = editorStore.getState();
   const pick = (x: Tool) => s.setTool(x);
 
   async function addImage(f: File | undefined) {
     const st = editorStore.getState();
-    if (!f || !st.info) return;
-    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage) ?? st.doc.pages[0];
+    const at = currentPage();
+    if (!f || !st.info || !at) return;
     try {
       const asset = await uploadAsset(st.info.docId, f);
-      const g = pageGeom(entry, st.info);
-      const rect = fitImage(asset.width, asset.height, g.width, g.height);
-      const op = { id: newId(), type: "image.add", pageKey: entry.pageKey, rect, assetId: asset.asset_id } as ContentOp;
-      st.addObject(op);
-      st.setTool("select");
-      st.select(op.id);
+      const rect = fitImage(asset.width, asset.height, at.geom.width, at.geom.height);
+      placeObject({ id: newId(), type: "image.add", pageKey: at.entry.pageKey, rect, assetId: asset.asset_id } as ContentOp);
     } catch (e) {
       onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
     } finally {
@@ -66,9 +65,11 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
         { tool: "strike", label: t.annot.strike, icon: "S̶" },
       ]} />
       <ToolButton tool="ink" label={t.editor.draw} icon="✎" active={tool} />
-      <button aria-label={t.editor.image} title={t.editor.image} onClick={() => file.current?.click()} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
-        <span aria-hidden>🖼</span><span className="hidden lg:inline">{t.editor.image}</span>
-      </button>
+      <SplitButton label={t.editor.image} active={tool} options={[
+        { key: "upload", label: t.annot.uploadImage, icon: "🖼", run: () => file.current?.click() },
+        { key: "stamp", label: t.annot.stamp, icon: "🏷", run: () => setStampOpen(true) },
+      ]} />
+      {stampOpen && <StampPicker onClose={() => setStampOpen(false)} />}
       <input ref={file} type="file" accept="image/png,image/jpeg" hidden data-testid="image-input" onChange={(e) => addImage(e.target.files?.[0])} />
       <SplitButton label={t.editor.shape} active={tool} onPick={pick} options={[
         { tool: "rect", label: t.editor.rect, icon: "□" },
```

Create `apps/web/src/components/editor/marks/StampPicker.tsx`:
```tsx
"use client";

import { useState } from "react";
import type { StampAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { STAMP_COLORS, STAMP_FONT, STAMP_PRESETS, stampDate, stampRect, stampTime, type StampKind } from "@/lib/stamps";
import { t } from "@/lib/strings";
import { currentPage, placeObject } from "../placement";

/** Puts a stamp of `kind` in the middle of the page in view, selected. */
export async function placeStamp(kind: StampKind, color: string): Promise<void> {
  const metrics = await fontStore.load(STAMP_FONT);
  const at = currentPage();
  if (!at) return;
  const op: StampAdd = { id: newId(), type: "stamp.add", pageKey: at.entry.pageKey, rect: stampRect(kind, metrics, at.geom), color, ...kind };
  placeObject(op);
}

/** Stamp chooser: the 17 presets, or a custom text with optional date/time in one of 5 colors. */
export function StampPicker({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"presets" | "custom">("presets");
  const [text, setText] = useState("");
  const [withDate, setWithDate] = useState(true);
  const [withTime, setWithTime] = useState(false);
  const [color, setColor] = useState<string>(STAMP_COLORS[0]);

  function pick(kind: StampKind, c: string) {
    onClose();
    placeStamp(kind, c).catch((e) => console.warn("stamp: font load failed", e));
  }

  function addCustom() {
    if (!text.trim()) return;
    const now = new Date();
    pick({ custom: { text: text.trim(), date: withDate ? stampDate(now) : null, time: withTime ? stampTime(now) : null } }, color);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-24" onPointerDown={onClose}>
      <div role="dialog" aria-label={t.stamp.title} data-testid="stamp-picker" onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
        className="w-[34rem] rounded-xl bg-surface p-4 shadow-xl ring-1 ring-line">
        <div className="mb-3 flex items-center gap-2">
          <span className="font-medium">{t.stamp.title}</span>
          <div className="flex-1" />
          <div role="tablist" className="flex rounded-md ring-1 ring-line text-sm">
            {(["presets", "custom"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`px-3 py-1 ${tab === k ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>{k === "presets" ? t.stamp.presets : t.stamp.custom}</button>
            ))}
          </div>
          <button aria-label={t.editor.close} onClick={onClose} className="rounded-md px-2 py-1 hover:bg-bg">✕</button>
        </div>
        {tab === "presets" ? (
          <div className="grid grid-cols-3 gap-2">
            {STAMP_PRESETS.map((p) => (
              <button key={p.id} aria-label={p.label} onClick={() => pick({ preset: p.id }, p.color)}
                className="truncate rounded-md border-2 px-2 py-1.5 text-xs font-bold hover:bg-bg" style={{ borderColor: p.color, color: p.color }}>
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <input aria-label={t.stamp.text} value={text} maxLength={60} autoFocus onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
              className="rounded border border-line px-2 py-1.5 font-bold" style={{ color }} />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1"><input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />{t.stamp.date}</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} />{t.stamp.time}</label>
              <div className="flex-1" />
              <div role="radiogroup" aria-label={t.editor.color} className="flex gap-1">
                {STAMP_COLORS.map((c) => (
                  <button key={c} role="radio" aria-checked={color === c} aria-label={`${t.editor.color} ${c}`} onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded-full ring-1 ring-line ${color === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
                ))}
              </div>
            </div>
            <button onClick={addCustom} disabled={!text.trim()} className="self-end rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-50">{t.stamp.add}</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

Create `apps/web/src/components/editor/placement.ts`:
```ts
import type { ContentOp } from "@edith/ops";
import type { PageGeom } from "@/lib/coords";
import { editorStore, pageGeom, type PageEntry } from "@/store/editor";

/** The page in view (or the first one) and its geometry: where stamps, signatures and images go. */
export function currentPage(): { entry: PageEntry; geom: PageGeom } | null {
  const st = editorStore.getState();
  const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage) ?? st.doc.pages[0];
  if (!entry || !st.info) return null;
  return { entry, geom: pageGeom(entry, st.info) };
}

/** Adds `op` and selects it with the select tool (it can be moved/resized right away). */
export function placeObject(op: ContentOp): void {
  const st = editorStore.getState();
  st.addObject(op);
  st.setTool("select");
  st.select(op.id);
}
```

Modify `apps/web/src/lib/stamps.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/stamps.ts
+++ b/apps/web/src/lib/stamps.ts
@@ -80,3 +80,15 @@ export function stampRect(s: StampKind, m: FontMetrics, page: { width: number; h
   const w = Math.max(60, Math.max(...texts.map((t, i) => textWidth(t, m, i === 0 ? size : STAMP.subSize * h))) + pad + 1);
   return { x: (page.width - w) / 2, y: (page.height - h) / 2, w, h };
 }
+
+const pad2 = (n: number) => String(n).padStart(2, "0");
+
+/** Date line of a custom stamp, as drawn: dd/mm/yyyy. */
+export function stampDate(d: Date): string {
+  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
+}
+
+/** Time line part of a custom stamp, as drawn: HH:MM (24 h). */
+export function stampTime(d: Date): string {
+  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
+}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run src/lib/stamps.test.ts`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Full check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: `Tests  195 passed (195)`; tsc prints nothing; eslint reports no problems. API untouched (`cd apps/api && uv run pytest -q` still `295 passed`).

- [ ] **Step 6: Try it in the browser**

Dev app: **Gambar ▾ → Stamp → APPROVED**: a green stamp in the middle of the page, selected; resize it (text shrinks/grows with the height). **Kustom**: "DIPERIKSA", tick Jam, pick red, "Tambahkan stamp" → two-line stamp. Download and compare the stamp position in a PDF viewer.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/PropertiesBar.tsx apps/web/src/components/editor/SplitButton.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/marks/StampPicker.tsx apps/web/src/components/editor/placement.ts apps/web/src/lib/stamps.test.ts apps/web/src/lib/stamps.ts
git commit -m "feat(web): stamp picker with presets and custom stamps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
