import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { getChars } from "@/lib/api";
import type { CharLine } from "@/lib/markup";

/** Character boxes of original pages (text markup), fetched per source page on first use. */
export interface CharsState {
  docId: string | null;
  /** Source page index → its lines; "loading" while fetched; "error" when it failed. */
  pages: Record<number, CharLine[] | "loading" | "error">;
  load(docId: string, index: number): Promise<void>;
}

export const charsStore = createStore<CharsState>()((set, get) => ({
  docId: null, pages: {},
  async load(docId, index) {
    if (get().docId !== docId) set({ docId, pages: {} });
    const cur = get().pages[index];
    if (cur !== undefined && cur !== "error") return;
    set({ pages: { ...get().pages, [index]: "loading" } });
    let result: CharLine[] | "error";
    try {
      result = await getChars(docId, index);
    } catch (e) {
      console.warn("chars: load failed", e);
      result = "error";
    }
    if (get().docId === docId) set({ pages: { ...get().pages, [index]: result } });
  },
}));

export function useChars<T>(selector: (s: CharsState) => T): T {
  return useStore(charsStore, selector);
}

const NONE: CharLine[] = [];

/** Loaded lines of a source page (none while loading, after an error, or for blank pages). */
export function charLines(index: number | null, pages: CharsState["pages"] = charsStore.getState().pages): CharLine[] {
  const v = index === null ? undefined : pages[index];
  return Array.isArray(v) ? v : NONE;
}
