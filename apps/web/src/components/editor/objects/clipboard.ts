import type { BundledFont, ContentOp, FontRef, Rect, TextBox } from "@edith/ops";
import { assetUrl, uploadAsset } from "@/lib/api";
import { alignMoves, distributeMoves } from "@/lib/arrange";
import { pageBounds, screenSize, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { fontId, fontStore, isOriginal } from "@/lib/fonts";
import { newId } from "@/lib/id";
import { getAsset, putAsset } from "@/lib/library";
import { relayout } from "@/lib/textbox";
import { textStore } from "@/store/text";
import { copyOp, isCopyable, isMarkup, moveOp, visualBounds, type Align } from "@/lib/objects";
import { boundsUnion } from "@/lib/snap";
import { editorStore, pageGeom } from "@/store/editor";
import { deleteSelectedParagraph, paragraphStartBox, selectedParagraph } from "../text/textEdit";
import { deleteObjects, moveEach, selectedOps } from "./group";

/** The editor's own clipboard (objects, not the system clipboard): Salin/Tempel/Duplikat of the mini-bar and
 *  Ctrl/Cmd+C, X, V, D. It holds a group as it lies: pasting keeps how its objects sit to each other.
 *
 *  It is shared by every document of this browser, so objects move from one PDF to another (two tabs, or one after
 *  the other): what is copied is also kept in localStorage, and the pictures it needs (images, signatures, an area
 *  taken from a page) in IndexedDB under CLIP_ID. A paste into another document uploads those pictures to it again
 *  and swaps fonts embedded in the first PDF for their stand-ins, since an op may only name the assets and fonts of
 *  its own document. */
export const PASTE_OFFSET = 10; // pt: a paste or duplicate on the same page lands this far down-right
const KEY = "edith:clipboard";
/** The IndexedDB "edit" the clipboard's pictures are kept under. */
export const CLIP_ID = "clipboard";

interface Clip {
  ops: ContentOp[];
  pastes: number;
  /** When it was copied (the newest clipboard of all tabs wins). */
  stamp: number;
  /** The edit and server document it was copied from. */
  from?: { editId: string; docId: string };
  /** Assets of `ops` not on `from`'s server document (an area taken from a page): only in IndexedDB. */
  local?: string[];
  /** The stand-in of each embedded font the ops use (by fontId), for a paste into another document. */
  fonts?: Record<string, BundledFont>;
}

let clip: Clip | null = null;

function stored(): Clip | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Clip) : null;
  } catch { return null; }
}

/** The newest clipboard: this tab's, or one copied since in another tab. */
function current(): Clip | null {
  const other = stored();
  if (other && (!clip || other.stamp > clip.stamp)) clip = { ...other, pastes: 0 };
  return clip;
}

export function hasClipboard(): boolean {
  return current() !== null;
}

const ASSET_TYPES = new Set(["image.add", "signature.add"]);
const assetOf = (op: ContentOp): string | null => (ASSET_TYPES.has(op.type) ? (op as { assetId: string }).assetId : null);

function fontsOf(ops: ContentOp[]): FontRef[] {
  return ops.flatMap((op) => ((op as { box?: TextBox }).box?.paragraphs.flat().map((r) => r.font) ?? []));
}

/** Puts `ops` on the clipboard (copied from this document); `local`: pictures of theirs only in IndexedDB. Keeps a copy of
 *  each picture with the clipboard, for a paste into another document. */
export function setClipboard(ops: ContentOp[], local: string[] = []): void {
  const s = editorStore.getState();
  const table = textStore.getState().fonts;
  const fonts: Record<string, BundledFont> = {};
  for (const f of fontsOf(ops)) if (isOriginal(f) && table[fontId(f)]) fonts[fontId(f)] = table[fontId(f)].substitute;
  clip = {
    ops: structuredClone(ops), pastes: 0, stamp: Date.now(), local,
    from: s.info ? { editId: s.info.editId, docId: s.info.docId } : undefined, fonts,
  };
  try { localStorage.setItem(KEY, JSON.stringify(clip)); } catch { /* storage full or blocked: this tab only */ }
  const from = clip.from;
  if (!from) return;
  for (const id of new Set(ops.map(assetOf).filter((a): a is string => !!a && !local.includes(a)))) {
    void (async () => {
      const blob = (await getAsset(from.editId, id).catch(() => undefined)) ?? (await fetch(assetUrl(from.docId, id)).then((r) => (r.ok ? r.blob() : undefined)).catch(() => undefined));
      if (blob) await putAsset(CLIP_ID, id, blob).catch(() => undefined);
    })();
  }
}

