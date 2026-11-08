import { afterEach, describe, expect, it, vi } from "vitest";
import { charLines, charsStore } from "@/store/chars";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  charsStore.getState().reset();
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
    expect(charLines("D:2")).toEqual(lines);
    expect(charLines("D:0")).toEqual([]);
    expect(charLines(null)).toEqual([]);
  });

  it("keeps pages of several documents apart, retries after an error, forgets on reset", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await charsStore.getState().load("D", 0);
    expect(charsStore.getState().pages["D:0"]).toBe("error");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ lines }), { status: 200 })));
    await charsStore.getState().load("D", 0);
    await charsStore.getState().load("I", 0);
    expect(charLines("D:0")).toEqual(lines);
    expect(charLines("I:0")).toEqual(lines);
    charsStore.getState().reset();
    expect(charLines("D:0")).toEqual([]);
  });
});
