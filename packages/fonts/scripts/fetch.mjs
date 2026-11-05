// Downloads static TTF files from the Google Fonts CSS API.
// An old user agent makes the API return truetype URLs instead of woff2.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "files");
const FAMILIES = ["Arimo", "Tinos", "Cousine"];
const STYLE = { "normal-400": "Regular", "normal-700": "Bold", "italic-400": "Italic", "italic-700": "BoldItalic" };

await mkdir(outDir, { recursive: true });
for (const family of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${family}:ital,wght@0,400;0,700;1,400;1,700`;
  const css = await (await fetch(url, { headers: { "User-Agent": "Mozilla/4.0" } })).text();
  const blocks = css.split("@font-face").slice(1);
  for (const b of blocks) {
    const style = /font-style:\s*(\w+)/.exec(b)[1];
    const weight = /font-weight:\s*(\d+)/.exec(b)[1];
    const src = /url\((https:[^)]+\.ttf)\)/.exec(b)[1];
    const name = `${family}-${STYLE[`${style}-${weight}`]}.ttf`;
    const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
    await writeFile(path.join(outDir, name), buf);
    console.log("saved", name, buf.length);
  }
}
