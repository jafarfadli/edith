# Task 11: A one-line hint for the active tool, one-letter tool keys, colour popover

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions, **Design system**). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files and full rewrites are complete.

**Goal:** Owner feedback 3 showed that tools were not self-explanatory ("buat apa dan aku gak ngerti"). While a tool is active and nothing is selected, the floating properties bar starts with one short Indonesian sentence saying what to do with it (e.g. "Seret di halaman untuk menggambar persegi."). Pilih — the resting state — has no hint, so the bar stays hidden there. Design-app tool keys arrive too (no modifier, ignored in text fields): **V** Pilih, **H** Geser, **T** Teks, **E** Whiteout, **M** Stabilo, **P** Gambar bebas, **R** Persegi, **O** Elips, **L** Garis; tooltips and split-button menus show them as key caps (`aria-keyshortcuts` on the control, the caps are `aria-hidden` so accessible names stay "Persegi", not "Persegi R").

With the hint the bar is wider, so the seven inline colour swatches move into a popover behind the colour chip (one chip → swatches + "Warna lain…" native picker). Inside the text properties the popover keeps the rich-text session open (`data-text-props` + no focus steal), so recolouring a selected word works as before.

**Files:**
- Create: `apps/web/src/lib/toolKeys.ts`, `apps/web/src/lib/toolKeys.test.ts`, `apps/web/e2e/ui.spec.ts`
- Rewrite: `apps/web/src/components/editor/ColorField.tsx`
- Modify: `apps/web/src/lib/strings.ts` (`t.hints`, `t.editor.customColor`)
- Modify: `apps/web/src/components/editor/useShortcuts.ts`, `Toolbar.tsx`, `SplitButton.tsx`, `ZoomPill.tsx`, `PropertiesBar.tsx`, `text/TextProps.tsx`
- Modify: `apps/web/src/components/ui/Tooltip.tsx`, `apps/web/src/components/ui/IconButton.tsx`

**Interfaces:**
- Consumes: Task 9 `Tip`/`Kbd`/`IconButton`/`SplitOption.keys`, Task 10 `styles.ts`.
- Produces:
  - `TOOL_KEYS`, `toolForKey(e): Tool | null`, `toolKey(tool): string | undefined`, `toolHint(tool): string | null` in `lib/toolKeys.ts`.
  - `t.hints.{text, whiteout, redact, highlight, underline, strike, ink, rect, ellipse, line, arrow, points, check, cross, pan}`.
  - `ColorField({ label, value, onChange, textProps? })` (the Task 10 `compact` prop is gone); its popover is `role="dialog"` named after the label, swatches keep their names (`"Warna #e11d48"`), the native input is `"Warna Warna lain…"`.
  - `data-testid="tool-hint"` on the hint.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { t } from "@/lib/strings";
import { TOOL_KEYS, toolForKey, toolHint } from "@/lib/toolKeys";

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("tool keys", () => {
  it("a letter picks its tool, either case", () => {
    expect(toolForKey(key("v"))).toBe("select");
    expect(toolForKey(key("T"))).toBe("text");
    expect(toolForKey(key("r"))).toBe("rect");
    expect(toolForKey(key("h"))).toBe("pan");
  });

  it("not with a modifier, and not for other keys", () => {
    expect(toolForKey(key("v", { metaKey: true }))).toBeNull();
    expect(toolForKey(key("t", { ctrlKey: true }))).toBeNull();
    expect(toolForKey(key("r", { altKey: true }))).toBeNull();
    expect(toolForKey(key("q"))).toBeNull();
    expect(toolForKey(key("Enter"))).toBeNull();
  });

  it("every key is one letter and used once", () => {
    const keys = Object.values(TOOL_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[A-Z]$/);
  });
});

describe("toolHint", () => {
  it("one sentence for each tool that needs explaining", () => {
    expect(toolHint("text")).toBe(t.hints.text);
    expect(toolHint("rect")).toBe(t.hints.rect);
    expect(toolHint("polygon")).toBe(t.hints.points);
    expect(toolHint("cloud")).toBe(t.hints.points);
  });

  it("none for Pilih (the resting state) and the hidden note and link tools", () => {
    expect(toolHint("select")).toBeNull();
    expect(toolHint("note")).toBeNull();
    expect(toolHint("link")).toBeNull();
  });
});
```

```ts
import { expect, test } from "@playwright/test";
import path from "node:path";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

