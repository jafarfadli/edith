/** Colours for the colour popover: reading a hex code someone typed, the hue/saturation/value model of the in-page
 *  picker, and the colours this browser keeps (spec: warna tersimpan per browser), shared by every colour field. */

export interface Hsv { h: number; s: number; v: number }
type KV = Pick<Storage, "getItem" | "setItem">;

export const SAVED_COLORS_KEY = "edith:colors";
/** At most this many saved colours (newest first; saving one more drops the oldest). */
export const MAX_SAVED_COLORS = 7;

/** A typed colour as "#rrggbb" (lower case), or null. Takes "#abc", "abc", "#aabbcc" or "aabbcc", spaces around. With
 *  `short` false, three digits do not count yet (someone typing "aab" may be on the way to "aabbcc"). */
export function parseHex(text: string, short = true): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  let d = m[1].toLowerCase();
  if (d.length === 3) {
    if (!short) return null;
    d = [...d].map((c) => c + c).join("");
  }
  return `#${d}`;
}

export function hexToHsv(hex: string): Hsv {
  const d = (parseHex(hex) ?? "#000000").slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(d.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  let h = 0;
  if (c) h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return { h: ((h * 60) + 360) % 360, s: max ? c / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[5, 3, 1].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const store = (): KV | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export function loadSavedColors(kv: KV | null = store()): string[] {
  try {
    const list: unknown = JSON.parse(kv?.getItem(SAVED_COLORS_KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    const ok = list.map((c) => (typeof c === "string" ? parseHex(c) : null)).filter((c): c is string => !!c);
    return [...new Set(ok)].slice(0, MAX_SAVED_COLORS);
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let cached: { raw: string | null; list: string[] } | null = null;

function write(list: string[], kv: KV | null): string[] {
  try { kv?.setItem(SAVED_COLORS_KEY, JSON.stringify(list)); } catch { /* storage full or blocked: kept for this page */ }
  cached = { raw: JSON.stringify(list), list };
  listeners.forEach((l) => l());
  return list;
}

/** Puts `color` first among the saved colours (moving it up when it is there already). */
export function saveColor(color: string, kv: KV | null = store()): string[] {
  const hex = parseHex(color);
  const current = loadSavedColors(kv);
  if (!hex) return current;
  return write([hex, ...current.filter((c) => c !== hex)].slice(0, MAX_SAVED_COLORS), kv);
}

export function removeSavedColor(color: string, kv: KV | null = store()): string[] {
  return write(loadSavedColors(kv).filter((c) => c !== parseHex(color)), kv);
}

/** For useSyncExternalStore: every colour field shows the same list, also after a save in another tab. */
export function subscribeSavedColors(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key === SAVED_COLORS_KEY) { cached = null; listener(); } };
  globalThis.addEventListener?.("storage", onStorage);
  return () => { listeners.delete(listener); globalThis.removeEventListener?.("storage", onStorage); };
}

const NONE: string[] = [];
/** The saved list, the same array until it changes (useSyncExternalStore compares snapshots by identity). */
export function savedColorsSnapshot(): string[] {
  let raw: string | null = null;
  try { raw = store()?.getItem(SAVED_COLORS_KEY) ?? null; } catch { /* blocked */ }
  if (cached && (cached.raw === raw || raw === null)) return cached.list;
  cached = { raw, list: loadSavedColors() };
  return cached.list;
}
export const savedColorsServerSnapshot = () => NONE;
