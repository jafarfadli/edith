import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { FontRef, Rect, Run } from "@edith/ops";
import {
  ApiError, fontFileUrl, getHiddenText, getText, ocrPage, type DocFont, type ImageTextRect, type OcrParagraph, type OcrQuality,
  type Paragraph, type TextData,
} from "@/lib/api";
import { documentScript } from "@/lib/fallback";
import { fontId, fontStore, isOriginal } from "@/lib/fonts";
import { areaKey, mergeOcr } from "@/lib/ocr";
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
  /** Rects of images that look like print with no text over them (M5c), with how sure that is (`tier`), keyed like
   *  `pages`. */
  imageText: Record<string, ImageTextRect[]>;
  /** Rects of every picture of a page, keyed like `pages`: OCR of any of them can be asked for. */
  images: Record<string, Rect[]>;
  fonts: FontTable;
  /** Load status of imported PDFs' text. */
  imports: Record<string, "loading" | "ready" | "error">;
  /** OCR results (M5d), keyed like `pages`: asked for page by page (or area by area), kept for the session (not in
   *  drafts: an edit of an OCR paragraph is a self-contained text.ocr_edit op). */
  ocr: Record<string, OcrPageState>;
  /** Hidden paragraphs that can be edited as their picture (GET .../hidden-text), keyed like `pages`: asked for once per
   *  page that has hidden text, when it is shown. */
  hidden: Record<string, HiddenPageState>;
  load(docId: string): Promise<void>;
  loadImport(docId: string): Promise<void>;
  /** Reads the pictures of print on page `index` of document `doc`, or `rect` of it (one OCR of a document at a time:
   *  a request while another of that document runs, or for a page or area already read, returns its state as it is).
   *  `taken`: ids the page's edits already use (an area's paragraphs never get one). */
  runOcr(doc: string, index: number, rect?: Rect, taken?: Iterable<string>): Promise<OcrPageState>;
  /** Asks once which hidden paragraphs of page `index` of `doc` can be edited (a failure: none; asked again later). */
  loadHidden(doc: string, index: number): Promise<HiddenPageState>;
}

/** One page's OCR: running (`running`: the page, or the key of an area), done or failed (`error`: an API error code).
 *  `paragraphs`: every paragraph read on the page so far (its own OCR and areas). `full`: the page's own OCR (its
 *  pictures of print) ran; `areas`: the areas read (areaKey). `last`: what the latest run found (`quality`,
 *  `found` paragraphs it added, `angle`). */
export interface OcrPageState {
  status: "loading" | "ready" | "error";
  quality?: OcrQuality; angle?: number; paragraphs: OcrParagraph[]; error?: string;
  full?: boolean; areas?: string[]; running?: string; last?: { quality: OcrQuality; found: number; angle: number; area?: string };
}

/** `tries`: how often it was asked (a failure, e.g. "hidden_text_busy", is asked again a few times: HIDDEN_TRIES). */
export interface HiddenPageState { status: "loading" | "ready" | "error"; paragraphs: OcrParagraph[]; tries?: number }

/** How often a page's hidden text is asked for at most, and the wait (ms) before the first retry (doubling after). */
export const HIDDEN_TRIES = 4;
export const HIDDEN_RETRY_MS = 1500;

/** The wait before asking again for a page's hidden text that failed, or null when it should not be asked again. */
export function hiddenRetryIn(st: HiddenPageState | undefined): number | null {
  if (!st || st.status !== "error" || (st.tries ?? 1) >= HIDDEN_TRIES) return null;
  return HIDDEN_RETRY_MS * 2 ** ((st.tries ?? 1) - 1);
}

/** The OCR state key of a run: the page ("page") or an area. */
export const PAGE_RUN = "page";

type Tagged = { pages: ParagraphPages; imageText: Record<string, ImageTextRect[]>; images: Record<string, Rect[]>; fonts: FontTable };

/** `data` with every original font naming document `doc` (the imported PDF it was extracted from). */
function tagged(data: TextData, doc: string | null): Tagged {
  const tag = (f: FontRef): FontRef => (doc && isOriginal(f) ? { ...f, doc } : f);
  const run = (r: Run): Run => ({ ...r, font: tag(r.font) });
  const pages: ParagraphPages = {};
  const imageText: Record<string, ImageTextRect[]> = {};
  const images: Record<string, Rect[]> = {};
  for (const p of data.pages) {
    const key = srcKey(doc ?? data.doc_id, p.index);
    pages[key] = p.paragraphs.map((g) => ({ ...g, runs: g.runs.map(run) }));
    if (p.imageText?.length) imageText[key] = p.imageText;
    if (p.images?.length) images[key] = p.images;
  }
  const fonts: FontTable = {};
  for (const f of data.fonts) {
    const font: DocFont = doc ? { ...f, doc } : f;
    fonts[fontId({ kind: "original", ref: f.ref, doc })] = font;
  }
  return { pages, imageText, images, fonts };
}