test("tool keys, the hint for the active tool, tooltips with shortcuts", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("page").first()).toBeVisible();
  const bar = page.getByTestId("properties-bar");
  const hint = page.getByTestId("tool-hint");

  // Pilih with nothing selected: no properties bar at all.
  await expect(bar).toHaveCount(0);

  // R picks Persegi: its hint and options appear; Escape goes back to Pilih and the bar goes away.
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "Bentuk", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toHaveText("Seret di halaman untuk menggambar persegi.");
  await expect(bar.getByRole("combobox", { name: "Gaya garis" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Pilih", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(bar).toHaveCount(0);

  // T: the text tool; letters typed into a field do not switch tools.
  await page.keyboard.press("t");
  await expect(hint).toContainText("Klik teks asli");
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Cari teks" }).fill("v");
  await expect(page.getByRole("button", { name: "Teks", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // A tooltip names the tool and its key.
  await page.getByRole("button", { name: "Pilih", exact: true }).hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Pilih");
  await expect(tip.locator("kbd")).toHaveText("V");
});

test("the colour popover recolours the word being edited and keeps the editor open", async ({ page }) => {
  await page.goto("/");
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "fixtures", "text.pdf"));
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!;
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 150, box.y + 110);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await editor.evaluate((el) => { // select "penting"
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf("penting");
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + 7);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(r);
      return;
    }
  });
  await page.getByTestId("properties-bar").getByRole("button", { name: "Warna", exact: true }).click();
  await page.getByRole("dialog", { name: "Warna" }).getByRole("button", { name: "Warna #e11d48" }).click();
  await expect(editor).toBeVisible();
  await expect(editor.locator("span[data-run]").filter({ hasText: /^penting$/ })).toHaveCSS("color", "rgb(225, 29, 72)");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/toolKeys.test.ts` (from `apps/web`)
Expected: FAIL — `Failed to resolve import "@/lib/toolKeys"`.

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web -- ui.spec.ts`
Expected: FAIL — `r` does not press Bentuk (`aria-pressed` is `"false"`).

- [ ] **Step 3: Tool keys and hints**

```ts
import { t } from "@/lib/strings";
import type { Tool } from "@/store/editor";

/** One-letter tool shortcuts (no modifier, outside text fields), shown in the tooltips. */
export const TOOL_KEYS = {
  select: "V", pan: "H", text: "T", whiteout: "E", highlight: "M", ink: "P", rect: "R", ellipse: "O", line: "L",
} as const satisfies Partial<Record<Tool, string>>;

const BY_KEY = new Map<string, Tool>(Object.entries(TOOL_KEYS).map(([tool, k]) => [k, tool as Tool]));

export function toolForKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): Tool | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return null;
  return BY_KEY.get(e.key.toUpperCase()) ?? null;
}

export function toolKey(tool: Tool): string | undefined {
  return (TOOL_KEYS as Partial<Record<Tool, string>>)[tool];
}

/** The one-line hint shown while `tool` is active; none for Pilih and for the hidden note and link tools. */
export function toolHint(tool: Tool): string | null {
  switch (tool) {
    case "select": case "note": case "link": case "image": return null;
    case "polygon": case "polyline": case "cloud": return t.hints.points;
    default: return t.hints[tool];
  }
}
```

```diff
diff --git a/apps/web/src/lib/strings.ts b/apps/web/src/lib/strings.ts
index f281929..ef96097 100644
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -69,6 +69,7 @@ export const t = {
     dashDashed: "Putus-putus",
     dashDotted: "Titik-titik",
     opacity: "Opasitas",
+    customColor: "Warna lain…",
   },
   text: {
     underline: "Garis bawah",
@@ -122,6 +123,24 @@ export const t = {
     cancel: "Batal",
     save: "Simpan",
   },
+  /** One sentence under the toolbar while a tool is active. */
+  hints: {
+    text: "Klik teks asli untuk mengeditnya, atau klik area kosong untuk menambah teks baru.",
+    whiteout: "Seret untuk menutup bagian halaman dengan kotak putih.",
+    redact: "Seret di atas isi yang ingin dihapus permanen dari PDF.",
+    highlight: "Seret di atas teks untuk menandainya dengan stabilo.",
+    underline: "Seret di atas teks untuk memberinya garis bawah.",
+    strike: "Seret di atas teks untuk mencoretnya.",
+    ink: "Seret untuk menggambar bebas di halaman.",
+    rect: "Seret di halaman untuk menggambar persegi.",
+    ellipse: "Seret di halaman untuk menggambar elips.",
+    line: "Seret di halaman untuk menggambar garis.",
+    arrow: "Seret di halaman untuk menggambar panah.",
+    points: "Klik untuk menaruh titik; klik titik pertama, klik dua kali atau Enter untuk selesai.",
+    check: "Klik di halaman untuk menaruh tanda centang.",
+    cross: "Klik di halaman untuk menaruh tanda silang.",
+    pan: "Seret untuk menggeser halaman.",
+  },
   objectKinds: {
     text: "Teks", textEdit: "Teks diedit", image: "Gambar", signature: "Tanda tangan", ink: "Gambar bebas",
     whiteout: "Whiteout", redact: "Redaksi", stamp: "Stamp", check: "Centang", cross: "Silang", link: "Link", note: "Catatan",
```

```diff
diff --git a/apps/web/src/components/editor/useShortcuts.ts b/apps/web/src/components/editor/useShortcuts.ts
index 623175d..90f1c8d 100644
--- a/apps/web/src/components/editor/useShortcuts.ts
+++ b/apps/web/src/components/editor/useShortcuts.ts
@@ -1,6 +1,7 @@
 "use client";
 
 import { useEffect } from "react";
+import { toolForKey } from "@/lib/toolKeys";
 import { editorStore } from "@/store/editor";
 import { openFind } from "./find/findStore";
 import { copySelection, duplicateSelection, pasteClipboard } from "./objects/clipboard";
@@ -45,6 +46,7 @@ export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
       else if (mod && k === "d" && !e.shiftKey && !e.altKey) { e.preventDefault(); duplicateSelection(); } // not the bookmark dialog
       else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) { e.preventDefault(); s.deleteObject(s.selection); }
       else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); }
+      else if (!e.repeat && toolForKey(e)) { e.preventDefault(); s.setTool(toolForKey(e)!); } // V, T, R …: see TOOL_KEYS
     }
     window.addEventListener("keydown", onKey);
     return () => window.removeEventListener("keydown", onKey);
```

- [ ] **Step 4: Key caps in tooltips and menus (names unchanged)**

```diff
diff --git a/apps/web/src/components/ui/Tooltip.tsx b/apps/web/src/components/ui/Tooltip.tsx
index 2831ebb..2a46def 100644
--- a/apps/web/src/components/ui/Tooltip.tsx
+++ b/apps/web/src/components/ui/Tooltip.tsx
@@ -8,10 +8,11 @@ import { formatKeys, isMac } from "@/lib/keys";
 const HOVER_DELAY_MS = 500;
 const EDGE = 8;
 
+/** Key caps of a shortcut (hidden from assistive tech: the control carries `aria-keyshortcuts`). */
 export function Kbd({ keys }: { keys: string }) {
   const mac = isMac();
   return (
-    <span className="flex gap-0.5">
+    <span aria-hidden className="flex gap-0.5">
       {formatKeys(keys, mac).map((k, i) => (
         <kbd key={i} className="min-w-4 rounded-sm bg-hover px-1 text-center font-mono text-2xs leading-4 text-muted">{k}</kbd>
       ))}
```

```diff
diff --git a/apps/web/src/components/ui/IconButton.tsx b/apps/web/src/components/ui/IconButton.tsx
index 9e194b3..e2d243e 100644
--- a/apps/web/src/components/ui/IconButton.tsx
+++ b/apps/web/src/components/ui/IconButton.tsx
@@ -10,7 +10,7 @@ export function IconButton({ label, icon: Icon, keys, pressed, disabled, onClick
 }) {
   return (
     <Tip label={label} keys={keys}>
-      <button aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}
+      <button aria-label={label} aria-pressed={pressed} aria-keyshortcuts={keys?.replace("Mod", "Control")} disabled={disabled} onClick={onClick}
         className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:text-faint/60 ${pressed ? "bg-accent/20 text-accent-text" : "text-muted hover:bg-hover hover:text-ink"}`}>
         <Icon {...ICON} />
       </button>
