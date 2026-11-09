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

/** One original line of a paragraph; `start`/`end` index the paragraph's joined run text (end excludes trailing spaces). */
export interface ParagraphLine { rect: Rect; baseline: number; size: number; start: number; end: number }
/** `maxWidth` (single-line paragraphs, M5): how wide the paragraph may grow when edited — up to the next cell border
 *  or text on its line. Measured per `align` (M5b): from the left edge (left), around the centre (center: the whole
 *  symmetric width) or leftwards from the right edge (right). Rects are the ink since M5b (no leading/trailing spaces).
 *  Left-aligned multi-line paragraphs get it too (M5b F2): the room beside all their lines, the most the web may
 *  widen their wrap width (lib/paragraphs.ts wrapWidth). Runs of original text carry the PDF's measured hScale /
 *  charSpacing / wordSpacing (and the true size of horizontally scaled text). A paragraph that is not editable says
 *  why in `lock` (M5c). */
export interface Paragraph {
  id: string; rect: Rect; lines: ParagraphLine[]; runs: Run[];
  align: "left" | "center" | "right" | "justify"; lineHeight: number; editable: boolean; maxWidth?: number;
  lock?: ParagraphLock;
}
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
   *  be edited as text. */
  doc_id: string; pages: { index: number; paragraphs: Paragraph[]; imageText?: Rect[] }[]; fonts: DocFont[];
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