/** `t` added to what the store holds. */
function merged(s: TextState, t: Tagged): Tagged {
  return {
    pages: { ...s.pages, ...t.pages }, imageText: { ...s.imageText, ...t.imageText }, images: { ...s.images, ...t.images },
    fonts: { ...s.fonts, ...t.fonts },
  };
}

export const textStore = createStore<TextState>()((set, get) => ({
  status: "idle", docId: null, pages: {}, imageText: {}, images: {}, fonts: {}, imports: {}, ocr: {}, hidden: {},
  async load(docId) {
    set({ status: "loading", docId, pages: {}, imageText: {}, images: {}, fonts: {}, imports: {}, ocr: {}, hidden: {} });
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
  async runOcr(doc, index, rect, taken = []) {
    const key = srcKey(doc, index);
    const run = rect ? areaKey(rect) : PAGE_RUN;
    const cur = get().ocr[key];
    if (cur?.status === "loading") return cur;
    if (cur && (rect ? cur.areas?.includes(run) : cur.full)) return cur;
    const busy = Object.entries(get().ocr).find(([k, v]) => v.status === "loading" && k.startsWith(doc + ":"));
    if (busy) return busy[1];
    const main = get().docId;
    const put = (v: OcrPageState) => { if (get().docId === main) set({ ocr: { ...get().ocr, [key]: v } }); return v; };
    // What was read before on the page stays shown while this runs, and whatever this run brings.
    const before = { paragraphs: cur?.paragraphs ?? [], full: cur?.full, areas: cur?.areas, quality: cur?.quality, angle: cur?.angle };
    put({ ...before, status: "loading", running: run });
    try {
      const r = await ocrPage(doc, index, rect);
      const now = get().ocr[key]?.paragraphs ?? before.paragraphs;
      const paragraphs = r.quality === "ok" ? mergeOcr(now, r.paragraphs, taken, !!rect) : now;
      const found = paragraphs.length - now.length;
      return put({
        status: "ready", paragraphs, angle: r.angle, quality: paragraphs.length ? "ok" : r.quality,
        full: before.full || !rect, areas: rect ? [...(before.areas ?? []), run] : before.areas,
        last: { quality: r.quality === "ok" && !found ? "empty" : r.quality, found, angle: r.angle, ...(rect ? { area: run } : {}) },
      });
    } catch (e) {
      console.warn("OCR failed", doc, index, e);
      return put({ ...before, status: "error", error: e instanceof ApiError ? e.code : "generic" });
    }
  },
  async loadHidden(doc, index) {
    const key = srcKey(doc, index);
    const cur = get().hidden[key];
    if (cur && cur.status !== "error") return cur;
    const main = get().docId;
    const put = (v: HiddenPageState) => { if (get().docId === main) set({ hidden: { ...get().hidden, [key]: v } }); return v; };
    const tries = (cur?.tries ?? 0) + 1;
    put({ status: "loading", paragraphs: [], tries });
    try {
      return put({ status: "ready", paragraphs: await getHiddenText(doc, index), tries });
    } catch (e) {
      console.warn("hidden text failed", doc, index, e);
      return put({ status: "error", paragraphs: [], tries });
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

const NO_RECTS: ImageTextRect[] = [];

/** Images of print on a page source that hold no text (see TextState.imageText), of every tier. */
export function imageTextOf(src: PageSrc, imageText: Record<string, ImageTextRect[]> = textStore.getState().imageText): ImageTextRect[] {
  return "doc" in src ? imageText[srcKey(src.doc, src.index)] ?? NO_RECTS : NO_RECTS;
}

/** Whether an image of print is surely print (tier "print", or no tier from an older API), not only maybe. */
export const isPrint = (r: ImageTextRect): boolean => r.tier !== "maybe";

/** Every picture of a page source (see TextState.images). */
export function imagesOf(src: PageSrc, images: Record<string, Rect[]> = textStore.getState().images): Rect[] {
  return "doc" in src ? images[srcKey(src.doc, src.index)] ?? NO_RECTS : NO_RECTS;
}

/** Whether some text of the loaded documents is surely a picture: an image of print, or invisible text over its
 *  picture (which may still turn out editable: see TextState.hidden). */
export function hasPictureText(s: Pick<TextState, "pages" | "imageText"> = textStore.getState()): boolean {
  return Object.values(s.imageText).some((r) => r.some(isPrint))
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

/** Hidden paragraphs of a page source that can be edited as their picture (none before asked). */
export function hiddenParagraphsOf(src: PageSrc, hidden: Record<string, HiddenPageState> = textStore.getState().hidden): OcrParagraph[] {
  return "doc" in src ? hidden[srcKey(src.doc, src.index)]?.paragraphs ?? NO_OCR : NO_OCR;
}

/** Every paragraph of a page source edited as a picture of text: hidden ones (their text known), then OCR's. */
export function pictureParagraphsOf(src: PageSrc, s: Pick<TextState, "ocr" | "hidden"> = textStore.getState()): OcrParagraph[] {
  const hidden = hiddenParagraphsOf(src, s.hidden), ocr = ocrParagraphsOf(src, s.ocr);
  return hidden.length ? (ocr.length ? [...hidden, ...ocr] : hidden) : ocr;
}
