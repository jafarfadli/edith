# Task 13: Web — original paragraphs: hover, select, drag/resize, double-click → `text.edit`

**Files:**
- Create: `apps/web/src/components/editor/text/ParagraphLayer.tsx`
- Modify: `apps/web/src/components/editor/text/textEdit.ts`, `textEdit.test.ts`, `install.ts`; `apps/web/src/components/editor/PageOverlay.tsx`, `Editor.tsx`, `useShortcuts.ts`, `PropertiesBar.tsx`

**Interfaces:**
- Consumes: Task 8 `textStore`, `useText`, `paragraphsOf`, `Paragraph`; Task 9 `paragraphBox`, `prepareRuns`, `maskRects`; Task 10 `textEditFor`; Task 12 `textEditStore` (`paragraph`, `selectParagraph`, `start`), `overlayHooks`.
- Produces:
  ```ts
  // text/textEdit.ts
  export function paragraphStartBox(p: Paragraph): Promise<TextBox>                          // fonts loaded + fallback applied
  export function startParagraphEdit(pageKey: string, p: Paragraph): Promise<void>         // session (existing op or new, with `initial`)
  export function materializeParagraph(pageKey: string, p: Paragraph, change: (box: TextBox) => TextBox): Promise<void>  // adds + selects a text.edit op
  // text/ParagraphLayer.tsx
  export function ParagraphLayer({ pageKey }: { pageKey: string }): JSX.Element | null
  // PageOverlay.tsx
  overlayHooks.renderUnder?: (pageKey: string) => React.ReactNode   // drawn first in the page group (under all objects)
  ```
  Behaviour:
  - After `init`, `Editor` calls `textStore.getState().load(docId)` in the background.
  - Under the page's objects, `ParagraphLayer` draws white masks (`maskRects`) over paragraphs that have a `text.edit` op on this page (or are in an open edit session), and transparent hit rectangles over the other editable paragraphs (listening with the select and text tools).
  - Hover: dashed outline and text cursor. Select tool click: selects the paragraph (`selectParagraph`, clears the object selection; a left/right-anchor Transformer appears). Dragging the selected paragraph or dragging a width handle creates the `text.edit` op with the moved/resized box (one history entry) and selects it. Double-click (select tool) or a click with the text tool opens the rich editor on the paragraph (`startParagraphEdit`).
  - Clicking empty page area, clicking an object, or Esc clears the paragraph selection.
  - Properties bar: a selected `text.edit` shows the text properties; its delete button reads "Kembalikan teks asli" (deleting the op restores the original paragraph). With the text tool on a page without text, the bar says "Halaman ini berupa gambar; OCR belum tersedia".

- [ ] **Step 1: Failing tests**

In `apps/web/src/components/editor/text/textEdit.test.ts`:
- add `import type { Paragraph } from "@/lib/api";` below the `@edith/ops` import;
- import `materializeParagraph, startParagraphEdit` from `./textEdit` too;
- append:
```ts

describe("original paragraphs", () => {
  beforeEach(() => { gate.resolve(); fontsLoaded = true; });
  const para: Paragraph = {
    id: "g2", rect: { x: 72, y: 88, w: 120, h: 16 }, align: "left", lineHeight: 14, editable: true,
    runs: [{ text: "Halo dunia", font, size: 14, color: "#111111" }],
    lines: [{ rect: { x: 72, y: 88, w: 120, h: 16 }, baseline: 100, size: 14, start: 0, end: 10 }],
  };

  it("startParagraphEdit opens a session on the paragraph's own lines", async () => {
    await startParagraphEdit("o0", para);
    const e = textEditStore.getState().editing!;
    expect(e).toMatchObject({ kind: "text.edit", paragraphId: "g2", pageKey: "o0", isNew: true });
    expect(e.box.rect.y + e.box.layout[0].baseline).toBeCloseTo(100);
    expect(e.initial).toEqual(e.box.paragraphs);
  });

  it("startParagraphEdit reopens the paragraph's existing op", async () => {
    await materializeParagraph("o0", para, (b) => b);
    const id = editorStore.getState().selection!;
    await startParagraphEdit("o0", para);
    expect(textEditStore.getState().editing).toMatchObject({ id, isNew: false, kind: "text.edit" });
  });

  it("materializeParagraph adds a moved text.edit op, selected, in one undo step", async () => {
    await materializeParagraph("o0", para, (b) => ({ ...b, rect: { ...b.rect, x: b.rect.x + 10 } }));
    const op = Object.values(editorStore.getState().doc.objects)[0] as TextEdit;
    expect(op).toMatchObject({ type: "text.edit", paragraphId: "g2" });
    expect(op.box.rect.x).toBe(82);
    expect(editorStore.getState().selection).toBe(op.id);
    editorStore.getState().undo();
    expect(editorStore.getState().doc.order).toEqual([]);
  });
});
```

