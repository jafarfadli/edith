import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../packages/fonts");
const dest = path.resolve(here, "../public/fonts");
await mkdir(dest, { recursive: true });
await cp(path.join(src, "manifest.json"), path.join(dest, "manifest.json"));
await cp(path.join(src, "files"), dest, { recursive: true });
console.log("fonts synced to", dest);
