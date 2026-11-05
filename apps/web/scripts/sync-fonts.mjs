import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../packages/fonts");
const dest = path.resolve(here, "../public/fonts");
await rm(dest, { recursive: true, force: true }); // drop files no longer in the manifest
await mkdir(dest, { recursive: true });
await cp(path.join(src, "manifest.json"), path.join(dest, "manifest.json"));
await cp(path.join(src, "files"), dest, { recursive: true });
console.log("fonts synced to", dest);

const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
await cp(path.join(pdfjsDir, "build", "pdf.worker.min.mjs"), path.resolve(here, "../public/pdf.worker.min.mjs"));
console.log("pdf.js worker synced");
