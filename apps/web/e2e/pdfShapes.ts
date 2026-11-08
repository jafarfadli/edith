import { execFileSync } from "node:child_process";
import path from "node:path";

export interface DrawingInfo { rect: number[]; items: string[]; dashes: string | null; fill: number[] | null; color: number[] | null; strokeOpacity: number | null; fillOpacity: number | null }
export interface ShapesPage { text: string; rotation: number; cropbox: number[]; width: number; height: number; drawings: DrawingInfo[] }

const SCRIPT = `
import json, sys, pymupdf
doc = pymupdf.open(sys.argv[1])
pages = []
for page in doc:
    rotation = page.rotation
    page.set_rotation(0)
    pages.append({
        "text": " ".join(page.get_text().split()), "rotation": rotation, "cropbox": list(page.cropbox),
        "width": page.rect.width, "height": page.rect.height,
        "drawings": [{"rect": list(d["rect"]), "items": [i[0] for i in d["items"]], "dashes": d.get("dashes"),
                      "fill": list(d["fill"]) if d.get("fill") else None, "color": list(d["color"]) if d.get("color") else None,
                      "strokeOpacity": d.get("stroke_opacity"), "fillOpacity": d.get("fill_opacity")} for d in page.get_drawings()],
    })
print(json.dumps(pages))
`;

/** Text, rotation, CropBox and vector drawings (unrotated page coordinates) of every page, as PyMuPDF reads them. */
export function pdfShapes(file: string): ShapesPage[] {
  const out = execFileSync("uv", ["run", "python", "-c", SCRIPT, file], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return JSON.parse(out) as ShapesPage[];
}
