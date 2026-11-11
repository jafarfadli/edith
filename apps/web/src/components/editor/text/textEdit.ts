"use client";

import { createStore } from "zustand/vanilla";
import type { Editor } from "@tiptap/core";
import type { ContentOp, Run, TextBox, TextEdit, TextOcrEdit } from "@edith/ops";
import type { OcrParagraph, Paragraph, ParagraphLine } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import { markupOverLines } from "@/lib/markup";
import { noticeStore } from "@/lib/notices";
import { newId } from "@/lib/id";
import { ocrEditOp, type OcrCover } from "@/lib/ocr";
import { blankBox, DECOR_V, editedBox, isBlank, isBlankBox, keepFirstBaseline } from "@/lib/keepLines";
import { keptLines, keptPrefixes, paragraphBox, preloadFallback, prepareRuns, replacedLines, resolveLoadedRuns } from "@/lib/paragraphs";
import { attrsOf, type RunAttrs } from "@/lib/richtext";
import { normalizeRuns, paragraphsEqual, runsText } from "@/lib/runs";
import { t } from "@/lib/strings";
import { keepRotatedTopLeft, rotationOf } from "@/lib/objects";
import { boxFonts, boxLineHeight, newBox, relayout } from "@/lib/textbox";
import { editorStore, ocrEditFor, textEditFor, type EditorDoc } from "@/store/editor";
import { ocrParagraphsOf, paragraphsOf, textStore } from "@/store/text";

type Pt = [number, number];

/** An open rich-text session: a text box being added/edited, an original paragraph being rewritten, or a paragraph OCR
 *  read in a picture being rewritten (`ocr`: what its edit covers, M5d). */
export interface Editing {
  id: string; pageKey: string; box: TextBox; isNew: boolean;
  kind: "text.add" | "text.edit" | "text.ocr_edit";
  paragraphId?: string;
  ocr?: OcrCover;
  /** Paragraphs the session started with (a new text.edit that ends unchanged adds nothing). */
  initial?: Run[][];
}

interface TextEditState {
  editing: Editing | null;
  /** Style at the rich editor's selection, for the properties bar. */
  current: RunAttrs | null;
  /** Selected original paragraph (select tool; not an op yet). */
  paragraph: { pageKey: string; id: string } | null;
  start(e: Editing): void;
  update(box: TextBox): void;
  finish(): void;
  setCurrent(a: RunAttrs | null): void;
  selectParagraph(p: { pageKey: string; id: string } | null): void;
}

/** The live rich editor of the open session (a mutable Tiptap object, so not in the store) and its
 *  content as runs, kept current on every change (still readable after the editor unmounted). */
export const session: { editor: Editor | null; paragraphs: Run[][] | null } = { editor: null, paragraphs: null };

/** Loads the fallback-chain fonts of `paragraphs` (live warning in the properties bar), then nudges
 *  the bar to re-render. Ignored when the session's content moved on meanwhile. */
export function preloadSessionFonts(paragraphs: Run[][]): void {
  void preloadFallback(paragraphs, textStore.getState().fonts).then(() => {
    const { editing, current, setCurrent } = textEditStore.getState();
    if (editing && current && session.paragraphs === paragraphs) setCurrent({ ...current });
  });
}

export const textEditStore = createStore<TextEditState>()((set, get) => ({
  editing: null, current: null, paragraph: null,
  start: (editing) => {
    if (editing.kind === "text.edit" && !editing.paragraphId) throw new Error(`text.edit session ${editing.id} has no paragraphId`);
    if (editing.kind === "text.ocr_edit" && (!editing.paragraphId || !editing.ocr)) throw new Error(`text.ocr_edit session ${editing.id} has no paragraph or cover`);
    session.paragraphs = editing.box.paragraphs;
    preloadSessionFonts(editing.box.paragraphs);
    set({ editing, current: attrsOf(editing.box.paragraphs[0][0]), paragraph: null });
  },
  update: (box) => { const e = get().editing; if (e) set({ editing: { ...e, box } }); },
  finish: () => set({ editing: null, current: null }),
  setCurrent: (current) => set({ current }),
  selectParagraph: (paragraph) => set({ paragraph }),
}));