Run: `npm test -w apps/web -- textEdit`
Expected: FAIL — `startParagraphEdit` is not exported.

- [ ] **Step 2: Paragraph sessions**

In `apps/web/src/components/editor/text/textEdit.ts`:
- Add imports: `import type { Paragraph } from "@/lib/api";` (after the `@edith/ops` import); change the paragraphs import to `import { paragraphBox, prepareRuns, resolveRunFonts } from "@/lib/paragraphs";` and the store import to `import { editorStore, textEditFor } from "@/store/editor";`.
- After `startTextAt`, add:
```ts
/** The box that redraws original paragraph `p` with fonts that can draw it (loads them). */
export async function paragraphStartBox(p: Paragraph): Promise<TextBox> {
  const [runs] = await prepareRuns([p.runs], textStore.getState().fonts);
  return paragraphBox({ ...p, runs }, (f) => fontStore.get(f));
}

/** Opens original paragraph `p` for typing (its text.edit op, when it has one). */
export async function startParagraphEdit(pageKey: string, p: Paragraph): Promise<void> {
  if (textEditStore.getState().editing || pendingCommit) return;
  editorStore.getState().select(null);
  const existing = textEditFor(editorStore.getState().doc, pageKey, p.id);
  if (existing) {
    textEditStore.getState().start({ id: existing.id, pageKey, box: existing.box, isNew: false, kind: "text.edit", paragraphId: p.id });
    return;
  }
  let box: TextBox;
  try {
    box = await paragraphStartBox(p);
  } catch (err) {
    console.warn("paragraph edit: font load failed", err);
    return;
  }
  if (textEditStore.getState().editing) return;
  textEditStore.getState().start({ id: newId(), pageKey, box, isNew: true, kind: "text.edit", paragraphId: p.id, initial: box.paragraphs });
}

/** Turns original paragraph `p` into a text.edit op changed by `change` (moved, resized), selected. */
export async function materializeParagraph(pageKey: string, p: Paragraph, change: (box: TextBox) => TextBox): Promise<void> {
  let box: TextBox;
  try {
    box = await paragraphStartBox(p);
  } catch (err) {
    console.warn("paragraph move: font load failed", err);
    return;
  }
  const st = editorStore.getState();
  if (textEditFor(st.doc, pageKey, p.id)) return;
  const id = newId();
  st.addObject({ id, type: "text.edit", pageKey, paragraphId: p.id, box: relayout(change(box), (f) => fontStore.get(f)) } as ContentOp);
  textEditStore.getState().selectParagraph(null);
  st.select(id);
}
```

Run: `npm test -w apps/web -- textEdit` → Expected: 12 passed.

- [ ] **Step 3: Paragraph layer**

