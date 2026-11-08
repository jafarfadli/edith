import type { ContentOp } from "@edith/ops";
import { normRotation, type CropBox } from "@/lib/coords";
import { newId } from "@/lib/id";
import type { DocInfo, EditorDoc, PageEntry } from "@/store/editor";

/** Page operations on the undoable document, shared by the page menu and the Manage Pages modal.
 *  Pure: each returns a new document (or the same one when nothing changes). */

export const MIN_CROP = 10; // pt: smaller crops are ignored

const keySet = (keys: readonly string[]) => new Set(keys);

export function rotatePages(doc: EditorDoc, keys: readonly string[], delta: 90 | -90): EditorDoc {
  const ks = keySet(keys);
  if (!doc.pages.some((p) => ks.has(p.pageKey))) return doc;
  return { ...doc, pages: doc.pages.map((p) => (ks.has(p.pageKey) ? { ...p, rotate: normRotation(p.rotate + delta) } : p)) };
}

/** Removes the pages (their objects stay in the document until compaction; undo brings both back). A document
 *  keeps at least one page. */
export function deletePages(doc: EditorDoc, keys: readonly string[]): EditorDoc {
  const ks = keySet(keys);
  const pages = doc.pages.filter((p) => !ks.has(p.pageKey));
  return pages.length === doc.pages.length || pages.length === 0 ? doc : { ...doc, pages };
}

/** Puts a copy of every page right after it, with a new pageKey and copies of all its objects (spec:
 *  duplicating a page copies its ops). Links on the copy keep their targets. */
export function duplicatePages(doc: EditorDoc, keys: readonly string[], makeKey = () => newId("u"), makeId = () => newId()): EditorDoc {
  const ks = keySet(keys);
  if (!doc.pages.some((p) => ks.has(p.pageKey))) return doc;
  const pages: PageEntry[] = [];
  const objects = { ...doc.objects };
  const order = [...doc.order];
  for (const p of doc.pages) {
    pages.push(p);
    if (!ks.has(p.pageKey)) continue;
    const pageKey = makeKey();
    pages.push({ ...p, pageKey });
    for (const id of doc.order) {
      const op = doc.objects[id];
      if (op?.pageKey !== p.pageKey) continue;
      const copy = { ...structuredClone(op), id: makeId(), pageKey } as ContentOp;
      objects[copy.id] = copy;
      order.push(copy.id);
    }
  }
  return { ...doc, pages, objects, order };
}

/** Moves each selected page one place left (-1) or right (+1); a selected page next to another selected one
 *  that cannot move stays (the selection moves as a block). */
export function shiftPages(doc: EditorDoc, keys: readonly string[], dir: -1 | 1): EditorDoc {
  const ks = keySet(keys);
  const pages = [...doc.pages];
  let changed = false;
  const idx = pages.map((_, i) => i);
  for (const i of dir < 0 ? idx : idx.reverse()) {
    const j = i + dir;
    if (j < 0 || j >= pages.length || !ks.has(pages[i].pageKey) || ks.has(pages[j].pageKey)) continue;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    changed = true;
  }
  return changed ? { ...doc, pages } : doc;
}

export function movePage(doc: EditorDoc, key: string, toIndex: number): EditorDoc {
  const from = doc.pages.findIndex((p) => p.pageKey === key);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(toIndex, doc.pages.length - 1));
  if (to === from) return doc;
  const pages = [...doc.pages];
  const [entry] = pages.splice(from, 1);
  pages.splice(to, 0, entry);
  return { ...doc, pages };
}

/** Size of a new blank page next to `neighbor`: as the neighbor looks (rotation and crop included), so the
 *  blank page shows in the same orientation; A4 without a neighbor. */
export function blankSizeLike(neighbor: PageEntry | undefined, info: DocInfo | null): { width: number; height: number } {
  if (!neighbor || !info) return { width: 595, height: 842 };
  const src = neighbor.src;
  let w: number, h: number, rot: number;
  if ("blank" in src) {
    ({ width: w, height: h } = src.blank);
    rot = neighbor.rotate;
  } else {
    const p = (src.doc === info.docId ? info.pages : info.imports?.[src.doc])?.[src.index];
    if (!p) return { width: 595, height: 842 };
    w = p.width; h = p.height; rot = p.rotation + neighbor.rotate;
  }
  if (neighbor.crop) { w = neighbor.crop.w; h = neighbor.crop.h; }
  return normRotation(rot) % 180 ? { width: h, height: w } : { width: w, height: h };
}