/** True when every font of `box` is loaded (metrics available synchronously). */
export function fontsReady(box: TextBox): boolean {
  return boxFonts(box).every((f) => fontStore.peek(f) !== null);
}

/** The original paragraph text.edit `paragraphId` on `pageKey` rewrites (undefined before the text loaded). */
export function originalParagraph(doc: EditorDoc, pageKey: string, paragraphId: string): Paragraph | undefined {
  const entry = doc.pages.find((p) => p.pageKey === pageKey);
  return entry ? paragraphsOf(entry.src, textStore.getState().pages).find((x) => x.id === paragraphId) : undefined;
}

/** Ids of the highlight/underline/strike ops on the original lines the paragraphs `edits` rewrite: the bake removes
 *  those glyphs, so the marks would float over the new text (owner decision: delete them). Marks on lines an edit
 *  keeps (LayoutLine.source) stay with them. */
export function markupUnderEdits(doc: EditorDoc, edits: TextEdit[]): string[] {
  const ops = doc.order.map((id) => doc.objects[id]).filter((op): op is ContentOp => !!op);
  const out = new Set<string>();
  for (const e of edits) {
    const p = originalParagraph(doc, e.pageKey, e.paragraphId);
    if (p) for (const id of markupOverLines(ops, e.pageKey, replacedLines(p, e.box))) out.add(id);
  }
  return [...out];
}

/** Ids of the marks on original lines that text.edit `cur` keeps (LayoutLine.source) and `next` no longer does: once
 *  moved, resized or restyled, those lines are redrawn and their glyphs removed, so the marks would float. */
export function marksLostBy(doc: EditorDoc, cur: ContentOp, next: ContentOp): string[] {
  if (cur.type !== "text.edit" || next.type !== "text.edit") return [];
  const p = originalParagraph(doc, cur.pageKey, cur.paragraphId);
  if (!p) return [];
  // How far each original line's glyphs stay: all of it (LayoutLine.source), up to a kept prefix's end
  // (LayoutLine.prefix, M5d) or nothing; what `next` keeps less of than `cur` is lost.
  const extent = (box: TextBox) => {
    const whole = keptLines(box), cuts = keptPrefixes(p, box);
    return (l: ParagraphLine, i: number) => (whole.has(i) ? l.rect.x + l.rect.w : cuts.get(i) ?? l.rect.x);
  };
  const before = extent(cur.box), after = extent(next.box);
  const lost = p.lines.flatMap((l, i) => {
    const from = after(l, i), to = before(l, i);
    return to > from ? [{ ...l, rect: { ...l.rect, x: from, w: to - from } }] : [];
  });
  if (!lost.length) return [];
  const ops = doc.order.map((id) => doc.objects[id]).filter((op): op is ContentOp => !!op);
  return markupOverLines(ops, cur.pageKey, lost);
}

/** Every change of an existing object outside a text session (drag, nudge, transform, restyle) goes through here: a
 *  text.edit that stops keeping original lines takes the marks on them along, in the same undo step, with a notice. */
export function updateTextOp(id: string, patch: Partial<ContentOp>, opts?: { coalesce?: string }): void {
  const st = editorStore.getState();
  const cur = st.doc.objects[id];
  if (!cur) return;
  const removed = marksLostBy(st.doc, cur, { ...cur, ...patch } as ContentOp);
  st.updateObject(id, patch, { ...opts, remove: removed });
  noteMarkupRemoved(removed);
}

/** Tells the user their marks on edited text went (after markupUnderEdits() removed some). */
export function noteMarkupRemoved(removed: string[]): void {
  if (removed.length) noticeStore.getState().show({ kind: "info", text: t.text.markupRemoved });
}

