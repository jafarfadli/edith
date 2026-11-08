import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareRuns } from "@/lib/fallback";
import { FontStore, charOffsets, covers, cssFamily, fontKey, metricsFromBuffer, pickFile, textWidth } from "@/lib/fonts";

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

  it("knows the fetched CJK pack: fallback families by script and design, not offered in the picker", async () => {
    const withCjk = { ...manifest, cjk: {
      "Noto Sans KR": { category: "sans", script: "kr", files: { regular: "cjk/NotoSansKR-Regular.ttf", bold: "cjk/NotoSansKR-Bold.ttf" } },
      "Noto Serif KR": { category: "serif", script: "kr", files: { regular: "cjk/NotoSerifKR-Regular.ttf" } },
      "Noto Sans JP": { category: "sans", script: "jp", files: { regular: "cjk/NotoSansJP-Regular.ttf" } },
    } };
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("manifest.json") ? json(withCjk) : new Response(bytes(), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const store = new FontStore("/fonts");
    expect(store.cjkFamily("kr", "sans")).toBeNull(); // manifest not loaded yet
    expect(await store.families()).toEqual(["Arimo"]);
    expect([store.cjkFamily("kr", "sans"), store.cjkFamily("kr", "serif"), store.cjkFamily("jp", "serif"), store.cjkFamily("sc", "sans")])
      .toEqual(["Noto Sans KR", "Noto Serif KR", "Noto Sans JP", null]);
    expect([store.categoryOf("Arimo"), store.categoryOf("Noto Serif KR"), store.categoryOf("Lato")]).toEqual(["sans", "serif", null]);
    await store.load({ kind: "bundled", family: "Noto Sans KR", bold: true, italic: true });
    expect(fetchMock).toHaveBeenLastCalledWith("/fonts/cjk/NotoSansKR-Bold.ttf"); // no italic: bold
    expect(store.hanScript()).toBe("sc");
    store.setHanScript("kr");
    expect(store.hanScript()).toBe("kr");
  });

  it("loads a CJK pack family the API names as an original font's substitute (only when the pack is there)", async () => {
    // GET /text substitutes Korean fonts (Dotum, Batang …) with "Noto Sans KR" / "Noto Serif KR" when the API has the pack.
    const sub = { kind: "bundled" as const, family: "Noto Sans KR", bold: false, italic: false };
    const docFonts = { f1: { ref: "f1", name: "Dotum", embedded: false, format: null, reusable: false, family: "dotum", bold: false,
      italic: false, substitute: sub } };
    const cjk = { "Noto Sans KR": { category: "sans", script: "kr", files: { regular: "cjk/NotoSansKR-Regular.ttf" } } };
    const serve = (m: unknown) => vi.fn(async (url: string) => (url.endsWith("manifest.json") ? json(m) : new Response(bytes(), { status: 200 })));
    const withPack = serve({ ...manifest, cjk });
    vi.stubGlobal("fetch", withPack);
    const store = new FontStore("/fonts");
    const runs = [[{ text: "ab", font: { kind: "original" as const, ref: "f1" }, size: 12, color: "#000000" }]];
    const out = await prepareRuns(runs, docFonts, store, store); // the original has no source: counts as glyph-less
    expect(out[0].map((r) => r.font)).toEqual([sub]);
    expect(withPack).toHaveBeenCalledWith("/fonts/cjk/NotoSansKR-Regular.ttf");
    vi.stubGlobal("fetch", serve({ ...manifest, cjk: {} })); // web without the pack: the family is unknown
    await expect(new FontStore("/fonts").load(sub)).rejects.toThrow("unknown font family Noto Sans KR");
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

describe("pickFile", () => {
  it("picks the nearest style a family has (same order as the API)", () => {
    expect(pickFile({ regular: "R.ttf", bold: "B.ttf" }, "bolditalic")).toBe("B.ttf");
    expect(pickFile({ regular: "R.ttf", bold: "B.ttf" }, "italic")).toBe("R.ttf");
    expect(pickFile({ regular: "R.ttf" }, "bold")).toBe("R.ttf");
    expect(() => pickFile({}, "regular")).toThrow("no regular style");
  });
});

describe("FontRef support", () => {
  afterEach(() => vi.unstubAllGlobals());
  const bytes = () => {
    const b = ttf("Arimo-Regular.ttf");
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  it("keys original fonts by ref", () => {
    expect(fontKey({ kind: "original", ref: "f12" })).toBe("orig-f12");
    expect(cssFamily({ kind: "original", ref: "f12" })).toBe("edith-orig-f12");
  });

  it("loads an original font from the document source and checks glyph coverage", async () => {
    const fetchMock = vi.fn(async () => new Response(bytes(), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = new FontStore("/fonts");
    const orig = { kind: "original" as const, ref: "f9" };
    await expect(store.load(orig)).rejects.toThrow("no source for original font f9");
    store.setOriginalSource((f) => `/api/fonts/${f.ref}`);
    const m = await store.load(orig);
    expect(fetchMock).toHaveBeenCalledWith("/api/fonts/f9");
    expect(store.peek(orig)).toBe(m);
    expect(covers(m, "Halo Ж")).toBe(true);
    expect(covers(m, "漢")).toBe(false);
    store.setOriginalSource(null); // another document: its fonts are gone
    expect(store.peek(orig)).toBeNull();
  });

  it("rejects bytes fontkit cannot parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })));
    const store = new FontStore("/fonts");
    store.setOriginalSource((f) => `/api/fonts/${f.ref}`);
    await expect(store.load({ kind: "original", ref: "f1" })).rejects.toThrow();
  });
});
