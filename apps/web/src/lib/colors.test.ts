import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, loadSavedColors, MAX_SAVED_COLORS, parseHex, removeSavedColor, SAVED_COLORS_KEY, saveColor } from "./colors";

function memory(initial?: string) {
  const data = new Map<string, string>(initial ? [[SAVED_COLORS_KEY, initial]] : []);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

describe("parseHex", () => {
  it("reads six or three digits, with or without #, any case", () => {
    expect(parseHex("#AABBCC")).toBe("#aabbcc");
    expect(parseHex(" 12ab9f ")).toBe("#12ab9f");
    expect(parseHex("#f0a")).toBe("#ff00aa");
  });
  it("refuses anything else, and three digits while still typing", () => {
    for (const bad of ["", "#", "#12", "#1234", "#ggg000", "red", "#1234567"]) expect(parseHex(bad)).toBeNull();
    expect(parseHex("f0a", false)).toBeNull();
  });
});

describe("hsv", () => {
  it("goes there and back", () => {
    for (const c of ["#000000", "#ffffff", "#e11d48", "#16a34a", "#2563eb", "#7c3aed", "#808080"]) expect(hsvToHex(hexToHsv(c))).toBe(c);
  });
  it("knows the pure hues", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00").h).toBe(120);
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe("#0000ff");
  });
});

describe("saved colours", () => {
  it("puts the newest first, without doubles, and drops the oldest past the limit", () => {
    const kv = memory();
    saveColor("#112233", kv);
    saveColor("#445566", kv);
    expect(saveColor("#112233", kv)).toEqual(["#112233", "#445566"]);
    for (let i = 0; i < MAX_SAVED_COLORS; i++) saveColor(`#0000${i}${i}`, kv);
    const list = loadSavedColors(kv);
    expect(list).toHaveLength(MAX_SAVED_COLORS);
    expect(list[0]).toBe(`#0000${MAX_SAVED_COLORS - 1}${MAX_SAVED_COLORS - 1}`);
    expect(list).not.toContain("#112233");
  });
  it("removes one, ignores junk in storage and a refused write", () => {
    expect(removeSavedColor("#ABC", memory('["#aabbcc", "#123456"]'))).toEqual(["#123456"]);
    expect(loadSavedColors(memory('["#123456", 5, "nope", "#123456"]'))).toEqual(["#123456"]);
    expect(loadSavedColors(memory("{broken"))).toEqual([]);
    const full = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(saveColor("#123456", full)).toEqual(["#123456"]);
  });
});