/** The commit that is waiting for its fonts (the text is not in the document yet). */
let pendingCommit: Promise<void> | null = null;

/** Paragraph edits waiting for their fonts before the session opens. */
let startingEdits = 0;

/** True while a rich-text session is open, starting (fonts loading) or landing: one-letter tool keys stay off then. */
export function textSessionBusy(): boolean {
  return !!textEditStore.getState().editing || !!pendingCommit || startingEdits > 0;
}

/** Resolves once no text commit is in flight; immediately when none is. */
export async function whenTextCommitted(): Promise<void> {
  while (pendingCommit) await pendingCommit;
}

/** Run `action` now, or right after the in-flight text commit lands (so undo/redo see the new box). */
export function afterTextCommitted(action: () => void): void {
  if (pendingCommit) void whenTextCommitted().then(action);
  else action();
}

/** Start a new text box at `at` (text tool); ignored while a session is open or a commit is landing. */
export function startTextAt(pageKey: string, at: Pt): void {
  const st = editorStore.getState();
  if (textEditStore.getState().editing || pendingCommit || st.tool !== "text") return;
  const s = st.style;
  const box = newBox(at, { family: s.fontFamily, bold: s.bold, italic: s.italic, size: s.fontSize, color: s.color, align: s.align });
  textEditStore.getState().start({ id: newId(), pageKey, box, isNew: true, kind: "text.add" });
}

/** The box that redraws original paragraph `p` with fonts that can draw it (loads them). */
export async function paragraphStartBox(p: Paragraph): Promise<TextBox> {
  const [runs] = await prepareRuns([p.runs], textStore.getState().fonts);
  return paragraphBox({ ...p, runs }, (f) => fontStore.get(f));
}

/** Opens original paragraph `p` for typing (its text.edit op, when it has one). */
export async function startParagraphEdit(pageKey: string, p: Paragraph): Promise<void> {
  if (textEditStore.getState().editing || pendingCommit) return;
  editorStore.getState().select(null);
  textEditStore.getState().selectParagraph(null);
  const existing = textEditFor(editorStore.getState().doc, pageKey, p.id);
  if (existing) {
    textEditStore.getState().start({ id: existing.id, pageKey, box: existing.box, isNew: false, kind: "text.edit", paragraphId: p.id });
    return;
  }
  let box: TextBox;
  startingEdits++;
  try {
    box = await paragraphStartBox(p);
  } catch (err) {
    console.warn("paragraph edit: font load failed", err);
    return;
  } finally {
    startingEdits--;
  }
  // Something else started (or landed an op for this paragraph) while the fonts loaded.
  if (textEditStore.getState().editing || pendingCommit || textEditFor(editorStore.getState().doc, pageKey, p.id)) return;
  textEditStore.getState().start({ id: newId(), pageKey, box, isNew: true, kind: "text.edit", paragraphId: p.id, initial: box.paragraphs });
}

/** Opens paragraph `p` that OCR read on `pageKey` for typing (its text.ocr_edit op, when it has one). Its text starts
 *  in place, in the font, size and colour OCR guessed; committing paints its cover and draws the new text (M5d). */
export async function startOcrEdit(pageKey: string, p: OcrParagraph): Promise<void> {
  if (textEditStore.getState().editing || pendingCommit) return;
  editorStore.getState().select(null);
  textEditStore.getState().selectParagraph(null);
  const ocr: OcrCover = { cover: p.cover, covers: p.covers, coverColor: p.coverColor };
  const existing = ocrEditFor(editorStore.getState().doc, pageKey, p.id);
  if (existing) {
    textEditStore.getState().start({ id: existing.id, pageKey, box: existing.box, isNew: false, kind: "text.ocr_edit", paragraphId: p.id, ocr: { cover: existing.cover, covers: existing.covers, coverColor: existing.coverColor } });
    return;
  }
  let box: TextBox;
  startingEdits++;
  try {
    box = await paragraphStartBox(p);
  } catch (err) {
    console.warn("OCR paragraph edit: font load failed", err);
    return;
  } finally {
    startingEdits--;
  }
  if (textEditStore.getState().editing || pendingCommit || ocrEditFor(editorStore.getState().doc, pageKey, p.id)) return;
  textEditStore.getState().start({ id: newId(), pageKey, box, isNew: true, kind: "text.ocr_edit", paragraphId: p.id, initial: box.paragraphs, ocr });
  // A photo or a gradient behind the text: one flat colour covers it, and may show.
  if (!p.coverUniform) noticeStore.getState().show({ kind: "info", text: t.ocr.uneven });
}

