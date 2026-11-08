# Task 13: Anotasi panel

> Part of the M4 plan — read `README.md` in this folder first (Global Constraints, Decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state Task 12 leaves, new files are complete.

**Goal:** Sidebar tabs Halaman | Anotasi (n). The panel lists every object grouped by page in page order (icon, kind, snippet); a click selects it and scrolls to its page; ✕ deletes it.

**Files:**
- Create: `apps/web/src/components/editor/AnnotationsPanel.tsx`
- Modify: `apps/web/src/components/editor/Sidebar.tsx`
- Create: `apps/web/src/lib/objectLabels.test.ts`
- Create: `apps/web/src/lib/objectLabels.ts`
- Modify: `apps/web/src/lib/strings.ts`

**Interfaces:**
- Consumes: Task 8 `Sidebar` without `pdf`.
- Produces:
- `lib/objectLabels.objectLabel(op) -> {icon, label, detail?}`; `AnnotationsPanel` (`data-testid=annotation-item`, delete buttons named `Hapus <label>`); strings `t.objectKinds.*`, `t.panel.*`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/objectLabels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { objectLabel } from "@/lib/objectLabels";

const base = { id: "x", pageKey: "o0" };
const op = (o: object) => ({ ...base, ...o }) as ContentOp;
const box = (text: string) => ({ rect: { x: 0, y: 0, w: 10, h: 10 }, lineHeight: 12, layout: [],
  paragraphs: text.split("\n").map((line) => [{ text: line, font: { kind: "bundled", family: "Arimo" }, size: 12, color: "#000000" }]) });

describe("objectLabel", () => {
  it("names each kind, with a snippet where there is text", () => {
    expect(objectLabel(op({ type: "text.add", box: box("Halo\ndunia") }))).toEqual({ icon: "T", label: "Teks", detail: "Halo dunia" });
    expect(objectLabel(op({ type: "shape.add", kind: "cloud", points: [], stroke: "#000000", width: 1 }))).toEqual({ icon: "☁", label: "Awan" });
    expect(objectLabel(op({ type: "stamp.add", preset: "disetujui", rect: {}, color: "#000000" })).detail).toBe("DISETUJUI");
    expect(objectLabel(op({ type: "stamp.add", custom: { text: "OK", date: "01/01/2026" }, rect: {}, color: "#000000" })).detail).toBe("OK 01/01/2026");
    expect(objectLabel(op({ type: "annot.add", kind: "note", point: [0, 0], color: "#000000", content: "" }))).toEqual({ icon: "🗒", label: "Catatan", detail: undefined });
    expect(objectLabel(op({ type: "annot.add", kind: "strike", quads: [], color: "#000000" })).label).toBe("Coret");
    expect(objectLabel(op({ type: "link.add", rect: {}, target: { pageKey: "o1" } })).detail).toBeUndefined();
  });

  it("shortens long text", () => {
    const d = objectLabel(op({ type: "text.add", box: box("x".repeat(100)) })).detail!;
    expect(d).toHaveLength(40);
    expect(d.endsWith("…")).toBe(true);
  });
});
```


- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/web`
Expected: FAIL: `@/lib/objectLabels` not found

- [ ] **Step 3: Implement**

Create `apps/web/src/components/editor/AnnotationsPanel.tsx`:

```tsx
"use client";

import type { ContentOp } from "@edith/ops";
import { objectLabel } from "@/lib/objectLabels";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { scrollToPage } from "./ZoomPill";

/** Every object added to the document, grouped by page in page order: a click goes to it and selects it. */
export function AnnotationsPanel() {
  const pages = useEditor((s) => s.doc.pages);
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const selection = useEditor((s) => s.selection);
  const groups = pages
    .map((p, i) => ({ pageKey: p.pageKey, n: i + 1, ops: order.map((id) => objects[id]).filter((op): op is ContentOp => !!op && op.pageKey === p.pageKey) }))
    .filter((g) => g.ops.length);

  if (!groups.length) return <p className="px-2 py-4 text-xs text-muted">{t.panel.empty}</p>;

  function go(op: ContentOp) {
    const s = editorStore.getState();
    s.setTool("select");
    s.select(op.id);
    s.setCurrentPage(op.pageKey);
    scrollToPage(op.pageKey);
  }

  return (
    <div className="flex flex-col gap-3" data-testid="annotations-panel">
      {groups.map((g) => (
        <section key={g.pageKey} aria-label={t.pages.pageN(g.n)}>
          <h3 className="px-1 pb-1 text-xs font-medium text-muted">{t.pages.pageN(g.n)}</h3>
          <ul className="flex flex-col gap-0.5">
            {g.ops.map((op) => {
              const { icon, label, detail } = objectLabel(op);
              return (
                <li key={op.id} className={`group flex items-center rounded-md ${selection === op.id ? "bg-accent/10" : "hover:bg-bg"}`}>
                  <button onClick={() => go(op)} data-testid="annotation-item" className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-xs">
                    <span aria-hidden className="w-4 shrink-0 text-center">{icon}</span>
                    <span className="shrink-0">{label}</span>
                    {detail && <span className="truncate text-muted">{detail}</span>}
                  </button>
                  <button aria-label={t.panel.deleteItem(label)} title={t.editor.delete} onClick={() => editorStore.getState().deleteObject(op.id)}
                    className="px-1.5 text-xs text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">✕</button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

Modify `apps/web/src/components/editor/Sidebar.tsx`:

```diff
--- a/apps/web/src/components/editor/Sidebar.tsx
+++ b/apps/web/src/components/editor/Sidebar.tsx
@@ -3,8 +3,10 @@
 import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
 import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
 import { CSS } from "@dnd-kit/utilities";
+import { useState } from "react";
 import { t } from "@/lib/strings";
 import { editorStore, pageGeom, useEditor, type PageEntry } from "@/store/editor";
+import { AnnotationsPanel } from "./AnnotationsPanel";
 import { MenuButton } from "./MenuButton";
 import { PageMenu } from "./PageMenu";
 import { importPdf, pickPdf } from "./pages/importPdf";
@@ -46,6 +48,26 @@ function SortableThumb({ entry, index, count, active }: { entry: PageEntry; inde
 }
 
 export function Sidebar() {
+  const [tab, setTab] = useState<"pages" | "annotations">("pages");
+  const count = useEditor((s) => s.doc.order.length);
+  const tabBtn = (k: typeof tab, label: string) => (
+    <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
+      className={`flex-1 rounded-md px-2 py-1 text-xs ${tab === k ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-bg"}`}>{label}</button>
+  );
+  return (
+    <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-surface" aria-label={t.editor.pages}>
+      <div role="tablist" className="flex gap-1 border-b border-line p-1.5">
+        {tabBtn("pages", t.panel.pages)}
+        {tabBtn("annotations", count ? `${t.panel.annotations} (${count})` : t.panel.annotations)}
+      </div>
+      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
+        {tab === "pages" ? <PageThumbs /> : <AnnotationsPanel />}
+      </div>
+    </aside>
+  );
+}
+
+function PageThumbs() {
   const pages = useEditor((s) => s.doc.pages);
   const current = useEditor((s) => s.currentPage);
   const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
@@ -57,7 +79,7 @@ export function Sidebar() {
   }
 
   return (
-    <aside className="w-48 shrink-0 overflow-y-auto border-r border-line bg-surface px-2 py-3" aria-label={t.editor.pages}>
+    <>
       <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
         <SortableContext items={pages.map((p) => p.pageKey)} strategy={verticalListSortingStrategy}>
           <InsertButton after={null} />
@@ -69,6 +91,6 @@ export function Sidebar() {
           ))}
         </SortableContext>
       </DndContext>
-    </aside>
+    </>
   );
 }
