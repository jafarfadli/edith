# Task 9: Check, cross, sticky note and link tools (Ctrl/Cmd+K)

Click tools: **Centang**/**Silang** place a 20 × 20 pt symbol centred on the click and stay active; **Catatan** places a note icon at the click, switches to Pilih and selects it — the properties bar shows (and focuses) its text field. **Link** (also Ctrl/Cmd+K) is dragged like a rect; on release the **LinkPopover** asks for a URL ("example.com" becomes `https://example.com`; only http/https/mailto) or a page of the document ("Halaman n"), then adds the `link.add` op. A selected link edits its target in the properties bar with the same fields.

**Files:**
- Modify: `apps/web/src/components/editor/Editor.tsx`
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`
- Modify: `apps/web/src/components/editor/PropertiesBar.tsx`
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Create: `apps/web/src/components/editor/marks/LinkPopover.tsx`
- Create: `apps/web/src/components/editor/marks/LinkTargetFields.tsx`
- Create: `apps/web/src/components/editor/marks/linkStore.ts`
- Modify: `apps/web/src/components/editor/useShortcuts.ts`
- Create: `apps/web/src/lib/links.test.ts`
- Create: `apps/web/src/lib/links.ts`
- Modify: `apps/web/src/lib/objects.ts`

**Interfaces:**
- Consumes: Task 6 `symbolAt`, `noteAt`, `style.symbolColor`, `style.noteColor`, strings; Task 7 rendering; M1 `normalizeRect`, `MIN_DRAG`, `beginDraw`.
- Produces:
  - `lib/links.ts`: `normalizeUrl(input) -> string | null`, `LinkTarget`, `isPageTarget(t)`.
  - `components/editor/marks/linkStore.ts`: `linkStore` (`pending: {pageKey, rect} | null`, `open`, `close`).
  - `marks/LinkTargetFields.tsx`: `LinkTargetFields({target, onChange(t | null), autoFocus?})` (radios "Ke URL"/"Ke halaman", textbox "Alamat web", combobox "Halaman tujuan").
  - `marks/LinkPopover.tsx`: `LinkPopover({pageKey, geom, scale})` (dialog "Tambah link", `data-testid="link-popover"`, button "Simpan link"), rendered per page by `Editor`'s overlay.
  - PropertiesBar kinds `"symbol"`, `"note"` (textbox "Isi catatan", typing coalesced per note), `"link"`; Toolbar buttons Centang, Silang, Catatan, Link; `useShortcuts`: Ctrl/Cmd+K → link tool, Escape also closes the popover.
  - `isMarkup` is now typed `op is AnnotAdd & {kind: "highlight"|"underline"|"strike"}` (a plain `op is AnnotAdd` would make TS drop notes from the false branch).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/links.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isPageTarget, normalizeUrl } from "@/lib/links";

describe("normalizeUrl", () => {
  it("keeps http, https and mailto URLs", () => {
    expect(normalizeUrl(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(normalizeUrl("http://x.y")).toBe("http://x.y");
    expect(normalizeUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
  });
  it("adds https:// to a bare host", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("www.example.co.id/path")).toBe("https://www.example.co.id/path");
  });
  it("rejects everything else", () => {
    for (const bad of ["", "javascript:alert(1)", "halo dunia", "a@b.co", "ftp://x.y", "https://a b"]) expect(normalizeUrl(bad)).toBeNull();
  });
  it("tells page targets from URLs", () => {
    expect(isPageTarget({ pageKey: "o1" })).toBe(true);
    expect(isPageTarget({ url: "https://a.b" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/web && npx vitest run src/lib/links.test.ts`
Expected: `Cannot find module '@/lib/links'`.

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Editor.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -32,6 +32,7 @@ const PageOverlay = dynamic(async () => {
 }, { ssr: false });
 const TextEditor = dynamic(() => import("./text/TextEditor").then((m) => m.TextEditor), { ssr: false });
 const FindBar = dynamic(() => import("./find/FindBar").then((m) => m.FindBar), { ssr: false });
+const LinkPopover = dynamic(() => import("./marks/LinkPopover").then((m) => m.LinkPopover), { ssr: false });
 
 const INFO_NOTICE_MS = 5000;
 
@@ -155,7 +156,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
           }}
           onPointerUp={() => { drag.current = null; }}
         >
-          {info && pdf ? <PageList pdf={pdf} overlay={(a) => <><PageOverlay {...a} /><TextEditor {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
+          {info && pdf ? <PageList pdf={pdf} overlay={(a) => <><PageOverlay {...a} /><TextEditor {...a} /><LinkPopover {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
         </main>
       </div>
       <FindBar />
```

Modify `apps/web/src/components/editor/PageOverlay.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/PageOverlay.tsx
+++ b/apps/web/src/components/editor/PageOverlay.tsx
@@ -7,10 +7,11 @@ import { useStore } from "zustand";
 import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
 import { groupTransform, screenSize, type PageGeom } from "@/lib/coords";
 import { newId } from "@/lib/id";
-import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, MARKUP_TOOLS, moveOp, resizeOp, type DragTool, type Pt } from "@/lib/objects";
+import { clampToPage, createFromDrag, DRAG_TOOLS, inkWidth, isMarkup, isResizable, isTextOp, MARKUP_TOOLS, MIN_DRAG, moveOp, normalizeRect, noteAt, resizeOp, symbolAt, type DragTool, type Pt } from "@/lib/objects";
 import { charsStore } from "@/store/chars";
 import { editorStore, useEditor, type MarkupTool } from "@/store/editor";
 import { MarkupShape } from "./marks/MarkupShape";
+import { linkStore } from "./marks/linkStore";
 import { markupFromDrag, onMarkableText } from "./marks/markupTool";
 import { ObjectShape } from "./ObjectShape";
 import { textEditStore } from "./text/textEdit";
@@ -100,6 +101,8 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
       if (cur.draft) setDrawDraft(extendInk(cur.draft, at));
     } else if (MARKUP_TOOLS.has(tool)) {
       setDrawDraft(markupFromDrag(tool as MarkupTool, pageKey, cur.start, at, "draft"));
+    } else if (tool === "link") {
+      setDrawDraft({ id: "draft", type: "link.add", pageKey, rect: normalizeRect(cur.start, at), target: { url: "https://" } });
     } else if (DRAG_TOOLS.has(tool)) {
       setDrawDraft(createFromDrag(tool as DragTool, cur.start, at, editorStore.getState().style, pageKey, "draft"));
     }
@@ -115,6 +118,9 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
     } else if (MARKUP_TOOLS.has(tool)) {
       const op = markupFromDrag(tool as MarkupTool, pageKey, cur.start, at, newId());
       if (op) s.addObject(op); // the markup tools stay active
+    } else if (tool === "link") {
+      const rect = normalizeRect(cur.start, at);
+      if (rect.w >= MIN_DRAG && rect.h >= MIN_DRAG) { s.setTool("select"); linkStore.getState().open({ pageKey, rect }); }
     } else if (DRAG_TOOLS.has(tool)) {
       const op = createFromDrag(tool as DragTool, cur.start, at, s.style, pageKey, newId());
       if (op) { s.addObject(op); s.setTool("select"); s.select(op.id); }
@@ -153,7 +159,14 @@ export default function PageOverlay({ pageKey, geom, scale }: { pageKey: string;
     if (tool === "text") { overlayHooks.onTextPointerDown?.(pageKey, at); return; }
     if (MARKUP_TOOLS.has(tool)) {
       if (onMarkableText(pageKey, at)) beginDraw(at, null);
-    } else if (DRAG_TOOLS.has(tool)) {
+    } else if (tool === "check" || tool === "cross") {
+      s.addObject(symbolAt(tool, at, s.style, pageKey, newId(), geom)); // stays active for the next one
+    } else if (tool === "note") {
+      const note = noteAt(at, s.style, pageKey, newId(), geom);
+      s.addObject(note);
+      s.setTool("select");
+      s.select(note.id); // the properties bar shows its text field
+    } else if (tool === "link" || DRAG_TOOLS.has(tool)) {
       beginDraw(at, null);
     } else if (tool === "ink") {
       beginDraw(at, { id: "draft", type: "ink.add", pageKey, paths: [[at]], color: s.style.stroke, width: inkWidth(s.style.width) } as ContentOp);
```

Modify `apps/web/src/components/editor/PropertiesBar.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -6,12 +6,14 @@ import { inkWidth, isMarkup, isTextOp, MARKUP_TOOLS } from "@/lib/objects";
 import { t } from "@/lib/strings";
 import { useChars } from "@/store/chars";
 import { editorStore, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
+import type { LinkTarget } from "@/lib/links";
 import { ColorField } from "./ColorField";
+import { LinkTargetFields } from "./marks/LinkTargetFields";
 import { textEditStore } from "./text/textEdit";
 
 export const textPropsSlot: { render?: () => React.ReactNode } = {};
 
-type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | null;
+type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | "symbol" | "note" | "link" | null;
 
 function kindOf(op: ContentOp | undefined, tool: string): Kind {
   if (op) {
@@ -20,9 +22,14 @@ function kindOf(op: ContentOp | undefined, tool: string): Kind {
     if (op.type === "redact.add") return "redact";
     if (isTextOp(op)) return "text";
     if (isMarkup(op)) return "markup";
+    if (op.type === "symbol.add") return "symbol";
+    if (op.type === "annot.add") return "note";
+    if (op.type === "link.add") return "link";
     return null;
   }
   if (MARKUP_TOOLS.has(tool)) return "markup";
+  if (tool === "check" || tool === "cross") return "symbol";
+  if (tool === "note") return "note";
   if (tool === "rect" || tool === "ellipse") return "shape";
   if (tool === "line" || tool === "arrow") return "line";
   if (tool === "ink") return "ink";
@@ -57,6 +64,8 @@ export function PropertiesBar() {
   function setColor(v: string) {
     if (o) s.updateObject(o.id, { color: v } as Partial<ContentOp>, { coalesce: `props:${o.id}` });
     else if (MARKUP_TOOLS.has(tool)) s.setStyle({ markup: { ...style.markup, [tool]: v } });
+    else if (kind === "symbol") s.setStyle({ symbolColor: v });
+    else if (kind === "note") s.setStyle({ noteColor: v });
   }
 
   const stroke = (o?.type === "ink.add" ? (o.color as string) : (o?.stroke as string | undefined)) ?? style.stroke;
@@ -117,6 +126,18 @@ export function PropertiesBar() {
           onChange={(v) => setColor(v)} />
       )}
       {kind === "markup" && noText && <span className="text-xs text-muted">{t.annot.noText}</span>}
+      {kind === "symbol" && <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.symbolColor} onChange={setColor} />}
+      {kind === "note" && <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.noteColor} onChange={setColor} />}
+      {kind === "note" && o && (
+        <textarea key={o.id} aria-label={t.annot.noteContent} placeholder={t.annot.noteContent} autoFocus rows={1}
+          value={(o.content as string | null | undefined) ?? ""}
+          onChange={(e) => s.updateObject(o.id, { content: e.target.value } as Partial<ContentOp>, { coalesce: `note:${o.id}` })}
+          className="h-8 w-80 resize-none rounded border border-line px-1.5 py-1 text-ink" />
+      )}
+      {kind === "link" && o && (
+        <LinkTargetFields key={o.id} target={o.target as LinkTarget}
+          onChange={(target) => { if (target) s.updateObject(o.id, { target } as Partial<ContentOp>, { coalesce: `link:${o.id}` }); }} />
+      )}
       {kind === "text" && textPropsSlot.render?.()}
       {kind === "text" && scanned && <span className="text-xs text-muted">{t.text.scanned}</span>}
       <div className="flex-1" />
```

Modify `apps/web/src/components/editor/Toolbar.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -76,6 +76,10 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
         { tool: "line", label: t.editor.line, icon: "╱" },
         { tool: "arrow", label: t.editor.arrow, icon: "→" },
       ]} />
+      <ToolButton tool="check" label={t.annot.check} icon="✓" active={tool} />
+      <ToolButton tool="cross" label={t.annot.cross} icon="✗" active={tool} />
+      <ToolButton tool="note" label={t.annot.note} icon="🗒" active={tool} />
+      <ToolButton tool="link" label={t.annot.link} icon="🔗" active={tool} />
     </div>
   );
 }
```

Create `apps/web/src/components/editor/marks/LinkPopover.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useStore } from "zustand";
import type { LinkAdd } from "@edith/ops";
import { toScreen, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import type { LinkTarget } from "@/lib/links";
import { t } from "@/lib/strings";
import { editorStore } from "@/store/editor";
import { LinkTargetFields } from "./LinkTargetFields";
import { linkStore } from "./linkStore";

/** Asks for the target of the link area just drawn on this page; saving adds the link.add op. */
export function LinkPopover({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const pending = useStore(linkStore, (s) => s.pending);
  const [target, setTarget] = useState<LinkTarget | null>(null);
  if (!pending || pending.pageKey !== pageKey) return null;
  const { rect } = pending;
  const corners = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]]
    .map((p) => toScreen(p as [number, number], geom, scale));
  const left = Math.min(...corners.map((c) => c[0])), top = Math.max(...corners.map((c) => c[1])) + 6;

  function close() { setTarget(null); linkStore.getState().close(); }
  function save() {
    if (!target || !pending) return;
    const op: LinkAdd = { id: newId(), type: "link.add", pageKey: pending.pageKey, rect: pending.rect, target };
    const s = editorStore.getState();
    s.addObject(op);
    s.select(op.id);
    close();
  }

  return (
    <div role="dialog" aria-label={t.link.title} data-testid="link-popover"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation(); // typing here is not an editor shortcut
        if (e.key === "Escape") close();
        if (e.key === "Enter") { e.preventDefault(); save(); }
      }}
      className="absolute z-20 flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-lg ring-1 ring-line" style={{ left, top }}>
      <span className="text-sm font-medium">{t.link.title}</span>
      <LinkTargetFields target={target} onChange={setTarget} autoFocus />
      <div className="flex justify-end gap-2 text-sm">
        <button type="button" onClick={close} className="rounded-md px-3 py-1 hover:bg-bg">{t.link.cancel}</button>
        <button type="button" onClick={save} disabled={!target} className="rounded-md bg-accent px-3 py-1 text-accent-ink disabled:opacity-50">{t.link.save}</button>
      </div>
    </div>
  );
}
```

Create `apps/web/src/components/editor/marks/LinkTargetFields.tsx`:
```tsx
"use client";