/** Turns original paragraph `p` into a text.edit op changed by `change` (moved, resized), selected. */
export function materializeParagraph(pageKey: string, p: Paragraph, change: (box: TextBox) => TextBox): Promise<void> {
  return putParagraphEdit(pageKey, p, (box) => relayout(change(box), (f) => fontStore.get(f)));
}

/** Deletes the text of original paragraph `p` (Delete on the selected paragraph, "Hapus teks"): a text.edit op with a
 *  blank box (blankBox), landing like any edit (one undo step, the marks on its lines go), selected: "Kembalikan teks
 *  asli" or Undo bring the text back. */
export function deleteParagraphText(pageKey: string, p: Paragraph): Promise<void> {
  return putParagraphEdit(pageKey, p, (box) => blankBox(box, p.rect));
}

/** Lands the text.edit op of original paragraph `p` whose box `make` builds from the box that redraws it, selected. */
async function putParagraphEdit(pageKey: string, p: Paragraph, make: (box: TextBox) => TextBox): Promise<void> {
  let box: TextBox;
  try {
    box = await paragraphStartBox(p);
  } catch (err) {
    console.warn("paragraph edit: font load failed", err);
    return;
  }
  const st = editorStore.getState();
  if (textEditFor(st.doc, pageKey, p.id) || !st.doc.pages.some((pg) => pg.pageKey === pageKey)) return;
  const id = newId();
  const op = { id, type: "text.edit", decorV: DECOR_V, pageKey, paragraphId: p.id, box: make(box) } as TextEdit;
  // The edit removes the paragraph's original glyphs: their marks go in the same undo step.
  const removed = markupUnderEdits(st.doc, [op]);
  st.putObjects([op], removed);
  noteMarkupRemoved(removed);
  textEditStore.getState().selectParagraph(null);
  if (!textEditStore.getState().editing) st.select(id);
}

/** Deletes the text of paragraph `p` OCR read on `pageKey`: a text.ocr_edit op that paints its covers and draws
 *  nothing, selected. */
export async function deleteOcrText(pageKey: string, p: OcrParagraph): Promise<void> {
  let box: TextBox;
  try {
    box = await paragraphStartBox(p);
  } catch (err) {
    console.warn("OCR paragraph delete: font load failed", err);
    return;
  }
  const st = editorStore.getState();
  if (ocrEditFor(st.doc, pageKey, p.id) || !st.doc.pages.some((pg) => pg.pageKey === pageKey)) return;
  const op = ocrEditOp(newId(), pageKey, p, blankBox(box, p.cover));
  st.putObjects([op]);
  textEditStore.getState().selectParagraph(null);
  if (!textEditStore.getState().editing) st.select(op.id);
  // A photo or a gradient behind the text: one flat colour covers it, and may show.
  if (!p.coverUniform) noticeStore.getState().show({ kind: "info", text: t.ocr.uneven });
}

