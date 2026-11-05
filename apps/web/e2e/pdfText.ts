import { readFile } from "node:fs/promises";

export async function pdfInfo(path: string): Promise<{ pages: { text: string; rotation: number }[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push({ text: content.items.map((it) => ("str" in it ? it.str : "")).join(" "), rotation: page.rotate });
  }
  return { pages };
}
