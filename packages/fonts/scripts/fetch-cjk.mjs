// Downloads the optional CJK fallback pack (manifest.json "cjk": Noto Sans/Serif KR, JP, SC; regular + bold, about
// 113 MB) from the Google Fonts CSS API into ../files/cjk. Not committed (see .gitignore): run it once per checkout,
// in the Docker builds and in CI. Without the pack, Korean/Japanese/Chinese characters stay "unsupported".
// Files already present (valid font signature) are kept and, when all 12 are there, nothing is requested at all (each
// download is written to .part first, then renamed), so a cached ../files/cjk makes it a no-op; `--force` downloads
// everything again.
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const filesDir = path.join(here, "..", "files");
const manifest = JSON.parse(await readFile(path.join(here, "..", "manifest.json"), "utf8"));
const WEIGHT = { 400: "regular", 700: "bold" };

const force = process.argv.includes("--force");

async function get(url, as) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/4.0" } }); // old UA: one full TTF per style
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

// A file counts as present only when it starts with a TrueType/OpenType signature (not a truncated or HTML error page).
const MAGIC = ["\x00\x01\x00\x00", "true", "OTTO"];
const isFont = (buf) => MAGIC.includes(buf.subarray(0, 4).toString("latin1"));
const present = async (file) => {
  try {
    const handle = await open(file);
    try {
      const head = Buffer.alloc(4);
      await handle.read(head, 0, 4, 0);
      return isFont(head);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
};

await mkdir(path.join(filesDir, "cjk"), { recursive: true });
const wanted = Object.values(manifest.cjk).flatMap((info) => Object.values(info.files));
const missing = [];
for (const file of wanted) if (force || !(await present(path.join(filesDir, file)))) missing.push(file);
if (missing.length === 0) {
  console.log(`kept all ${wanted.length} files in cjk/ (--force: download again)`); // no network needed
  process.exit(0);
}

for (const [family, info] of Object.entries(manifest.cjk)) {
  const todo = Object.entries(info.files).filter(([, file]) => missing.includes(file));
  if (todo.length === 0) continue;
  const css = await get(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700`, "text");
  const served = {};
  for (const block of css.split("@font-face").slice(1)) {
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
    const url = /url\((https:[^)]+\.ttf)\)/.exec(block)?.[1];
    if (WEIGHT[weight] && url) served[WEIGHT[weight]] = url;
  }
  for (const [style, file] of todo) {
    if (!served[style]) throw new Error(`${family} ${style}: no .ttf url in the Google Fonts CSS (not served, or the CSS format changed)`);
    const target = path.join(filesDir, file);
    const buf = await get(served[style]);
    if (!isFont(buf)) throw new Error(`${file}: downloaded from ${served[style]} but it is not a TrueType font (${buf.length} bytes); nothing was saved`);
    await writeFile(`${target}.part`, buf);
    await rename(`${target}.part`, target); // never leave a truncated font behind
    console.log("saved", file, buf.length);
  }
}
