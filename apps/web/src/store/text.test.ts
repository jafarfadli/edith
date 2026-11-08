import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocFont, Paragraph } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import { paragraphsOf, textStore } from "@/store/text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  textStore.setState({ status: "idle", docId: null, pages: {}, fonts: {}, imports: {} });
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
});
