import type { PDFDocumentProxy } from "pdfjs-dist";
import { BASE_PATH } from "@/lib/basePath";

let lib: Promise<typeof import("pdfjs-dist")> | null = null;

function pdfjs() {
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${BASE_PATH}/pdf.worker.min.mjs`;
    return m;
  });
  return lib;
}

/** Where pdf.js finds what it loads on demand (copied to public/pdfjs by scripts/sync-fonts.mjs). Without `wasmUrl`
 *  pdf.js decodes no JBIG2 or CCITT fax image: a letterhead or signature scanned to 1-bit vanishes from the page
 *  (M5c, Nota Dinas). The trailing slashes are required. */
export const PDFJS_ASSETS = {
  wasmUrl: `${BASE_PATH}/pdfjs/wasm/`,
  cMapUrl: `${BASE_PATH}/pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${BASE_PATH}/pdfjs/standard_fonts/`,
  iccUrl: `${BASE_PATH}/pdfjs/iccs/`,
} as const;

export async function loadPdf(url: string): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  return m.getDocument({ url, ...PDFJS_ASSETS }).promise;
}

/** Release the worker and network resources held by a loaded document. */
export function destroyPdf(doc: PDFDocumentProxy): void {
  void doc.loadingTask.destroy();
}
