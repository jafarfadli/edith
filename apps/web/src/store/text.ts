import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { FontRef, Rect, Run } from "@edith/ops";
import { ApiError, fontFileUrl, getText, ocrPage, type DocFont, type OcrParagraph, type OcrQuality, type Paragraph, type TextData } from "@/lib/api";
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
  /** Rects of images that look like print with no text over them (M5c), keyed like `pages`. */
  imageText: Record<string, Rect[]>;
  fonts: FontTable;
  /** Load status of imported PDFs' text. */
  imports: Record<string, "loading" | "ready" | "error">;
  /** OCR results (M5d), keyed like `pages`: asked for page by page, kept for the session (not in drafts: an edit of an
   *  OCR paragraph is a self-contained text.ocr_edit op). */
  ocr: Record<string, OcrPageState>;
  load(docId: string): Promise<void>;
  loadImport(docId: string): Promise<void>;
  /** Reads the pictures of print on page `index` of document `doc` (one page of a document at a time: a request while
   *  another of that document runs, or for a page already read, returns its state as it is). */
  runOcr(doc: string, index: number): Promise<OcrPageState>;
}

/** One page's OCR: running, done (`quality`, `paragraphs`: none unless "ok") or failed (`error`: an API error code). */
export interface OcrPageState {
  status: "loading" | "ready" | "error";
  quality?: OcrQuality; angle?: number; paragraphs: OcrParagraph[]; error?: string;
}

type Tagged = { pages: ParagraphPages; imageText: Record<string, Rect[]>; fonts: FontTable };

/** `data` with every original font naming document `doc` (the imported PDF it was extracted from). */
function tagged(data: TextData, doc: string | null): Tagged {
  const tag = (f: FontRef): FontRef => (doc && isOriginal(f) ? { ...f, doc } : f);
  const run = (r: Run): Run => ({ ...r, font: tag(r.font) });
  const pages: ParagraphPages = {};
  const imageText: Record<string, Rect[]> = {};
  for (const p of data.pages) {
    const key = srcKey(doc ?? data.doc_id, p.index);
    pages[key] = p.paragraphs.map((g) => ({ ...g, runs: g.runs.map(run) }));
    if (p.imageText?.length) imageText[key] = p.imageText;
  }
  const fonts: FontTable = {};
  for (const f of data.fonts) {
    const font: DocFont = doc ? { ...f, doc } : f;
    fonts[fontId({ kind: "original", ref: f.ref, doc })] = font;
  }
  return { pages, imageText, fonts };
}

/** `t` added to what the store holds. */
function merged(s: TextState, t: Tagged): Tagged {
  return { pages: { ...s.pages, ...t.pages }, imageText: { ...s.imageText, ...t.imageText }, fonts: { ...s.fonts, ...t.fonts } };
}

export const textStore = createStore<TextState>()((set, get) => ({
  status: "idle", docId: null, pages: {}, imageText: {}, fonts: {}, imports: {}, ocr: {},
  async load(docId) {
    set({ status: "loading", docId, pages: {}, imageText: {}, fonts: {}, imports: {}, ocr: {} });
    fontStore.setOriginalSource((f) => fontFileUrl(f.doc ?? docId, f.ref));
    try {
      const data = await getText(docId);
      if (get().docId !== docId) return;
      const t = tagged({ ...data, doc_id: docId }, null);
      // Han characters typed into this document fall back to the CJK font of its own script (Korean, Japanese …).
      fontStore.setHanScript(documentScript(data.pages.flatMap((p) => p.paragraphs.flatMap((g) => g.runs.map((r) => r.text)))));
      set({ status: "ready", ...merged(get(), t) });
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
      set({ ...merged(get(), t), imports: { ...get().imports, [docId]: "ready" } });
    } catch (e) {
      console.warn("text extraction of an imported PDF failed", docId, e);
      if (get().docId === main) set({ imports: { ...get().imports, [docId]: "error" } });
    }
  },
  async runOcr(doc, index) {
    const key = srcKey(doc, index);
    const cur = get().ocr[key];
    if (cur && cur.status !== "error") return cur;
    const busy = Object.entries(get().ocr).find(([k, v]) => v.status === "loading" && k.startsWith(doc + ":"));
    if (busy) return busy[1];
    const main = get().docId;
    const put = (v: OcrPageState) => { if (get().docId === main) set({ ocr: { ...get().ocr, [key]: v } }); return v; };
    put({ status: "loading", paragraphs: [] });
    try {
      const r = await ocrPage(doc, index);
      return put({ status: "ready", quality: r.quality, angle: r.angle, paragraphs: r.quality === "ok" ? r.paragraphs : [] });
    } catch (e) {
      console.warn("OCR failed", doc, index, e);
      return put({ status: "error", paragraphs: [], error: e instanceof ApiError ? e.code : "generic" });
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

const NO_RECTS: Rect[] = [];

/** Images of print on a page source that hold no text (see TextState.imageText). */
export function imageTextOf(src: PageSrc, imageText: Record<string, Rect[]> = textStore.getState().imageText): Rect[] {
  return "doc" in src ? imageText[srcKey(src.doc, src.index)] ?? NO_RECTS : NO_RECTS;
}

/** Whether some text of the loaded documents is a picture: an image of print, or invisible text over its picture. */
export function hasPictureText(s: Pick<TextState, "pages" | "imageText"> = textStore.getState()): boolean {
  return Object.values(s.imageText).some((r) => r.length > 0)
    || Object.values(s.pages).some((ps) => ps.some((p) => p.lock === "hidden"));
}

const NO_OCR: OcrParagraph[] = [];

/** The OCR state of a page source (undefined: never asked; blank pages have none). */
export function ocrStateOf(src: PageSrc, ocr: Record<string, OcrPageState> = textStore.getState().ocr): OcrPageState | undefined {
  return "doc" in src ? ocr[srcKey(src.doc, src.index)] : undefined;
}

/** Paragraphs OCR read on a page source (none before it ran). */
export function ocrParagraphsOf(src: PageSrc, ocr: Record<string, OcrPageState> = textStore.getState().ocr): OcrParagraph[] {
  return ocrStateOf(src, ocr)?.paragraphs ?? NO_OCR;
}
