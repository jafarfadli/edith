/** Keyboard shortcuts as shown in tooltips and menus: `Mod` is ⌘ on the Mac and Ctrl elsewhere. */
const MAC: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };
const OTHER: Record<string, string> = { Mod: "Ctrl" };

/** The keys of a shortcut such as "Mod+Shift+Z", one entry per key cap. */
export function formatKeys(spec: string, mac: boolean): string[] {
  const names = mac ? MAC : OTHER;
  return spec.split("+").map((k) => names[k] ?? k);
}

/** A shortcut as `aria-keyshortcuts` spells it: Mod is Meta on the Mac and Control elsewhere. */
const ARIA: Record<string, string> = { Ctrl: "Control" };
export function ariaKeys(spec: string, mac: boolean): string {
  return spec.split("+").map((k) => (k === "Mod" ? (mac ? "Meta" : "Control") : ARIA[k] ?? k)).join("+");
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
