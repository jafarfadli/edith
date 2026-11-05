import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FontStore, charOffsets, cssFamily, fontKey, metricsFromBuffer, textWidth } from "@/lib/fonts";

const ttf = (name: string) => readFileSync(path.resolve(__dirname, "../../../../packages/fonts/files", name));

describe("fonts", () => {
  const arimo = metricsFromBuffer(ttf("Arimo-Regular.ttf"));

  it("reads metrics", () => {
    expect(arimo.unitsPerEm).toBe(2048);
    expect(arimo.ascent).toBeGreaterThan(0);
    expect(arimo.descent).toBeGreaterThan(0);
  });

  it("measures without kerning, with PDF-quantized widths (floor of 1/1000 em)", () => {
    // Arimo "A" = 1366/2048 em = 666.99 milli-em → 666 → 13.32 pt at 20 pt, as stored in the baked PDF.
    expect(textWidth("A", arimo, 20)).toBeCloseTo(13.32, 6);
    expect(textWidth("AV", arimo, 20)).toBeCloseTo(textWidth("A", arimo, 20) + textWidth("V", arimo, 20), 6);
  });

  it("char offsets accumulate", () => {
    const o = charOffsets("AVA", arimo, 10);
    expect(o[0]).toBe(0);
    expect(o[2]).toBeCloseTo(textWidth("AV", arimo, 10));
  });

  it("keys", () => {
    const f = { kind: "bundled" as const, family: "Tinos", bold: true, italic: false };
    expect(fontKey(f)).toBe("Tinos-bold");
    expect(cssFamily({ ...f, bold: false })).toBe("edith-Tinos-regular");
  });
});

describe("FontStore", () => {
  afterEach(() => vi.unstubAllGlobals());

  const manifest = { default: "Arimo", families: { Arimo: { category: "sans", files: { regular: "Arimo-Regular.ttf" } } } };
  const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
  const bytes = () => {
    const b = ttf("Arimo-Regular.ttf");
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("rejects a failed manifest fetch with status and retries later", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(json(manifest))
      .mockResolvedValueOnce(new Response(bytes(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = new FontStore("/fonts");
    await expect(store.load(font)).rejects.toThrow("font fetch failed: /fonts/manifest.json (404)");
    const m = await store.load(font);
    expect(m.unitsPerEm).toBe(2048);
    expect(store.get(font)).toBe(m);
  });

  it("rejects a failed TTF fetch and retries later", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("manifest.json")) return json(manifest);
      return fetchMock.mock.calls.filter(([u]) => u === url).length === 1
        ? new Response("", { status: 404 })
        : new Response(bytes(), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new FontStore("/fonts");
    await expect(store.load(font)).rejects.toThrow("font fetch failed: /fonts/Arimo-Regular.ttf (404)");
    expect((await store.load(font)).unitsPerEm).toBe(2048);
  });
});
