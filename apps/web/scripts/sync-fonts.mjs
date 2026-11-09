import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../packages/fonts");
const dest = path.resolve(here, "../public/fonts");
await rm(dest, { recursive: true, force: true }); // drop files no longer in the manifest
await mkdir(dest, { recursive: true });
// The optional CJK pack (packages/fonts/scripts/fetch-cjk.mjs) may be missing: the web manifest lists only the
// families and styles whose files are there, so the editor never asks for a font that is not served.
const manifest = JSON.parse(await readFile(path.join(src, "manifest.json"), "utf8"));
const exists = (file) => access(path.join(src, "files", file)).then(() => true, () => false);
const cjk = {};
for (const [family, info] of Object.entries(manifest.cjk ?? {})) {
  const files = {};
  for (const [style, file] of Object.entries(info.files)) if (await exists(file)) files[style] = file;
  if (files.regular) cjk[family] = { ...info, files };
}
await writeFile(path.join(dest, "manifest.json"), JSON.stringify({ ...manifest, cjk }, null, 1));
await cp(path.join(src, "files"), dest, { recursive: true });
console.log("fonts synced to", dest, `(CJK pack: ${Object.keys(cjk).length ? Object.keys(cjk).join(", ") : "not fetched"})`);

const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
await cp(path.join(pdfjsDir, "build", "pdf.worker.min.mjs"), path.resolve(here, "../public/pdf.worker.min.mjs"));
// The decoders and data pdf.js loads on demand (lib/pdf.ts PDFJS_ASSETS): without the wasm folder it draws no
// JBIG2 or CCITT fax image at all (scanned letterheads, signatures), and JPEG 2000 / ICC colour fall back.
const assets = path.resolve(here, "../public/pdfjs");
await rm(assets, { recursive: true, force: true });
for (const dir of ["wasm", "cmaps", "standard_fonts", "iccs"]) {
  await cp(path.join(pdfjsDir, dir), path.join(assets, dir), { recursive: true });
}
console.log("pdf.js worker and assets synced");
