import { createStore } from "zustand/vanilla";
import type { Gap, Guide } from "@/lib/snap";

/** What PageOverlay shows while an object is dragged or resized: the smart guides and spacing gaps (page points), and
 *  a badge (`text` at screen pixel `at`, below the moving box: its size). Kept outside React state of the page so a drag redraws
 *  only the guides layer, not every object. `measure`: distances Alt shows from the selection to the hovered object. */
export interface SnapView {
  pageKey: string; guides: Guide[]; gaps: Gap[];
  badge: { at: [number, number]; text: string } | null;
}

export const snapStore = createStore<{ view: SnapView | null; show(v: SnapView): void; clear(): void }>()((set) => ({
  view: null,
  show: (view) => set({ view }),
  clear: () => set((s) => (s.view ? { view: null } : s)),
}));