/** The selected objects that can be copied (not edits of original text, not text markup). */
function selected(): ContentOp[] {
  return selectedOps().filter(isCopyable);
}

function geomOf(pageKey: string): PageGeom | null {
  const s = editorStore.getState();
  const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
  return entry && s.info ? pageGeom(entry, s.info) : null;
}

/** `ops` moved together (as little as possible) so that the group lies inside the visible part of its page. */
function keepOnPage(ops: ContentOp[], g: PageGeom): ContentOp[] {
  const b = boundsUnion(ops.map(visualBounds)), p = pageBounds(g);
  if (!b) return ops;
  const dx = Math.min(Math.max(b.x, p.x), Math.max(p.x + p.w - b.w, p.x)) - b.x;
  const dy = Math.min(Math.max(b.y, p.y), Math.max(p.y + p.h - b.h, p.y)) - b.y;
  return dx || dy ? ops.map((op) => moveOp(op, dx, dy)) : ops;
}

/** Adds `ops` as one step, with the select tool, and selects them; returns the primary's id. */
function place(ops: ContentOp[]): string {
  const s = editorStore.getState();
  s.putObjects(ops);
  s.setTool("select");
  s.selectMany(ops.map((o) => o.id));
  return ops[ops.length - 1].id;
}

export function copySelection(): boolean {
  const ops = selected();
  if (!ops.length) return copyParagraph();
  setClipboard(ops);
  return true;
}

/** Copies the selected paragraph of the page's own text (or one OCR read) as a new text box in its fonts: pasted, it is
 *  text of its own, here or in another document. False when none is selected. */
function copyParagraph(): boolean {
  const sel = selectedParagraph();
  const p = sel?.ocr ?? sel?.original;
  if (!sel || !p) return false;
  const done = paragraphStartBox(p).then((box) => {
    const plain = relayout(box, (f) => fontStore.get(f)); // its own lines, none tied to the original's
    setClipboard([{ id: newId(), type: "text.add", pageKey: sel.pageKey, box: plain } as ContentOp]);
  }).catch((err) => console.warn("copy paragraph: font load failed", err));
  pending = done.finally(() => { if (pending === done) pending = null; });
  return true;
}

/** Cut: copies the selected objects and deletes them (one undo step). False when nothing could be copied. */
export function cutSelection(): boolean {
  if (!selected().length) return copyParagraph() && deleteSelectedParagraph();
  if (!copySelection()) return false;
  deleteObjects(selected().map((o) => o.id));
  return true;
}

/** Pastes the clipboard on the page in view: where it was on another page, a little further each time on the
 *  same page. Returns the id of the last new object (the primary of the new selection). */
export function pasteClipboard(): string | null {
  const s = editorStore.getState();
  const pageKey = s.currentPage ?? s.doc.pages[0]?.pageKey;
  const g = pageKey ? geomOf(pageKey) : null;
  const c = current();
  if (!c || !pageKey || !g) return null;
  const here = !c.from || !s.info || c.from.editId === s.info.editId;
  const fromPage = c.ops[0].pageKey;
  const same = here && fromPage === pageKey && s.doc.pages.some((p) => p.pageKey === fromPage);
  const shift = same ? PASTE_OFFSET * ++c.pastes : 0;
  const ops = c.ops.map((op) => copyOp(op, pageKey, newId(), shift, shift));
  if (here && !c.local?.length) return place(keepOnPage(ops, g));
  // From another document, or with pictures only kept here: they go to this document's server first.
  const done = adopt(ops, c, here).then((moved) => {
    const now = geomOf(pageKey);
    if (moved && now) place(keepOnPage(moved, now));
  });
  pending = done.finally(() => { if (pending === done) pending = null; });
  return ops[ops.length - 1].id;
}

/** The paste landing after its pictures are uploaded (tests and e2e wait for it). */
export let pending: Promise<void> | null = null;

/** `ops` made this document's: their pictures uploaded to its server document (under new asset ids) and, from another
 *  document, embedded fonts swapped for their stand-ins and the text laid out again. Null when a picture is gone. */
