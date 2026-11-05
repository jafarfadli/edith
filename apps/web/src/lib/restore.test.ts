import { describe, expect, it } from "vitest";
import { restoreDraft } from "@/lib/restore";

describe("restoreDraft", () => {
  const draft = {
    pages: [
      { pageKey: "o1", src: { doc: "OLD", index: 1 }, rotate: 90 as const },
      { pageKey: "u-b", src: { blank: { width: 1, height: 1 } }, rotate: 0 as const },
    ],
    objects: {}, order: [],
  };

  it("rewrites doc ids", () => {
    const r = restoreDraft(draft, "NEW", 2)!;
    expect(r.pages[0].src).toEqual({ doc: "NEW", index: 1 });
    expect(r.pages[1].src).toEqual({ blank: { width: 1, height: 1 } });
  });

  it("rejects drafts referencing missing pages", () => {
    expect(restoreDraft(draft, "NEW", 1)).toBeNull();
    expect(restoreDraft(null, "NEW", 1)).toBeNull();
  });
});
