import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft";

class MemStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new MemStorage(); });

describe("draft", () => {
  it("round-trips and clears", () => {
    const doc = { pages: [], objects: {}, order: ["x"] };
    saveDraft("h", doc);
    expect(loadDraft("h")).toEqual(doc);
    clearDraft("h");
    expect(loadDraft("h")).toBeNull();
  });

  it("survives broken storage", () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() {} };
    expect(() => saveDraft("h", { pages: [], objects: {}, order: [] })).not.toThrow();
    expect(loadDraft("h")).toBeNull();
  });

  it("rejects malformed stored drafts", () => {
    for (const raw of ["123", "{}", "null", "[]", '{"pages":null,"order":[],"objects":{}}', '{"pages":[],"order":[],"objects":[]}', '{"pages":[],"order":{},"objects":{}}', "not json"]) {
      localStorage.setItem("edith:draft:h", raw);
      expect(loadDraft("h")).toBeNull();
    }
  });
});
