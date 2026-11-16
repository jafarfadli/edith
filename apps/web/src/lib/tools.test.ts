import { describe, expect, it } from "vitest";
import { accepted, DEFAULT_OPTIONS, fields, invalid, toolBySlug, TOOLS } from "./tools";
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
});
