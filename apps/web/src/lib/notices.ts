import { createStore } from "zustand/vanilla";

export interface NoticeMsg { kind: "error" | "info"; text: string }

/** Notices raised outside React (store actions such as a text commit); the editor shows the latest. */
export const noticeStore = createStore<{ notice: NoticeMsg | null; show(n: NoticeMsg): void }>()((set) => ({
  notice: null,
  show: (n) => set({ notice: { ...n } }), // a fresh object: the same message twice still notifies
}));
