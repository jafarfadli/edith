/** The documents open as tabs in the editor (several PDFs edited side by side, one shown at a time): their edit ids
 *  and names, in this browser's localStorage, so every tab of the browser and a reload show the same row. Opening a
 *  document adds it; closing a tab only takes it off the row (the edit stays in the recent list). */

export interface DocTab { id: string; name: string }

const KEY = "edith:tabs";
/** Tabs kept at most: opening another drops the oldest that is not the one opened. */
export const MAX_TABS = 8;

const listeners = new Set<() => void>();

function raw(): string {
  try { return localStorage.getItem(KEY) ?? "[]"; } catch { return "[]"; }
}

export function parseTabs(text: string): DocTab[] {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is DocTab => typeof x?.id === "string" && typeof x?.name === "string") : [];
  } catch { return []; }
}

export const readTabs = () => parseTabs(raw());

function write(list: DocTab[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  cached = null;
  listeners.forEach((f) => f());
}

/** `tab` on the row (at its end when new; its name brought up to date when there already). */
export function withTab(list: DocTab[], tab: DocTab): DocTab[] {
  if (list.some((x) => x.id === tab.id)) return list.map((x) => (x.id === tab.id ? tab : x));
  const next = [...list, tab];
  return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
}

export function openTab(tab: DocTab): void {
  const list = readTabs();
  const next = withTab(list, tab);
  if (JSON.stringify(next) !== JSON.stringify(list)) write(next);
}

/** Takes `id` off the row; returns the tab to show instead when it was the one shown (its right neighbour, else its
 *  left one), or null when none is left. */
export function closeTab(id: string): DocTab | null {
  const list = readTabs();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return list[0] ?? null;
  const next = list.filter((x) => x.id !== id);
  write(next);
  return next[i] ?? next[i - 1] ?? null;
}

let cached: { text: string; list: DocTab[] } | null = null;

/** For useSyncExternalStore: the row, the same array until it changes. */
export function tabsSnapshot(): DocTab[] {
  const text = raw();
  if (!cached || cached.text !== text) cached = { text, list: parseTabs(text) };
  return cached.list;
}
const EMPTY: DocTab[] = [];
export const tabsServerSnapshot = () => EMPTY;

export function subscribeTabs(f: () => void): () => void {
  listeners.add(f);
  window.addEventListener("storage", f);
  return () => { listeners.delete(f); window.removeEventListener("storage", f); };
}
