# Task 12: Web — Tiptap rich editor, rich properties, decorations in Konva

**Files:**
- Modify: `apps/web/package.json` + `package-lock.json` (Tiptap dependencies)
- Create: `apps/web/src/components/editor/text/runMark.ts`
- Rewrite: `apps/web/src/components/editor/text/textEdit.ts`, `textEdit.test.ts`, `TextEditor.tsx`, `TextNode.tsx`, `TextProps.tsx`, `install.ts` (all in `apps/web/src/components/editor/text/`)
- Modify: `apps/web/src/components/editor/PageOverlay.tsx`, `apps/web/src/components/editor/Editor.tsx`, `apps/web/src/lib/strings.ts`

**Interfaces:**
- Consumes: Task 8 `textStore`, `runsText`, `normalizeRuns`, `paragraphsEqual`, `decorBands`; Task 9 `prepareRuns`, `resolveRunFonts`; Task 10 `isTextOp`, `updateObject(…, {coalesce})`; Task 11 `RunAttrs`, `attrsOf`, `applyPatch`, `fontStyle`, `runsToDoc`, `docToRuns`, `runCss`, `withStyle`, `BoxPatch`.
- Produces:
  ```ts
  // text/textEdit.ts
  export interface Editing { id: string; pageKey: string; box: TextBox; isNew: boolean; kind: "text.add" | "text.edit"; paragraphId?: string; initial?: Run[][] }
  export const textEditStore: StoreApi<{
    editing: Editing | null; current: RunAttrs | null; paragraph: { pageKey: string; id: string } | null;
    start(e: Editing): void; update(box: TextBox): void; finish(): void;
    setCurrent(a: RunAttrs | null): void; selectParagraph(p: { pageKey: string; id: string } | null): void }>;
  export const session: { editor: Editor | null; paragraphs: Run[][] | null };  // live Tiptap editor + its content as runs
  export function fontsReady(box: TextBox): boolean
  export function whenTextCommitted(): Promise<void>
  export function afterTextCommitted(action: () => void): void
  export function startTextAt(pageKey: string, at: [number, number]): void   // only with the text tool
  export function commitOpenSession(): Promise<void>                        // commits session.paragraphs
  export function commitEditing(paragraphs: Run[][]): Promise<void>
  // text/runMark.ts — Tiptap mark "run" (attrs = RunAttrs) with command updateRuns(fn: (a: RunAttrs) => RunAttrs)
  export function createRunMark(fallback: () => RunAttrs): Mark
  ```
  - `commitEditing`: blank text in a `text.add` session adds nothing (deletes an existing box); a `text.edit` session always lands an op (empty = the original paragraph removed) unless it is new and its paragraphs equal `initial`; runs are normalized, fonts resolved (original → substitute → Arimo, `prepareRuns`), relaid out; one history entry; then tool = select and the op selected (M1 behaviour).
  - Session end: a pointerdown anywhere outside the editor and outside `[data-text-props]` (capture phase, before the press acts), Esc, Ctrl/Cmd+Enter, or the editor unmounting.
  - `PageOverlay`'s `overlayHooks.renderText/resizeText` take `TextAdd | TextEdit`; text ops of both types are drawn by `TextNode`, resized width-only, double-click opens a session of their kind.
  - `TextProps` root carries `data-text-props`; it styles the editor selection while a session is open (`session.editor.chain().focus().updateRuns(…)`), else the whole selected text op (`withStyle` + `prepareRuns` + `relayout`, coalesce key `text-style:<id>`), and always remembers the style for the next box.
  - New strings `t.text.*` (`underline`, `strike`, `background`, `noBackground`, `alignJustify`, `originalFont(name)`, `revert`, `scanned`).
  - The editor element keeps `data-testid="text-editor"` (the ProseMirror root), so the M1 E2E still drives it with `fill()`.

- [ ] **Step 1: Install Tiptap**

Run: `npm install -w apps/web @tiptap/core@^3.32.2 @tiptap/pm@^3.32.2 @tiptap/react@^3.32.2 @tiptap/extension-document@^3.32.2 @tiptap/extension-paragraph@^3.32.2 @tiptap/extension-text@^3.32.2 @tiptap/extensions@^3.32.2`
Expected: the seven packages appear under `dependencies` in `apps/web/package.json`; `package-lock.json` updated.

- [ ] **Step 2: Failing session tests**

`apps/web/src/components/editor/text/textEdit.test.ts` (replace):
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FontRef, Run, TextEdit } from "@edith/ops";
import { fontStore, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { newBox } from "@/lib/textbox";
import { editorStore, type DocInfo } from "@/store/editor";
import { textStore } from "@/store/text";
import { afterTextCommitted, commitEditing, startTextAt, textEditStore, whenTextCommitted } from "./textEdit";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "abc", fileName: "a.pdf",
  pages: [{ index: 0, width: 595, height: 842, rotation: 0, hasText: true }],
};
const arimo = metricsFromBuffer(readFileSync(path.resolve(__dirname, "../../../../../../packages/fonts/files/Arimo-Regular.ttf")));
/** An "original" font that only has the glyphs of "Halo ". */
const original: FontMetrics = { ...arimo, hasGlyph: (cp) => "Halo ".includes(String.fromCodePoint(cp)) };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

