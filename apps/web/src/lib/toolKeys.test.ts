import { describe, expect, it } from "vitest";
import { t } from "@/lib/strings";
import { TOOL_KEYS, toolForKey, toolHint } from "@/lib/toolKeys";

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("tool keys", () => {
  it("a letter picks its tool, either case", () => {
    expect(toolForKey(key("v"))).toBe("select");
    expect(toolForKey(key("T"))).toBe("text");
    expect(toolForKey(key("r"))).toBe("rect");
    expect(toolForKey(key("h"))).toBe("pan");
  });

  it("not with a modifier, and not for other keys", () => {
    expect(toolForKey(key("v", { metaKey: true }))).toBeNull();
    expect(toolForKey(key("t", { ctrlKey: true }))).toBeNull();
    expect(toolForKey(key("r", { altKey: true }))).toBeNull();
    expect(toolForKey(key("q"))).toBeNull();
    expect(toolForKey(key("Enter"))).toBeNull();
  });

  it("every key is one letter and used once", () => {
    const keys = Object.values(TOOL_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[A-Z]$/);
  });
});

describe("toolHint", () => {
  it("one sentence for each tool that needs explaining", () => {
    expect(toolHint("text")).toBe(t.hints.text);
    expect(toolHint("rect")).toBe(t.hints.rect);
    expect(toolHint("polygon")).toBe(t.hints.points);
    expect(toolHint("cloud")).toBe(t.hints.points);
  });

  it("none for Pilih (the resting state) and the hidden note and link tools", () => {
    expect(toolHint("select")).toBeNull();
    expect(toolHint("note")).toBeNull();
    expect(toolHint("link")).toBeNull();
  });
});
