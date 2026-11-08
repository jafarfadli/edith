import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { getChars } from "@/lib/api";
import type { CharLine } from "@/lib/markup";
import { srcKey } from "@/lib/sources";

/** Character boxes of original pages (text markup), fetched per source page — of the edited PDF or an
 *  imported one, keyed by `srcKey(doc, index)` — on first use. */
export interface CharsState {
  /** Source page → its lines; "loading" while fetched; "error" when it failed. */
  pages: Record<string, CharLine[] | "loading" | "error">;
  load(docId: string, index: number): Promise<void>;
  /** Forgets every page (another document was opened). */
  reset(): void;
}

export const charsStore = createStore<CharsState>()((set, get) => ({
  pages: {},
  async load(docId, index) {
    const key = srcKey(docId, index);
    const cur = get().pages[key];
    if (cur !== undefined && cur !== "error") return;
    set({ pages: { ...get().pages, [key]: "loading" } });
    let result: CharLine[] | "error";
    try {
      result = await getChars(docId, index);
    } catch (e) {
      console.warn("chars: load failed", e);
      result = "error";
    }
    if (get().pages[key] === "loading") set({ pages: { ...get().pages, [key]: result } });
  },
  reset: () => set({ pages: {} }),
}));

export function useChars<T>(selector: (s: CharsState) => T): T {
  return useStore(charsStore, selector);
}

const NONE: CharLine[] = [];

/** Loaded lines of a source page `srcKey(doc, index)` (none while loading, after an error, or for blank pages). */
export function charLines(key: string | null, pages: CharsState["pages"] = charsStore.getState().pages): CharLine[] {
  const v = key === null ? undefined : pages[key];
  return Array.isArray(v) ? v : NONE;
}
