import { execFileSync } from "node:child_process";
import path from "node:path";

export interface Span { text: string; font: string; origin: [number, number]; size: number; bbox: [number, number, number, number] }

const SCRIPT = `
import json, sys, pymupdf
doc = pymupdf.open(sys.argv[1])
print(json.dumps([[{"text": s["text"].replace("\\xa0", " ") if sys.argv[2] == "clean" else s["text"], "font": s["font"], "origin": s["origin"], "size": s["size"], "bbox": s["bbox"]}
                   for b in page.get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"]]
                  for page in doc]))
`;

/** Text spans per page as PyMuPDF reads them (font names, baselines) — via the API's Python env. */
export function pdfSpans(file: string, raw = false): Span[][] {
  const out = execFileSync("uv", ["run", "python", "-c", SCRIPT, file, raw ? "raw" : "clean"], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return JSON.parse(out) as Span[][];
}

export interface Char { c: string; origin: [number, number]; x1: number }

const CHARS = `
import json, sys, pymupdf
doc = pymupdf.open(sys.argv[1])
print(json.dumps([[{"c": c["c"], "origin": c["origin"], "x1": c["bbox"][2]}
                   for b in page.get_text("rawdict")["blocks"] for l in b.get("lines", []) for s in l["spans"] for c in s["chars"]]
                  for page in doc]))
`;

/** Every character per page with its origin and right edge, as PyMuPDF reads them. */
export function pdfChars(file: string): Char[][] {
  const out = execFileSync("uv", ["run", "python", "-c", CHARS, file], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return JSON.parse(out) as Char[][];
}