let fontsLoaded = false;
let gate: ReturnType<typeof deferred>;
const metricsOf = (f: FontRef) => (isOriginal(f) ? original : arimo);

beforeEach(() => {
  fontsLoaded = false;
  gate = deferred();
  editorStore.getState().init(info);
  textEditStore.setState({ editing: null, current: null, paragraph: null });
  textStore.setState({ fonts: { f7: { ref: "f7", name: "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold: false, italic: false, substitute: { kind: "bundled", family: "Carlito", bold: false, italic: false } } } });
  vi.spyOn(fontStore, "load").mockImplementation(async (f) => { await gate.promise; fontsLoaded = true; return metricsOf(f); });
  vi.spyOn(fontStore, "peek").mockImplementation((f) => (fontsLoaded ? metricsOf(f) : null));
  vi.spyOn(fontStore, "get").mockImplementation((f): FontMetrics => {
    if (!fontsLoaded) throw new Error("font not loaded");
    return metricsOf(f);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const style = { family: "Arimo", bold: false, italic: false, size: 14, color: "#111111", align: "left" as const };
const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const runs = (text: string, f: FontRef = font): Run[][] => [[{ text, font: f, size: 14, color: "#111111" }]];

function openSession(id = "t1") {
  textEditStore.getState().start({ id, pageKey: "o0", box: newBox([100, 400], style), isNew: true, kind: "text.add" });
}

function openParagraph(text: string, f: FontRef = font) {
  const box = { ...newBox([72, 90], style), paragraphs: runs(text, f) };
  textEditStore.getState().start({ id: "e1", pageKey: "o0", box, isNew: true, kind: "text.edit", paragraphId: "g3", initial: box.paragraphs });
}

describe("text commit while fonts load", () => {
  it("whenTextCommitted resolves only after the op is in the document", async () => {
    openSession();
    const commit = commitEditing(runs("Halo"));
    expect(editorStore.getState().doc.objects.t1).toBeUndefined();

    let settled = false;
    const waiter = whenTextCommitted().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve();
    await waiter;
    expect(editorStore.getState().doc.objects.t1).toBeDefined();
    await commit;
    expect(editorStore.getState().selection).toBe("t1");
  });

  it("whenTextCommitted resolves immediately when nothing is pending", async () => {
    await expect(whenTextCommitted()).resolves.toBeUndefined();
  });

  it("does not start a new box during the pending window, and does afterwards with the text tool", async () => {
    openSession();
    editorStore.getState().setTool("text");
    const commit = commitEditing(runs("Halo"));
    startTextAt("o0", [10, 10]);
    expect(textEditStore.getState().editing).toBeNull();
    gate.resolve();
    await commit;
    startTextAt("o0", [10, 10]); // the commit switched to the select tool
    expect(textEditStore.getState().editing).toBeNull();
    editorStore.getState().setTool("text");
    startTextAt("o0", [10, 10]);
    expect(textEditStore.getState().editing).not.toBeNull();
  });

  it("undo requested during the pending window runs after the box landed", async () => {
    openSession();
    const commit = commitEditing(runs("Halo"));
    afterTextCommitted(() => editorStore.getState().undo());
    gate.resolve();
    await commit;
    await whenTextCommitted();
    await Promise.resolve();
    expect(editorStore.getState().doc.objects.t1).toBeUndefined(); // added, then undone, in that order
    editorStore.getState().redo();
    expect(editorStore.getState().doc.objects.t1).toBeDefined();
  });

  it("leaves tool/selection alone if another session started meanwhile", async () => {
    openSession();
    const commit = commitEditing(runs("Halo"));
    editorStore.getState().setTool("text");
    textEditStore.getState().start({ id: "t2", pageKey: "o0", box: newBox([5, 5], style), isNew: true, kind: "text.add" });
    gate.resolve();
    await commit;
    expect(editorStore.getState().doc.objects.t1).toBeDefined();
    expect(editorStore.getState().tool).toBe("text");
  });
});

describe("editing an original paragraph", () => {
  beforeEach(() => { gate.resolve(); fontsLoaded = true; });

  it("adds a text.edit op for the paragraph, as one undo step", async () => {
    openParagraph("Halo dunia");
    await commitEditing(runs("Halo semua"));
    const op = editorStore.getState().doc.objects.e1 as TextEdit;
    expect(op).toMatchObject({ type: "text.edit", pageKey: "o0", paragraphId: "g3" });
    expect(op.box.layout.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["Halo semua"]);
    editorStore.getState().undo();
    expect(editorStore.getState().doc.objects.e1).toBeUndefined();
  });

  it("adds nothing when the text did not change", async () => {
    openParagraph("Halo dunia");
    await commitEditing(runs("Halo dunia"));
    expect(editorStore.getState().doc.order).toEqual([]);
  });

  it("keeps an emptied paragraph as an op (the original text is removed)", async () => {
    openParagraph("Halo dunia");
    await commitEditing(runs(""));
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.layout).toEqual([{ baseline: expect.any(Number), segments: [] }]);
  });

  it("swaps an original font for its substitute when a new character has no glyph", async () => {
    const orig = { kind: "original" as const, ref: "f7" };
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo", orig));
    expect(editorStore.getState().doc.order).toEqual([]); // unchanged
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo!", orig));
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0][0].font)
      .toEqual({ kind: "bundled", family: "Carlito", bold: false, italic: false });
  });
});
```

Run: `npm test -w apps/web`
Expected: FAIL — type/shape errors (`commitEditing` still takes a string, `Editing` has no `kind`), e.g. the "editing an original paragraph" tests find no `text.edit` op.

- [ ] **Step 3: Session logic**

`apps/web/src/components/editor/text/textEdit.ts` (replace):
```ts
"use client";

import { createStore } from "zustand/vanilla";
import type { Editor } from "@tiptap/core";
import type { ContentOp, Run, TextBox } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { prepareRuns, resolveRunFonts } from "@/lib/paragraphs";
import { attrsOf, type RunAttrs } from "@/lib/richtext";
import { normalizeRuns, paragraphsEqual, runsText } from "@/lib/runs";
import { boxFonts, newBox, relayout } from "@/lib/textbox";
import { editorStore } from "@/store/editor";
import { textStore } from "@/store/text";

type Pt = [number, number];

/** An open rich-text session: a text box being added/edited, or an original paragraph being rewritten. */
export interface Editing {
  id: string; pageKey: string; box: TextBox; isNew: boolean;
  kind: "text.add" | "text.edit";
  paragraphId?: string;
  /** Paragraphs the session started with (a new text.edit that ends unchanged adds nothing). */
  initial?: Run[][];
}

interface TextEditState {
  editing: Editing | null;
  /** Style at the rich editor's selection, for the properties bar. */
  current: RunAttrs | null;
  /** Selected original paragraph (select tool; not an op yet — Task 13). */
  paragraph: { pageKey: string; id: string } | null;
  start(e: Editing): void;
  update(box: TextBox): void;
  finish(): void;
  setCurrent(a: RunAttrs | null): void;
  selectParagraph(p: { pageKey: string; id: string } | null): void;
}

/** The live rich editor of the open session (a mutable Tiptap object, so not in the store) and its
 *  content as runs, kept current on every change (still readable after the editor unmounted). */
export const session: { editor: Editor | null; paragraphs: Run[][] | null } = { editor: null, paragraphs: null };

export const textEditStore = createStore<TextEditState>()((set, get) => ({
  editing: null, current: null, paragraph: null,
  start: (editing) => {
    session.paragraphs = editing.box.paragraphs;
    set({ editing, current: attrsOf(editing.box.paragraphs[0][0]), paragraph: null });
  },
  update: (box) => { const e = get().editing; if (e) set({ editing: { ...e, box } }); },
  finish: () => set({ editing: null, current: null }),
  setCurrent: (current) => set({ current }),
  selectParagraph: (paragraph) => set({ paragraph }),
}));

/** True when every font of `box` is loaded (metrics available synchronously). */
export function fontsReady(box: TextBox): boolean {
  return boxFonts(box).every((f) => fontStore.peek(f) !== null);
}

/** The commit that is waiting for its fonts (the text is not in the document yet). */
let pendingCommit: Promise<void> | null = null;

/** Resolves once no text commit is in flight; immediately when none is. */
export async function whenTextCommitted(): Promise<void> {
  while (pendingCommit) await pendingCommit;
}

/** Run `action` now, or right after the in-flight text commit lands (so undo/redo see the new box). */
export function afterTextCommitted(action: () => void): void {
  if (pendingCommit) void whenTextCommitted().then(action);
  else action();
}

/** Start a new text box at `at` (text tool); ignored while a session is open or a commit is landing. */
export function startTextAt(pageKey: string, at: Pt): void {
  const st = editorStore.getState();
  if (textEditStore.getState().editing || pendingCommit || st.tool !== "text") return;
  const s = st.style;
  const box = newBox(at, { family: s.fontFamily, bold: s.bold, italic: s.italic, size: s.fontSize, color: s.color, align: s.align });
  textEditStore.getState().start({ id: newId(), pageKey, box, isNew: true, kind: "text.add" });
}

/** Commits the open session with the rich editor's current content. */
export function commitOpenSession(): Promise<void> {
  const e = textEditStore.getState().editing;
  if (!e) return Promise.resolve();
  return commitEditing(session.paragraphs ?? e.box.paragraphs);
}

export function commitEditing(paragraphs: Run[][]): Promise<void> {
  const e = textEditStore.getState().editing;
  if (!e) return Promise.resolve();
  textEditStore.getState().finish();
  const s = editorStore.getState();
  const blank = paragraphs.every((p) => !runsText(p).trim());
  if (blank && e.kind === "text.add") {
    if (!e.isNew) s.deleteObject(e.id);
    return Promise.resolve();
  }
  const draft: TextBox = { ...e.box, paragraphs: paragraphs.map(normalizeRuns) };
  if (e.isNew && e.initial && paragraphsEqual(draft.paragraphs, e.initial)) return Promise.resolve(); // opened, not changed
  const fonts = textStore.getState().fonts;
  // Fast path: every font (after fallback) already loaded → land synchronously.
  let ready: TextBox | null = draft;
  for (let step = 0; step < 2 && ready; step++) {
    ready = fontsReady(ready) ? { ...ready, paragraphs: ready.paragraphs.map((p) => resolveRunFonts(p, fonts, (f) => fontStore.peek(f))) } : null;
  }
  if (ready && fontsReady(ready)) {
    land(e, relayout(ready, (f) => fontStore.get(f)));
    return Promise.resolve();
  }
  const p: Promise<void> = (async () => {
    let runs: Run[][];
    try {
      runs = await prepareRuns(draft.paragraphs, fonts);
    } catch (err) {
      console.warn("text commit: font load failed", err);
      textEditStore.getState().start({ ...e, box: draft }); // keep the text editable instead of losing it
      return;
    }
    land(e, relayout({ ...draft, paragraphs: runs }, (f) => fontStore.get(f)));
  })().finally(() => { if (pendingCommit === p) pendingCommit = null; });
  pendingCommit = p;
  return p;
}

function land(e: Editing, box: TextBox): void {
  const st = editorStore.getState();
  const op = (e.kind === "text.edit"
    ? { id: e.id, type: "text.edit", pageKey: e.pageKey, paragraphId: e.paragraphId!, box }
    : { id: e.id, type: "text.add", pageKey: e.pageKey, box }) as ContentOp;
  if (e.isNew) {
    st.addObject(op);
  } else {
    const cur = st.doc.objects[e.id] as { box: TextBox } | undefined;
    if (!cur) return; // deleted meanwhile (e.g. undo)
    if (JSON.stringify(cur.box) !== JSON.stringify(box)) st.updateObject(e.id, { box } as Partial<ContentOp>);
  }
  // Another session started while the fonts loaded: leave tool/selection to it.
  if (textEditStore.getState().editing) return;
  // Selection is null while editing; if the click that ended editing selected another object, keep that one.
  const clickedOther = st.selection !== null && st.selection !== e.id;
  st.setTool("select");
  if (!clickedOther) st.select(e.id);
}
```

Run: `npm test -w apps/web -- textEdit`
Expected: the 9 session tests pass (the components still fail tsc until Step 6).

- [ ] **Step 4: The `run` mark**

`apps/web/src/components/editor/text/runMark.ts`:
```ts
import { Mark } from "@tiptap/core";
import { runCss, type RunAttrs } from "@/lib/richtext";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    run: {
      /** Restyles every text in the selection with `fn` (or the style typed next, when the selection is empty). */
      updateRuns: (fn: (a: RunAttrs) => RunAttrs) => ReturnType;
    };
  }
}

const KEYS = ["font", "size", "color", "bgColor", "underline", "strike"] as const;

function readRun(el: HTMLElement): Partial<RunAttrs> {
  try { return JSON.parse(el.getAttribute("data-run") || "{}") as Partial<RunAttrs>; } catch { return {}; }
}

/** The one mark of the rich editor: a run's whole character style. `fallback` styles text that has none yet. */
export function createRunMark(fallback: () => RunAttrs) {
  return Mark.create({
    name: "run",
    inclusive: true,
    addAttributes() {
      const defaults: RunAttrs = { font: { kind: "bundled", family: "Arimo", bold: false, italic: false }, size: 12, color: "#000000", bgColor: null, underline: false, strike: false };
      return Object.fromEntries(KEYS.map((k) => [k, {
        default: defaults[k],
        rendered: false,
        parseHTML: (el: HTMLElement) => readRun(el)[k] ?? defaults[k],
      }]));
    },
    // Copy/paste inside the editor keeps styles: the attributes travel as JSON in data-run.
    parseHTML() { return [{ tag: "span[data-run]" }]; },
    renderHTML({ mark }) {
      const a = mark.attrs as RunAttrs;
      return ["span", { "data-run": JSON.stringify(a), style: runCss(a) }, 0];
    },
    addCommands() {
      return {
        updateRuns: (fn) => ({ state, tr, dispatch }) => {
          const type = state.schema.marks.run;
          const { from, to, empty } = state.selection;
          if (!dispatch) return true;
          if (empty) {
            const marks = state.storedMarks ?? state.selection.$from.marks();
            const cur = marks.find((m) => m.type === type)?.attrs as RunAttrs | undefined;
            tr.addStoredMark(type.create(fn(cur ?? fallback())));
            return true;
          }
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText) return;
            const cur = node.marks.find((m) => m.type === type)?.attrs as RunAttrs | undefined;
            tr.addMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), type.create(fn(cur ?? fallback())));
          });
          return true;
        },
      };
    },
  });
}
```

- [ ] **Step 5: Rich editor, Konva node, properties, hooks**

`apps/web/src/components/editor/text/TextEditor.tsx` (replace):
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { EditorContent, useEditor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import type { Editor } from "@tiptap/core";
import { toScreen, type PageGeom } from "@/lib/coords";
import { cssFamily, fontStore } from "@/lib/fonts";
import { attrsOf, docToRuns, runsToDoc, type RunAttrs } from "@/lib/richtext";
import { boxFonts } from "@/lib/textbox";
import { createRunMark } from "./runMark";
import { commitOpenSession, session, textEditStore, type Editing } from "./textEdit";

export function TextEditor({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const editing = useStore(textEditStore, (s) => s.editing);
  if (!editing || editing.pageKey !== pageKey) return null;
  // Keyed by the session: a new session mounts a fresh editor with that box's runs.
  return <RichArea key={editing.id} editing={editing} geom={geom} scale={scale} />;
}

/** Tells the properties bar the style at the selection. */
function publish(editor: Editor, fallback: RunAttrs) {
  const a = editor.getAttributes("run") as Partial<RunAttrs>;
  textEditStore.getState().setCurrent(a.font ? { ...fallback, ...a } as RunAttrs : fallback);
}

function RichArea({ editing, geom, scale }: { editing: Editing; geom: PageGeom; scale: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useStore(textEditStore, (s) => s.editing?.box ?? editing.box);
  // Style of text that has none yet (an empty box, pasted text); fixed for the session.
  const [fallback] = useState(() => attrsOf(editing.box.paragraphs[0][0]));
  const editingId = editing.id;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [Document, Paragraph, Text, UndoRedo, createRunMark(() => fallback)],
    content: runsToDoc(editing.box.paragraphs) as never,
    editorProps: { attributes: { "data-testid": "text-editor", spellcheck: "false", style: "outline:none" } },
    onUpdate: ({ editor }) => { session.paragraphs = docToRuns(editor.getJSON(), fallback); },
    onSelectionUpdate: ({ editor }) => publish(editor, fallback),
  });

  // useEditor may create the editor more than once (React StrictMode): track the live instance.
  useEffect(() => {
    if (!editor) return;
    session.editor = editor;
    editor.commands.focus("end");
    if (editor.isEmpty) editor.commands.updateRuns(() => fallback); // typed text gets the box style
    publish(editor, fallback);
    return () => { if (session.editor === editor) session.editor = null; };
  }, [editor, fallback]);

  useEffect(() => {
    boxFonts(editing.box).forEach((f) => { fontStore.load(f).catch(() => {}); });
    // A press outside the editor and the properties bar ends the session (before the press acts).
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && (wrap.current?.contains(t) || t.closest("[data-text-props]"))) return;
      void commitOpenSession();
    };
    document.addEventListener("pointerdown", onDown, true);
    const el = wrap.current;
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      // Unmounted while still editing (page scrolled out of range, page deleted): commit, don't lose the text.
      // Checked after a tick so StrictMode's dev-only effect replay (node stays mounted) doesn't commit.
      setTimeout(() => {
        if (el?.isConnected) return;
        if (textEditStore.getState().editing?.id === editingId) void commitOpenSession();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const [left, top] = toScreen([box.rect.x, box.rect.y], geom, scale);
  return (
    <div
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); void commitOpenSession(); }
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute", left, top, zIndex: 10,
        // +1 pt: the browser measures unquantized advances, slightly wider than the layout's.
        width: (box.rect.w + 1) * scale, minHeight: box.lineHeight * scale,
        transform: `rotate(${geom.rotation}deg)`, transformOrigin: "top left",
        ["--edith-scale" as string]: scale,
        fontFamily: `"${cssFamily(fallback.font)}"`, fontSize: fallback.size * scale, color: fallback.color,
        lineHeight: `${box.lineHeight * scale}px`, textAlign: box.align ?? "left",
        fontKerning: "none", fontVariantLigatures: "none", letterSpacing: 0,
        whiteSpace: "pre-wrap", overflowWrap: "break-word",
        outline: "1px dashed #0f766e", background: editing.kind === "text.edit" ? "#ffffff" : "rgba(255,255,255,0.85)",
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
```

