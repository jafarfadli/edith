import { describe, expect, it } from "vitest";
import { TOOLS } from "./tools";
import { searchTools, wantsEditor } from "./toolSearch";

const all = TOOLS.map((x) => x.slug);

describe("tool search", () => {
  it("finds tools by what people need, not only their names", () => {
    expect(searchTools("kecilkan", all)[0]).toBe("kompres-pdf");
    expect(searchTools("fotokopi ktp", all)[0]).toBe("kartu-ke-a4");
    expect(searchTools("romawi", all)[0]).toBe("nomor-halaman");
    expect(searchTools("Merge", all)[0]).toBe("gabung-pdf");
    expect(searchTools("skripsi", all)).toEqual(expect.arrayContaining(["nomor-halaman", "ukuran-kertas"]));
    expect(searchTools("", all)).toEqual(all);
  });

  it("points edits of the PDF itself to the editor", () => {
    expect(wantsEditor("tanda tangan")).toBe(true);
    expect(wantsEditor("edit teks")).toBe(true);
    expect(wantsEditor("kompres")).toBe(false);
  });
});
