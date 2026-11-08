import { createStore } from "zustand/vanilla";

/** `action`: one button in the notice (e.g. "Coba lagi"); pressing it also closes the notice. */
export interface NoticeMsg { kind: "error" | "info"; text: string; action?: { label: string; run: () => void } }

/** Notices raised outside React (store actions such as a text commit); the editor shows the latest. */
export const noticeStore = createStore<{ notice: NoticeMsg | null; show(n: NoticeMsg): void }>()((set) => ({
  notice: null,
  show: (n) => set({ notice: { ...n } }), // a fresh object: the same message twice still notifies
}));

export const INFO_NOTICE_MS = 5_000;
/** An info notice with a button ("Buka di tab baru") stays long enough to reach the button. */
export const ACTION_NOTICE_MS = 20_000;

/** How long a notice shows before it goes away by itself; null: until closed (errors). */
export function noticeLifetime(n: NoticeMsg): number | null {
  if (n.kind !== "info") return null;
  return n.action ? ACTION_NOTICE_MS : INFO_NOTICE_MS;
}
