import type { BundledFont, ExportRequest, Rect, RenderPageRequest, Run } from "@edith/ops";
import type { CharLine } from "@/lib/markup";
import type { StructurePage } from "@/store/editor";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
/** Paragraph segmentation the client's paragraph ids (g0, g1, …) come from: shared contract with PARAGRAPHS_VERSION in
 *  apps/api/edith/paragraphs.py. Exports send it (the API refuses text.edit ops of another version) and drafts store it.
 *  Bump it on ANY change to how lines are split or measured (line start/end, rects, baselines), not only to ids: drafts
 *  store LayoutLine.source indexes into a paragraph's lines, and the bake checks kept lines against those lines. */
export const PARAGRAPHS_VERSION = 3;

export class ApiError extends Error {
  constructor(public code: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "ApiError";
  }
}

/** One original line of a paragraph; `start`/`end` index the paragraph's joined run text (end excludes trailing spaces).
 *  `wordX` (M5d, horizontal left-to-right lines): the x of the first glyph of each word of the line's text (words split
 *  at SPACE_CHARS, lib/keepLines.ts), where an edit keeps the words it leaves alone (lib/editLine.ts). */
export interface ParagraphLine { rect: Rect; baseline: number; size: number; start: number; end: number; wordX?: number[] }
/** `maxWidth` (single-line paragraphs, M5): how wide the paragraph may grow when edited — up to the next cell border
 *  or text on its line. Measured per `align` (M5b): from the left edge (left), around the centre (center: the whole
 *  symmetric width) or leftwards from the right edge (right). Rects are the ink since M5b (no leading/trailing spaces).
 *  Left-aligned multi-line paragraphs get it too (M5b F2): the room beside all their lines, the most the web may
 *  widen their wrap width (lib/paragraphs.ts wrapWidth); centred and right-aligned ones since M5d, with the same
 *  meaning (an edited line may grow that far before it wraps). Runs of original text carry the PDF's measured hScale /
 *  charSpacing / wordSpacing (and the true size of horizontally scaled text). A paragraph that is not editable says
 *  why in `lock` (M5c). */
export interface Paragraph {
  id: string; rect: Rect; lines: ParagraphLine[]; runs: Run[];
  align: "left" | "center" | "right" | "justify"; lineHeight: number; editable: boolean; maxWidth?: number;
  lock?: ParagraphLock;
}
/** A paragraph OCR read in a picture of text (POST /documents/{id}/pages/{n}/ocr, M5d): ids `ocr0`, `ocr1`, … (never an
 *  original paragraph's `gN`), runs in a bundled font. `confidence`: 0–1, the mean of its words. An edit paints `covers`
 *  (one rect per line: its words' ink, padded, clear of other text; `cover` is their bounding box) with `coverColor`
 *  (the picture's own background there; `coverUniform` false: not plain, the cover may show) and draws the new text: a
 *  text.ocr_edit op, which carries them. */
export interface OcrParagraph extends Paragraph {
  ocr: true; confidence: number; cover: Rect; covers: Rect[]; coverColor: string; coverUniform: boolean;
  /** "hidden" (GET /documents/{id}/pages/{n}/hidden-text): not read by OCR but the invisible text laid over a picture of
   *  it, its lines measured in the picture (`confidence` 1); id `hgN`, replacing the locked original paragraph
   *  `replaces` (gN). Absent: read by OCR. */
  source?: "hidden"; replaces?: string;
}
/** How sure the API is that a picture holds text (GET /text `imageText`): "print", rows of print on a plain background
 *  (what a page's OCR reads); "maybe", a picture that may hold some (one pictured line, a logo with its name, light print
 *  on a dark band), read only when asked. Absent: "print" (an API from before). */
export type ImageTextTier = "print" | "maybe";
export interface ImageTextRect extends Rect { tier?: ImageTextTier }
/** "ok" (paragraphs found), "none" (no picture of print on the page), "empty" (nothing read), "rotated" (the page is
 *  turned in the PDF), "skewed" (`angle` degrees, too much to read into straight lines), "unreadable", "too_large";
 *  "known": what was read is text the page already has editable (an area over it). */
export type OcrQuality = "ok" | "none" | "empty" | "known" | "rotated" | "skewed" | "unreadable" | "too_large";
export interface OcrResult { doc_id: string; index: number; quality: OcrQuality; angle: number; dpi: number; regions: Rect[]; paragraphs: OcrParagraph[] }
/** Why an original paragraph can't be edited: "hidden", its text is invisible (an OCR layer over a picture of the text,
 *  which is what shows); "font", a symbol font nothing else can draw; "rotated", text that isn't horizontal. */
