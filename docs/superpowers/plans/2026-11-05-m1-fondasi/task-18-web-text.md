# Task 18: Text tool (single-style text boxes)

**Files:**
- Create: `apps/web/src/lib/textbox.ts`, `apps/web/src/lib/textbox.test.ts`, `apps/web/src/components/editor/text/textEdit.ts`, `apps/web/src/components/editor/text/TextNode.tsx`, `apps/web/src/components/editor/text/TextEditor.tsx`, `apps/web/src/components/editor/text/TextProps.tsx`, `apps/web/src/components/editor/text/install.ts`
- Modify: `apps/web/src/components/editor/Editor.tsx` (install hooks, render `TextEditor` in the overlay, preload fonts)

**Interfaces:**
- Consumes: `layoutText` (Task 11), `fontStore`, `cssFamily`, `charOffsets`, `FontMetrics` (Task 11), `overlayHooks` (Task 16), `textPropsSlot` (Task 17), store (Task 12), `toScreen`, `PageGeom` (Task 10), `newId`.
- Produces:
```ts
// lib/textbox.ts (pure)
export const DEFAULT_BOX_WIDTH = 200;
export interface TextStyle { family: string; bold: boolean; italic: boolean; size: number; color: string; align: "left" | "center" | "right" | "justify" }
export function plainText(box: TextBox): string;                       // paragraphs joined by "\n"
export function withText(box: TextBox, text: string): TextBox;         // keeps first run's style; one paragraph per line
export function withStyle(box: TextBox, patch: Partial<TextStyle>): TextBox; // applies to every run; lineHeight = 1.2 × size
export function relayout(box: TextBox, metricsFor: (f: BundledFont) => FontMetrics): TextBox; // sets layout + rect.h
export function newBox(at: [number, number], style: TextStyle): TextBox; // empty text, width DEFAULT_BOX_WIDTH, top-left at `at`
export function boxFonts(box: TextBox): BundledFont[];                // unique fonts used
// components/editor/text/textEdit.ts
export interface Editing { id: string; pageKey: string; box: TextBox; isNew: boolean }
export const textEditStore: StoreApi<{ editing: Editing | null; start(e: Editing): void; update(box: TextBox): void; finish(): void }>;
export async function commitEditing(text: string): Promise<void>; // relayout + add/update/delete in editorStore; one history entry
export function installTextTool(): void; // fills overlayHooks + textPropsSlot; idempotent
```
Behavior:
- Tool `text`: click on a page starts a **new** pending box at the click point (not yet in history). Typing happens in an HTML `<textarea data-testid="text-editor">` placed over the box (same font via `cssFamily`, size × zoom, width × zoom, `font-kerning: none`, rotated with the page).
- Blur, Esc or Ctrl/Cmd+Enter commits: empty text → nothing added (or existing op deleted); otherwise `relayout` and `addObject`/`updateObject` (one history entry). Tool returns to `select`, the box is selected.
- Double-click a text object (select tool) edits it; while editing, Konva hides that object.
- Konva draws text glyph-by-glyph at `charOffsets` (identical to the bake).
- Resizing a text box changes only its width and re-wraps (`resizeText` hook).
- Text properties (font family Arimo/Tinos/Cousine, size, bold, italic, color, align) apply to the editing box, else the selected text op, else `style` for the next box.

- [ ] **Step 1: Failing pure tests**

