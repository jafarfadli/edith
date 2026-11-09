import { describe, expect, it } from "vitest";
import { ariaKeys, formatKeys } from "@/lib/keys";

describe("formatKeys", () => {
  it("writes Mod as Ctrl off the Mac", () => {
    expect(formatKeys("Mod+Z", false)).toEqual(["Ctrl", "Z"]);
    expect(formatKeys("Mod+Shift+Z", false)).toEqual(["Ctrl", "Shift", "Z"]);
  });

  it("uses the Mac symbols on the Mac", () => {
    expect(formatKeys("Mod+Z", true)).toEqual(["⌘", "Z"]);
    expect(formatKeys("Mod+Shift+Z", true)).toEqual(["⌘", "⇧", "Z"]);
    expect(formatKeys("Alt+X", true)).toEqual(["⌥", "X"]);
    expect(formatKeys("Mod+Shift+]", true)).toEqual(["⌘", "⇧", "]"]);
  });

  it("writes Delete as the key it is on each keyboard (the Mac's delete key is ⌫)", () => {
    expect(formatKeys("Delete", true)).toEqual(["⌫"]);
    expect(formatKeys("Delete", false)).toEqual(["Del"]);
  });

  it("single keys stay as they are", () => {
    expect(formatKeys("V", true)).toEqual(["V"]);
    expect(formatKeys("Esc", false)).toEqual(["Esc"]);
  });
});

describe("ariaKeys", () => {
  it("names Mod as Meta on the Mac and Control elsewhere (aria-keyshortcuts)", () => {
    expect(ariaKeys("Mod+Z", true)).toBe("Meta+Z");
    expect(ariaKeys("Mod+Z", false)).toBe("Control+Z");
    expect(ariaKeys("Mod+Shift+Z", true)).toBe("Meta+Shift+Z");
    expect(ariaKeys("Mod+F", false)).toBe("Control+F");
  });

  it("spells the other modifiers the way aria-keyshortcuts wants them", () => {
    expect(ariaKeys("Ctrl+Y", true)).toBe("Control+Y");
    expect(ariaKeys("Alt+X", false)).toBe("Alt+X");
    expect(ariaKeys("V", true)).toBe("V");
  });
});
