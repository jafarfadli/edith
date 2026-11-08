import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { FontRef, Run } from "@edith/ops";
import { fontFileUrl, getText, type DocFont, type Paragraph, type TextData } from "@/lib/api";
import { documentScript } from "@/lib/fallback";
import { fontId, fontStore, isOriginal } from "@/lib/fonts";
import type { FontTable } from "@/lib/richtext";
import { srcKey, type ParagraphPages } from "@/lib/sources";
import type { PageSrc } from "@/store/editor";

/** Original text of the open document and of every PDF imported into it (GET /documents/{id}/text), each
 *  loaded once. Paragraphs are keyed by `srcKey(doc, index)`, fonts by `fontId` — runs of an imported PDF
 *  name it in their original FontRefs (`doc`). `status` is the edited document's. */
export interface TextState {
  status: "idle" | "loading" | "ready" | "error";
  docId: string | null;
  pages: ParagraphPages;
  fonts: FontTable;
  /** Load status of imported PDFs' text. */
  imports: Record<string, "loading" | "ready" | "error">;
  load(docId: string): Promise<void>;
  loadImport(docId: string): Promise<void>;
}

/** `data` with every original font naming document `doc` (the imported PDF it was extracted from). */
function tagged(data: TextData, doc: string | null): { pages: ParagraphPages; fonts: FontTable } {
  const tag = (f: FontRef): FontRef => (doc && isOriginal(f) ? { ...f, doc } : f);
  const run = (r: Run): Run => ({ ...r, font: tag(r.font) });
  const pages: ParagraphPages = {};
  for (const p of data.pages) pages[srcKey(doc ?? data.doc_id, p.index)] = p.paragraphs.map((g) => ({ ...g, runs: g.runs.map(run) }));
  const fonts: FontTable = {};
  for (const f of data.fonts) {
    const font: DocFont = doc ? { ...f, doc } : f;
    fonts[fontId({ kind: "original", ref: f.ref, doc })] = font;
  }
  return { pages, fonts };
}

export const textStore = createStore<TextState>()((set, get) => ({
  status: "idle", docId: null, pages: {}, fonts: {}, imports: {},
  async load(docId) {
    set({ status: "loading", docId, pages: {}, fonts: {}, imports: {} });
    fontStore.setOriginalSource((f) => fontFileUrl(f.doc ?? docId, f.ref));
    try {
      const data = await getText(docId);
      if (get().docId !== docId) return;
      const t = tagged({ ...data, doc_id: docId }, null);
      // Han characters typed into this document fall back to the CJK font of its own script (Korean, Japanese …).
      fontStore.setHanScript(documentScript(data.pages.flatMap((p) => p.paragraphs.flatMap((g) => g.runs.map((r) => r.text)))));
      set({ status: "ready", pages: { ...get().pages, ...t.pages }, fonts: { ...get().fonts, ...t.fonts } });
    } catch (e) {
      console.warn("text extraction failed; original text cannot be edited", e);
      if (get().docId === docId) set({ status: "error" });
    }
  },
  async loadImport(docId) {
    const cur = get().imports[docId];
    if (cur === "loading" || cur === "ready") return;
    const main = get().docId;
    set({ imports: { ...get().imports, [docId]: "loading" } });
    try {
      const t = tagged(await getText(docId), docId);
      if (get().docId !== main) return;
      set({ pages: { ...get().pages, ...t.pages }, fonts: { ...get().fonts, ...t.fonts }, imports: { ...get().imports, [docId]: "ready" } });
    } catch (e) {
      console.warn("text extraction of an imported PDF failed", docId, e);
      if (get().docId === main) set({ imports: { ...get().imports, [docId]: "error" } });
    }
  },
}));

export function useText<T>(selector: (s: TextState) => T): T {
  return useStore(textStore, selector);
}

const NONE: Paragraph[] = [];

/** Original paragraphs of a page source (none for blank pages or before loading). */
export function paragraphsOf(src: PageSrc, pages: ParagraphPages = textStore.getState().pages): Paragraph[] {
  return "doc" in src ? pages[srcKey(src.doc, src.index)] ?? NONE : NONE;
}