`apps/web/src/components/editor/text/ParagraphLayer.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Rect, Transformer } from "react-konva";
import { useStore } from "zustand";
import type { TextEdit } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { maskRects } from "@/lib/paragraphs";
import { editorStore, useEditor } from "@/store/editor";
import { paragraphsOf, useText } from "@/store/text";
import { materializeParagraph, startParagraphEdit, textEditStore } from "./textEdit";

const OUTLINE = "#0f766e";

/** Under the page's objects: white covers over edited paragraphs (the bake redacts them) and, for
 *  the select and text tools, hover/select/drag/resize targets over the paragraphs not edited yet. */
export function ParagraphLayer({ pageKey }: { pageKey: string }) {
  const entry = useEditor((s) => s.doc.pages.find((p) => p.pageKey === pageKey));
  const order = useEditor((s) => s.doc.order);
  const objects = useEditor((s) => s.doc.objects);
  const tool = useEditor((s) => s.tool);
  const pages = useText((s) => s.pages);
  const editing = useStore(textEditStore, (s) => s.editing);
  const selected = useStore(textEditStore, (s) => (s.paragraph?.pageKey === pageKey ? s.paragraph.id : null));
  const [hover, setHover] = useState<string | null>(null);
  const nodes = useRef(new Map<string, Konva.Rect>());
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    const node = selected ? nodes.current.get(selected) : undefined;
    trRef.current?.nodes(node ? [node] : []);
    trRef.current?.getLayer()?.batchDraw();
  }, [selected, pages]);

  if (!entry) return null;
  const paragraphs = paragraphsOf(entry.src, pages);
  if (!paragraphs.length) return null;
  const edited = new Set(order.map((id) => objects[id])
    .filter((op): op is TextEdit => op?.type === "text.edit" && op.pageKey === pageKey)
    .map((op) => op.paragraphId));
  if (editing?.kind === "text.edit" && editing.pageKey === pageKey && editing.paragraphId) edited.add(editing.paragraphId);
  const interactive = tool === "select" || tool === "text";

  const select = (p: Paragraph) => {
    editorStore.getState().select(null);
    textEditStore.getState().selectParagraph({ pageKey, id: p.id });
  };

  return (
    <>
      {paragraphs.filter((p) => edited.has(p.id)).flatMap((p) => maskRects(p).map((r, i) => (
        <Rect key={`mask-${p.id}-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#ffffff" listening={false} />
      )))}
      {paragraphs.filter((p) => p.editable && !edited.has(p.id)).map((p) => (
        <Rect
          key={p.id}
          ref={(n) => { if (n) nodes.current.set(p.id, n); else nodes.current.delete(p.id); }}
          x={p.rect.x} y={p.rect.y} width={p.rect.w} height={p.rect.h}
          fill="transparent"
          stroke={hover === p.id || selected === p.id ? OUTLINE : undefined}
          strokeWidth={1} strokeScaleEnabled={false} dash={selected === p.id ? undefined : [4, 3]}
          listening={interactive}
          draggable={tool === "select" && selected === p.id}
          onMouseEnter={(e) => { setHover(p.id); const c = e.target.getStage()?.container(); if (c) c.style.cursor = "text"; }}
          onMouseLeave={(e) => { setHover(null); const c = e.target.getStage()?.container(); if (c) c.style.cursor = ""; }}
          onPointerDown={(e) => {
            e.cancelBubble = true; // not a click on the empty page
            if (tool === "text") void startParagraphEdit(pageKey, p);
            else select(p);
          }}
          onDblClick={() => void startParagraphEdit(pageKey, p)}
          onDragEnd={(e) => {
            const node = e.target;
            const dx = node.x() - p.rect.x, dy = node.y() - p.rect.y;
            node.position({ x: p.rect.x, y: p.rect.y });
            if (dx || dy) void materializeParagraph(pageKey, p, (box) => ({ ...box, rect: { ...box.rect, x: box.rect.x + dx, y: box.rect.y + dy } }));
          }}
          onTransformEnd={(e) => {
            const node = e.target;
            const x = node.x(), w = Math.max(10, p.rect.w * node.scaleX());
            node.setAttrs({ x: p.rect.x, scaleX: 1, scaleY: 1 });
            void materializeParagraph(pageKey, p, (box) => ({ ...box, rect: { ...box.rect, x, w: Math.max(10, box.rect.w + w - p.rect.w) } }));
          }}
        />
      ))}
      <Transformer ref={trRef} rotateEnabled={false} ignoreStroke keepRatio={false} enabledAnchors={["middle-left", "middle-right"]}
        borderStroke={OUTLINE} anchorStroke={OUTLINE} anchorSize={8} />
    </>
  );
}
```

- [ ] **Step 4: Wire it in**

`apps/web/src/components/editor/PageOverlay.tsx`:
- Add to the `overlayHooks` type:
```ts
  /** Konva nodes drawn under the page's objects (original paragraphs). */
  renderUnder?: (pageKey: string) => React.ReactNode;
