import { describe, expect, it } from "vitest";
import { dataUrlToBlob, loadSignatures, MAX_DATA_URL, MAX_SIGNATURES, removeSignature, saveSignature, SIGNATURE_KEY, signatureRect, type SavedSignature } from "@/lib/signatures";

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } } as Storage & { data: Map<string, string> };
}
const sig = (id: string, dataUrl = `data:image/png;base64,${id}`): SavedSignature => ({ id, dataUrl, width: 300, height: 100 });

describe("signature library", () => {
  it("keeps the newest first, at most MAX_SIGNATURES, without duplicates", () => {
    const kv = memory();
    for (let i = 0; i < MAX_SIGNATURES + 2; i++) expect(saveSignature(sig(`s${i}`), kv).saved).toBe(true);
    saveSignature(sig("again", "data:image/png;base64,s6"), kv); // same image as s6
    const list = loadSignatures(kv);
    expect(list.map((s) => s.id)).toEqual(["again", "s5", "s4", "s3", "s2"]);
    expect(removeSignature("s4", kv).map((s) => s.id)).toEqual(["again", "s5", "s3", "s2"]);
  });

  it("does not save a signature that is too big, or when storage refuses", () => {
    const kv = memory();
    expect(saveSignature(sig("big", `data:image/png;base64,${"A".repeat(MAX_DATA_URL)}`), kv)).toEqual({ saved: false, list: [] });
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(saveSignature(sig("a"), full).saved).toBe(false);
    expect(saveSignature(sig("a"), null).saved).toBe(false);
  });

  it("ignores broken storage content", () => {
    const kv = memory();
    kv.data.set(SIGNATURE_KEY, "not json");
    expect(loadSignatures(kv)).toEqual([]);
    kv.data.set(SIGNATURE_KEY, JSON.stringify([sig("ok"), { id: "x", dataUrl: "javascript:1", width: 1, height: 1 }, null]));
    expect(loadSignatures(kv).map((s) => s.id)).toEqual(["ok"]);
  });

  it("keeps only PNG and JPEG images", () => {
    const kv = memory();
    kv.data.set(SIGNATURE_KEY, JSON.stringify([sig("png"), sig("jpg", "data:image/jpeg;base64,/9j/"),
      sig("svg", "data:image/svg+xml;base64,PHN2Zz4="), sig("gif", "data:image/gif;base64,R0lG"), sig("pngx", "data:image/pngx;base64,AA")]));
    expect(loadSignatures(kv).map((s) => s.id)).toEqual(["png", "jpg"]);
  });
});

describe("signatureRect", () => {
  const page = { width: 595, height: 842 };
  it("is 160 pt wide for a wide signature, centred", () => {
    expect(signatureRect(600, 200, page)).toEqual({ x: (595 - 160) / 2, y: (842 - 160 / 3) / 2, w: 160, h: 160 / 3 });
  });
  it("is at most 80 pt tall", () => {
    const r = signatureRect(200, 200, page);
    expect([r.w, r.h]).toEqual([80, 80]);
  });
});

describe("dataUrlToBlob", () => {
  it("decodes base64 with its type", async () => {
    const b = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(b.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await b.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
