"use client";

import { createStore } from "zustand/vanilla";
import type { Editor } from "@tiptap/core";
import type { ContentOp, Rect, Run, TextBox, TextEdit } from "@edith/ops";
import type { OcrParagraph, Paragraph } from "@/lib/api";
import { fontStore } from "@/lib/fonts";
import { markupOverLines } from "@/lib/markup";
import { noticeStore } from "@/lib/notices";
import { newId } from "@/lib/id";
import { ocrEditOp } from "@/lib/ocr";
import { editedBox, keepFirstBaseline } from "@/lib/keepLines";
import { keptLines, paragraphBox, preloadFallback, prepareRuns, replacedLines, resolveLoadedRuns } from "@/lib/paragraphs";
import { attrsOf, type RunAttrs } from "@/lib/richtext";
import { normalizeRuns, paragraphsEqual, runsText } from "@/lib/runs";
import { t } from "@/lib/strings";
import { keepRotatedTopLeft, rotationOf } from "@/lib/objects";
import { boxFonts, boxLineHeight, newBox, relayout } from "@/lib/textbox";
import { editorStore, ocrEditFor, textEditFor, type EditorDoc } from "@/store/editor";
import { paragraphsOf, textStore } from "@/store/text";

type Pt = [number, number];

/** An open rich-text session: a text box being added/edited, an original paragraph being rewritten, or a paragraph OCR
 *  read in a picture being rewritten (`ocr`: what its edit covers, M5d). */
export interface Editing {
  id: string; pageKey: string; box: TextBox; isNew: boolean;
  kind: "text.add" | "text.edit" | "text.ocr_edit";
  paragraphId?: string;
  ocr?: { cover: Rect; coverColor: string };
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
  const before = keptLines(cur.box), after = keptLines(next.box);
  const p = originalParagraph(doc, cur.pageKey, cur.paragraphId);
  const lost = p?.lines.filter((_, i) => before.has(i) && !after.has(i)) ?? [];
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
  const ocr = { cover: p.cover, coverColor: p.coverColor };
  const existing = ocrEditFor(editorStore.getState().doc, pageKey, p.id);
  if (existing) {
    textEditStore.getState().start({ id: existing.id, pageKey, box: existing.box, isNew: false, kind: "text.ocr_edit", paragraphId: p.id, ocr: { cover: existing.cover, coverColor: existing.coverColor } });
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
export async function materializeParagraph(pageKey: string, p: Paragraph, change: (box: TextBox) => TextBox): Promise<void> {
  let box: TextBox;
  try {
    box = await paragraphStartBox(p);
  } catch (err) {
    console.warn("paragraph move: font load failed", err);
    return;
  }
  const st = editorStore.getState();
  if (textEditFor(st.doc, pageKey, p.id) || !st.doc.pages.some((pg) => pg.pageKey === pageKey)) return;
  const id = newId();
  const op = { id, type: "text.edit", pageKey, paragraphId: p.id, box: relayout(change(box), (f) => fontStore.get(f)) } as TextEdit;
  // Moving the paragraph also removes its original glyphs: their marks go in the same undo step.
  const removed = markupUnderEdits(st.doc, [op]);
  st.putObjects([op], removed);
  noteMarkupRemoved(removed);
  textEditStore.getState().selectParagraph(null);
  if (!textEditStore.getState().editing) st.select(id);
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
  if (original) return editedBox(e.box, runs, original, metrics);
  return keepFirstBaseline(e.box, relayout({ ...draft, paragraphs: runs }, metrics));
}

function land(e: Editing, box: TextBox): void {
  const st = editorStore.getState();
  const op = (e.kind === "text.edit"
    ? { id: e.id, type: "text.edit", pageKey: e.pageKey, paragraphId: e.paragraphId as string, box } // checked in start()
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
