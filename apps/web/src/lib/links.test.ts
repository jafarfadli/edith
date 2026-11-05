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
  it("tells page targets from URLs", () => {
    expect(isPageTarget({ pageKey: "o1" })).toBe(true);
    expect(isPageTarget({ url: "https://a.b" })).toBe(false);
  });
});