/** The paragraph (original, or one OCR read) selected with the select tool, if it can still be edited. */
export function selectedParagraph(): { pageKey: string; original?: Paragraph; ocr?: OcrParagraph } | null {
  const sel = textEditStore.getState().paragraph;
  const st = editorStore.getState();
  const entry = sel && st.tool === "select" ? st.doc.pages.find((pg) => pg.pageKey === sel.pageKey) : undefined;
  if (!sel || !entry) return null;
  const ocr = ocrParagraphsOf(entry.src).find((x) => x.id === sel.id);
  if (ocr) return ocrEditFor(st.doc, sel.pageKey, ocr.id) ? null : { pageKey: sel.pageKey, ocr };
  const original = paragraphsOf(entry.src).find((x) => x.id === sel.id);
  return original?.editable && !textEditFor(st.doc, sel.pageKey, original.id) ? { pageKey: sel.pageKey, original } : null;
}

/** Deletes the text of the selected paragraph (Delete, Backspace): false when none is selected. */
export function deleteSelectedParagraph(): boolean {
  const sel = selectedParagraph();
  if (!sel || textSessionBusy()) return false;
  if (sel.ocr) void deleteOcrText(sel.pageKey, sel.ocr);
  else if (sel.original) void deleteParagraphText(sel.pageKey, sel.original);
  return true;
}

/** Opens the selected paragraph for typing ("Edit teks"). */
export function editSelectedParagraph(): void {
  const sel = selectedParagraph();
  if (sel?.ocr) void startOcrEdit(sel.pageKey, sel.ocr);
  else if (sel?.original) void startParagraphEdit(sel.pageKey, sel.original);
}

/** True when `op` edits original or OCR text (deleting the op brings that text back). */
export function isTextEdit(op: ContentOp | undefined): op is TextEdit | TextOcrEdit {
  return op?.type === "text.edit" || op?.type === "text.ocr_edit";
}

/** True when `op` is an edit of original or OCR text that deleted it. */
export function isDeletedText(op: ContentOp | undefined): boolean {
  return isTextEdit(op) && isBlankBox(op.box);
}

/** Delete on object `id` (the key, "Hapus" in its menus): an edit of original or OCR text keeps its op and loses its
 *  text (blankBox), as deleting the paragraph would; once deleted nothing more happens (Undo or "Kembalikan teks asli"
 *  bring the text back). Any other object goes. */
export function deleteObjectOrText(id: string): void {
  const st = editorStore.getState();
  const op = st.doc.objects[id];
  if (!isTextEdit(op)) { st.deleteObject(id); return; }
  if (isBlankBox(op.box)) return;
  const area = op.type === "text.ocr_edit" ? op.cover : originalParagraph(st.doc, op.pageKey, op.paragraphId)?.rect ?? op.box.rect;
  updateTextOp(id, { box: blankBox(op.box, area) });
}

/** Commits the open session with the rich editor's current content. */
export function commitOpenSession(): Promise<void> {
  const e = textEditStore.getState().editing;
  if (!e) return Promise.resolve();
  return commitEditing(session.paragraphs ?? e.box.paragraphs);
}

