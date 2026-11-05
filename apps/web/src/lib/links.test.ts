import { describe, expect, it } from "vitest";
import { isPageTarget, normalizeUrl } from "@/lib/links";

describe("normalizeUrl", () => {
  it("keeps http, https and mailto URLs", () => {
    expect(normalizeUrl(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(normalizeUrl("http://x.y")).toBe("http://x.y");
    expect(normalizeUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
  });
  it("adds https:// to a bare host", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("www.example.co.id/path")).toBe("https://www.example.co.id/path");
  });
  it("rejects everything else", () => {
    for (const bad of ["", "javascript:alert(1)", "halo dunia", "a@b.co", "ftp://x.y", "https://a b"]) expect(normalizeUrl(bad)).toBeNull();
  });
  it("matches the API: lower-case scheme, max 2048 chars", () => {
    expect(normalizeUrl("HTTPS://x.y")).toBe("https://x.y");
    expect(normalizeUrl("Mailto:a@b.co")).toBe("mailto:a@b.co");
    const long = "https://a.co/" + "x".repeat(2048 - 13);
    expect(normalizeUrl(long)).toBe(long);
    expect(normalizeUrl(long + "x")).toBeNull();
    expect(normalizeUrl("a.co/" + "x".repeat(2048))).toBeNull();
  });
  it("does not turn non-hosts into https URLs", () => {
    for (const bad of ["1.50", "v1.2.3", "file.p1", "file.pdf", "foto.JPG", "a.b", "https://", "mailto:"]) expect(normalizeUrl(bad)).toBeNull();
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });
  it("tells page targets from URLs", () => {
    expect(isPageTarget({ pageKey: "o1" })).toBe(true);
    expect(isPageTarget({ url: "https://a.b" })).toBe(false);
  });
});