`apps/web/src/components/editor/text/TextNode.tsx` (replace):
```tsx
"use client";

import { useEffect, useState } from "react";
import { Rect, Shape } from "react-konva";
import type { TextAdd, TextEdit } from "@edith/ops";
import { charOffsets, cssFamily, fontKey, fontStore, textWidth } from "@/lib/fonts";
import { decorBands } from "@/lib/textDecor";
import { boxFonts } from "@/lib/textbox";
import { fontsReady } from "./textEdit";

/** Draws a text box glyph-by-glyph at the PDF-quantized offsets — the same positions the API bakes —
 *  with backgrounds under and underline/strike over the glyphs, as the bake does. */
export function TextNode({ op, hidden }: { op: TextAdd | TextEdit; hidden: boolean }) {
  const { box } = op;
  const keys = boxFonts(box).map(fontKey).join("|");
  const [, setLoaded] = useState(0);
  const ready = fontsReady(box);

  useEffect(() => {
    if (ready) return;
    let alive = true;
    Promise.all(boxFonts(box).map((f) => fontStore.load(f)))
      .then(() => { if (alive) setLoaded((n) => n + 1); })
      .catch((err) => console.warn("text: font load failed", err));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, ready]);

  const runs = box.paragraphs.flat();
  const { x, y, w, h } = box.rect;
  return (
    <>
      <Rect x={x} y={y} width={w} height={h} fill="transparent" />
      {ready && !hidden && (
        <Shape
          listening={false}
          x={x}
          y={y}
          width={w}
          height={h}
          sceneFunc={(ctx) => {
            const c = ctx._context as CanvasRenderingContext2D & { fontKerning?: string };
            c.save();
            c.textBaseline = "alphabetic";
            c.textAlign = "left";
            if ("fontKerning" in c) c.fontKerning = "none";
            // Same order as the bake: every background, then the glyphs, then underline/strike.
            const bands: { x: number; y: number; w: number; h: number; color: string; over: boolean }[] = [];
            for (const line of box.layout) {
              for (const seg of line.segments) {
                const r = runs[seg.runIndex];
                if (!r || !(r.bgColor || r.underline || r.strike)) continue;
                const d = decorBands(seg.x, line.baseline, textWidth(seg.text, fontStore.get(r.font), r.size), r);
                if (d.bg) bands.push({ ...d.bg, color: r.bgColor!, over: false });
                if (d.underline) bands.push({ ...d.underline, color: r.color, over: true });
                if (d.strike) bands.push({ ...d.strike, color: r.color, over: true });
              }
            }
            const fill = (over: boolean) => bands.filter((b) => b.over === over).forEach((b) => { c.fillStyle = b.color; c.fillRect(b.x, b.y, b.w, b.h); });
            fill(false);
            for (const line of box.layout) {
              for (const seg of line.segments) {
                const r = runs[seg.runIndex];
                if (!r) continue;
                const m = fontStore.get(r.font);
                c.font = `${r.size}px "${cssFamily(r.font)}"`;
                c.fillStyle = r.color;
                const offs = charOffsets(seg.text, m, r.size);
                let i = 0;
                for (const ch of seg.text) {
                  c.fillText(ch, seg.x + offs[i], line.baseline);
                  i++;
                }
              }
            }
            fill(true);
            c.restore();
          }}
        />
      )}
    </>
  );
}
```

