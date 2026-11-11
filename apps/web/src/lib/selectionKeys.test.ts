import { describe, expect, it } from "vitest";
import { arrangeForKey, isCutKey, isSelectAllKey, nudgeForKey, tabForKey } from "./selectionKeys";

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; keyCode: number; code: string }> = {}) =>
  ({ key: k, code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe("nudgeForKey", () => {
  it("one point per arrow, ten with Shift", () => {
    expect(nudgeForKey(key("ArrowLeft"))).toEqual([-1, 0]);
    expect(nudgeForKey(key("ArrowRight"))).toEqual([1, 0]);
    expect(nudgeForKey(key("ArrowUp"))).toEqual([0, -1]);
    expect(nudgeForKey(key("ArrowDown", { shiftKey: true }))).toEqual([0, 10]);
  });

  it("not with Cmd / Ctrl / Alt (those are the browser's and the OS's), not while composing", () => {
    expect(nudgeForKey(key("ArrowLeft", { metaKey: true }))).toBeNull();
    expect(nudgeForKey(key("ArrowLeft", { ctrlKey: true }))).toBeNull();
    expect(nudgeForKey(key("ArrowLeft", { altKey: true }))).toBeNull();
    expect(nudgeForKey(key("ArrowLeft", { isComposing: true }))).toBeNull();
    expect(nudgeForKey(key("ArrowLeft", { keyCode: 229 }))).toBeNull();
  });

  it("other keys are none", () => {
    expect(nudgeForKey(key("a"))).toBeNull();
  });
});

describe("arrangeForKey", () => {
  it("Alt + A H D / W V S align by the key's position (Option changes the typed letter on a Mac)", () => {
    expect(arrangeForKey(key("å", { altKey: true, code: "KeyA" }))).toEqual({ align: "left" });
    expect(arrangeForKey(key("˙", { altKey: true, code: "KeyH" }))).toEqual({ align: "center" });
    expect(arrangeForKey(key("∂", { altKey: true, code: "KeyD" }))).toEqual({ align: "right" });
    expect(arrangeForKey(key("w", { altKey: true, code: "KeyW" }))).toEqual({ align: "top" });
    expect(arrangeForKey(key("v", { altKey: true, code: "KeyV" }))).toEqual({ align: "middle" });
    expect(arrangeForKey(key("ß", { altKey: true, code: "KeyS" }))).toEqual({ align: "bottom" });
  });

  it("Alt+Shift+H / V distribute", () => {
    expect(arrangeForKey(key("H", { altKey: true, shiftKey: true, code: "KeyH" }))).toEqual({ distribute: "x" });
    expect(arrangeForKey(key("V", { altKey: true, shiftKey: true, code: "KeyV" }))).toEqual({ distribute: "y" });
  });

  it("not without Alt, nor with Cmd or Ctrl (AltGr is Ctrl+Alt), nor while composing", () => {
    expect(arrangeForKey(key("a", { code: "KeyA" }))).toBeNull();
    expect(arrangeForKey(key("a", { altKey: true, metaKey: true, code: "KeyA" }))).toBeNull();
    expect(arrangeForKey(key("a", { altKey: true, ctrlKey: true, code: "KeyA" }))).toBeNull();
    expect(arrangeForKey(key("a", { altKey: true, code: "KeyA", isComposing: true }))).toBeNull();
    expect(arrangeForKey(key("a", { altKey: true, shiftKey: true, code: "KeyA" }))).toBeNull(); // Shift only for distribute
  });
});

describe("select all / cut / tab", () => {
  it("Cmd or Ctrl + A", () => {
    expect(isSelectAllKey(key("a", { metaKey: true }))).toBe(true);
    expect(isSelectAllKey(key("A", { ctrlKey: true }))).toBe(true);
    expect(isSelectAllKey(key("a"))).toBe(false);
    expect(isSelectAllKey(key("a", { metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("Cmd or Ctrl + X", () => {
    expect(isCutKey(key("x", { metaKey: true }))).toBe(true);
    expect(isCutKey(key("x"))).toBe(false);
    expect(isCutKey(key("x", { ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("Tab forwards, Shift+Tab back, nothing with other modifiers", () => {
    expect(tabForKey(key("Tab"))).toBe(1);
    expect(tabForKey(key("Tab", { shiftKey: true }))).toBe(-1);
    expect(tabForKey(key("Tab", { ctrlKey: true }))).toBeNull();
    expect(tabForKey(key("Tab", { altKey: true }))).toBeNull();
    expect(tabForKey(key("Enter"))).toBeNull();
  });
});