```
- In `onDown`, replace `if (e.target === e.target.getStage()) s.select(null);` with
```ts
      if (e.target === e.target.getStage()) { s.select(null); textEditStore.getState().selectParagraph(null); }
```
- Make `{overlayHooks.renderUnder?.(pageKey)}` the first child of the page `<Group ref={pageRef} …>` (before `{mine.map(…)}`).
- Replace each object group's `onPointerDown` with:
```tsx
                onPointerDown={(e) => {
                  if (tool !== "select") return;
                  e.cancelBubble = true;
                  textEditStore.getState().selectParagraph(null);
                  editorStore.getState().select(op.id);
                }}
```

`apps/web/src/components/editor/text/install.ts`: import `ParagraphLayer` (`import { ParagraphLayer } from "./ParagraphLayer";`) and, before `textPropsSlot.render = …`, add:
```ts
  overlayHooks.renderUnder = (pageKey) => createElement(ParagraphLayer, { pageKey });
```

`apps/web/src/components/editor/Editor.tsx`: `import { textStore } from "@/store/text";` and right after `if (draft) setNotice({ kind: "info", text: t.editor.restored });` add:
```ts
      void textStore.getState().load(docId); // original paragraphs + fonts, in the background
```

`apps/web/src/components/editor/useShortcuts.ts`: import `textEditStore` (`import { afterTextCommitted, textEditStore } from "./text/textEdit";`) and change the Escape branch to:
```ts
      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); }
```

`apps/web/src/components/editor/PropertiesBar.tsx`:
- In `kindOf`: `if (op.type === "text.add" || op.type === "text.edit") return "text";`
- After `const kind = …` add:
```ts
  // The text tool on a page without text (a scan): say why there is nothing to edit.
  const scanned = useEditor((st) => {
    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
    return tool === "text" && !!entry && "doc" in entry.src && st.info?.pages[entry.src.index]?.hasText === false;
  });
```
- After `{kind === "text" && textPropsSlot.render?.()}` add:
```tsx
      {kind === "text" && scanned && <span className="text-xs text-muted">{t.text.scanned}</span>}
```
- The delete button label becomes `🗑 {op?.type === "text.edit" ? t.text.revert : t.editor.delete}`.

- [ ] **Step 5: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run e2e -w apps/web`
Expected: all pass.

Manual (dev servers, upload a PDF with text, e.g. one produced by `cd apps/api && uv run python -c "from tests.pdfs import make_paragraphs_pdf; open('/tmp/p.pdf','wb').write(make_paragraphs_pdf())"`):
1. Hover a paragraph → dashed outline, text cursor. Click → solid outline with left/right handles. Esc → gone.
2. Drag the selected paragraph down 40 px → the original disappears (white mask) and the same text is drawn 40 px lower in the same font and line breaks; one Ctrl+Z brings the original back.
3. Double-click another paragraph → white editor with its text on the same lines; select a word, click B → bold; click outside → the paragraph is redrawn with the bold word; the rest keeps its lines.
4. Select the edited paragraph → the delete button says "Kembalikan teks asli"; click → original back.
5. Unduh → the edited paragraph is in the PDF, the original text is gone (search for it in the viewer), and images/lines under it are intact.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): select, move, resize and edit original paragraphs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
