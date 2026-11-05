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
