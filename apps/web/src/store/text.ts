import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { fontFileUrl, getText, type DocFont, type Paragraph } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import type { PageSrc } from "@/store/editor";

/** Original text of the open document (GET /documents/{id}/text), loaded once after the editor opens. */
export interface TextState {
  status: "idle" | "loading" | "ready" | "error";
  docId: string | null;
  pages: Record<number, Paragraph[]>;
  fonts: Record<string, DocFont>;
  load(docId: string): Promise<void>;
}

export const textStore = createStore<TextState>()((set, get) => ({
  status: "idle", docId: null, pages: {}, fonts: {},
  async load(docId) {
    set({ status: "loading", docId, pages: {}, fonts: {} });
    fontStore.setOriginalSource((ref) => fontFileUrl(docId, ref));
    try {
      const data = await getText(docId);
      if (get().docId !== docId) return;
      set({
        status: "ready",
        pages: Object.fromEntries(data.pages.map((p) => [p.index, p.paragraphs])),
        fonts: Object.fromEntries(data.fonts.map((f) => [f.ref, f])),
      });
    } catch (e) {
      console.warn("text extraction failed; original text cannot be edited", e);
      if (get().docId === docId) set({ status: "error" });
    }
  },
}));

export function useText<T>(selector: (s: TextState) => T): T {
  return useStore(textStore, selector);
}

const NONE: Paragraph[] = [];

/** Original paragraphs of a page source (none for blank pages or before loading). */
export function paragraphsOf(src: PageSrc, pages: Record<number, Paragraph[]> = textStore.getState().pages): Paragraph[] {
  return "doc" in src ? pages[src.index] ?? NONE : NONE;
}
