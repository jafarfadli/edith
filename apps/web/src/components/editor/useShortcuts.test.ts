import { describe, expect, it } from "vitest";
import { undoKey } from "./useShortcuts";

const key = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

describe("undoKey", () => {
  it("recognizes undo and redo on both platforms", () => {
    expect(undoKey(key("z", { ctrlKey: true }))).toBe("undo");
    expect(undoKey(key("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(undoKey(key("y", { ctrlKey: true }))).toBe("redo");
    expect(undoKey(key("y", { metaKey: true }))).toBeNull();
    expect(undoKey(key("z"))).toBeNull();
  });
});