/** Inserts `entries` at position `index` (0 = before the first page). */
export function insertPages(doc: EditorDoc, index: number, entries: PageEntry[]): EditorDoc {
  const pages = [...doc.pages];
  pages.splice(Math.max(0, Math.min(index, pages.length)), 0, ...entries);
  return { ...doc, pages };
}

export function blankPage(size: { width: number; height: number }, pageKey = newId("u")): PageEntry {
  return { pageKey, src: { blank: { width: size.width, height: size.height } }, rotate: 0 };
}

/** The pages of an imported PDF, in order, with new keys; `doc.imports` records the document so a restored
 *  draft can tell its pages from the main document's. */
export function importPages(doc: EditorDoc, index: number, docId: string, count: number, makeKey = () => newId("u")): EditorDoc {
  const entries: PageEntry[] = Array.from({ length: count }, (_, i) => ({ pageKey: makeKey(), src: { doc: docId, index: i }, rotate: 0 }));
  const next = insertPages(doc, index, entries);
  const imports = doc.imports?.includes(docId) ? doc.imports : [...(doc.imports ?? []), docId];
  return { ...next, imports };
}

/** The unrotated size of a page (its source's CropBox, or the blank size). */
export function pageSize(entry: PageEntry, info: DocInfo): { width: number; height: number } | null {
  if ("blank" in entry.src) return entry.src.blank;
  const p = (entry.src.doc === info.docId ? info.pages : info.imports?.[entry.src.doc])?.[entry.src.index];
  return p ? { width: p.width, height: p.height } : null;
}

/** `crop` clamped to a page of `size`; null when what is left is smaller than MIN_CROP. */
export function clampCrop(crop: CropBox, size: { width: number; height: number }): CropBox | null {
  const x = Math.max(0, crop.x), y = Math.max(0, crop.y);
  const w = Math.min(crop.x + crop.w, size.width) - x, h = Math.min(crop.y + crop.h, size.height) - y;
  if (w < MIN_CROP || h < MIN_CROP) return null;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(x), y: r(y), w: Math.floor(w * 100) / 100, h: Math.floor(h * 100) / 100 };
}

/** Sets (or with null removes) the crop of the pages; a crop that does not fit a page is clamped to it, and
 *  pages it misses keep theirs. */
export function setCrop(doc: EditorDoc, keys: readonly string[], crop: CropBox | null, info: DocInfo): EditorDoc {
  const ks = keySet(keys);
  let changed = false;
  const pages = doc.pages.map((p) => {
    if (!ks.has(p.pageKey)) return p;
    if (crop === null) {
      if (!p.crop) return p;
      changed = true;
      const { crop: _drop, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    }
    const size = pageSize(p, info);
    const c = size ? clampCrop(crop, size) : null;
    if (!c) return p;
    changed = true;
    return { ...p, crop: c };
  });
  return changed ? { ...doc, pages } : doc;
}

/** Where pages inserted in the Manage Pages modal go: after the last selected page, else at the end. */
export function insertIndex(doc: EditorDoc, selected: ReadonlySet<string>): number {
  let last = -1;
  doc.pages.forEach((p, i) => { if (selected.has(p.pageKey)) last = i; });
  return last < 0 ? doc.pages.length : last + 1;
}

/** Click/keyboard selection in the Manage Pages modal: Shift extends from the anchor through `key`
 *  (a plain toggle when there is no anchor or it no longer exists), otherwise `key` is toggled. */
export function toggleSelection(doc: EditorDoc, selected: ReadonlySet<string>, anchor: string | null, key: string, shift: boolean): Set<string> {
  const next = new Set(selected);
  const a = anchor === null ? -1 : doc.pages.findIndex((p) => p.pageKey === anchor);
  const b = doc.pages.findIndex((p) => p.pageKey === key);
  if (shift && a >= 0 && b >= 0) {
    for (const p of doc.pages.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(p.pageKey);
  } else if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
