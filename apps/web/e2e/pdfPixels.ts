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
