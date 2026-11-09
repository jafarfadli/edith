import { execFileSync } from "node:child_process";
import path from "node:path";

const SCRIPT = `
import json, sys, pymupdf
page = pymupdf.open(sys.argv[1])[int(sys.argv[2])]
r = page.rect
out = []
for fx, fy in json.loads(sys.argv[3]):
    x, y = r.x0 + fx * r.width, r.y0 + fy * r.height
    out.append(list(page.get_pixmap(clip=pymupdf.Rect(x, y, x + 1, y + 1)).pixel(0, 0)))
print(json.dumps(out))
`;

/** RGB of page `index` of the PDF at points given as fractions of the page's width and height (as shown). */
export function pdfPixels(file: string, index: number, at: [number, number][]): [number, number, number][] {
  const out = execFileSync("uv", ["run", "python", "-c", SCRIPT, file, String(index), JSON.stringify(at)], {
    cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8",
  });
  return JSON.parse(out) as [number, number, number][];
}

const INK = `
import json, sys, pymupdf
page = pymupdf.open(sys.argv[1])[int(sys.argv[2])]
x, y, w, h = json.loads(sys.argv[3])
pix = page.get_pixmap(dpi=144, clip=pymupdf.Rect(x, y, x + w, y + h), colorspace=pymupdf.csGRAY)
print(sum(1 for v in pix.samples if v < 160))
`;

/** How many pixels of page `index` inside `rect` (pt, as shown) are dark (ink), rendered at 144 dpi. */
export function pdfInk(file: string, index: number, rect: { x: number; y: number; w: number; h: number }): number {
  const out = execFileSync("uv", ["run", "python", "-c", INK, file, String(index), JSON.stringify([rect.x, rect.y, rect.w, rect.h])], {
    cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8",
  });
  return Number(out.trim());
}