export type ParagraphLock = "hidden" | "font" | "rotated";
/** `doc`: set by the client on fonts of an imported PDF (see `fontId`). */
export interface DocFont {
  doc?: string;
  ref: string; name: string; embedded: boolean; format: string | null; reusable: boolean;
  family: string; bold: boolean; italic: boolean; substitute: BundledFont;
}
export interface TextData {
  /** `imageText` (M5c): rects of images that look like print with no text over them (a scanned form): nothing there can
   *  be edited as text until OCR reads it; `tier` says how sure that is. `images`: every picture of the page (OCR of any
   *  of them can be asked for). */
  doc_id: string; pages: { index: number; paragraphs: Paragraph[]; imageText?: ImageTextRect[]; images?: Rect[] }[]; fonts: DocFont[];
  /** Segmentation version (2 since M5, 3 since M5b); absent in fixtures built from extract_text directly. */
  paragraphsVersion?: number;
}

/** One AcroForm widget (GET /documents/{id}/structure). Radio buttons of a group share `name`. */
export interface FormField {
  name: string; type: "text" | "checkbox" | "radio" | "combo" | "list" | "button" | "signature";
  /** Text/choice value; checkbox/radio: the widget's state name ("Off" when not chosen). */
  value: string;
  /** Checkbox/radio: the state name of this widget when it is on. */
  onState: string | null;
  options: string[] | null; page: number; rect: Rect; readOnly: boolean; multiline: boolean;
  /** 0 = auto. */
  fontSize: number;
}
export type { CharLine } from "@/lib/markup";

export interface UploadResult { doc_id: string; sha256: string; page_count: number }
export interface Structure { doc_id: string; sha256: string; page_count: number; pages: StructurePage[]; fields: FormField[] }

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch (e) {
    throw new ApiError(e instanceof DOMException && e.name === "TimeoutError" ? "timeout" : "network", 0);
  }
  if (!res.ok) {
    let err: Record<string, unknown> = {};
    try { err = ((await res.json()) as { error?: Record<string, unknown> }).error ?? {}; } catch { /* not JSON */ }
    throw new ApiError(String(err.code ?? "generic"), res.status, err);
  }
  return res;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function uploadDocument(file: File | Blob, name = "document.pdf"): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, name);
  return (await request("/documents", { method: "POST", body: form })).json();
}

export async function getStructure(docId: string): Promise<Structure> {
  return (await request(`/documents/${docId}/structure`)).json();
}

export async function getText(docId: string): Promise<TextData> {
  return (await request(`/documents/${docId}/text`)).json();
}

/** One page's OCR takes up to 30 s on the server (its own timeout), plus the upload of nothing and the answer. */
export const OCR_TIMEOUT_MS = 60_000;

/** OCR of page `index`: its pictures of print, or `rect` of it (a picture the user picked, an area of the page). */
export async function ocrPage(docId: string, index: number, rect?: Rect): Promise<OcrResult> {
  const init: RequestInit = rect ? json({ rect }) : { method: "POST" };
  const res = await request(`/documents/${docId}/pages/${index}/ocr`, { ...init, signal: AbortSignal.timeout(OCR_TIMEOUT_MS) });
  return res.json();
}

/** The hidden paragraphs of page `index` (lock "hidden") that can be edited as the picture they lie over (see
 *  OcrParagraph.source). */
export async function getHiddenText(docId: string, index: number): Promise<OcrParagraph[]> {
  return ((await (await request(`/documents/${docId}/pages/${index}/hidden-text`)).json()) as { paragraphs: OcrParagraph[] }).paragraphs;
}

export async function getChars(docId: string, index: number): Promise<CharLine[]> {
  return ((await (await request(`/documents/${docId}/pages/${index}/chars`)).json()) as { lines: CharLine[] }).lines;
}

export function fontFileUrl(docId: string, ref: string): string {
  return `${API_URL}/documents/${docId}/fonts/${ref}`;
}

export function fileUrl(docId: string): string {
  return `${API_URL}/documents/${docId}/file`;
}

export async function uploadAsset(docId: string, file: Blob) {
  const form = new FormData();
  form.append("file", file, "asset");
  return (await request(`/documents/${docId}/assets`, { method: "POST", body: form })).json() as Promise<{ asset_id: string; width: number; height: number }>;
}

export function assetUrl(docId: string, assetId: string): string {
  return `${API_URL}/documents/${docId}/assets/${assetId}`;
}

/** A bake of a large document takes seconds; past this the server or the connection is stuck. */
export const EXPORT_TIMEOUT_MS = 120_000;

export async function exportPdf(docId: string, body: ExportRequest): Promise<Blob> {
  const res = await request(`/documents/${docId}/export`, { ...json({ paragraphs_version: PARAGRAPHS_VERSION, ...body }), signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS) });
  try {
    return await res.blob();
  } catch (e) {
    throw new ApiError(e instanceof DOMException && e.name === "TimeoutError" ? "timeout" : "network", 0);
  }
}

export async function renderPage(docId: string, body: RenderPageRequest): Promise<Blob> {
  return (await request(`/documents/${docId}/render-page`, json({ paragraphs_version: PARAGRAPHS_VERSION, ...body }))).blob();
}