`apps/web/src/components/editor/text/TextProps.tsx` (replace):
```tsx
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { TextAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { isTextOp } from "@/lib/objects";
import { prepareRuns } from "@/lib/paragraphs";
import { applyPatch, attrsOf, docToRuns, fontStyle, type RunAttrs } from "@/lib/richtext";
import { t } from "@/lib/strings";
import { boxFonts, relayout, withStyle, type BoxPatch } from "@/lib/textbox";
import { editorStore, useEditor, type ToolStyle } from "@/store/editor";
import { textStore, useText } from "@/store/text";
import { ColorField } from "../ColorField";
import { session, textEditStore } from "./textEdit";

/** Restyles the whole selected text op (no session open). Repeated changes within a second are one undo step. */
async function applyToSelected(patch: BoxPatch) {
  const s = editorStore.getState();
  const op = s.selection ? s.doc.objects[s.selection] : undefined;
  if (!isTextOp(op)) return;
  const fonts = textStore.getState().fonts;
  try {
    const styled = withStyle(op.box, patch, fonts);
    const paragraphs = await prepareRuns(styled.paragraphs, fonts);
    if (!editorStore.getState().doc.objects[op.id]) return; // deleted while fonts loaded
    const box = relayout({ ...styled, paragraphs }, (f) => fontStore.get(f));
    editorStore.getState().updateObject(op.id, { box } as Partial<TextAdd>, { coalesce: `text-style:${op.id}` });
  } catch (err) {
    console.warn("text style: font load failed", err);
  }
}

/** Restyles the rich editor's selection. */
function applyToSession(patch: BoxPatch) {
  const e = textEditStore.getState().editing;
  if (!e) return;
  if (patch.align) textEditStore.getState().update({ ...e.box, align: patch.align });
  const runPatch: BoxPatch = { ...patch };
  delete runPatch.align;
  const editor = session.editor;
  if (!editor || !Object.keys(runPatch).length) return;
  const fonts = textStore.getState().fonts;
  editor.chain().focus().updateRuns((a) => applyPatch(a, runPatch, fonts)).run();
  const runs = docToRuns(editor.getJSON(), attrsOf(e.box.paragraphs[0][0]));
  boxFonts({ ...e.box, paragraphs: runs }).forEach((f) => { fontStore.load(f).catch(() => {}); });
}

const ALIGNS = ["left", "center", "right", "justify"] as const;
const ALIGN_ICON = { left: "⇤", center: "↔", right: "⇥", justify: "☰" } as const;

function toolAttrs(s: ToolStyle): RunAttrs {
  return { font: { kind: "bundled", family: s.fontFamily, bold: s.bold, italic: s.italic }, size: s.fontSize, color: s.color, bgColor: null, underline: false, strike: false };
}

export function TextProps() {
  const style = useEditor((s) => s.style);
  const editing = useStore(textEditStore, (s) => s.editing);
  const current = useStore(textEditStore, (s) => s.current);
  const selected = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
  const fonts = useText((s) => s.fonts);
  const [families, setFamilies] = useState<string[]>(["Arimo", "Tinos", "Cousine"]);
  useEffect(() => { fontStore.families().then(setFamilies).catch(() => {}); }, []);

  const box = editing?.box ?? (isTextOp(selected) ? selected.box : null);
  const attrs: RunAttrs = (editing && current) ?? (box ? attrsOf(box.paragraphs[0][0]) : toolAttrs(style));
  const fs = fontStyle(attrs.font, fonts);
  const align = box?.align ?? style.align;

  function set(patch: BoxPatch) {
    const next: Partial<ToolStyle> = {};
    if (patch.family !== undefined) next.fontFamily = patch.family;
    if (patch.size !== undefined) next.fontSize = patch.size;
    if (patch.bold !== undefined) next.bold = patch.bold;
    if (patch.italic !== undefined) next.italic = patch.italic;
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.align !== undefined) next.align = patch.align;
    editorStore.getState().setStyle(next);
    if (textEditStore.getState().editing) applyToSession(patch);
    else void applyToSelected(patch);
  }

  const toggle = (on: boolean) => `h-8 w-8 rounded-md ${on ? "bg-accent/10 text-accent" : "hover:bg-bg"}`;
  const alignLabel = { left: t.editor.alignLeft, center: t.editor.alignCenter, right: t.editor.alignRight, justify: t.text.alignJustify };
  const original = fs.original ? fonts[fs.original] : undefined;
  return (
    <div
      data-text-props
      className="flex items-center gap-2"
      // Keep focus in the rich editor for buttons (a select/input takes focus; the session stays open).
      onMouseDown={(e) => { const tag = (e.target as HTMLElement).tagName; if (tag !== "SELECT" && tag !== "INPUT") e.preventDefault(); }}
    >
      <select aria-label={t.editor.font} value={original ? `orig:${original.ref}` : fs.family}
        onChange={(e) => { if (!e.target.value.startsWith("orig:")) set({ family: e.target.value }); }}
        className="max-w-40 rounded border border-line px-1 py-1">
        {original && <option value={`orig:${original.ref}`}>{t.text.originalFont(original.name)}</option>}
        {families.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <input aria-label={t.editor.fontSize} type="number" min={4} max={200} step={0.5} value={attrs.size}
        onChange={(e) => { const v = Number(e.target.value); if (v >= 4 && v <= 200) set({ size: v }); }}
        className="w-16 rounded border border-line px-1 py-1" />
      <button type="button" aria-label={t.editor.bold} aria-pressed={fs.bold} className={`${toggle(fs.bold)} font-bold`} onClick={() => set({ bold: !fs.bold })}>B</button>
      <button type="button" aria-label={t.editor.italic} aria-pressed={fs.italic} className={`${toggle(fs.italic)} italic`} onClick={() => set({ italic: !fs.italic })}>I</button>
      <button type="button" aria-label={t.text.underline} aria-pressed={attrs.underline} className={`${toggle(attrs.underline)} underline`} onClick={() => set({ underline: !attrs.underline })}>U</button>
      <button type="button" aria-label={t.text.strike} aria-pressed={attrs.strike} className={`${toggle(attrs.strike)} line-through`} onClick={() => set({ strike: !attrs.strike })}>S</button>
      <ColorField label={t.editor.color} value={attrs.color} onChange={(v) => set({ color: v })} />
      <ColorField label={t.text.background} value={attrs.bgColor ?? "#ffff00"} onChange={(v) => set({ bgColor: v })} />
      <button type="button" aria-label={t.text.noBackground} aria-pressed={attrs.bgColor === null} className={toggle(attrs.bgColor === null)}
        onClick={() => set({ bgColor: null })}>⌀</button>
      {ALIGNS.map((a) => (
        <button key={a} type="button" aria-label={alignLabel[a]} aria-pressed={align === a}
          className={toggle(align === a)} onClick={() => set({ align: a })}>{ALIGN_ICON[a]}</button>
      ))}
    </div>
  );
}
```

