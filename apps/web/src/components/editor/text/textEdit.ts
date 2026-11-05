"use client";

import { createStore } from "zustand/vanilla";
import type { Editor } from "@tiptap/core";
import type { ContentOp, Run, TextBox } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { paragraphBox, prepareRuns, resolveLoadedRuns } from "@/lib/paragraphs";
import { attrsOf, type RunAttrs } from "@/lib/richtext";
import { normalizeRuns, paragraphsEqual, runsText } from "@/lib/runs";
import { boxFonts, boxLineHeight, newBox, relayout } from "@/lib/textbox";
import { editorStore, textEditFor } from "@/store/editor";
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
  /** Selected original paragraph (select tool; not an op yet). */
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
    if (editing.kind === "text.edit" && !editing.paragraphId) throw new Error(`text.edit session ${editing.id} has no paragraphId`);
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

/** The box that redraws original paragraph `p` with fonts that can draw it (loads them). */
export async function paragraphStartBox(p: Paragraph): Promise<TextBox> {
  const [runs] = await prepareRuns([p.runs], textStore.getState().fonts);
  return paragraphBox({ ...p, runs }, (f) => fontStore.get(f));
}

/** Opens original paragraph `p` for typing (its text.edit op, when it has one). */
export async function startParagraphEdit(pageKey: string, p: Paragraph): Promise<void> {
  if (textEditStore.getState().editing || pendingCommit) return;
  editorStore.getState().select(null);
  textEditStore.getState().selectParagraph(null);
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
  // Something else started (or landed an op for this paragraph) while the fonts loaded.
  if (textEditStore.getState().editing || pendingCommit || textEditFor(editorStore.getState().doc, pageKey, p.id)) return;
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
  if (textEditFor(st.doc, pageKey, p.id) || !st.doc.pages.some((pg) => pg.pageKey === pageKey)) return;
  const id = newId();
  st.addObject({ id, type: "text.edit", pageKey, paragraphId: p.id, box: relayout(change(box), (f) => fontStore.get(f)) } as ContentOp);
  textEditStore.getState().selectParagraph(null);
  if (!textEditStore.getState().editing) st.select(id);
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
  const normalized = paragraphs.map(normalizeRuns);
  // A text box's line spacing follows its sizes; an original paragraph keeps its own.
  const draft: TextBox = { ...e.box, paragraphs: normalized, ...(e.kind === "text.add" ? { lineHeight: boxLineHeight(normalized) } : {}) };
  if (e.isNew && e.initial && paragraphsEqual(draft.paragraphs, e.initial)) return Promise.resolve(); // opened, not changed
  const fonts = textStore.getState().fonts;
  // Fast path: every font (after the whole fallback chain) already loaded → land synchronously.
  const ready = resolveLoadedRuns(draft.paragraphs, fonts, (f) => fontStore.peek(f));
  if (ready) {
    land(e, relayout({ ...draft, paragraphs: ready }, (f) => fontStore.get(f)));
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
    ? { id: e.id, type: "text.edit", pageKey: e.pageKey, paragraphId: e.paragraphId as string, box } // checked in start()
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
