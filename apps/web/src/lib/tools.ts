/** The "Alat PDF": each tool's page (/tools/{slug}), what it takes and which options it asks, and how they become the
 *  form fields of POST /tools/{api} (apps/api/edith/routes/tools.py). */

export type ToolSlug =
  | "gabung-pdf" | "pisah-pdf" | "ambil-halaman" | "kompres-pdf" | "pdf-ke-gambar" | "gambar-ke-pdf" | "pdf-ke-teks"
  | "buka-kunci-pdf" | "kunci-pdf" | "watermark-pdf" | "nomor-halaman" | "pdf-bisa-dicari" | "office-ke-pdf" | "pdf-ke-word"
  | "scan-dokumen" | "pas-foto" | "kartu-ke-a4" | "ukuran-kertas";

export interface ToolDef {
  slug: ToolSlug;
  api: string;
  /** What it takes: PDFs, pictures (JPG/PNG) or office documents (Word, PowerPoint, Excel, OpenDocument). */
  accepts: "pdf" | "images" | "office";
  /** At least this many files, at most `max` (1: one file). */
  min: number;
  max: number;
  /** Asks the PDF's password up front (unlock); the others ask it only when the server says the PDF is locked. */
  password: boolean;
}

export const TOOLS: ToolDef[] = [
  { slug: "gabung-pdf", api: "merge", accepts: "pdf", min: 2, max: 50, password: false },
  { slug: "pisah-pdf", api: "split", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "ambil-halaman", api: "extract", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "kompres-pdf", api: "compress", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "pdf-ke-gambar", api: "to-images", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "gambar-ke-pdf", api: "images-to-pdf", accepts: "images", min: 1, max: 50, password: false },
  { slug: "scan-dokumen", api: "scan", accepts: "images", min: 1, max: 50, password: false },
  { slug: "pas-foto", api: "pas-foto", accepts: "images", min: 1, max: 1, password: false },
  { slug: "kartu-ke-a4", api: "cards", accepts: "images", min: 1, max: 16, password: false },
  { slug: "office-ke-pdf", api: "office-to-pdf", accepts: "office", min: 1, max: 1, password: false },
  { slug: "pdf-ke-word", api: "to-docx", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "pdf-ke-teks", api: "to-text", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "buka-kunci-pdf", api: "unlock", accepts: "pdf", min: 1, max: 1, password: true },
  { slug: "kunci-pdf", api: "protect", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "watermark-pdf", api: "watermark", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "ukuran-kertas", api: "paper-size", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "nomor-halaman", api: "page-numbers", accepts: "pdf", min: 1, max: 1, password: false },
  { slug: "pdf-bisa-dicari", api: "ocr", accepts: "pdf", min: 1, max: 1, password: false },
];

export const toolBySlug = (slug: string): ToolDef | undefined => TOOLS.find((x) => x.slug === slug);

/** The options of every tool (each reads only its own), as the page's form holds them. */
export interface ToolOptions {
  pages: string; format: "png" | "jpg"; dpi: 72 | 150 | 300; level: "low" | "medium" | "high";
  mode: "every" | "ranges"; every: number; ranges: string; size: "a4" | "fit"; margin: 0 | 20 | 40;
  newPassword: string; confirm: string; allowPrint: boolean; allowCopy: boolean;
  text: string; strength: "light" | "medium" | "strong"; diagonal: boolean; colour: string;
  position: "bottom-center" | "bottom-right" | "bottom-left" | "top-center" | "top-right" | "top-left";
  numberFormat: "n" | "n_of" | "page_n" | "page_n_of"; start: number;
  /** Compress: by a level, or down to a size (KB). */
  compressBy: "level" | "size"; targetKb: number;
  /** Scan: how the page comes out, and whether the sheet is cut out of the photo. */
  scanMode: "color" | "gray" | "bw" | "original"; crop: boolean;
  /** Pas foto: the new background, and the photo size. */
  photoColour: "red" | "blue" | "white"; photoSize: "3x4" | "2x3" | "4x6" | "original";
  /** Paper size: the new paper, the whole page or its content, and the margins. */
  paper: "a4" | "f4" | "letter" | "legal"; fit: "page" | "content"; margins: "none" | "narrow" | "normal" | "thesis";
  /** Page numbers: how they are written; with roman then arabic, the last page (1-based) in roman. */
  numerals: "arabic" | "roman" | "ROMAN" | "roman_then_arabic"; romanTo: number;
  /** ID card to A4: the sheet, colour or grey, real size or larger. */
  cardPaper: "a4" | "f4"; cardColour: "color" | "gray"; cardScale: "real" | "large";
}

/** See-through of a watermark, by its strength. */
export const OPACITY = { light: 0.15, medium: 0.3, strong: 0.5 } as const;

export const DEFAULT_OPTIONS: ToolOptions = {
  pages: "", format: "png", dpi: 150, level: "medium", mode: "every", every: 1, ranges: "", size: "a4", margin: 20,
  newPassword: "", confirm: "", allowPrint: true, allowCopy: true,
  text: "", strength: "medium", diagonal: true, colour: "#9ca3af", position: "bottom-center", numberFormat: "n", start: 1,
  compressBy: "level", targetKb: 500,
  scanMode: "color", crop: true, photoColour: "red", photoSize: "3x4",
  paper: "a4", fit: "page", margins: "none",
  cardPaper: "a4", cardColour: "color", cardScale: "real",
  numerals: "arabic", romanTo: 5,
};

