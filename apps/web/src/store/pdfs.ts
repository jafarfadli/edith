import { createStore } from "zustand/vanilla";
import { useEffect } from "react";
import { useStore } from "zustand";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { fileUrl } from "@/lib/api";
import { destroyPdf, loadPdf } from "@/lib/pdf";

/** pdf.js documents by doc id: the edited PDF and every imported one. Loaded once, on first use. */
export interface PdfsState {
  docs: Record<string, PDFDocumentProxy | "loading" | "error">;
  /** Registers an already loaded document (the editor's main PDF). */
  put(docId: string, pdf: PDFDocumentProxy): void;
  load(docId: string): Promise<void>;
  /** Destroys every document (the editor closed or opened another file). */
  reset(): void;
}

export const pdfStore = createStore<PdfsState>()((set, get) => ({
  docs: {},
  put(docId, pdf) { set({ docs: { ...get().docs, [docId]: pdf } }); },
  async load(docId) {
    const cur = get().docs[docId];
    if (cur !== undefined && cur !== "error") return;
    set({ docs: { ...get().docs, [docId]: "loading" } });
    let result: PDFDocumentProxy | "error";
    try {
      result = await loadPdf(fileUrl(docId));
    } catch (e) {
      console.warn("pdf: load failed", docId, e);
      result = "error";
    }
    if (get().docs[docId] !== "loading") { // reset meanwhile
      if (result !== "error") destroyPdf(result);
      return;
    }
    set({ docs: { ...get().docs, [docId]: result } });
  },
  reset() {
    for (const d of Object.values(get().docs)) if (typeof d === "object") destroyPdf(d);
    set({ docs: {} });
  },
}));

/** The pdf.js document of `docId` (null for blank pages or while loading); starts loading it when needed. */
export function usePdf(docId: string | null): PDFDocumentProxy | null {
  const d = useStore(pdfStore, (s) => (docId ? s.docs[docId] : undefined));
  // In an effect: load() updates the store, which must not happen while rendering.
  useEffect(() => { if (docId && d === undefined) void pdfStore.getState().load(docId); }, [docId, d]);
  return typeof d === "object" ? d : null;
}
