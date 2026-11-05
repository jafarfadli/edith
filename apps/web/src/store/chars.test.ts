import { afterEach, describe, expect, it, vi } from "vitest";
import { charLines, charsStore } from "@/store/chars";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  charsStore.setState({ docId: null, pages: {} });
});

const lines = [{ text: "Hi", boxes: [[72, 78], [78, 81]], baseline: 100, size: 12 }];

describe("charsStore", () => {
  it("fetches a page once and caches it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ doc_id: "D", index: 2, lines }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([charsStore.getState().load("D", 2), charsStore.getState().load("D", 2)]);
    await charsStore.getState().load("D", 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/documents/D/pages/2/chars", undefined);
    expect(charLines(2)).toEqual(lines);
    expect(charLines(0)).toEqual([]);
    expect(charLines(null)).toEqual([]);
  });

  it("retries after an error and forgets another document's pages", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await charsStore.getState().load("D", 0);
    expect(charsStore.getState().pages[0]).toBe("error");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ lines }), { status: 200 })));
    await charsStore.getState().load("D", 0);
    expect(charLines(0)).toEqual(lines);
    await charsStore.getState().load("E", 1);
    expect(charsStore.getState().pages[0]).toBeUndefined();
  });
});
