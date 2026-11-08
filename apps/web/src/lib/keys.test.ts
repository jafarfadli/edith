import { describe, expect, it } from "vitest";
import { formatKeys } from "@/lib/keys";

describe("formatKeys", () => {
  it("writes Mod as Ctrl off the Mac", () => {
    expect(formatKeys("Mod+Z", false)).toEqual(["Ctrl", "Z"]);
    expect(formatKeys("Mod+Shift+Z", false)).toEqual(["Ctrl", "Shift", "Z"]);
  });

  it("uses the Mac symbols on the Mac", () => {
    expect(formatKeys("Mod+Z", true)).toEqual(["⌘", "Z"]);
    expect(formatKeys("Mod+Shift+Z", true)).toEqual(["⌘", "⇧", "Z"]);
    expect(formatKeys("Alt+X", true)).toEqual(["⌥", "X"]);
  });

  it("single keys stay as they are", () => {
    expect(formatKeys("V", true)).toEqual(["V"]);
    expect(formatKeys("Esc", false)).toEqual(["Esc"]);
  });
});