```

Create `apps/web/src/lib/objectLabels.ts`:

```ts
import type { ContentOp } from "@edith/ops";
import { t } from "@/lib/strings";
import { stampTexts } from "@/lib/stamps";
import { plainText } from "@/lib/textbox";

const SNIPPET = 40;

function snippet(text: string | null | undefined): string | undefined {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > SNIPPET ? `${s.slice(0, SNIPPET - 1)}…` : s;
}

/** How the Anotasi panel lists an object: an icon, its kind and (for text, notes, stamps, links) a snippet. */
export function objectLabel(op: ContentOp): { icon: string; label: string; detail?: string } {
  const L = t.objectKinds;
  switch (op.type) {
    case "text.add": return { icon: "T", label: L.text, detail: snippet(plainText(op.box)) };
    case "text.edit": return { icon: "✎", label: L.textEdit, detail: snippet(plainText(op.box)) };
    case "image.add": return { icon: "🖼", label: L.image };
    case "signature.add": return { icon: "✍", label: L.signature };
    case "shape.add": return { icon: { rect: "□", ellipse: "○", line: "╱", arrow: "→", polygon: "⬠", polyline: "⌇", cloud: "☁" }[op.kind], label: L.shape[op.kind] };
    case "ink.add": return { icon: "✎", label: L.ink };
    case "whiteout.add": return { icon: "▭", label: L.whiteout };
    case "redact.add": return { icon: "▮", label: L.redact };
    case "stamp.add": return { icon: "🏷", label: L.stamp, detail: snippet(stampTexts(op).join(" ")) };
    case "symbol.add": return { icon: op.kind === "check" ? "✓" : "✗", label: op.kind === "check" ? L.check : L.cross };
    case "link.add": return { icon: "🔗", label: L.link, detail: "url" in op.target ? snippet(op.target.url) : undefined };
    case "annot.add": return op.kind === "note"
      ? { icon: "🗒", label: L.note, detail: snippet(op.content) }
      : { icon: "🖍", label: L.markup[op.kind] };
  }
}
```

Modify `apps/web/src/lib/strings.ts`:

```diff
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -122,6 +122,18 @@ export const t = {
     cancel: "Batal",
     save: "Simpan",
   },
+  objectKinds: {
+    text: "Teks", textEdit: "Teks diedit", image: "Gambar", signature: "Tanda tangan", ink: "Gambar bebas",
+    whiteout: "Whiteout", redact: "Redaksi", stamp: "Stamp", check: "Centang", cross: "Silang", link: "Link", note: "Catatan",
+    shape: { rect: "Persegi", ellipse: "Elips", line: "Garis", arrow: "Panah", polygon: "Poligon", polyline: "Garis bersambung", cloud: "Awan" },
+    markup: { highlight: "Stabilo", underline: "Garis bawah", strike: "Coret" },
+  },
+  panel: {
+    pages: "Halaman",
+    annotations: "Anotasi",
+    empty: "Belum ada anotasi. Objek yang Anda tambahkan muncul di sini.",
+    deleteItem: (label: string) => `Hapus ${label}`,
+  },
   objects: {
     bar: "Aksi objek",
     duplicate: "Duplikat",
```


- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 274 passed; tsc/eslint clean

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/AnnotationsPanel.tsx apps/web/src/components/editor/Sidebar.tsx apps/web/src/lib/objectLabels.test.ts apps/web/src/lib/objectLabels.ts apps/web/src/lib/strings.ts
git commit -m "feat(web): annotations panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
