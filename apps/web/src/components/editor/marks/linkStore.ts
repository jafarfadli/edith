"use client";

import { createStore } from "zustand/vanilla";
import type { Rect } from "@edith/ops";

/** The link area just drawn with the link tool, waiting for its target in the LinkPopover. */
export const linkStore = createStore<{
  pending: { pageKey: string; rect: Rect } | null;
  open(p: { pageKey: string; rect: Rect }): void;
  close(): void;
  /** Id of the note just created: its text field takes focus once. */
  focusNote: string | null;
  setFocusNote(id: string | null): void;
}>()((set) => ({
  pending: null,
  open: (pending) => set({ pending }),
  close: () => set({ pending: null }),
  focusNote: null,
  setFocusNote: (focusNote) => set({ focusNote }),
}));
