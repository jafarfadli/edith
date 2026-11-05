import { describe, expect, it } from "vitest";
import { t, errorMessage } from "@/lib/strings";

describe("strings", () => {
  it("has Indonesian app name tagline", () => {
    expect(t.appName).toBe("Edith");
  });
  it("maps known error codes and falls back", () => {
    expect(errorMessage("pdf_encrypted")).toContain("terkunci");
    expect(errorMessage("nope")).toBe(t.errors.generic);
  });
});

describe("strings (M3)", () => {
  it("has the text warnings and M3 groups", () => {
    expect(t.text.unsupported).toBe("beberapa karakter tidak didukung font ini");
    expect(t.text.overflow).toBeTruthy();
    expect(t.annot.highlight).toBe("Stabilo");
    expect(t.signature.colors["#111111"]).toBe("Hitam");
    expect(t.form.flatten).toBe("Ratakan form");
  });
});
