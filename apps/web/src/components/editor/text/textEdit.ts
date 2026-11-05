"use client";

import { createStore } from "zustand/vanilla";
import type { BundledFont, TextAdd, TextBox } from "@edith/ops";
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

/** True when every font of `box` is already loaded (metrics available synchronously). */
export function fontsReady(box: TextBox): boolean {
  return boxFonts(box).every((f: BundledFont) => { try { fontStore.get(f); return true; } catch { return false; } });
}

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
  if (!fontsReady(withNewText)) {
    try {
      await Promise.all(boxFonts(withNewText).map((f) => fontStore.load(f)));
    } catch (err) {
      console.warn("text commit: font load failed", err);
      textEditStore.getState().start({ ...e, box: withNewText }); // keep the text editable instead of losing it
      return;
    }
  }
  const box = relayout(withNewText, (f) => fontStore.get(f));
  const st = editorStore.getState();
  if (e.isNew) {
    st.addObject({ id: e.id, type: "text.add", pageKey: e.pageKey, box } as TextAdd);
  } else {
    const cur = st.doc.objects[e.id] as TextAdd | undefined;
    if (!cur) return; // deleted meanwhile (e.g. undo)
    if (JSON.stringify(cur.box) !== JSON.stringify(box)) st.updateObject(e.id, { box } as Partial<TextAdd>);
  }
  // Selection is null while editing; if the click that ended editing selected another object, keep that one.
  const clickedOther = st.selection !== null && st.selection !== e.id;
  st.setTool("select");
  if (!clickedOther) st.select(e.id);
}