```

```diff
diff --git a/apps/web/src/components/editor/SplitButton.tsx b/apps/web/src/components/editor/SplitButton.tsx
index 0b361b0..c325649 100644
--- a/apps/web/src/components/editor/SplitButton.tsx
+++ b/apps/web/src/components/editor/SplitButton.tsx
@@ -57,7 +57,7 @@ export function SplitButton({ label, options, active, onPick }: {
   return (
     <div ref={ref} className="flex shrink-0 items-center" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setAt(null); } }}>
       <Tip label={`${label}: ${current.label}`} keys={current.keys}>
-        <button aria-label={label} aria-pressed={pressed} onClick={() => choose(current)}
+        <button aria-label={label} aria-pressed={pressed} aria-keyshortcuts={current.keys} onClick={() => choose(current)}
           className={`grid h-8 w-8 place-items-center rounded-l-md transition-colors ${tone}`}>
           <Icon {...ICON} />
         </button>
@@ -74,7 +74,7 @@ export function SplitButton({ label, options, active, onPick }: {
             const OptIcon = o.icon;
             const on = o.tool !== undefined && o.tool === active;
             return (
-              <button key={keyOf(o)} role="menuitem" onClick={() => { setMemory(o); setAt(null); choose(o); }}
+              <button key={keyOf(o)} role="menuitem" aria-keyshortcuts={o.keys} onClick={() => { setMemory(o); setAt(null); choose(o); }}
                 className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-hover ${on ? "text-accent-text" : "text-ink"}`}>
                 <OptIcon {...ICON} />
                 <span className="flex-1">{o.label}</span>
```

```diff
diff --git a/apps/web/src/components/editor/Toolbar.tsx b/apps/web/src/components/editor/Toolbar.tsx
index bb5c582..a183280 100644
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -10,6 +10,7 @@ import { ApiError, uploadAsset } from "@/lib/api";
 import { newId } from "@/lib/id";
 import { fitImage } from "@/lib/image";
 import { errorMessage, t } from "@/lib/strings";
+import { toolKey } from "@/lib/toolKeys";
 import { editorStore, useEditor, type Tool } from "@/store/editor";
 import { IconButton } from "../ui/IconButton";
 import { SignatureModal } from "./marks/SignatureModal";
@@ -23,7 +24,7 @@ import { afterTextCommitted } from "./text/textEdit";
 type NoticeFn = (n: { kind: "error" | "info"; text: string }) => void;
 
 function ToolButton({ tool, label, icon, active }: { tool: Tool; label: string; icon: LucideIcon; active: Tool }) {
-  return <IconButton label={label} icon={icon} pressed={active === tool} onClick={() => editorStore.getState().setTool(tool)} />;
+  return <IconButton label={label} icon={icon} keys={toolKey(tool)} pressed={active === tool} onClick={() => editorStore.getState().setTool(tool)} />;
 }
 
 const Sep = () => <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />;
@@ -62,20 +63,20 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
         <ToolButton tool="select" label={t.editor.select} icon={MousePointer2} active={tool} />
         <ToolButton tool="text" label={t.editor.text} icon={Type} active={tool} />
         <SplitButton label={t.editor.erase} active={tool} onPick={pick} options={[
-          { tool: "whiteout", label: t.editor.whiteout, icon: Eraser },
+          { tool: "whiteout", label: t.editor.whiteout, icon: Eraser, keys: toolKey("whiteout") },
           { tool: "redact", label: t.editor.redact, icon: EyeOff },
         ]} />
         <Sep />
         <SplitButton label={t.annot.markup} active={tool} onPick={pick} options={[
-          { tool: "highlight", label: t.annot.highlight, icon: Highlighter },
+          { tool: "highlight", label: t.annot.highlight, icon: Highlighter, keys: toolKey("highlight") },
           { tool: "underline", label: t.annot.underline, icon: Underline },
           { tool: "strike", label: t.annot.strike, icon: Strikethrough },
         ]} />
         <ToolButton tool="ink" label={t.editor.draw} icon={Pencil} active={tool} />
         <SplitButton label={t.editor.shape} active={tool} onPick={pick} options={[
-          { tool: "rect", label: t.editor.rect, icon: Square },
-          { tool: "ellipse", label: t.editor.ellipse, icon: Circle },
-          { tool: "line", label: t.editor.line, icon: Slash },
+          { tool: "rect", label: t.editor.rect, icon: Square, keys: toolKey("rect") },
+          { tool: "ellipse", label: t.editor.ellipse, icon: Circle, keys: toolKey("ellipse") },
+          { tool: "line", label: t.editor.line, icon: Slash, keys: toolKey("line") },
           { tool: "arrow", label: t.editor.arrow, icon: ArrowUpRight },
           { tool: "polygon", label: t.editor.polygon, icon: Pentagon },
           { tool: "polyline", label: t.editor.polyline, icon: Spline },
```

```diff
diff --git a/apps/web/src/components/editor/ZoomPill.tsx b/apps/web/src/components/editor/ZoomPill.tsx
index fec1ca3..73b7b21 100644
--- a/apps/web/src/components/editor/ZoomPill.tsx
+++ b/apps/web/src/components/editor/ZoomPill.tsx
@@ -3,7 +3,9 @@
 import { ChevronLeft, ChevronRight, Hand, Minus, Plus } from "lucide-react";
 import { t } from "@/lib/strings";
 import { editorStore, useEditor } from "@/store/editor";
+import { toolKey } from "@/lib/toolKeys";
 import { ICON } from "../ui/icon";
+import { Tip } from "../ui/Tooltip";
 
 export function scrollToPage(pageKey: string) {
   // The page itself, not its thumbnail (which carries the same data-page-key and comes first in the DOM).
@@ -31,8 +33,10 @@ export function ZoomPill() {
       <span className="min-w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
       <button className={btn} onClick={() => s.setZoom(Math.round((zoom + 0.1) * 10) / 10)} aria-label={t.editor.zoomIn}><Plus {...ICON} /></button>
       <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />
-      <button className={`${btn} ${tool === "pan" ? "bg-accent/20 text-accent-text" : ""}`} onClick={() => s.setTool(tool === "pan" ? "select" : "pan")}
-        aria-label={t.editor.pan} aria-pressed={tool === "pan"}><Hand {...ICON} /></button>
+      <Tip label={t.editor.pan} keys={toolKey("pan")} side="top">
+        <button className={`${btn} ${tool === "pan" ? "bg-accent/20 text-accent-text" : ""}`} onClick={() => s.setTool(tool === "pan" ? "select" : "pan")}
+          aria-label={t.editor.pan} aria-pressed={tool === "pan"}><Hand {...ICON} /></button>
+      </Tip>
     </div>
   );
 }
```

- [ ] **Step 5: The hint in the properties bar; colour popover**

```diff
diff --git a/apps/web/src/components/editor/PropertiesBar.tsx b/apps/web/src/components/editor/PropertiesBar.tsx
index 2b3ae8c..a03244d 100644
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -1,7 +1,7 @@
 "use client";
 
 import type { ContentOp } from "@edith/ops";
-import { Trash2, Undo2 } from "lucide-react";
+import { Info, Trash2, Undo2 } from "lucide-react";
 import { useStore } from "zustand";
 import type { Dash } from "@/lib/geometry";
 import { hasOpacity, inkWidth, isMarkup, isTextOp, MARKUP_TOOLS, opacityOf, POLY_TOOLS } from "@/lib/objects";
@@ -9,8 +9,9 @@ import { t } from "@/lib/strings";
 import { useChars } from "@/store/chars";
 import { editorStore, sourcePage, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
 import { srcKey } from "@/lib/sources";
+import { toolHint } from "@/lib/toolKeys";
 import { STAMP_COLORS } from "@/lib/stamps";
-import { ICON } from "../ui/icon";
+import { ICON, ICON_SM } from "../ui/icon";
 import { BTN_DANGER, FIELD, PROP_LABEL, swatch } from "../ui/styles";
 import { ColorField } from "./ColorField";
 import { textEditStore } from "./text/textEdit";
@@ -110,21 +111,24 @@ export function PropertiesBar() {
     }
   }
 
-  // Hidden when it would be empty (Pilih with nothing selected, Whiteout, a tool without options).
-  const empty = !selection && !showOpacity && !scanned && !noText
+  // What the active tool does, while nothing is selected (with a selection the bar is about that object).
+  const hint = !selection && !editingText ? toolHint(tool) : null;
+  // Hidden when it would be empty (Pilih with nothing selected).
+  const empty = !hint && !selection && !showOpacity && !scanned && !noText
     && (kind === null || (kind === "redact" && !o) || (kind === "stamp" && !o) || (kind === "text" && !editingText && !textPropsSlot.render));
   if (empty) return null;
 
   return (
     <div role="group" aria-label={t.editor.properties} data-testid="properties-bar"
       className="absolute left-1/2 top-3 z-30 flex h-10 max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-4 overflow-x-auto whitespace-nowrap rounded-lg bg-panel px-3 text-sm shadow-pop [scrollbar-width:none]">
+      {hint && <span data-testid="tool-hint" className="flex shrink-0 items-center gap-2 text-xs text-muted"><Info {...ICON_SM} className="text-accent-text" />{hint}</span>}
       {(kind === "shape" || kind === "line" || kind === "ink") && (
         <>
           <ColorField label={t.editor.color} value={stroke} onChange={(v) => set({ stroke: v })} />
           <label className={PROP_LABEL}>
             {t.editor.strokeWidth}
             <input type="range" min={kind === "shape" ? 0 : 1} max={20} step={0.5} value={width} aria-label={t.editor.strokeWidth}
-              onChange={(e) => set({ width: Number(e.target.value) })} className="w-24" />
+              onChange={(e) => set({ width: Number(e.target.value) })} className="w-20" />
             <span className="w-7 tabular-nums text-ink">{width}</span>
           </label>
         </>
@@ -132,7 +136,7 @@ export function PropertiesBar() {
       {(kind === "shape" || kind === "line") && (
         <label className={PROP_LABEL}>
           {t.editor.dash}
-          <select value={dash} aria-label={t.editor.dash} onChange={(e) => setDash(e.target.value as Dash)} className={`${FIELD} h-7 pr-1`}>
+          <select value={dash} aria-label={t.editor.dash} onChange={(e) => setDash(e.target.value as Dash)} className={`${FIELD} pr-1`}>
             <option value="solid">{t.editor.dashSolid}</option>
             <option value="dashed">{t.editor.dashDashed}</option>
             <option value="dotted">{t.editor.dashDotted}</option>
@@ -151,7 +155,7 @@ export function PropertiesBar() {
       {kind === "redact" && o && (
         <label className={PROP_LABEL}>
           {t.editor.fill}
-          <select value={o.fill as string} onChange={(e) => set({ redactFill: e.target.value as "black" | "white" })} className={`${FIELD} h-7 pr-1`}>
+          <select value={o.fill as string} onChange={(e) => set({ redactFill: e.target.value as "black" | "white" })} className={`${FIELD} pr-1`}>
             <option value="black">{t.editor.black}</option>
             <option value="white">{t.editor.white}</option>
           </select>
```

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/lib/strings";
import { POPOVER, PROP_LABEL, swatch } from "../ui/styles";

const SWATCHES = ["#111111", "#ffffff", "#e11d48", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];

/** A colour chip; pressing it opens a small popover with swatches and the browser's colour picker. The popover renders
 *  in a portal (the properties bar scrolls horizontally and would clip it). `textProps`: it belongs to the text properties,
 *  so pressing it keeps the rich-text session open and the editor focused. */
export function ColorField({ label, value, onChange, textProps = false }: {
  label: string; value: string; onChange: (v: string) => void; textProps?: boolean;
}) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !chip.current?.contains(target)) setAt(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setAt(null); chip.current?.focus(); } };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", onKey, true); };
  }, [open]);

  function toggle() {
    if (open) { setAt(null); return; }
    const r = chip.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 216)) });
  }

  return (
    <span className={PROP_LABEL}>
      {label}
      <button ref={chip} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}
        className="h-6 w-6 shrink-0 rounded-md ring-1 ring-inset ring-line-strong transition-shadow hover:ring-ink/40" style={{ background: value }} />
      {at && createPortal(
        <div ref={pop} role="dialog" aria-label={label} style={{ top: at.top, left: at.left }} data-text-props={textProps || undefined}
          onMouseDown={(e) => { if (textProps && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}
          className={`fixed z-50 flex w-52 flex-col gap-2.5 p-2.5 ${POPOVER}`}>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={`${label} ${c}`} onClick={() => onChange(c)}
                className={swatch(value.toLowerCase() === c)} style={{ background: c }} />
            ))}
          </div>
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs text-muted hover:bg-hover hover:text-ink">
            <input type="color" aria-label={`${label} ${t.editor.customColor}`} value={value} onChange={(e) => onChange(e.target.value)}
              className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0" />
            {t.editor.customColor}
            <span className="ml-auto font-mono uppercase text-faint">{value}</span>
          </label>
        </div>,
        document.body,
      )}
    </span>
  );
}
```

```diff
diff --git a/apps/web/src/components/editor/text/TextProps.tsx b/apps/web/src/components/editor/text/TextProps.tsx
index cb554d1..e3369a4 100644
--- a/apps/web/src/components/editor/text/TextProps.tsx
+++ b/apps/web/src/components/editor/text/TextProps.tsx
@@ -137,8 +137,8 @@ export function TextProps() {
       <button type="button" aria-label={t.editor.italic} aria-pressed={fs.italic} className={toggle(fs.italic)} onClick={() => set({ italic: !fs.italic })}><Italic {...ICON} /></button>
       <button type="button" aria-label={t.text.underline} aria-pressed={attrs.underline} className={toggle(attrs.underline)} onClick={() => set({ underline: !attrs.underline })}><Underline {...ICON} /></button>
       <button type="button" aria-label={t.text.strike} aria-pressed={attrs.strike} className={toggle(attrs.strike)} onClick={() => set({ strike: !attrs.strike })}><Strikethrough {...ICON} /></button>
-      <ColorField compact label={t.editor.color} value={attrs.color} onChange={(v) => set({ color: v })} />
-      <ColorField compact label={t.text.background} value={attrs.bgColor ?? "#ffff00"} onChange={(v) => set({ bgColor: v })} />
+      <ColorField textProps label={t.editor.color} value={attrs.color} onChange={(v) => set({ color: v })} />
+      <ColorField textProps label={t.text.background} value={attrs.bgColor ?? "#ffff00"} onChange={(v) => set({ bgColor: v })} />
       <button type="button" aria-label={t.text.noBackground} aria-pressed={attrs.bgColor === null} className={toggle(attrs.bgColor === null)}
         onClick={() => set({ bgColor: null })}><Ban {...ICON} /></button>
       <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
```

- [ ] **Step 6: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 314 passed (+5 toolKeys), tsc/eslint clean.

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web`
Expected: 12 passed (ui.spec adds 2). Note for anyone extending the E2E: a menu item's accessible name must not include its key caps — `getByRole("menuitem", { name: "Persegi", exact: true })` relies on it.

- [ ] **Step 7: Commit**

```bash
git checkout apps/web/tsconfig.json; rm -f apps/web/AGENTS.md
git add apps/web/src/lib/toolKeys.ts apps/web/src/lib/toolKeys.test.ts apps/web/e2e/ui.spec.ts apps/web/src/lib/strings.ts \
  apps/web/src/components/editor/useShortcuts.ts apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/SplitButton.tsx \
  apps/web/src/components/editor/ZoomPill.tsx apps/web/src/components/editor/PropertiesBar.tsx apps/web/src/components/editor/ColorField.tsx \
  apps/web/src/components/editor/text/TextProps.tsx apps/web/src/components/ui/Tooltip.tsx apps/web/src/components/ui/IconButton.tsx
git commit -m "feat(web): one-line hint for the active tool, one-letter tool keys in tooltips, colour popover" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
