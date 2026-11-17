import { describe, expect, it } from "vitest";
import { accepted, countPages, DEFAULT_OPTIONS, fields, invalid, toolBySlug, TOOLS } from "./tools";
import { t } from "./strings";

const tool = (slug: string) => toolBySlug(slug)!;

describe("PDF tools", () => {
  it("every tool has a name and a description", () => {
    for (const x of TOOLS) expect(t.tools.items[x.slug]?.name).toBeTruthy();
    expect(toolBySlug("nope")).toBeUndefined();
  });

  it("takes PDFs or pictures, by type or by name", () => {
    expect(accepted(tool("gabung-pdf"), { name: "a.PDF", type: "" })).toBe(true);
    expect(accepted(tool("gabung-pdf"), { name: "a.png", type: "image/png" })).toBe(false);
    expect(accepted(tool("gambar-ke-pdf"), { name: "foto.jpeg", type: "" })).toBe(true);
    expect(accepted(tool("gambar-ke-pdf"), { name: "a.pdf", type: "application/pdf" })).toBe(false);
  });

  it("compresses by a level, or down to a size of 10 KB or more", () => {
    const o = DEFAULT_OPTIONS;
    expect(fields(tool("kompres-pdf"), o, "")).toEqual({ level: "medium" });
    expect(fields(tool("kompres-pdf"), { ...o, compressBy: "size", targetKb: 200 }, "")).toEqual({ target_kb: "200" });
    expect(invalid(tool("kompres-pdf"), { ...o, compressBy: "size", targetKb: 5 })).toBe("target");
    expect(invalid(tool("kompres-pdf"), { ...o, compressBy: "size", targetKb: 2.5 })).toBe("target");
    expect(invalid(tool("kompres-pdf"), { ...o, compressBy: "level", targetKb: 0 })).toBeNull();
  });

  it("checks page numbers, ranges and passwords before asking the server", () => {
    const o = DEFAULT_OPTIONS;
    expect(invalid(tool("ambil-halaman"), { ...o, pages: "" })).toBe("pages");
    expect(invalid(tool("ambil-halaman"), { ...o, pages: "1-3, 5, 8-" })).toBeNull();
    expect(invalid(tool("ambil-halaman"), { ...o, pages: "1,,2" })).toBe("pages");
    expect(invalid(tool("pdf-ke-gambar"), { ...o, pages: "" })).toBeNull(); // all pages
    expect(invalid(tool("pisah-pdf"), { ...o, mode: "every", every: 0 })).toBe("every");
    expect(invalid(tool("pisah-pdf"), { ...o, mode: "ranges", ranges: "1-2, 3" })).toBeNull();
    expect(invalid(tool("kunci-pdf"), { ...o, newPassword: "" })).toBe("newPassword");
    expect(invalid(tool("kunci-pdf"), { ...o, newPassword: "a", confirm: "b" })).toBe("mismatch");
    expect(invalid(tool("kunci-pdf"), { ...o, newPassword: "a", confirm: "a" })).toBeNull();
  });

  it("sends each tool's own options, and the PDF's password when there is one", () => {
    const o = DEFAULT_OPTIONS;
    expect(fields(tool("pdf-ke-gambar"), { ...o, format: "jpg", dpi: 300, pages: "2" }, "")).toEqual({ format: "jpg", dpi: "300", pages: "2" });
    expect(fields(tool("pisah-pdf"), { ...o, mode: "every", every: 3 }, "x")).toEqual({ password: "x", mode: "every", every: "3" });
    expect(fields(tool("gambar-ke-pdf"), { ...o, size: "fit", margin: 40 }, "")).toEqual({ size: "fit", margin: "0" });
    expect(fields(tool("kunci-pdf"), { ...o, newPassword: "k", allowCopy: false }, "")).toEqual({ new_password: "k", allow_print: "true", allow_copy: "false" });
    expect(fields(tool("buka-kunci-pdf"), o, "s")).toEqual({ password: "s" });
  });

  it("watermark and page numbers: their text, strength and numbering", () => {
    const o = DEFAULT_OPTIONS;
    expect(invalid(tool("watermark-pdf"), { ...o, text: " " })).toBe("text");
    expect(fields(tool("watermark-pdf"), { ...o, text: " DRAFT ", strength: "strong", diagonal: false }, "")).toEqual(
      { text: "DRAFT", opacity: "0.5", diagonal: "false", colour: "#9ca3af", pages: "" });
    expect(invalid(tool("nomor-halaman"), { ...o, start: -1 })).toBe("start");
    expect(fields(tool("nomor-halaman"), { ...o, position: "top-right", numberFormat: "n_of", start: 3 }, "")).toEqual(
      { position: "top-right", number_format: "n_of", start: "3", pages: "" });
    expect(fields(tool("pdf-bisa-dicari"), o, "")).toEqual({});
  });

  it("counts the pages a page list takes, each once and only those the document has", () => {
    expect(countPages("", 7)).toBe(7);
    expect(countPages("2-3", 7)).toBe(2);
    expect(countPages("1-3, 2, 8-", 9)).toBe(5); // 1, 2, 3, 8, 9
    expect(countPages("-2, 6-", 7)).toBe(4);
    expect(countPages("5-9", 6)).toBe(2);
    expect(countPages("1,,2", 6)).toBeNull();
  });
});
