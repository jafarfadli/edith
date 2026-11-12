import { describe, expect, it } from "vitest";
import { ago, listed, MAX_LISTED, pruned, remapAssets, UNEDITED_TTL_MS, upsert, type EditRecord } from "./library";

const rec = (id: string, over: Partial<EditRecord> = {}): EditRecord =>
  ({ id, serverId: id, name: `${id}.pdf`, pageCount: 1, edited: true, updatedAt: 1000, ...over });

describe("the list of edits", () => {
  it("replaces an edit by its id and puts it first", () => {
    const list = upsert([rec("a"), rec("b")], rec("b", { updatedAt: 5 }));
    expect(list.map((r) => r.id)).toEqual(["b", "a"]);
    expect(list[0].updatedAt).toBe(5);
  });

  it("lists only changed edits, newest first, and not more than it shows", () => {
    const many = Array.from({ length: MAX_LISTED + 5 }, (_, i) => rec(`e${i}`, { updatedAt: i }));
    const shown = listed([rec("fresh", { edited: false, updatedAt: 99999 }), ...many]);
    expect(shown).toHaveLength(MAX_LISTED);
    expect(shown[0].id).toBe(`e${MAX_LISTED + 4}`);
    expect(shown.some((r) => r.id === "fresh")).toBe(false);
  });

  it("keeps listed edits and recent uploads, forgets old unedited uploads and edits past the list", () => {
    const now = 10 * UNEDITED_TTL_MS;
    const list = [
      rec("edited", { updatedAt: now - 5 * UNEDITED_TTL_MS }),
      rec("just-uploaded", { edited: false, updatedAt: now - 1000 }),
      rec("old-upload", { edited: false, updatedAt: now - 2 * UNEDITED_TTL_MS }),
    ];
    const { keep, drop } = pruned(list, now);
    expect(keep.map((r) => r.id)).toEqual(["edited", "just-uploaded"]);
    expect(drop.map((r) => r.id)).toEqual(["old-upload"]);
  });
});

describe("remapAssets", () => {
  it("replaces known asset ids wherever they are and leaves everything else alone", () => {
    const doc = { objects: { a: { type: "image.add", assetId: "old1", rect: { x: 1 } }, b: { type: "signature.add", assetId: "old2" }, c: { type: "x", assetId: "other" } }, list: [{ assetId: "old1" }] };
    const out = remapAssets(doc, { old1: "new1", old2: "new2" });
    expect(out.objects.a.assetId).toBe("new1");
    expect(out.objects.b.assetId).toBe("new2");
    expect(out.objects.c.assetId).toBe("other");
    expect(out.list[0].assetId).toBe("new1");
    expect(doc.objects.a.assetId).toBe("old1"); // the original is untouched
  });
});

describe("ago", () => {
  it("says how long ago in words", () => {
    const now = 1_000_000_000;
    expect(ago(now - 10_000, now)).toBe("baru saja");
    expect(ago(now - 5 * 60_000, now)).toBe("5 menit lalu");
    expect(ago(now - 3 * 3600_000, now)).toBe("3 jam lalu");
    expect(ago(now - 24 * 3600_000, now)).toBe("kemarin");
    expect(ago(now - 4 * 24 * 3600_000, now)).toBe("4 hari lalu");
  });
});
