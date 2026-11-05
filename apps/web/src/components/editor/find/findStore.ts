"use client";

import { createStore } from "zustand/vanilla";
import type { Match } from "@/lib/search";

export interface FindState {
  open: boolean; query: string; replacement: string; caseSensitive: boolean; showReplace: boolean;
  /** Matches over the current document (kept fresh by FindBar) and the highlighted one. */
  matches: Match[]; current: number;
  /** Bumped when fonts used to measure highlights finish loading. */
  fontsVersion: number;
  /** Bumped by openFind so an already open bar takes the focus again. */
  focusTick: number;
  set(p: Partial<Omit<FindState, "set">>): void;
}

export const findStore = createStore<FindState>()((set) => ({
  open: false, query: "", replacement: "", caseSensitive: false, showReplace: false, matches: [], current: 0, fontsVersion: 0, focusTick: 0,
  set: (p) => set(p),
}));

export function openFind(): void {
  const s = findStore.getState();
  s.set({ open: true, focusTick: s.focusTick + 1 });
}
