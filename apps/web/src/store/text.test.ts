import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocFont, Paragraph } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import { paragraphsOf, textStore } from "@/store/text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  textStore.setState({ status: "idle", docId: null, pages: {}, fonts: {} });
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
    expect(paragraphsOf({ doc: "IMPORTED", index: 0 })).toEqual([]); // pages of imported PDFs: no original text
    const url = source.mock.calls[0][0]!;
    expect(url("f5")).toBe("http://localhost:8000/documents/D/fonts/f5");
  });

  it("marks a failed load as error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await textStore.getState().load("D");
    expect(textStore.getState().status).toBe("error");
  });
});
