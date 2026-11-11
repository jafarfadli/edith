import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

/** Viewport state that is not part of the document: `space` is true while the Space bar is held — a drag then pans the
 *  canvas whatever the tool (Figma), and the page's overlay lets the pointer through to the scroller. */
export const viewStore = createStore<{ space: boolean; setSpace(on: boolean): void }>()((set) => ({
  space: false,
  setSpace: (space) => set((s) => (s.space === space ? s : { space })),
}));

export function useSpaceHeld(): boolean {
  return useStore(viewStore, (s) => s.space);
}
