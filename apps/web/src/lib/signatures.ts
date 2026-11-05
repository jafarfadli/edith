import type { Rect } from "@edith/ops";

/** A signature kept in this browser's library (spec: pustaka tanda tangan per browser). */
export interface SavedSignature { id: string; dataUrl: string; width: number; height: number }
type KV = Pick<Storage, "getItem" | "setItem">;

export const SIGNATURE_KEY = "edith:signatures";
/** At most this many saved signatures (newest first; the oldest drops out). */
export const MAX_SIGNATURES = 5;
/** A signature PNG larger than this (data URL characters, ≈ 300 KB) is used but not saved. */
export const MAX_DATA_URL = 400_000;
export const SIGNATURE_FONTS = ["Dancing Script", "Caveat", "Great Vibes", "Sacramento"] as const;
export const SIGNATURE_COLORS = ["#111111", "#1d4ed8", "#b91c1c"] as const;
/** Width of a newly placed signature (pt); a tall one is limited to SIGNATURE_MAX_H instead. */
export const SIGNATURE_W = 160;
export const SIGNATURE_MAX_H = 80;

const store = (): KV | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

function valid(v: unknown): v is SavedSignature {
  const s = v as SavedSignature;
  return typeof s === "object" && s !== null && typeof s.id === "string" && typeof s.dataUrl === "string"
    && s.dataUrl.startsWith("data:image/") && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0;
}

export function loadSignatures(kv: KV | null = store()): SavedSignature[] {
  try {
    const raw = kv?.getItem(SIGNATURE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(valid).slice(0, MAX_SIGNATURES) : [];
  } catch {
    return [];
  }
}

function write(list: SavedSignature[], kv: KV | null): boolean {
  try { kv?.setItem(SIGNATURE_KEY, JSON.stringify(list)); return !!kv; } catch { return false; } // quota or blocked
}

/** Saves `sig` first in the library; `saved` is false when it is too big or storage refused it. */
export function saveSignature(sig: SavedSignature, kv: KV | null = store()): { saved: boolean; list: SavedSignature[] } {
  const current = loadSignatures(kv);
  if (sig.dataUrl.length > MAX_DATA_URL) return { saved: false, list: current };
  const list = [sig, ...current.filter((s) => s.id !== sig.id && s.dataUrl !== sig.dataUrl)].slice(0, MAX_SIGNATURES);
  return write(list, kv) ? { saved: true, list } : { saved: false, list: current };
}

export function removeSignature(id: string, kv: KV | null = store()): SavedSignature[] {
  const list = loadSignatures(kv).filter((s) => s.id !== id);
  write(list, kv);
  return list;
}

/** Where a new signature of `w` × `h` px goes: SIGNATURE_W wide (or SIGNATURE_MAX_H tall), centred on the page. */
export function signatureRect(w: number, h: number, page: { width: number; height: number }): Rect {
  const scale = Math.min(SIGNATURE_W / w, SIGNATURE_MAX_H / h, (page.width * 0.8) / w);
  const rw = w * scale, rh = h * scale;
  return { x: (page.width - rw) / 2, y: (page.height - rh) / 2, w: rw, h: rh };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",", 2);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bin = atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