`apps/web/src/components/editor/text/install.ts` (replace):
```ts
"use client";

import { createElement } from "react";
import { fontStore } from "@/lib/fonts";
import { isTextOp } from "@/lib/objects";
import { relayout } from "@/lib/textbox";
import { editorStore } from "@/store/editor";
import { overlayHooks } from "../PageOverlay";
import { textPropsSlot } from "../PropertiesBar";
import { TextNode } from "./TextNode";
import { TextProps } from "./TextProps";
import { fontsReady, startTextAt, textEditStore } from "./textEdit";

let installed = false;

export function installTextTool(): void {
  if (installed) return;
  installed = true;

  overlayHooks.onTextPointerDown = startTextAt;

  overlayHooks.onDoubleClick = (op) => {
    if (!isTextOp(op)) return;
    editorStore.getState().select(null); // hide the transformer while the rich editor is on top
    textEditStore.getState().start(op.type === "text.edit"
      ? { id: op.id, pageKey: op.pageKey, box: op.box, isNew: false, kind: "text.edit", paragraphId: op.paragraphId }
      : { id: op.id, pageKey: op.pageKey, box: op.box, isNew: false, kind: "text.add" });
  };

  overlayHooks.renderText = (op) =>
    createElement(TextNode, { op, hidden: textEditStore.getState().editing?.id === op.id });

  // Only the left/right anchors are enabled for text: keep y, change x/width, re-wrap.
  overlayHooks.resizeText = (op, to) => {
    const box = { ...op.box, rect: { ...op.box.rect, x: to.x, w: Math.max(to.w, 10) } };
    return { ...op, box: fontsReady(box) ? relayout(box, (f) => fontStore.get(f)) : box };
  };

  textPropsSlot.render = () => createElement(TextProps);
}
```