/** Office documents LibreOffice converts (apps/api/edith/office.py OFFICE_TYPES), by extension. */
export const OFFICE_EXTENSIONS = ["doc", "docx", "odt", "rtf", "ppt", "pptx", "odp", "xls", "xlsx", "ods"];

/** The file picker's `accept` of a tool. */
export function acceptAttr(tool: ToolDef): string {
  if (tool.accepts === "images") return "image/png,image/jpeg,.png,.jpg,.jpeg";
  if (tool.accepts === "office") return OFFICE_EXTENSIONS.map((e) => `.${e}`).join(",");
  return "application/pdf,.pdf";
}

/** A file the tool takes (by type, or by name when the browser gives no type). */
export function accepted(tool: ToolDef, file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  if (tool.accepts === "pdf") return file.type === "application/pdf" || name.endsWith(".pdf");
  if (tool.accepts === "office") return OFFICE_EXTENSIONS.includes(name.split(".").pop() ?? "");
  return ["image/png", "image/jpeg"].includes(file.type) || /\.(png|jpe?g)$/.test(name);
}

const PAGES = /^\s*(\d+\s*(-\s*\d*)?|-\s*\d+)(\s*,\s*(\d+\s*(-\s*\d*)?|-\s*\d+))*\s*$/;

/** Why the options cannot go to the server yet (a message key of t.tools), or null. */
export function invalid(tool: ToolDef, o: ToolOptions): "pages" | "ranges" | "every" | "newPassword" | "mismatch" | "text" | "start" | "target" | "romanTo" | null {
  const pagesOk = !o.pages.trim() || PAGES.test(o.pages);
  switch (tool.api) {
    case "watermark": return !o.text.trim() || o.text.length > 120 ? "text" : pagesOk ? null : "pages";
    case "page-numbers":
      if (!Number.isInteger(o.start) || o.start < 0) return "start";
      if (o.numerals === "roman_then_arabic" && !(Number.isInteger(o.romanTo) && o.romanTo >= 1)) return "romanTo";
      return pagesOk ? null : "pages";
    case "compress": return o.compressBy === "size" && !(Number.isInteger(o.targetKb) && o.targetKb >= 10) ? "target" : null;
    case "extract": return PAGES.test(o.pages) ? null : "pages";
    case "to-images": return !o.pages.trim() || PAGES.test(o.pages) ? null : "pages";
    case "split": return o.mode === "ranges" ? (PAGES.test(o.ranges) ? null : "ranges") : (Number.isInteger(o.every) && o.every >= 1 ? null : "every");
    case "protect": return !o.newPassword ? "newPassword" : o.newPassword !== o.confirm ? "mismatch" : null;
    default: return null;
  }
}

/** The form fields of the tool's request (`password`: of a locked input PDF). */
export function fields(tool: ToolDef, o: ToolOptions, password: string): Record<string, string> {
  const out: Record<string, string> = password ? { password } : {};
  switch (tool.api) {
    case "extract": return { ...out, pages: o.pages };
    case "to-images": return { ...out, format: o.format, dpi: String(o.dpi), pages: o.pages };
    case "compress": return o.compressBy === "size" ? { ...out, target_kb: String(o.targetKb) } : { ...out, level: o.level };
    case "split": return o.mode === "ranges" ? { ...out, mode: "ranges", ranges: o.ranges } : { ...out, mode: "every", every: String(o.every) };
    case "images-to-pdf": return { size: o.size, margin: String(o.size === "fit" ? 0 : o.margin) };
    case "scan": return { scan_mode: o.scanMode, crop: String(o.crop), size: o.size };
    case "pas-foto": return { colour: o.photoColour, size: o.photoSize };
    case "cards": return { paper: o.cardPaper, scan_mode: o.cardColour, scale: o.cardScale };
    case "paper-size": return { ...out, paper: o.paper, fit: o.fit, margins: o.fit === "content" && o.margins === "none" ? "narrow" : o.margins };
    case "protect": return { ...out, new_password: o.newPassword, allow_print: String(o.allowPrint), allow_copy: String(o.allowCopy) };
    case "watermark": return { ...out, text: o.text.trim(), opacity: String(OPACITY[o.strength]), diagonal: String(o.diagonal), colour: o.colour, pages: o.pages };
    case "page-numbers": return {
      ...out, position: o.position, number_format: o.numberFormat, start: String(o.start), pages: o.pages, numerals: o.numerals,
      ...(o.numerals === "roman_then_arabic" ? { roman_to: String(o.romanTo) } : {}),
    };
    default: return out;
  }
}

/** How many of a document's `total` pages a page list ("1-3, 5, 8-"; empty: all) takes, each page once; null when
 *  the list does not parse. */
export function countPages(spec: string, total: number): number | null {
  if (!spec.trim()) return total;
  if (!PAGES.test(spec)) return null;
  const taken = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map((x) => x.trim());
    const from = a ? Number(a) : 1;
    const to = part.includes("-") ? (b ? Number(b) : total) : from;
    for (let p = Math.max(1, from); p <= Math.min(total, to); p++) taken.add(p);
  }
  return taken.size;
}
