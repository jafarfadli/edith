import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocFont, Paragraph } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import { hasPictureText, hiddenParagraphsOf, imagesOf, imageTextOf, ocrParagraphsOf, ocrStateOf, paragraphsOf, pictureParagraphsOf, textStore } from "@/store/text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  textStore.setState({ status: "idle", docId: null, pages: {}, imageText: {}, images: {}, fonts: {}, imports: {}, ocr: {}, hidden: {} });
});

const para: Paragraph = { id: "g0", rect: { x: 0, y: 0, w: 10, h: 10 }, lines: [], runs: [], align: "left", lineHeight: 12, editable: true };
const font: DocFont = {
  ref: "f5", name: "Helvetica", embedded: false, format: null, reusable: false, family: "helvetica", bold: false, italic: false,
  substitute: { kind: "bundled", family: "Arimo", bold: false, italic: false },
};

describe("textStore", () => {
  it("loads paragraphs and fonts and points the font store at the document", async () => {
    const body = { doc_id: "D", pages: [{ index: 0, paragraphs: [para] }, { index: 1, paragraphs: [] }], fonts: [font] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const source = vi.spyOn(fontStore, "setOriginalSource");
    await textStore.getState().load("D");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/documents/D/text", undefined);
    expect(textStore.getState()).toMatchObject({ status: "ready", docId: "D", fonts: { f5: font } });
    expect(paragraphsOf({ doc: "D", index: 0 })).toEqual([para]);
    expect(paragraphsOf({ blank: { width: 1, height: 1 } })).toEqual([]);
    expect(paragraphsOf({ doc: "IMPORTED", index: 0 })).toEqual([]); // not loaded
    const url = source.mock.calls[0][0]!;
    expect(url({ kind: "original", ref: "f5" })).toBe("http://localhost:8000/documents/D/fonts/f5");
    expect(url({ kind: "original", ref: "f5", doc: "I" })).toBe("http://localhost:8000/documents/I/fonts/f5");
  });

  it("sets the script Han characters fall back to from the document's text", async () => {
    const korean = { ...para, runs: [{ text: "사증 漢字", font: { kind: "original", ref: "f5" }, size: 12, color: "#000000" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ doc_id: "D", pages: [{ index: 0, paragraphs: [korean] }], fonts: [font] }), { status: 200 })));
    const set = vi.spyOn(fontStore, "setHanScript");
    await textStore.getState().load("D");
    expect(set).toHaveBeenCalledWith("kr");
  });

  it("adds an imported PDF's text with its fonts named after it", async () => {
    const run = { text: "Impor", font: { kind: "original", ref: "f5" }, size: 12, color: "#000000" };
    const imported = { doc_id: "I", pages: [{ index: 0, paragraphs: [{ ...para, runs: [run] }] }], fonts: [font] };
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/I/") ? imported : { doc_id: "D", pages: [{ index: 0, paragraphs: [para] }], fonts: [font] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await textStore.getState().load("D");
    await Promise.all([textStore.getState().loadImport("I"), textStore.getState().loadImport("I")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(paragraphsOf({ doc: "D", index: 0 })).toEqual([para]);
    expect(paragraphsOf({ doc: "I", index: 0 })[0].runs[0].font).toEqual({ kind: "original", ref: "f5", doc: "I" });
    expect(textStore.getState().fonts).toEqual({ f5: font, "I/f5": { ...font, doc: "I" } });
    expect(textStore.getState().imports).toEqual({ I: "ready" });
  });

  it("marks a failed load as error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await textStore.getState().load("D");
    expect(textStore.getState().status).toBe("error");
  });

  it("keeps the images of print of every page and tells whether any text is a picture (M5c)", async () => {
    const scan = { x: 84, y: 174, w: 429, h: 172 };
    const body = { doc_id: "D", pages: [{ index: 0, paragraphs: [para], imageText: [scan] }, { index: 1, paragraphs: [] }], fonts: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    await textStore.getState().load("D");
    expect(imageTextOf({ doc: "D", index: 0 })).toEqual([scan]);
    expect(imageTextOf({ doc: "D", index: 1 })).toEqual([]);
    expect(imageTextOf({ blank: { width: 1, height: 1 } })).toEqual([]);
    expect(hasPictureText()).toBe(true);
    expect(hasPictureText({ imageText: {}, pages: { "D:0": [para] } })).toBe(false);
    expect(hasPictureText({ imageText: {}, pages: { "D:0": [{ ...para, editable: false, lock: "hidden" }] } })).toBe(true);
    expect(hasPictureText({ imageText: {}, pages: { "D:0": [{ ...para, editable: false, lock: "rotated" }] } })).toBe(false);
  });

  it("reads a page with OCR once, one page of a document at a time, and keeps a failure retryable (M5d)", async () => {
    const ocrPara = { ...para, id: "ocr0", ocr: true, confidence: 0.9, cover: para.rect, coverColor: "#ffffff", coverUniform: true };
    let release!: () => void;
    const answered = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/text")) return new Response(JSON.stringify({ doc_id: "D", pages: [{ index: 0, paragraphs: [] }, { index: 1, paragraphs: [] }], fonts: [] }), { status: 200 });
      if (url.endsWith("/pages/1/ocr")) return new Response(JSON.stringify({ error: { code: "ocr_busy" } }), { status: 429 });
      await answered;
      return new Response(JSON.stringify({ doc_id: "D", index: 0, quality: "ok", angle: 0, dpi: 300, regions: [], paragraphs: [ocrPara] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await textStore.getState().load("D");
    const first = textStore.getState().runOcr("D", 0);
    expect(ocrStateOf({ doc: "D", index: 0 })?.status).toBe("loading");
    expect((await textStore.getState().runOcr("D", 1)).status).toBe("loading"); // page 0 still runs: not asked
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/documents/D/pages/0/ocr", expect.objectContaining({ method: "POST" }));
    release();
    expect((await first).status).toBe("ready");
    expect(ocrParagraphsOf({ doc: "D", index: 0 })).toEqual([ocrPara]);
    await textStore.getState().runOcr("D", 0); // read already: kept
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/pages/0/ocr"))).toHaveLength(1);
    expect(await textStore.getState().runOcr("D", 1)).toEqual({ status: "error", paragraphs: [], error: "ocr_busy" });
    expect(textStore.getState().runOcr("D", 1)).toBeInstanceOf(Promise); // a failure can be retried
    await textStore.getState().load("D"); // another load forgets the results
    expect(ocrParagraphsOf({ doc: "D", index: 0 })).toEqual([]);
  });

  const ocrAt = (id: string, x: number, y: number) => ({
    ...para, id, rect: { x, y, w: 50, h: 10 }, ocr: true as const, confidence: 0.9, cover: { x, y, w: 50, h: 10 }, covers: [],
    coverColor: "#ffffff", coverUniform: true,
  });

  it("keeps every picture's rect and how sure each image of print is; only sure print counts as picture text", async () => {
    const logo = { x: 40, y: 34, w: 72, h: 74 };
    const body = { doc_id: "D", pages: [{ index: 0, paragraphs: [para], imageText: [{ ...logo, tier: "maybe" }], images: [logo] }], fonts: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    await textStore.getState().load("D");
    expect(imagesOf({ doc: "D", index: 0 })).toEqual([logo]);
    expect(imageTextOf({ doc: "D", index: 0 })).toEqual([{ ...logo, tier: "maybe" }]);
    expect(hasPictureText()).toBe(false); // a logo that may hold its name: nothing to say at load
  });

  it("reads areas of a page one by one; their paragraphs join the page's, numbered apart, each area once", async () => {
    let answer = ocrAt("ocr0", 100, 100);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/text")) return new Response(JSON.stringify({ doc_id: "D", pages: [{ index: 0, paragraphs: [] }], fonts: [] }), { status: 200 });
      return new Response(JSON.stringify({ doc_id: "D", index: 0, quality: "ok", angle: 0, dpi: 300, regions: [], paragraphs: [answer] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await textStore.getState().load("D");
    const area = { x: 90, y: 90, w: 100, h: 30 };
    let st = await textStore.getState().runOcr("D", 0, area, ["ocr1000"]);
    expect(fetchMock).toHaveBeenLastCalledWith("http://localhost:8000/documents/D/pages/0/ocr",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ rect: area }) }));
    expect(st.paragraphs.map((p) => p.id)).toEqual(["ocr1001"]); // an area's ids: from 1000, never an edit's
    expect(st.full).toBeFalsy();
    expect(st.areas).toHaveLength(1);
    expect(st.last).toMatchObject({ quality: "ok", found: 1 });
    await textStore.getState().runOcr("D", 0, area); // read already
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/ocr"))).toHaveLength(1);
    // The page's own OCR then: what it reads again (the same paragraph) is left out, the rest keeps its ids.
    answer = ocrAt("ocr0", 300, 300);
    st = await textStore.getState().runOcr("D", 0);
    expect(st.full).toBe(true);
    expect(st.paragraphs.map((p) => p.id)).toEqual(["ocr1001", "ocr0"]);
    answer = ocrAt("ocr0", 102, 101);
    st = await textStore.getState().runOcr("D", 0, { x: 95, y: 95, w: 80, h: 20 });
    expect(st.paragraphs).toHaveLength(2);
    expect(st.last).toMatchObject({ quality: "empty", found: 0 });
  });

  it("asks once per page which hidden paragraphs can be edited as their picture", async () => {
    const hidden = { ...ocrAt("hg1", 140, 30), source: "hidden", replaces: "g1", confidence: 1 };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/text")) return new Response(JSON.stringify({ doc_id: "D", pages: [{ index: 0, paragraphs: [] }], fonts: [] }), { status: 200 });
      return new Response(JSON.stringify({ doc_id: "D", index: 0, paragraphs: [hidden] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await textStore.getState().load("D");
    await textStore.getState().loadHidden("D", 0);
    await textStore.getState().loadHidden("D", 0);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/pages/0/hidden-text"))).toHaveLength(1);
    expect(hiddenParagraphsOf({ doc: "D", index: 0 })).toEqual([hidden]);
    textStore.setState({ ocr: { "D:0": { status: "ready", paragraphs: [ocrAt("ocr0", 100, 300)] } } });
    expect(pictureParagraphsOf({ doc: "D", index: 0 }).map((p) => p.id)).toEqual(["hg1", "ocr0"]);
    expect(pictureParagraphsOf({ blank: { width: 1, height: 1 } })).toEqual([]);
  });
});
