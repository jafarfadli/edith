import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { downloadError, downloadName, isPdfBlob, openBlob, savedNotice, saveBlob, type SaveEnv } from "@/lib/download";
import { t } from "@/lib/strings";

function env(opts: { click?: () => void; open?: Window | null; noDownloadAttr?: boolean } = {}) {
  const anchor = {
    href: "", download: "", click: vi.fn(opts.click ?? (() => {})), remove: vi.fn(),
  } as unknown as HTMLAnchorElement;
  if (opts.noDownloadAttr) delete (anchor as Partial<HTMLAnchorElement>).download;
  const opened = opts.open === undefined ? ({ opener: {} } as unknown as Window) : opts.open;
  const e: SaveEnv = {
    createAnchor: () => anchor,
    append: vi.fn(),
    createUrl: vi.fn(() => "blob:x"),
    revokeLater: vi.fn(),
    open: vi.fn(() => opened),
  };
  return { e, anchor };
}

const pdf = () => new Blob(["%PDF-1.7\n..."], { type: "application/pdf" });

describe("saveBlob", () => {
  it("downloads through an <a download> click", () => {
    const { e, anchor } = env();
    expect(saveBlob(pdf(), "a.pdf", e)).toBe("downloaded");
    expect(anchor.download).toBe("a.pdf");
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.remove).toHaveBeenCalled();
    expect(e.open).not.toHaveBeenCalled();
  });

  it("opens the PDF in a new tab when the click throws", () => {
    const { e } = env({ click: () => { throw new Error("blocked by sandbox"); } });
    expect(saveBlob(pdf(), "a.pdf", e)).toBe("opened");
    expect(e.open).toHaveBeenCalledWith("blob:x");
  });

  it("opens the PDF in a new tab when the browser has no download attribute", () => {
    const { e, anchor } = env({ noDownloadAttr: true });
    expect(saveBlob(pdf(), "a.pdf", e)).toBe("opened");
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it("reports blocked when the new tab is blocked too", () => {
    const { e } = env({ click: () => { throw new Error("x"); }, open: null });
    expect(saveBlob(pdf(), "a.pdf", e)).toBe("blocked");
  });
});

describe("openBlob", () => {
  it("opens a blob URL and cuts the opener", () => {
    const { e } = env();
    const w = { opener: {} } as unknown as Window;
    (e.open as ReturnType<typeof vi.fn>).mockReturnValue(w);
    expect(openBlob(pdf(), e)).toBe(true);
    expect(w.opener).toBeNull();
    expect(e.revokeLater).toHaveBeenCalledWith("blob:x");
  });

  it("is false when the popup is blocked", () => {
    const { e } = env({ open: null });
    expect(openBlob(pdf(), e)).toBe(false);
  });
});

describe("isPdfBlob", () => {
  it("checks the %PDF- signature", async () => {
    expect(await isPdfBlob(pdf())).toBe(true);
    expect(await isPdfBlob(new Blob(["<html>502 Bad Gateway</html>"]))).toBe(false);
    expect(await isPdfBlob(new Blob([]))).toBe(false);
  });
});

describe("downloadError", () => {
  it("network failures say so and can be retried", () => {
    expect(downloadError(new ApiError("network", 0))).toEqual({ code: "network", message: t.errors.network, retry: true });
  });

  it("timeouts can be retried", () => {
    expect(downloadError(new ApiError("timeout", 0))).toMatchObject({ message: t.errors.timeout, retry: true });
  });

  it("known API codes keep their message; a failed object is not retried", () => {
    expect(downloadError(new ApiError("bake_failed", 500))).toMatchObject({ message: t.errors.bake_failed, retry: false });
    expect(downloadError(new ApiError("doc_expired", 410))).toMatchObject({ message: t.errors.doc_expired, retry: false });
    expect(downloadError(new ApiError("internal", 500))).toMatchObject({ message: t.errors.internal, retry: true });
  });

  it("a server error without an error body names the status", () => {
    expect(downloadError(new ApiError("generic", 502))).toMatchObject({ message: t.download.server(502), retry: true });
    expect(downloadError(new ApiError("not_found", 404))).toMatchObject({ message: t.errors.not_found, retry: false });
    expect(downloadError(new ApiError("generic", 403))).toMatchObject({ message: t.download.refused(403), retry: false });
  });

  it("a body that is not a PDF and anything unexpected", () => {
    expect(downloadError(new ApiError("bad_response", 200))).toMatchObject({ message: t.errors.bad_response, retry: true });
    expect(downloadError(new Error("boom"))).toMatchObject({ code: "generic", message: t.errors.generic, retry: true });
  });
});

describe("downloadName", () => {
  it("adds .pdf and keeps a name that has it", () => {
    expect(downloadName("laporan", "a.pdf")).toBe("laporan.pdf");
    expect(downloadName("Laporan.PDF", "a.pdf")).toBe("Laporan.PDF");
    expect(downloadName("formulir visa 2026.pdf", "a.pdf")).toBe("formulir visa 2026.pdf");
  });

  it("strips path separators, reserved and control characters (as the server's safe_filename)", () => {
    expect(downloadName("../../etc/passwd", "a.pdf")).toBe("etcpasswd.pdf");
    expect(downloadName("a\\b:c*d?e\"f<g>h|i.pdf", "x.pdf")).toBe("abcdefghi.pdf");
    expect(downloadName("tab\there\u0000\u007f.pdf", "x.pdf")).toBe("tabhere.pdf");
  });

  it("trims spaces and dots around the name", () => {
    expect(downloadName("  laporan.  ", "a.pdf")).toBe("laporan.pdf");
    expect(downloadName("..laporan...pdf", "a.pdf")).toBe("laporan.pdf");
    expect(downloadName(" laporan .pdf ", "a.pdf")).toBe("laporan.pdf");
  });

  it("never just \".pdf\": falls back to the original file name, then document.pdf", () => {
    expect(downloadName(".pdf", "Visa Application Form (1).pdf")).toBe("Visa Application Form (1).pdf");
    expect(downloadName("  ", "asli.pdf")).toBe("asli.pdf");
    expect(downloadName("///", "")).toBe("document.pdf");
    expect(downloadName("..", "...pdf")).toBe("document.pdf");
    expect(downloadName("", undefined)).toBe("document.pdf");
  });

  it("keeps non-Latin names", () => {
    expect(downloadName("신청서", "a.pdf")).toBe("신청서.pdf");
  });
});

describe("savedNotice", () => {
  const openTab = { label: t.download.openTab, run: () => {} };

  it("a started download says so and offers the new tab", () => {
    expect(savedNotice("downloaded", "a.pdf", openTab)).toEqual({ kind: "info", text: t.download.started("a.pdf"), action: openTab });
  });

  it("a PDF opened in a new tab does not claim to be downloading", () => {
    const n = savedNotice("opened", "a.pdf", openTab);
    expect(n).toEqual({ kind: "info", text: t.download.opened });
    expect(n.text).not.toContain("Mengunduh");
  });

  it("blocked: an error with the new tab as the way out", () => {
    expect(savedNotice("blocked", "a.pdf", openTab)).toEqual({ kind: "error", text: t.download.blocked, action: openTab });
  });
});

describe("saveBlob revoke delay", () => {
  it("keeps the blob URL of a download for 40 s (a slow save dialog still reads it)", () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:y");
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const doc = { createElement: () => anchor, body: { appendChild: vi.fn() } };
    vi.stubGlobal("document", doc);
    try {
      expect(saveBlob(pdf(), "a.pdf")).toBe("downloaded");
      vi.advanceTimersByTime(39_000);
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_000);
      expect(revoke).toHaveBeenCalledWith("blob:y");
    } finally {
      vi.unstubAllGlobals();
      revoke.mockRestore();
      create.mockRestore();
      vi.useRealTimers();
    }
  });
});