`apps/web/src/lib/textbox.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { FontMetrics } from "@/lib/fonts";
import { boxFonts, newBox, plainText, relayout, withStyle, withText } from "@/lib/textbox";

const mono: FontMetrics = { unitsPerEm: 1, ascent: 0.8, descent: 0.2, advance: () => 1 };
const style = { family: "Arimo", bold: false, italic: false, size: 10, color: "#111111", align: "left" as const };

describe("textbox", () => {
  it("creates an empty box at a point", () => {
    const b = newBox([30, 40], style);
    expect(b.rect).toEqual({ x: 30, y: 40, w: 200, h: 12 });
    expect(b.lineHeight).toBe(12);
    expect(plainText(b)).toBe("");
  });

  it("sets text as paragraphs and keeps style", () => {
    const b = withText(newBox([0, 0], { ...style, color: "#ff0000" }), "satu\ndua");
    expect(b.paragraphs.length).toBe(2);
    expect(b.paragraphs[1][0]).toMatchObject({ text: "dua", color: "#ff0000", size: 10 });
    expect(plainText(b)).toBe("satu\ndua");
  });

  it("applies style to all runs and updates line height", () => {
    const b = withStyle(withText(newBox([0, 0], style), "a\nb"), { size: 20, bold: true, align: "center" });
    expect(b.paragraphs.flat().every((r) => r.size === 20 && r.font.bold)).toBe(true);
    expect(b.lineHeight).toBe(24);
    expect(b.align).toBe("center");
  });

  it("relayout computes layout and height", () => {
    const b = relayout({ ...withText(newBox([0, 0], style), "aa bb"), rect: { x: 0, y: 0, w: 30, h: 0 } }, () => mono);
    expect(b.layout.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["aa", "bb"]);
    expect(b.rect.h).toBeCloseTo(22);
  });

  it("lists fonts", () => {
    const b = withStyle(withText(newBox([0, 0], style), "x"), { family: "Tinos", italic: true });
    expect(boxFonts(b)).toEqual([{ kind: "bundled", family: "Tinos", bold: false, italic: true }]);
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL.

- [ ] **Step 2: textbox.ts**

`apps/web/src/lib/textbox.ts`:
```ts
import type { BundledFont, Run, TextBox } from "@edith/ops";
import type { FontMetrics } from "@/lib/fonts";
import { fontKey } from "@/lib/fonts";
import { layoutText } from "@/lib/layout";

export const DEFAULT_BOX_WIDTH = 200;
export interface TextStyle { family: string; bold: boolean; italic: boolean; size: number; color: string; align: "left" | "center" | "right" | "justify" }

function runFrom(style: TextStyle, text: string): Run {
  return { text, font: { kind: "bundled", family: style.family, bold: style.bold, italic: style.italic }, size: style.size, color: style.color };
}

export function newBox([x, y]: [number, number], style: TextStyle): TextBox {
  const lineHeight = Math.round(style.size * 1.2 * 100) / 100;
  return { rect: { x, y, w: DEFAULT_BOX_WIDTH, h: lineHeight }, align: style.align, lineHeight, paragraphs: [[runFrom(style, "")]], layout: [] };
}

export function plainText(box: TextBox): string {
  return box.paragraphs.map((p) => p.map((r) => r.text).join("")).join("\n");
}

export function withText(box: TextBox, text: string): TextBox {
  const first = box.paragraphs[0]?.[0];
  const paragraphs = text.split("\n").map((line) => [{ ...first, text: line } as Run]);
  return { ...box, paragraphs };
}

export function withStyle(box: TextBox, patch: Partial<TextStyle>): TextBox {
  const paragraphs = box.paragraphs.map((p) => p.map((r) => ({
    ...r,
    size: patch.size ?? r.size,
    color: patch.color ?? r.color,
    font: { ...r.font, family: patch.family ?? r.font.family, bold: patch.bold ?? r.font.bold, italic: patch.italic ?? r.font.italic },
  })));
  const size = patch.size ?? box.paragraphs[0]?.[0]?.size;
  return {
    ...box,
    paragraphs,
    align: patch.align ?? box.align,
    lineHeight: patch.size !== undefined && size ? Math.round(size * 1.2 * 100) / 100 : box.lineHeight,
  };
}

export function relayout(box: TextBox, metricsFor: (f: BundledFont) => FontMetrics): TextBox {
  const r = layoutText({ width: box.rect.w, align: box.align, lineHeight: box.lineHeight, paragraphs: box.paragraphs }, metricsFor);
  return { ...box, layout: r.lines, rect: { ...box.rect, h: Math.max(r.height, box.lineHeight) } };
}

export function boxFonts(box: TextBox): BundledFont[] {
  const seen = new Map<string, BundledFont>();
  for (const r of box.paragraphs.flat()) seen.set(fontKey(r.font), r.font);
  return [...seen.values()];
}
```

Run: `npm test -w apps/web` → Expected: PASS.

- [ ] **Step 3: Editing store + commit**

`apps/web/src/components/editor/text/textEdit.ts`:
```ts
"use client";

import { createStore } from "zustand/vanilla";
import type { TextAdd, TextBox } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { boxFonts, relayout, withText } from "@/lib/textbox";
import { editorStore } from "@/store/editor";

export interface Editing { id: string; pageKey: string; box: TextBox; isNew: boolean }

interface TextEditState { editing: Editing | null; start(e: Editing): void; update(box: TextBox): void; finish(): void }

