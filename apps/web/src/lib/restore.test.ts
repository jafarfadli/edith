import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { dropStaleTextEdits, resolveImports, restoreDraft } from "@/lib/restore";

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
    const field = { name: "nama", page: 0 } as never;
    const ok = await resolveImports(r, async () => ({ pages: sizes, fields: [field] }));
    expect(ok.imports).toEqual({ [I]: sizes });
    expect(ok.fields).toEqual({ [I]: [field] });
    expect(ok.doc!.pages.map((p) => p.pageKey)).toEqual(["o0", "u-i0"]); // index 1 no longer exists
    expect(ok.missing).toBe(true);
    const gone = await resolveImports(r, async () => { throw new ApiError("doc_expired", 410); });
    expect(gone.doc!.pages.map((p) => p.pageKey)).toEqual(["o0"]);
    expect(gone.imports).toEqual({});
    const onlyImported = await resolveImports({ ...r, pages: r.pages.slice(1) }, async () => { throw new ApiError("doc_expired", 410); });
    expect(onlyImported.doc).toBeNull();
    const notFound = await resolveImports(r, async () => { throw new ApiError("doc_not_found", 404); });
    expect(notFound.doc!.pages.map((p) => p.pageKey)).toEqual(["o0"]);
  });

  it("propagates any other failure instead of dropping the import's pages", async () => {
    const r = restoreDraft(draft, "NEW", 1)!;
    await expect(resolveImports(r, async () => { throw new Error("network down"); })).rejects.toThrow("network down");
    await expect(resolveImports(r, async () => { throw new ApiError("boom", 500); })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("restoreDraft keeps imported field values", () => {
  it("validates them per imported PDF", () => {
    const I = "I".repeat(22);
    const draft = {
      pages: [{ pageKey: "u-i0", src: { doc: I, index: 0 }, rotate: 0 as const }], objects: {}, order: [], imports: [I],
      importForms: { [I]: { nama: "Budi", rusak: 3 }, OTHER: { x: "y" } },
    };
    expect(restoreDraft(draft as never, "NEW", 1)!.importForms).toEqual({ [I]: { nama: "Budi" } });
  });
});

describe("dropStaleTextEdits", () => {
  const box = { rect: { x: 0, y: 0, w: 10, h: 10 }, lineHeight: 12, paragraphs: [], layout: [] };
  const doc = {
    pages: [{ pageKey: "o0", src: { doc: "D", index: 0 }, rotate: 0 as const }],
    objects: {
      e: { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g3", box },
      w: { id: "w", type: "whiteout.add", pageKey: "o0", rect: { x: 0, y: 0, w: 5, h: 5 } },
    },
    order: ["e", "w"],
  } as unknown as Parameters<typeof dropStaleTextEdits>[0];

  it("drops text edits of drafts from another segmentation (unstamped = version 1) and keeps the rest", () => {
    for (const stamp of [undefined, 1, 3]) {
      const { doc: out, dropped } = dropStaleTextEdits({ ...doc, paragraphsVersion: stamp });
      expect(dropped).toBe(1);
      expect(out.order).toEqual(["w"]);
      expect(Object.keys(out.objects)).toEqual(["w"]);
      expect(out).not.toHaveProperty("paragraphsVersion");
    }
  });

  it("keeps text edits of the current segmentation", () => {
    const { doc: out, dropped } = dropStaleTextEdits({ ...doc, paragraphsVersion: 2 });
    expect(dropped).toBe(0);
    expect(out.order).toEqual(["e", "w"]);
    expect(out).not.toHaveProperty("paragraphsVersion");
  });
});
