// Downloads the optional CJK fallback pack (manifest.json "cjk": Noto Sans/Serif KR, JP, SC; regular + bold, about
// 113 MB) from the Google Fonts CSS API into ../files/cjk. Not committed (see .gitignore): run it once per checkout,
// in the Docker builds and in CI. Without the pack, Korean/Japanese/Chinese characters stay "unsupported".
// Files already present are kept (each is written to .part first, then renamed), so a cached ../files/cjk makes it
// a no-op; `--force` downloads everything again.
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

const exists = (file) => access(file).then(() => true, () => false);

await mkdir(path.join(filesDir, "cjk"), { recursive: true });
for (const [family, info] of Object.entries(manifest.cjk)) {
  const css = await get(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700`, "text");
  const served = {};
  for (const block of css.split("@font-face").slice(1)) {
    served[WEIGHT[/font-weight:\s*(\d+)/.exec(block)[1]]] = /url\((https:[^)]+\.ttf)\)/.exec(block)[1];
  }
  for (const [style, file] of Object.entries(info.files)) {
    if (!served[style]) throw new Error(`${family} ${style}: not served by Google Fonts`);
    const target = path.join(filesDir, file);
    if (!force && (await exists(target))) { console.log("kept", file); continue; }
    const buf = await get(served[style]);
    await writeFile(`${target}.part`, buf);
    await rename(`${target}.part`, target); // never leave a truncated font behind
    console.log("saved", file, buf.length);
  }
}
