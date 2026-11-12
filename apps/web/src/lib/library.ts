/** The edits this browser keeps (the "recent edits" list) and what each needs to continue after the server has dropped
 *  its copy of the PDF: the PDF itself and the images placed on it, in IndexedDB. An edit is named by `id`, the id of
 *  the document at its upload, and keeps it for good (it is the address /edit/{id}); `serverId` is the document the
 *  server holds for it now, which changes when the edit is put back after the server forgot it. Its draft is in
 *  localStorage (lib/draft.ts) under the same id. Every call here may fail (private mode, storage full): the editor
 *  then simply has no local copy and the list no entry. */

import { clearDraft } from "./draft";

export interface EditRecord {
  id: string; serverId: string; name: string; pageCount: number;
  /** Set once the edit has a change; an upload nobody touched stays out of the list. */
  edited: boolean;
  updatedAt: number;
}

const INDEX_KEY = "edith:edits";
export const MAX_LISTED = 12;
/** An upload nobody edited is forgotten after this long. */
export const UNEDITED_TTL_MS = 24 * 3600 * 1000;

// ---- the list (pure) --------------------------------------------------------------------------------------------

export function upsert(list: EditRecord[], rec: EditRecord): EditRecord[] {
  return [rec, ...list.filter((r) => r.id !== rec.id)];
}

/** The edits to list: the changed ones, newest first. */
export function listed(list: EditRecord[]): EditRecord[] {
  return list.filter((r) => r.edited).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LISTED);
}

/** What to keep: the listed edits, and recent unedited uploads (so the one just opened is not lost). The rest goes. */
export function pruned(list: EditRecord[], now: number): { keep: EditRecord[]; drop: EditRecord[] } {
  const shown = new Set(listed(list).map((r) => r.id));
  const keep: EditRecord[] = [], drop: EditRecord[] = [];
  for (const r of list) (shown.has(r.id) || (!r.edited && now - r.updatedAt < UNEDITED_TTL_MS) ? keep : drop).push(r);
  return { keep, drop };
}

/** A copy of `value` in which every `assetId` that `map` knows is replaced (the images of an edit put on a new document). */
export function remapAssets<T>(value: T, map: Record<string, string>): T {
  if (Array.isArray(value)) return value.map((v) => remapAssets(v, map)) as T;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, k === "assetId" && typeof v === "string" && v in map ? map[v] : remapAssets(v, map)])) as T;
}

/** "5 menit lalu", "kemarin" … for the list. */
export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "baru saja";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.round(h / 24);
  return d === 1 ? "kemarin" : `${d} hari lalu`;
}

// ---- the list (stored) ------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is EditRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.serverId === "string" && typeof r.name === "string"
    && typeof r.pageCount === "number" && typeof r.edited === "boolean" && typeof r.updatedAt === "number";
}

export function parseIndex(raw: string): EditRecord[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isRecord) : [];
  } catch { return []; }
}

export const readIndex = () => parseIndex(rawIndex());

const listeners = new Set<() => void>();

function writeIndex(list: EditRecord[]) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  listeners.forEach((f) => f());
}

/** For useSyncExternalStore: the stored list as text (a stable value), and a subscription to its changes (this tab's and
 *  other tabs'). */
export const rawIndex = () => { try { return localStorage.getItem(INDEX_KEY) ?? "[]"; } catch { return "[]"; } };
export function subscribeIndex(f: () => void): () => void {
  listeners.add(f);
  window.addEventListener("storage", f);
  return () => { listeners.delete(f); window.removeEventListener("storage", f); };
}

export const getRecord = (id: string) => readIndex().find((r) => r.id === id);

export function saveRecord(rec: EditRecord) {
  writeIndex(upsert(readIndex(), rec));
}

/** Marks the edit as changed, now. */
export function touchRecord(id: string, now = Date.now()) {
  const rec = getRecord(id);
  if (rec) saveRecord({ ...rec, edited: true, updatedAt: now });
}

// ---- the PDF and the images (IndexedDB) -------------------------------------------------------------------------

const DB = "edith";
const SOURCES = "sources";
const ASSETS = "assets";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(SOURCES); req.result.createObjectStore(ASSETS); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = f(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const assetKey = (id: string, assetId: string) => `${id}/${assetId}`;

export const putSource = (id: string, pdf: Blob) => run(SOURCES, "readwrite", (s) => s.put(pdf, id));
export const getSource = (id: string) => run<Blob | undefined>(SOURCES, "readonly", (s) => s.get(id));
export const putAsset = (id: string, assetId: string, image: Blob) => run(ASSETS, "readwrite", (s) => s.put(image, assetKey(id, assetId)));

/** Every image of the edit, by asset id. */
export async function getAssets(id: string): Promise<Record<string, Blob>> {
  const range = assetRange(id);
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const out: Record<string, Blob> = {};
      const tx = db.transaction(ASSETS, "readonly");
      const req = tx.objectStore(ASSETS).openCursor(range);
      req.onsuccess = () => {
        const c = req.result;
        if (c) { out[String(c.key).slice(id.length + 1)] = c.value as Blob; c.continue(); }
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const assetRange = (id: string) => IDBKeyRange.bound(`${id}/`, `${id}/\uffff`);

/** Replaces the images of the edit with `assets` (after they were uploaded again under new ids). */
export async function setAssets(id: string, assets: Record<string, Blob>) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ASSETS, "readwrite");
      const store = tx.objectStore(ASSETS);
      store.delete(assetRange(id));
      for (const [assetId, blob] of Object.entries(assets)) store.put(blob, assetKey(id, assetId));
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function deleteStored(id: string) {
  await run(SOURCES, "readwrite", (s) => s.delete(id));
  await run(ASSETS, "readwrite", (s) => s.delete(assetRange(id)));
}

/** Forgets an edit: its entry, draft, PDF and images. */
export async function forget(id: string) {
  writeIndex(readIndex().filter((r) => r.id !== id));
  clearDraft(id);
  try { await deleteStored(id); } catch { /* nothing stored */ }
}

/** Drops what `pruned` says is not worth keeping. */
export async function tidy(now = Date.now()) {
  const { keep, drop } = pruned(readIndex(), now);
  if (!drop.length) return;
  writeIndex(keep);
  await Promise.all(drop.map((r) => forget(r.id)));
}
