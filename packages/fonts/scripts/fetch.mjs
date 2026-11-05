// Downloads static TTF files from the Google Fonts CSS API into ../files and checks them against manifest.json.
// An old user agent makes the API return one full truetype file per style instead of woff2 subsets.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "files");
const manifest = JSON.parse(await readFile(path.join(here, "..", "manifest.json"), "utf8"));
const STYLE = { "normal-400": "regular", "normal-700": "bold", "italic-400": "italic", "italic-700": "bolditalic" };

async function get(url, as) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/4.0" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

await mkdir(outDir, { recursive: true });
for (const [family, info] of Object.entries(manifest.families)) {
  const css = await get(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:ital,wght@0,400;0,700;1,400;1,700`, "text");
  const served = {};
  for (const block of css.split("@font-face").slice(1)) {
    const style = STYLE[`${/font-style:\s*(\w+)/.exec(block)[1]}-${/font-weight:\s*(\d+)/.exec(block)[1]}`];
    served[style] = /url\((https:[^)]+\.ttf)\)/.exec(block)[1];
  }
  for (const [style, file] of Object.entries(info.files)) {
    if (!served[style]) throw new Error(`${family} ${style}: not served by Google Fonts`);
    const buf = await get(served[style]);
    await writeFile(path.join(outDir, file), buf);
    console.log("saved", file, buf.length);
  }
  const extra = Object.keys(served).filter((s) => !info.files[s]);
  if (extra.length) throw new Error(`${family}: manifest lacks served styles ${extra.join(", ")}`);
}
