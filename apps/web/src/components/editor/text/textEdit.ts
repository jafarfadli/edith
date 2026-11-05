"use client";

import { createStore } from "zustand/vanilla";
import type { TextAdd, TextBox } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { boxFonts, newBox, relayout, withText } from "@/lib/textbox";
import { newId } from "@/lib/id";
import { editorStore } from "@/store/editor";

type Pt = [number, number];

export interface Editing { id: string; pageKey: string; box: TextBox; isNew: boolean }

interface TextEditState { editing: Editing | null; start(e: Editing): void; update(box: TextBox): void; finish(): void }

export const textEditStore = createStore<TextEditState>()((set, get) => ({
  editing: null,
  start: (editing) => set({ editing }),
  update: (box) => { const e = get().editing; if (e) set({ editing: { ...e, box } }); },
  finish: () => set({ editing: null }),
}));

/** True when every font of `box` is already loaded (metrics available synchronously). */
export function fontsReady(box: TextBox): boolean {
  return boxFonts(box).every((f) => fontStore.peek(f) !== null);
}

/** The commit that is waiting for its fonts (the text box is not in the document yet). */
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

/** Start a new text box at `at`; ignored while an editor is open or a commit is still landing. */
export function startTextAt(pageKey: string, at: Pt): void {
  if (textEditStore.getState().editing || pendingCommit) return;
  const st = editorStore.getState().style;
  const box = newBox(at, { family: st.fontFamily, bold: st.bold, italic: st.italic, size: st.fontSize, color: st.color, align: st.align });
  textEditStore.getState().start({ id: newId(), pageKey, box, isNew: true });
}

export function commitEditing(text: string): Promise<void> {
  const e = textEditStore.getState().editing;
  if (!e) return Promise.resolve();
  textEditStore.getState().finish();
  const s = editorStore.getState();
  if (!text.trim()) {
    if (!e.isNew) s.deleteObject(e.id);
    return Promise.resolve();
  }
  const withNewText = withText(e.box, text);
  if (fontsReady(withNewText)) {
    land(e, withNewText);
    return Promise.resolve();
  }
  const p: Promise<void> = (async () => {
    try {
      await Promise.all(boxFonts(withNewText).map((f) => fontStore.load(f)));
    } catch (err) {
      console.warn("text commit: font load failed", err);
      textEditStore.getState().start({ ...e, box: withNewText }); // keep the text editable instead of losing it
      return;
    }
    land(e, withNewText);
  })().finally(() => { if (pendingCommit === p) pendingCommit = null; });
  pendingCommit = p;
  return p;
}

function land(e: Editing, withNewText: TextBox): void {
  const box = relayout(withNewText, (f) => fontStore.get(f));
  const st = editorStore.getState();
  if (e.isNew) {
    st.addObject({ id: e.id, type: "text.add", pageKey: e.pageKey, box } as TextAdd);
  } else {
    const cur = st.doc.objects[e.id] as TextAdd | undefined;
    if (!cur) return; // deleted meanwhile (e.g. undo)
    if (JSON.stringify(cur.box) !== JSON.stringify(box)) st.updateObject(e.id, { box } as Partial<TextAdd>);
  }
  // Another editing session started while the fonts loaded: leave tool/selection to it.
  if (textEditStore.getState().editing) return;
  // Selection is null while editing; if the click that ended editing selected another object, keep that one.
  const clickedOther = st.selection !== null && st.selection !== e.id;
  st.setTool("select");
  if (!clickedOther) st.select(e.id);
}