export const textEditStore = createStore<TextEditState>()((set, get) => ({
  editing: null,
  start: (editing) => set({ editing }),
  update: (box) => { const e = get().editing; if (e) set({ editing: { ...e, box } }); },
  finish: () => set({ editing: null }),
}));

export async function commitEditing(text: string): Promise<void> {
  const e = textEditStore.getState().editing;
  if (!e) return;
  textEditStore.getState().finish();
  const s = editorStore.getState();
  if (!text.trim()) {
    if (!e.isNew) s.deleteObject(e.id);
    return;
  }
  const withNewText = withText(e.box, text);
  await Promise.all(boxFonts(withNewText).map((f) => fontStore.load(f)));
  const box = relayout(withNewText, (f) => fontStore.get(f));
  if (e.isNew) {
    s.addObject({ id: e.id, type: "text.add", pageKey: e.pageKey, box } as TextAdd);
  } else {
    s.updateObject(e.id, { box } as Partial<TextAdd>);
  }
  s.setTool("select");
  s.select(e.id);
}
```

- [ ] **Step 4: Konva text node**

`apps/web/src/components/editor/text/TextNode.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { Rect, Shape } from "react-konva";
import type { TextAdd } from "@edith/ops";
import { charOffsets, cssFamily, fontStore } from "@/lib/fonts";
import { boxFonts } from "@/lib/textbox";