async function adopt(ops: ContentOp[], c: Clip, here: boolean): Promise<ContentOp[] | null> {
  const info = editorStore.getState().info;
  if (!info) return null;
  const upload = new Set(ops.map(assetOf).filter((a): a is string => !!a && (!here || !!c.local?.includes(a))));
  const ids: Record<string, string> = {};
  for (const id of upload) {
    const blob = (await getAsset(CLIP_ID, id).catch(() => undefined))
      ?? (c.from ? await fetch(assetUrl(c.from.docId, id)).then((r) => (r.ok ? r.blob() : undefined)).catch(() => undefined) : undefined);
    if (!blob) return null;
    const asset = await uploadAsset(info.docId, blob);
    void putAsset(info.editId, asset.asset_id, blob).catch(() => undefined);
    ids[id] = asset.asset_id;
  }
  const out: ContentOp[] = [];
  for (const op of ops) {
    const a = assetOf(op);
    let next = a && ids[a] ? ({ ...op, assetId: ids[a] } as ContentOp) : op;
    const box = (next as { box?: TextBox }).box;
    if (!here && box) next = { ...next, box: await standIn(box, c.fonts ?? {}) } as ContentOp;
    out.push(next);
  }
  // A text.edit / text.ocr_edit belongs to an original paragraph of its document: elsewhere it is new text.
  return out.map((op) => (!here && (op.type === "text.edit" || op.type === "text.ocr_edit") ? toTextAdd(op) : op));
}

function toTextAdd(op: ContentOp): ContentOp {
  const { id, pageKey, box } = op as { id: string; pageKey: string; box: TextBox };
  return { id, type: "text.add", pageKey, box } as ContentOp;
}

/** `box` with every embedded font of another PDF replaced by its stand-in, laid out again with it. */
async function standIn(box: TextBox, fonts: Record<string, BundledFont>): Promise<TextBox> {
  const swap = (f: FontRef): FontRef => (isOriginal(f) ? fonts[fontId(f)] ?? { kind: "bundled", family: "Arimo" } : f);
  const paragraphs = box.paragraphs.map((p) => p.map((r) => ({ ...r, font: swap(r.font) })));
  await Promise.all(paragraphs.flat().map((r) => fontStore.load(r.font)));
  return relayout({ ...box, paragraphs }, (f) => fontStore.get(f));
}

/** Copies of the selected objects next to them on their page (the clipboard is left alone). */
export function duplicateSelection(): string | null {
  const ops = selected();
  const g = ops.length ? geomOf(ops[0].pageKey) : null;
  if (!g) return null;
  return place(keepOnPage(ops.map((op) => copyOp(op, op.pageKey, newId(), PASTE_OFFSET, PASTE_OFFSET)), g));
}

/** The selected objects that move (everything but text markup), with the page they lie on. */
function movable(): { ops: ContentOp[]; g: PageGeom } | null {
  const ops = selectedOps().filter((op) => !isMarkup(op));
  const g = ops.length ? geomOf(ops[0].pageKey) : null;
  return g ? { ops, g } : null;
}

/** What `op` covers as seen on screen (rotation and crop included), at scale 1. */
function screenRect(op: ContentOp, g: PageGeom): Rect {
  const b = visualBounds(op);
  const corners = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => toScreen(p, g, 1));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Screen deltas to page deltas. */
function pageDelta(g: PageGeom, dx: number, dy: number): [number, number] {
  const [x0, y0] = toPage([0, 0], g, 1), [x1, y1] = toPage([dx, dy], g, 1);
  return [x1 - x0, y1 - y0];
}

/** Lines the selection up with a side (or the middle) of the screen as seen: one object with its page, several with
 *  their common bounding box (Figma), as one undo step. Rotation and crop count. */
export function alignSelection(a: Align): void {
  const at = movable();
  if (!at) return;
  const rects = Object.fromEntries(at.ops.map((op) => [op.id, screenRect(op, at.g)]));
  const size = screenSize(at.g, 1);
  const ref = at.ops.length === 1 ? { x: 0, y: 0, w: size.width, h: size.height } : boundsUnion(Object.values(rects))!;
  const moves = alignMoves(rects, a, ref);
  moveEach(Object.fromEntries(Object.entries(moves).map(([id, [dx, dy]]) => [id, pageDelta(at.g, dx, dy)])));
}

/** Evens out the gaps between three or more selected objects (`axis`: along the screen's x or y), the outer two
 *  staying; one undo step. */
export function distributeSelection(axis: "x" | "y"): void {
  const at = movable();
  if (!at || at.ops.length < 3) return;
  const along = distributeMoves(at.ops.map((op) => ({ id: op.id, rect: screenRect(op, at.g) })), axis);
  moveEach(Object.fromEntries(Object.entries(along).map(([id, d]) => [id, pageDelta(at.g, axis === "x" ? d : 0, axis === "y" ? d : 0)])));
}

/** Test hook: forget the clipboard. */
export function clearClipboard(): void {
  clip = null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
