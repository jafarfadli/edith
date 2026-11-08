import { describe, expect, it } from "vitest";
import { resolveImports, restoreDraft } from "@/lib/restore";

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

  it("rejects pages without a valid src", () => {
    const bad = (pages: unknown[]) => restoreDraft({ ...draft, pages } as never, "NEW", 5);
    expect(bad([{ pageKey: "o0", rotate: 0 }])).toBeNull();
    expect(bad([{ pageKey: "o0", src: null, rotate: 0 }])).toBeNull();
    expect(bad([null])).toBeNull();
    expect(bad([{ pageKey: "o0", src: {}, rotate: 0 }])).toBeNull();
    expect(bad([{ pageKey: "o0", src: { doc: "OLD", index: "1" }, rotate: 0 }])).toBeNull();
    expect(bad([{ pageKey: "o0", src: { doc: "OLD", index: -1 }, rotate: 0 }])).toBeNull();
    expect(bad([{ pageKey: "u-b", src: { blank: { width: "1", height: 1 } }, rotate: 0 }])).toBeNull();
  });
});

describe("restoreDraft forms", () => {
  const pages = [{ pageKey: "o0", src: { doc: "OLD", index: 0 }, rotate: 0 as const }];
  it("keeps string/boolean form values and drops anything else", () => {
    const draft = { pages, objects: {}, order: [], forms: { nama: "Budi", setuju: true, bad: 3 } } as never;
    expect(restoreDraft(draft, "NEW", 1)!.forms).toEqual({ nama: "Budi", setuju: true });
  });
  it("gives M1/M2 drafts an empty form", () => {
    expect(restoreDraft({ pages, objects: {}, order: [] }, "NEW", 1)!.forms).toEqual({});
  });
});

describe("restoreDraft with imported PDFs", () => {
  const I = "I".repeat(22);
  const draft = {
    pages: [
      { pageKey: "o0", src: { doc: "OLD", index: 0 }, rotate: 0 as const },
      { pageKey: "u-i0", src: { doc: I, index: 0 }, rotate: 0 as const },
      { pageKey: "u-i1", src: { doc: I, index: 1 }, rotate: 0 as const },
    ],
    objects: {}, order: [], imports: [I],
  };

  it("keeps the doc id of imported pages", () => {
    const r = restoreDraft(draft, "NEW", 1)!;
    expect(r.pages.map((p) => ("doc" in p.src ? p.src.doc : null))).toEqual(["NEW", I, I]);
    expect(r.imports).toEqual([I]);
  });

  it("loads the imports' page sizes and drops pages of imports that are gone", async () => {
    const r = restoreDraft(draft, "NEW", 1)!;
    const sizes = [{ index: 0, width: 300, height: 400, rotation: 0, hasText: true }];
    const ok = await resolveImports(r, async () => sizes);
    expect(ok.imports).toEqual({ [I]: sizes });
    expect(ok.doc!.pages.map((p) => p.pageKey)).toEqual(["o0", "u-i0"]); // index 1 no longer exists
    expect(ok.missing).toBe(true);
    const gone = await resolveImports(r, async () => { throw new Error("410"); });
    expect(gone.doc!.pages.map((p) => p.pageKey)).toEqual(["o0"]);
    expect(gone.imports).toEqual({});
    const onlyImported = await resolveImports({ ...r, pages: r.pages.slice(1) }, async () => { throw new Error("410"); });
    expect(onlyImported.doc).toBeNull();
  });
});