`apps/web/src/components/editor/PageOverlay.tsx`:
- `import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";` and add `isTextOp` to the `@/lib/objects` import.
- Replace the `overlayHooks` declaration with:
```ts
type TextOp = TextAdd | TextEdit;

export const overlayHooks: {
  onTextPointerDown?: (pageKey: string, at: Pt) => void;
  renderText?: (op: TextOp, selected: boolean) => React.ReactNode;
  resizeText?: (op: TextOp, to: { x: number; y: number; w: number; h: number }) => TextOp;
  onDoubleClick?: (op: ContentOp) => void;
} = {};
```
- In `onTransformEnd`, replace the `next` computation with:
```ts
                  const next = isTextOp(cur) && overlayHooks.resizeText
                    ? overlayHooks.resizeText(cur, to)
                    : resizeOp(cur, to);
```
- Replace the group's child expression with:
```tsx
                {isTextOp(op)
                  ? overlayHooks.renderText?.(op, selection === op.id) ?? null
                  : <ObjectShape op={op} docId={docId} />}
```
- In the `Transformer`, use `enabledAnchors={selection && isTextOp(objects[selection])` (instead of `objects[selection]?.type === "text.add"`).

`apps/web/src/components/editor/Editor.tsx`: replace `import type { TextAdd } from "@edith/ops";` with `import { isTextOp } from "@/lib/objects";` and the restored-text filter with `const texts = Object.values(editorStore.getState().doc.objects).filter(isTextOp);`.

`apps/web/src/lib/strings.ts`: insert before `errors: {`:
```ts
  text: {
    underline: "Garis bawah",
    strike: "Coret",
    background: "Latar",
    noBackground: "Tanpa latar",
    alignJustify: "Rata kiri-kanan",
    originalFont: (name: string) => `${name} (asli)`,
    revert: "Kembalikan teks asli",
    scanned: "Halaman ini berupa gambar; OCR belum tersedia",
  },
```

- [ ] **Step 6: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run e2e -w apps/web`
Expected: unit tests, types and lint pass; the M1 E2E (`editor.spec.ts`) still passes — its text box is now typed into the Tiptap editor.

Manual (`npm run dev:api` + `npm run dev:web`, upload any PDF):
1. Teks tool → click → type "Halo dunia" → double-click "dunia" → click B, U, pick a red color → click elsewhere: Konva shows "dunia" bold, underlined, red; one Ctrl+Z removes the box.
2. Select the box → change the size to 20 by typing in the field → the box re-wraps; one Ctrl+Z undoes the whole size change.
3. Unduh → the PDF shows the same runs, underline under "dunia".

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json package-lock.json apps/web/src
git commit -m "feat(web): rich text editing with Tiptap for text boxes and edit sessions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