export function commitEditing(paragraphs: Run[][]): Promise<void> {
  const e = textEditStore.getState().editing;
  if (!e) return Promise.resolve();
  textEditStore.getState().finish();
  const s = editorStore.getState();
  const blank = paragraphs.every((p) => !runsText(p).trim());
  if (blank && e.kind === "text.add") {
    if (!e.isNew) s.deleteObject(e.id);
    return Promise.resolve();
  }
  const normalized = paragraphs.map(normalizeRuns);
  // A text box's line spacing follows its sizes; an original paragraph keeps its own.
  const draft: TextBox = { ...e.box, paragraphs: normalized, ...(e.kind === "text.add" ? { lineHeight: boxLineHeight(normalized) } : {}) };
  if (e.isNew && e.initial && paragraphsEqual(draft.paragraphs, e.initial)) return Promise.resolve(); // opened, not changed
  const fonts = textStore.getState().fonts;
  // An original paragraph keeps the lines the edit left alone (lib/keepLines.ts): it needs the original's runs as
  // paragraphBox laid them out (same font fallback).
  const original = e.kind === "text.edit" ? originalParagraph(s.doc, e.pageKey, e.paragraphId as string) : undefined;
  // Fast path: every font (after the whole fallback chain) already loaded → land synchronously.
  const ready = resolveLoadedRuns(draft.paragraphs, fonts, (f) => fontStore.peek(f));
  const readyOriginal = original ? resolveLoadedRuns([original.runs], fonts, (f) => fontStore.peek(f)) : null;
  if (ready && (!original || readyOriginal)) {
    land(e, committedBox(e, draft, ready, original && readyOriginal ? { ...original, runs: readyOriginal[0] } : undefined));
    return Promise.resolve();
  }
  const p: Promise<void> = (async () => {
    let runs: Run[][];
    try {
      runs = await prepareRuns(draft.paragraphs, fonts);
    } catch (err) {
      console.warn("text commit: font load failed", err);
      textEditStore.getState().start({ ...e, box: draft }); // keep the text editable instead of losing it
      return;
    }
    // Without the original's fonts the edit still lands, redrawing every line.
    const originalRuns = original ? await prepareRuns([original.runs], fonts).catch(() => null) : null;
    land(e, committedBox(e, draft, runs, original && originalRuns ? { ...original, runs: originalRuns[0] } : undefined));
  })().finally(() => { if (pendingCommit === p) pendingCommit = null; });
  pendingCommit = p;
  return p;
}

/** The box a session lands: a text box re-laid out; an original paragraph (`original`: its runs prepared) also
 *  keeps its first baseline where the session's box had it and the lines the edit left alone (editedBox). */
function committedBox(e: Editing, draft: TextBox, runs: Run[][], original: Paragraph | undefined): TextBox {
  const metrics = (f: Parameters<typeof fontStore.get>[0]) => fontStore.get(f);
  if (e.kind === "text.add") return relayout({ ...draft, paragraphs: runs }, metrics);
  // Every character removed: the text is deleted (not the edit dropped, which would bring it back).
  if (isBlank(runs)) return blankBox(e.box, original?.rect ?? e.ocr?.cover ?? e.box.rect);
  if (original) return editedBox(e.box, runs, original, metrics);
  return keepFirstBaseline(e.box, relayout({ ...draft, paragraphs: runs }, metrics));
}

function land(e: Editing, box: TextBox): void {
  const st = editorStore.getState();
  const op = (e.kind === "text.edit"
    ? { id: e.id, type: "text.edit", decorV: DECOR_V, pageKey: e.pageKey, paragraphId: e.paragraphId as string, box } // checked in start()
    : e.kind === "text.ocr_edit"
      ? ocrEditOp(e.id, e.pageKey, { id: e.paragraphId as string, ...e.ocr! }, box)
      : { id: e.id, type: "text.add", pageKey: e.pageKey, box }) as ContentOp;
  // A rewritten paragraph loses the marks on its original lines, in the same undo step as the edit.
  const removed = op.type === "text.edit" ? markupUnderEdits(st.doc, [op as TextEdit]) : [];
  if (e.isNew) {
    st.putObjects([op], removed);
    noteMarkupRemoved(removed);
  } else {
    const cur = st.doc.objects[e.id];
    if (!cur) return; // deleted meanwhile (e.g. undo)
    // A turned box grew while edited: keep its rotated top-left corner where the editor showed it.
    const prev = (cur as { box: TextBox }).box.rect;
    box = { ...box, rect: keepRotatedTopLeft(prev, box.rect, rotationOf(cur)) };
    if (JSON.stringify((cur as { box: TextBox }).box) !== JSON.stringify(box)) {
      st.putObjects([{ ...cur, box } as ContentOp], removed);
      noteMarkupRemoved(removed);
    }
  }
  // Another session started while the fonts loaded: leave tool/selection to it.
  if (textEditStore.getState().editing) return;
  // Selection is null while editing; if the click that ended editing selected another object, keep that one.
  const clickedOther = st.selection !== null && st.selection !== e.id;
  st.setTool("select");
  if (!clickedOther) st.select(e.id);
}
