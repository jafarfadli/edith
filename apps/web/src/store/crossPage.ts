import { createStore } from "zustand/vanilla";

/** An object dragged off its page onto another: the page it would land on, and where the dragged selection's box is
 *  on screen (client px), shown as a ghost (each page's canvas clips the object itself at its edges). */
export interface CrossPageView { pageKey: string; box: { left: number; top: number; width: number; height: number } }

export const crossPageStore = createStore<{ view: CrossPageView | null; show(v: CrossPageView): void; clear(): void }>()((set) => ({
  view: null,
  show: (view) => set({ view }),
  clear: () => set((s) => (s.view ? { view: null } : s)),
}));