import { useState } from "react";
import { isPageTarget, normalizeUrl, type LinkTarget } from "@/lib/links";
import { t } from "@/lib/strings";
import { useEditor } from "@/store/editor";

/** URL / page choice of a link. `onChange` gets the target on every change: a normalized URL, a page,
 *  or null while the typed URL is not valid (a hint shows when the field is left that way). */
export function LinkTargetFields({ target, onChange, autoFocus = false }: {
  target: LinkTarget | null; onChange: (t: LinkTarget | null) => void; autoFocus?: boolean;
}) {
  const pages = useEditor((s) => s.doc.pages);
  const [mode, setMode] = useState<"url" | "page">(target && isPageTarget(target) ? "page" : "url");
  const [url, setUrl] = useState(target && !isPageTarget(target) ? target.url : "");
  const [invalid, setInvalid] = useState(false);
  const pageKey = target && isPageTarget(target) ? target.pageKey : "";

  function typeUrl(v: string) {
    setUrl(v);
    setInvalid(false);
    const u = normalizeUrl(v);
    onChange(u ? { url: u } : null);
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <div role="radiogroup" className="flex rounded-md ring-1 ring-line">
        {(["url", "page"] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m}
            onClick={() => { setMode(m); onChange(m === "url" ? (normalizeUrl(url) ? { url: normalizeUrl(url)! } : null) : pageKey ? { pageKey } : null); }}
            className={`px-2 py-1 ${mode === m ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>
            {m === "url" ? t.link.toUrl : t.link.toPage}
          </button>
        ))}
      </div>
      {mode === "url" ? (
        <>
          <input aria-label={t.link.url} value={url} autoFocus={autoFocus} placeholder="https://"
            onChange={(e) => typeUrl(e.target.value)}
            onBlur={() => setInvalid(url.trim() !== "" && normalizeUrl(url) === null)}
            className="w-56 rounded border border-line px-1.5 py-1 text-ink" />
          {invalid && <span role="alert" className="text-danger">{t.link.invalidUrl}</span>}
        </>
      ) : (
        <select aria-label={t.link.page} value={pageKey} onChange={(e) => { if (e.target.value) onChange({ pageKey: e.target.value }); }}
          className="rounded border border-line px-1 py-1 text-ink">
          <option value="" disabled>{t.link.page}</option>
          {pages.map((p, i) => <option key={p.pageKey} value={p.pageKey}>{t.link.pageN(i + 1)}</option>)}
        </select>
      )}
    </div>
  );
}
```

Create `apps/web/src/components/editor/marks/linkStore.ts`:
```ts
"use client";

import { createStore } from "zustand/vanilla";
import type { Rect } from "@edith/ops";

/** The link area just drawn with the link tool, waiting for its target in the LinkPopover. */
export const linkStore = createStore<{
  pending: { pageKey: string; rect: Rect } | null;
  open(p: { pageKey: string; rect: Rect }): void;
  close(): void;
}>()((set) => ({
  pending: null,
  open: (pending) => set({ pending }),
  close: () => set({ pending: null }),
}));
```

Modify `apps/web/src/components/editor/useShortcuts.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/useShortcuts.ts
+++ b/apps/web/src/components/editor/useShortcuts.ts
@@ -3,6 +3,7 @@
 import { useEffect } from "react";
 import { editorStore } from "@/store/editor";
 import { openFind } from "./find/findStore";
+import { linkStore } from "./marks/linkStore";
 import { afterTextCommitted, textEditStore } from "./text/textEdit";
 
 export function isTyping(target: EventTarget | null): boolean {
@@ -27,8 +28,9 @@ export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
       const k = e.key.toLowerCase();
       if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().undo()); }
       else if ((mod && k === "z" && e.shiftKey) || (e.ctrlKey && k === "y")) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().redo()); }
+      else if (mod && k === "k") { e.preventDefault(); s.setTool("link"); }
       else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) { e.preventDefault(); s.deleteObject(s.selection); }
-      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); }
+      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); linkStore.getState().close(); }
     }
     window.addEventListener("keydown", onKey);
     return () => window.removeEventListener("keydown", onKey);
```

Create `apps/web/src/lib/links.ts`:
```ts
import type { LinkAdd } from "@edith/ops";

const FULL = /^(https?:\/\/|mailto:)\S+$/i;
const BARE_HOST = /^[^\s/@:]+\.[^\s.]{2,}(\/\S*)?$/;

/** A URL the API accepts (http/https/mailto), adding https:// to a bare host like "example.com"; null otherwise. */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (FULL.test(v)) return v;
  if (BARE_HOST.test(v)) return `https://${v}`;
  return null;
}

export type LinkTarget = LinkAdd["target"];

export function isPageTarget(t: LinkTarget): t is { pageKey: string } {
  return "pageKey" in t;
}
```

Modify `apps/web/src/lib/objects.ts` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/lib/objects.ts
+++ b/apps/web/src/lib/objects.ts
@@ -39,7 +39,7 @@ export const NOTE_SIZE = 16;
 export const SYMBOL_SIZE = 20;
 
 /** Highlight/underline/strike: attached to the text under it (cannot be moved or resized). */
-export function isMarkup(op: ContentOp | undefined): op is AnnotAdd {
+export function isMarkup(op: ContentOp | undefined): op is AnnotAdd & { kind: "highlight" | "underline" | "strike" } {
   return op?.type === "annot.add" && op.kind !== "note";
 }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run src/lib/links.test.ts`
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Full check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: `Tests  194 passed (194)`; tsc prints nothing; eslint reports no problems. API untouched (`cd apps/api && uv run pytest -q` still `295 passed`).

- [ ] **Step 6: Try it in the browser**

In the dev app: **Centang** then click three times → three blue checks (tool still active). **Catatan**, click → note icon, type in "Isi catatan". **Link** (or Ctrl/Cmd+K), drag a box → popover; type `example.com`, "Simpan link" → dashed box; select it → properties show the URL; switch to "Ke halaman" and pick "Halaman 2".

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/PageOverlay.tsx apps/web/src/components/editor/PropertiesBar.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/marks/LinkPopover.tsx apps/web/src/components/editor/marks/LinkTargetFields.tsx apps/web/src/components/editor/marks/linkStore.ts apps/web/src/components/editor/useShortcuts.ts apps/web/src/lib/links.test.ts apps/web/src/lib/links.ts apps/web/src/lib/objects.ts
git commit -m "feat(web): check/cross, sticky note and link tools" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
