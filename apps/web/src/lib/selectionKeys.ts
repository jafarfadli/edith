import type { Align } from "@/lib/objects";

/** Keyboard commands of the selection (Figma's), as pure key tests. Every one is off while an input method composes
 *  (`isComposing`, keyCode 229: arrows and letters then belong to the candidate window). */
interface Key { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean; keyCode?: number }

const composing = (e: Key) => !!e.isComposing || e.keyCode === 229;

/** Arrow keys: the move in screen points — 1, or 10 with Shift. Not with Cmd/Ctrl/Alt. */
export function nudgeForKey(e: Key): [number, number] | null {
  if (composing(e) || e.metaKey || e.ctrlKey || e.altKey) return null;
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case "ArrowLeft": return [-step, 0];
    case "ArrowRight": return [step, 0];
    case "ArrowUp": return [0, -step];
    case "ArrowDown": return [0, step];
    default: return null;
  }
}

/** Figma's align keys: Alt + A (left), H (horizontal centres), D (right), W (top), V (vertical centres), S (bottom);
 *  Alt+Shift + H / V distribute the spacing. Judged by the key's position (`code`), since Option changes the typed
 *  letter on a Mac (Option+A types "å"). Never with Cmd or Ctrl: AltGr is Ctrl+Alt on a European Windows layout. */
export function arrangeForKey(e: Key): { align: Align } | { distribute: "x" | "y" } | null {
  if (composing(e) || !e.altKey || e.metaKey || e.ctrlKey) return null;
  if (e.shiftKey) {
    if (e.code === "KeyH") return { distribute: "x" };
    if (e.code === "KeyV") return { distribute: "y" };
    return null;
  }
  switch (e.code) {
    case "KeyA": return { align: "left" };
    case "KeyH": return { align: "center" };
    case "KeyD": return { align: "right" };
    case "KeyW": return { align: "top" };
    case "KeyV": return { align: "middle" };
    case "KeyS": return { align: "bottom" };
    default: return null;
  }
}

const mod = (e: Key) => e.metaKey || e.ctrlKey;

export function isSelectAllKey(e: Key): boolean {
  return !composing(e) && mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a";
}

export function isCutKey(e: Key): boolean {
  return !composing(e) && mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "x";
}

/** Tab (1) and Shift+Tab (-1): the next/previous object. */
export function tabForKey(e: Key): 1 | -1 | null {
  if (composing(e) || e.key !== "Tab" || mod(e) || e.altKey) return null;
  return e.shiftKey ? -1 : 1;
}
