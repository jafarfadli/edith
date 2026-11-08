import { afterEach, describe, expect, it, vi } from "vitest";

const loadPdf = vi.fn();
const destroyPdf = vi.fn();
vi.mock("@/lib/pdf", () => ({ loadPdf: (url: string) => loadPdf(url), destroyPdf: (d: unknown) => destroyPdf(d) }));

const { pdfStore } = await import("@/store/pdfs");

afterEach(() => { pdfStore.getState().reset(); vi.clearAllMocks(); });

describe("pdfStore", () => {
  it("loads each document once", async () => {
    const doc = { id: 1 };
    loadPdf.mockResolvedValue(doc);
    await Promise.all([pdfStore.getState().load("A"), pdfStore.getState().load("A")]);
    expect(loadPdf).toHaveBeenCalledTimes(1);
    expect(loadPdf).toHaveBeenCalledWith("http://localhost:8000/documents/A/file");
    expect(pdfStore.getState().docs.A).toBe(doc);
  });

  it("records failures and retries them", async () => {
    loadPdf.mockRejectedValueOnce(new Error("410"));
    await pdfStore.getState().load("B");
    expect(pdfStore.getState().docs.B).toBe("error");
    loadPdf.mockResolvedValueOnce({ id: 2 });
    await pdfStore.getState().load("B");
    expect(pdfStore.getState().docs.B).toEqual({ id: 2 });
  });

  it("destroys documents on reset, also one that finishes loading afterwards", async () => {
    const late = { id: 3 };
    let resolve!: (v: unknown) => void;
    loadPdf.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = pdfStore.getState().load("C");
    pdfStore.getState().put("M", { id: 4 } as never);
    pdfStore.getState().reset();
    expect(destroyPdf).toHaveBeenCalledWith({ id: 4 });
    resolve(late);
    await pending;
    expect(destroyPdf).toHaveBeenCalledWith(late);
    expect(pdfStore.getState().docs).toEqual({});
  });
});
