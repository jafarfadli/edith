import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, exportPdf, getStructure, uploadDocument } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown, type = "application/json") {
  const fn = vi.fn(async () => new Response(type === "application/json" ? JSON.stringify(body) : (body as BodyInit), { status, headers: { "content-type": type } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api client", () => {
  it("uploads multipart", async () => {
    const fn = mockFetch(201, { doc_id: "x", sha256: "s", page_count: 1 });
    const res = await uploadDocument(new Blob(["%PDF"]), "a.pdf");
    expect(res.doc_id).toBe("x");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/documents");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("maps error bodies to ApiError", async () => {
    mockFetch(410, { error: { code: "doc_expired", message: "gone" } });
    await expect(getStructure("x")).rejects.toMatchObject({ code: "doc_expired", status: 410 });
  });

  it("keeps extra error fields", async () => {
    mockFetch(500, { error: { code: "bake_failed", message: "m", op_id: "o1" } });
    try {
      await exportPdf("x", { ops: [], flatten_forms: false, filename: "a.pdf" });
      throw new Error("should fail");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).extra.op_id).toBe("o1");
    }
  });

  it("maps network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fail"); }));
    await expect(getStructure("x")).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("gives the export a time limit and maps it to a timeout error", async () => {
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    vi.stubGlobal("fetch", fn);
    await expect(exportPdf("x", { ops: [], flatten_forms: false, filename: "a.pdf" })).rejects.toMatchObject({ code: "timeout", status: 0 });
    expect(fn).toHaveBeenCalledOnce();
  });

  it("returns blob for export", async () => {
    mockFetch(200, "%PDF-1.7", "application/pdf");
    const blob = await exportPdf("x", { ops: [], flatten_forms: false, filename: "a.pdf" });
    expect(await blob.text()).toBe("%PDF-1.7");
  });
});