export function TextNode({ op, hidden }: { op: TextAdd; hidden: boolean }) {
  const { box } = op;
  const [ready, setReady] = useState(() => boxFonts(box).every((f) => { try { fontStore.get(f); return true; } catch { return false; } }));

  useEffect(() => {
    let alive = true;
    Promise.all(boxFonts(box).map((f) => fontStore.load(f))).then(() => alive && setReady(true));
    return () => { alive = false; };
  }, [box]);

  const runs = box.paragraphs.flat();
  return (
    <>
      <Rect x={box.rect.x} y={box.rect.y} width={box.rect.w} height={box.rect.h} fill="transparent" />
      {ready && !hidden && (
        <Shape
          listening={false}
          sceneFunc={(ctx) => {
            const c = ctx._context as CanvasRenderingContext2D;
            c.save();
            c.textBaseline = "alphabetic";
            if ("fontKerning" in c) (c as CanvasRenderingContext2D & { fontKerning: string }).fontKerning = "none";
            for (const line of box.layout) {
              for (const seg of line.segments) {
                const r = runs[seg.runIndex];
                const m = fontStore.get(r.font);
                c.font = `${r.size}px "${cssFamily(r.font)}"`;
                c.fillStyle = r.color;
                const offs = charOffsets(seg.text, m, r.size);
                let i = 0;
                for (const ch of seg.text) {
                  c.fillText(ch, box.rect.x + seg.x + offs[i], box.rect.y + line.baseline);
                  i++;
                }
              }
            }
            c.restore();
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: HTML editor**

`apps/web/src/components/editor/text/TextEditor.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { toScreen, type PageGeom } from "@/lib/coords";
import { cssFamily, fontStore } from "@/lib/fonts";
import { boxFonts, plainText } from "@/lib/textbox";
import { commitEditing, textEditStore } from "./textEdit";

export function TextEditor({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const editing = useStore(textEditStore, (s) => s.editing);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const active = editing && editing.pageKey === pageKey ? editing : null;
  const editingId = active?.id;

  useEffect(() => {
    if (!active) return;
    setText(plainText(active.box));
    boxFonts(active.box).forEach((f) => fontStore.load(f));
    setTimeout(() => ref.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  if (!active) return null;
  const { box } = active;
  const run = box.paragraphs[0][0];
  const [left, top] = toScreen([box.rect.x, box.rect.y], geom, scale);
  const lines = Math.max(1, text.split("\n").length);

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => commitEditing(text)}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); ref.current?.blur(); }
        e.stopPropagation();
      }}
      spellCheck={false}
      style={{
        position: "absolute", left, top, zIndex: 10,
        width: box.rect.w * scale,
        minHeight: box.lineHeight * scale * lines,
        transform: `rotate(${geom.rotation}deg)`, transformOrigin: "top left",
        fontFamily: `"${cssFamily(run.font)}"`, fontSize: run.size * scale,
        lineHeight: `${box.lineHeight * scale}px`, color: run.color, textAlign: box.align === "justify" ? "justify" : box.align,
        fontKerning: "none", fontVariantLigatures: "none",
        padding: 0, margin: 0, border: "1px dashed #0f766e", outline: "none", background: "rgba(255,255,255,0.85)",
        resize: "none", overflow: "hidden", whiteSpace: "pre-wrap",
      }}
    />
  );
}
```

- [ ] **Step 6: Text properties + install**

`apps/web/src/components/editor/text/TextProps.tsx`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { TextAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { t } from "@/lib/strings";
import { boxFonts, relayout, withStyle, type TextStyle } from "@/lib/textbox";
import { editorStore, useEditor } from "@/store/editor";
import { ColorField } from "../ColorField";
import { textEditStore } from "./textEdit";

async function applyToSelected(patch: Partial<TextStyle>) {
  const s = editorStore.getState();
  const op = s.selection ? (s.doc.objects[s.selection] as TextAdd | undefined) : undefined;
  if (!op || op.type !== "text.add") return;
  const styled = withStyle(op.box, patch);
  await Promise.all(boxFonts(styled).map((f) => fontStore.load(f)));
  s.updateObject(op.id, { box: relayout(styled, (f) => fontStore.get(f)) } as Partial<TextAdd>);
}

export function TextProps() {
  const style = useEditor((s) => s.style);
  const editing = useStore(textEditStore, (s) => s.editing);
  const selected = useEditor((s) => (s.selection ? (s.doc.objects[s.selection] as TextAdd | undefined) : undefined));
  const [families, setFamilies] = useState<string[]>(["Arimo", "Tinos", "Cousine"]);
  useEffect(() => { fontStore.families().then(setFamilies).catch(() => {}); }, []);

  const box = editing?.box ?? (selected?.type === "text.add" ? selected.box : null);
  const run = box?.paragraphs[0]?.[0];
  const cur: TextStyle = run
    ? { family: run.font.family, bold: run.font.bold ?? false, italic: run.font.italic ?? false, size: run.size, color: run.color, align: box!.align ?? "left" }
    : { family: style.fontFamily, bold: style.bold, italic: style.italic, size: style.fontSize, color: style.color, align: style.align };

  function set(patch: Partial<TextStyle>) {
    const s = editorStore.getState();
    s.setStyle({
      ...(patch.family !== undefined && { fontFamily: patch.family }),
      ...(patch.size !== undefined && { fontSize: patch.size }),
      ...(patch.bold !== undefined && { bold: patch.bold }),
      ...(patch.italic !== undefined && { italic: patch.italic }),
      ...(patch.color !== undefined && { color: patch.color }),
      ...(patch.align !== undefined && { align: patch.align }),
    });
    const e = textEditStore.getState().editing;
    if (e) {
      textEditStore.getState().update(withStyle(e.box, patch));
      boxFonts(withStyle(e.box, patch)).forEach((f) => fontStore.load(f));
    } else {
      void applyToSelected(patch);
    }
  }

  const toggle = (on: boolean) => `h-8 w-8 rounded-md ${on ? "bg-accent/10 text-accent" : "hover:bg-bg"}`;
  return (
    <div className="flex items-center gap-2" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== "SELECT" && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}>
      <select aria-label={t.editor.font} value={cur.family} onChange={(e) => set({ family: e.target.value })} className="rounded border border-line px-1 py-1">
        {families.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <input aria-label={t.editor.fontSize} type="number" min={4} max={200} value={cur.size}
        onChange={(e) => { const v = Number(e.target.value); if (v >= 4 && v <= 200) set({ size: v }); }}
        className="w-16 rounded border border-line px-1 py-1" />
      <button aria-label="Tebal" aria-pressed={cur.bold} className={`${toggle(cur.bold)} font-bold`} onClick={() => set({ bold: !cur.bold })}>B</button>
      <button aria-label="Miring" aria-pressed={cur.italic} className={`${toggle(cur.italic)} italic`} onClick={() => set({ italic: !cur.italic })}>I</button>
      <ColorField label={t.editor.color} value={cur.color} onChange={(v) => set({ color: v })} />
      {(["left", "center", "right"] as const).map((a) => (
        <button key={a} aria-label={{ left: t.editor.alignLeft, center: t.editor.alignCenter, right: t.editor.alignRight }[a]} aria-pressed={cur.align === a}
          className={toggle(cur.align === a)} onClick={() => set({ align: a })}>{{ left: "⇤", center: "↔", right: "⇥" }[a]}</button>
      ))}
    </div>
  );
}
```

Note: the textarea commits on blur; clicking a property control would blur it. The `onMouseDown` `preventDefault` above keeps focus in the textarea for buttons. For `select`/`input` controls focus moves and the box commits — acceptable in M1; the selected-op path then applies the change.

`apps/web/src/components/editor/text/install.ts`:
```ts
"use client";

import { createElement } from "react";
import type { TextAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { boxFonts, newBox, relayout } from "@/lib/textbox";
import { editorStore } from "@/store/editor";
import { overlayHooks } from "../PageOverlay";
import { textPropsSlot } from "../PropertiesBar";
import { TextNode } from "./TextNode";
import { TextProps } from "./TextProps";
import { textEditStore } from "./textEdit";

let installed = false;

export function installTextTool(): void {
  if (installed) return;
  installed = true;

  overlayHooks.onTextPointerDown = (pageKey, at) => {
    if (textEditStore.getState().editing) return; // the blur of the current editor commits first
    const st = editorStore.getState().style;
    const box = newBox(at, { family: st.fontFamily, bold: st.bold, italic: st.italic, size: st.fontSize, color: st.color, align: st.align });
    textEditStore.getState().start({ id: newId(), pageKey, box, isNew: true });
  };

  overlayHooks.onDoubleClick = (op) => {
    if (op.type !== "text.add") return;
    textEditStore.getState().start({ id: op.id, pageKey: op.pageKey, box: (op as TextAdd).box, isNew: false });
  };

  overlayHooks.renderText = (op) =>
    createElement(TextNode, { op, hidden: textEditStore.getState().editing?.id === op.id });

  overlayHooks.resizeText = (op, to) => {
    const box = { ...op.box, rect: { ...op.box.rect, x: to.x, y: to.y, w: Math.max(to.w, 10) } };
    const fontsReady = boxFonts(box).every((f) => { try { fontStore.get(f); return true; } catch { return false; } });
    return { ...op, box: fontsReady ? relayout(box, (f) => fontStore.get(f)) : box };
  };

  textPropsSlot.render = () => createElement(TextProps);
}
```

- [ ] **Step 7: Wire into Editor**

In `Editor.tsx`:
- `import { installTextTool } from "./text/install";` and call `installTextTool();` at module top level (below imports; it only mutates hook objects).
- `const TextEditor = dynamic(() => import("./text/TextEditor").then((m) => m.TextEditor), { ssr: false });`
- Overlay prop becomes: `overlay={(a) => <><PageOverlay {...a} /><TextEditor {...a} /></>}`
- Re-render Konva when editing starts/stops so the edited node hides: in `PageOverlay` this is driven by `renderText` reading `textEditStore` at render time; add to `Editor.tsx` a subscription that forces an overlay re-render: `const editingId = useStore(textEditStore, (s) => s.editing?.id);` and pass `key={editingId ?? "none"}` is too heavy — instead, in `PageOverlay.tsx` add `useStore(textEditStore, (s) => s.editing?.id)` (import `textEditStore` from `./text/textEdit`) so the overlay re-renders when editing changes.
- After `init`, preload fonts of restored text ops:
```ts
const ops = Object.values(editorStore.getState().doc.objects).filter((o) => o.type === "text.add") as TextAdd[];
await Promise.all(ops.flatMap((o) => boxFonts(o.box)).map((f) => fontStore.load(f)));
```
- In `PropertiesBar.tsx`'s `kindOf`, also return `"text"` when `textEditStore.getState().editing` is set (read it with `useStore(textEditStore, (s) => !!s.editing)` in the component and treat `editing ? "text" : kindOf(...)`).

- [ ] **Step 8: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run build -w apps/web` → succeed.

Manual:
1. Teks tool → click on a page → textarea appears → type "Halo Edith" + Enter + "baris dua" → click elsewhere → text drawn, box selected, tool back to Pilih; one Ctrl+Z removes it.
2. Change font to Tinos, size 24, bold, red, center → box updates and re-wraps.
3. Drag the right handle narrower → text re-wraps.
4. Double-click → edit text → click away → updated.
5. Unduh → open the PDF in a viewer: text at the same place, same line breaks, font Tinos-Bold, red.
6. Reload the page → draft restored with text drawn correctly.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): add text tool with client layout matching the bake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
