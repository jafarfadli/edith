import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFJS_ASSETS } from "@/lib/pdf";

describe("pdf.js assets (M5c)", () => {
  it("are folders public/ serves, synced by sync-fonts (the wasm decoders draw JBIG2 and CCITT images)", () => {
    const pub = path.resolve(__dirname, "../../public");
    for (const url of [PDFJS_ASSETS.wasmUrl, PDFJS_ASSETS.cMapUrl, PDFJS_ASSETS.standardFontDataUrl, PDFJS_ASSETS.iccUrl]) {
      expect(url.endsWith("/")).toBe(true); // pdf.js appends file names
      expect(existsSync(path.join(pub, url))).toBe(true);
    }
    expect(existsSync(path.join(pub, PDFJS_ASSETS.wasmUrl, "jbig2.wasm"))).toBe(true);
  });
});
