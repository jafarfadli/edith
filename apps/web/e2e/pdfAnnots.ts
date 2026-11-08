import { execFileSync } from "node:child_process";
import path from "node:path";

export interface AnnotInfo { type: string; stroke: number[]; vertices: number[][]; rect: number[]; content: string; author: string }
export interface LinkInfo { kind: number; page: number | null; uri: string | null; from: number[] }
export interface PageReport { text: string; annots: AnnotInfo[]; links: LinkInfo[]; widgets: { name: string; value: string | boolean }[]; images: number }  // images = placements
export interface PdfReport { isForm: boolean; pages: PageReport[] }

const SCRIPT = `
import json, sys, pymupdf
doc = pymupdf.open(sys.argv[1])
pages = []
for page in doc:
    pages.append({
        "text": page.get_text(),
        "annots": [{"type": a.type[1], "stroke": a.colors["stroke"], "vertices": [list(v) for v in (a.vertices or [])],
                    "rect": list(a.rect), "content": a.info["content"], "author": a.info["title"]} for a in page.annots()],
        "links": [{"kind": l["kind"], "page": l.get("page"), "uri": l.get("uri"), "from": list(l["from"])} for l in page.get_links()],
        "widgets": [{"name": w.field_name, "value": w.field_value} for w in page.widgets()],
        "images": len(page.get_image_info()),
    })
print(json.dumps({"isForm": bool(doc.is_form_pdf), "pages": pages}))
`;

/** Annotations, links, form widgets, images and text of every page, as PyMuPDF reads them (unrotated pages). */
export function pdfReport(file: string): PdfReport {
  const out = execFileSync("uv", ["run", "python", "-c", SCRIPT, file], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return JSON.parse(out) as PdfReport;
}

/** The bbox [x0, y0, x1, y1] of the first occurrence of `word` on page `index`. */
export function wordBox(file: string, word: string, index = 0): number[] {
  const out = execFileSync("uv", ["run", "python", "-c",
    "import json, sys, pymupdf; print(json.dumps(list(pymupdf.open(sys.argv[1])[int(sys.argv[3])].search_for(sys.argv[2])[0])))",
    file, word, String(index)], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return JSON.parse(out) as number[];
}
