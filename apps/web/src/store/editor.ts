import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { ContentOp, TextEdit, TextOcrEdit } from "@edith/ops";
import type { FormField } from "@/lib/api";
import { normRotation, type CropBox, type PageGeom, type Rotation } from "@/lib/coords";
import type { Dash } from "@/lib/geometry";
import * as P from "@/lib/pages";
import { reorder, type ZMove } from "@/lib/zorder";

export interface StructurePage { index: number; width: number; height: number; rotation: number; hasText: boolean }
/** `imports`/`importFields`: page sizes and form fields of the other PDFs imported into this one, by doc id
 *  (not undoable: a registry). Imported fields keep the names of their own PDF. */
export interface DocInfo {
  docId: string; sha256: string; fileName: string; pages: StructurePage[]; fields?: FormField[];
  imports?: Record<string, StructurePage[]>; importFields?: Record<string, FormField[]>;
}
export type PageSrc = { doc: string; index: number } | { blank: { width: number; height: number } };
/** `crop`: the visible part of the page (page coordinates), applied last at export. */
export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation; crop?: CropBox | null }
export type FormValue = string | boolean;
/** `forms`: AcroForm values the user set, by field name (sent as form.set ops); absent in M1/M2 drafts.
 *  `imports`: doc ids of imported PDFs whose pages the document has (had); absent before M4.
 *  `importForms`: values of imported PDFs' fields, by doc id then field name (form.set with `doc`).
 *  `paragraphsVersion`: only in stored drafts — the segmentation their text.edit paragraph ids come from (absent = 1). */
export interface EditorDoc {
  pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue>;
  imports?: string[]; importForms?: Record<string, Record<string, FormValue>>; paragraphsVersion?: number;
}
export type MarkupTool = "highlight" | "underline" | "strike";
export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan"
  | MarkupTool | "check" | "cross" | "note" | "link" | "polygon" | "polyline" | "cloud";
export interface ToolStyle {
  stroke: string; fill: string | null; width: number; color: string;
  fontFamily: string; fontSize: number; bold: boolean; italic: boolean;
  align: "left" | "center" | "right" | "justify";
  /** Colors of new text markup, symbols and notes. */
  markup: Record<MarkupTool, string>; symbolColor: string; noteColor: string;
  /** Stroke style and opacity of new shapes. */
  dash: Dash; opacity: number;
}

export interface EditorState {
  info: DocInfo | null; doc: EditorDoc; past: EditorDoc[]; future: EditorDoc[];
  selection: string | null; tool: Tool; zoom: number; style: ToolStyle; currentPage: string | null;
  init(info: DocInfo, restored?: EditorDoc | null): void;
  addObject(op: ContentOp): void;
  /** `coalesce`: successive updates with the same key within COALESCE_MS are one undo step (slider drags, typing a size).
   *  `remove`: objects deleted in the same step (marks on text a text.edit stops keeping, see updateTextOp). */
  updateObject(id: string, patch: Partial<ContentOp>, opts?: { coalesce?: string; remove?: string[] }): void;
  /** Adds or replaces several objects and deletes the objects `remove` as one undo step (Replace All). */
  putObjects(ops: ContentOp[], remove?: string[]): void;
  deleteObject(id: string): void;
  /** Moves objects `ids` in the stacking order of their page (lib/zorder.ts reorder) as one undo step; false when
   *  nothing changed (already at the front/back, unknown ids). */
  reorderObjects(ids: readonly string[], move: ZMove): boolean;
  /** Sets AcroForm field `name` (every widget of that name); `coalesce` as in updateObject (typing). */
  setFormValue(name: string, value: FormValue, opts?: { coalesce?: string }, doc?: string): void;
  rotatePage(pageKey: string, delta: 90 | -90): void;
  deletePage(pageKey: string): void;
  insertBlankAfter(pageKey: string | null): string;
  movePage(pageKey: string, toIndex: number): void;
  /** Copies the page (and its objects) right after it; returns the copy's key. */
  duplicatePage(pageKey: string): string | null;
  /** Registers the page sizes of an imported PDF (before its pages are inserted). */
  addImport(docId: string, pages: StructurePage[], fields?: FormField[]): void;
  /** Inserts all pages of imported PDF `docId` after `pageKey` (null: at the start); returns their keys. */
  insertImportAfter(pageKey: string | null, docId: string): string[];
  /** Crops the pages (null removes the crop) as one undo step. */
  setCrop(pageKeys: string[], crop: CropBox | null): void;
  /** Replaces the whole document as one undo step (the Manage Pages modal's Simpan). */
  replaceDoc(next: EditorDoc): void;
  undo(): void; redo(): void;
  select(id: string | null): void; setTool(t: Tool): void; setZoom(z: number): void;
  setStyle(p: Partial<ToolStyle>): void; setCurrentPage(k: string | null): void;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;
const A4 = { width: 595, height: 842 };
const EMPTY: EditorDoc = { pages: [], objects: {}, order: [] };
export const DEFAULT_STYLE: ToolStyle = {
  stroke: "#e11d48", fill: null, width: 2, color: "#111111",
  fontFamily: "Arimo", fontSize: 14, bold: false, italic: false, align: "left",
  markup: { highlight: "#ffeb3b", underline: "#e11d48", strike: "#e11d48" }, symbolColor: "#1d4ed8", noteColor: "#facc15",
  dash: "solid", opacity: 1,
};

/** Structure of a page's source: the main document's or an imported PDF's page (undefined while unknown). */
export function sourcePage(entry: PageEntry, info: DocInfo): StructurePage | undefined {
  if ("blank" in entry.src) return undefined;
  return (entry.src.doc === info.docId ? info.pages : info.imports?.[entry.src.doc])?.[entry.src.index];
}

export function pageGeom(entry: PageEntry, info: DocInfo): PageGeom {
  const crop = entry.crop ? { crop: entry.crop } : {};
  if ("blank" in entry.src) return { ...entry.src.blank, rotation: normRotation(entry.rotate), ...crop };
  const p = sourcePage(entry, info) ?? { width: A4.width, height: A4.height, rotation: 0 };
  return { width: p.width, height: p.height, rotation: normRotation(p.rotation + entry.rotate), ...crop };
}

/** Fields of `s` that must change so selection/currentPage stay valid for `doc`. */
function reconcile(doc: EditorDoc, s: { selection: string | null; currentPage: string | null }) {
  const keys = new Set(doc.pages.map((p) => p.pageKey));
  const out: { selection?: null; currentPage?: string | null } = {};
  if (s.selection !== null) {
    const op = doc.objects[s.selection];
    if (!op || !keys.has(op.pageKey)) out.selection = null;
  }
  if (s.currentPage === null || !keys.has(s.currentPage)) {
    const first = doc.pages[0]?.pageKey ?? null;
    if (first !== s.currentPage) out.currentPage = first;
  }
  return out;
}

/** The text.edit op replacing original paragraph `paragraphId` on `pageKey`, if any. */
export function textEditFor(doc: EditorDoc, pageKey: string, paragraphId: string): TextEdit | undefined {
  for (const id of doc.order) {
    const op = doc.objects[id];
    if (op?.type === "text.edit" && op.pageKey === pageKey && (op as TextEdit).paragraphId === paragraphId) return op as TextEdit;
  }
  return undefined;
}

/** The text.ocr_edit op replacing paragraph `paragraphId` that OCR read on `pageKey`, if any (M5d). */
export function ocrEditFor(doc: EditorDoc, pageKey: string, paragraphId: string): TextOcrEdit | undefined {
  for (const id of doc.order) {
    const op = doc.objects[id];
    if (op?.type === "text.ocr_edit" && op.pageKey === pageKey && op.paragraphId === paragraphId) return op;
  }
  return undefined;
}

export function createEditorStore(now: () => number = Date.now): StoreApi<EditorState> {
  return createStore<EditorState>()((set, get) => {
    let last: { key: string; at: number } | null = null;
    const commit = (fn: (d: EditorDoc) => EditorDoc, coalesce?: string) => {
      const prev = get().doc;
      const next = fn(prev);
      if (next === prev) return;
      const t = now();
      if (coalesce !== undefined && last?.key === coalesce && t - last.at <= COALESCE_MS && get().past.length) {
        set({ doc: next, future: [] }); // same undo step as the previous update
      } else {
        set({ doc: next, past: [...get().past, prev].slice(-HISTORY_LIMIT), future: [] });
      }
      last = coalesce !== undefined ? { key: coalesce, at: t } : null;
    };

    return {
      info: null, doc: EMPTY, past: [], future: [],
      selection: null, tool: "select", zoom: 1, style: DEFAULT_STYLE, currentPage: null,

      init(info, restored) {
        const pages: PageEntry[] = info.pages.map((p) => ({ pageKey: `o${p.index}`, src: { doc: info.docId, index: p.index }, rotate: 0 }));
        const doc = restored ?? { pages, objects: {}, order: [] };
        set({ info, doc, past: [], future: [], selection: null, currentPage: null });
        set(reconcile(doc, get()));
      },

      addObject(op) {
        commit((d) => ({
          ...d,
          objects: { ...d.objects, [op.id]: op },
          order: d.order.includes(op.id) ? d.order : [...d.order, op.id],
        }));
      },

      updateObject(id, patch, opts) {
        const gone = new Set((opts?.remove ?? []).filter((x) => x !== id));
        commit((d) => {
          const cur = d.objects[id];
          if (!cur) return d;
          const objects = { ...d.objects, [id]: { ...cur, ...patch, id: cur.id, type: cur.type } as ContentOp };
          for (const x of gone) delete objects[x];
          return { ...d, objects, order: gone.size ? d.order.filter((x) => !gone.has(x)) : d.order };
        }, opts?.coalesce);
        const sel = get().selection;
        if (sel !== null && gone.has(sel)) set({ selection: null });
      },

      putObjects(ops, remove = []) {
        const gone = new Set(remove.filter((id) => !ops.some((op) => op.id === id)));
        if (!ops.length && !gone.size) return;
        commit((d) => {
          const objects = { ...d.objects };
          let order = [...d.order];
          for (const op of ops) {
            if (!objects[op.id]) order.push(op.id);
            objects[op.id] = op;
          }
          if (gone.size) {
            for (const id of gone) delete objects[id];
            order = order.filter((id) => !gone.has(id));
          }
          return { ...d, objects, order };
        });
        const sel = get().selection;
        if (sel !== null && gone.has(sel)) set({ selection: null });
      },

      deleteObject(id) {
        commit((d) => {
          if (!d.objects[id]) return d;
          const objects = { ...d.objects };
          delete objects[id];
          return { ...d, objects, order: d.order.filter((x) => x !== id) };
        });
        if (get().selection === id) set({ selection: null });
      },

      reorderObjects(ids, move) {
        const before = get().doc;
        commit((d) => {
          const order = reorder(d, ids, move);
          return order ? { ...d, order } : d;
        });
        return get().doc !== before;
      },

      setFormValue(name, value, opts, doc) {
        if (doc && doc !== get().info?.docId) { // a field of an imported PDF
          commit((d) => (d.importForms?.[doc]?.[name] === value ? d
            : { ...d, importForms: { ...d.importForms, [doc]: { ...d.importForms?.[doc], [name]: value } } }), opts?.coalesce ? `${doc}:${opts.coalesce}` : undefined);
          return;
        }
        commit((d) => (d.forms?.[name] === value ? d : { ...d, forms: { ...d.forms, [name]: value } }), opts?.coalesce);
      },

      rotatePage(key, delta) {
        commit((d) => P.rotatePages(d, [key], delta));
      },

      deletePage(key) {
        commit((d) => P.deletePages(d, [key]));
        set(reconcile(get().doc, get()));
      },

      insertBlankAfter(key) {
        const entry = P.blankPage({ width: 0, height: 0 });
        commit((d) => {
          const idx = key === null ? -1 : d.pages.findIndex((p) => p.pageKey === key);
          const size = P.blankSizeLike(d.pages[Math.max(idx, 0)], get().info);
          return P.insertPages(d, idx + 1, [{ ...entry, src: { blank: size } }]);
        });
        return entry.pageKey;
      },

      movePage(key, toIndex) {
        commit((d) => P.movePage(d, key, toIndex));
      },

      duplicatePage(key) {
        const before = new Set(get().doc.pages.map((p) => p.pageKey));
        commit((d) => P.duplicatePages(d, [key]));
        return get().doc.pages.find((p) => !before.has(p.pageKey))?.pageKey ?? null;
      },

      addImport(docId, pages, fields = []) {
        const info = get().info;
        if (info) set({ info: { ...info, imports: { ...info.imports, [docId]: pages }, importFields: { ...info.importFields, [docId]: fields } } });
      },

      insertImportAfter(key, docId) {
        const count = get().info?.imports?.[docId]?.length ?? 0;
        if (!count) return [];
        const before = new Set(get().doc.pages.map((p) => p.pageKey));
        commit((d) => P.importPages(d, key === null ? 0 : d.pages.findIndex((p) => p.pageKey === key) + 1, docId, count));
        return get().doc.pages.filter((p) => !before.has(p.pageKey)).map((p) => p.pageKey);
      },

      setCrop(keys, crop) {
        const info = get().info;
        if (info) commit((d) => P.setCrop(d, keys, crop, info));
      },

      replaceDoc(next) {
        commit(() => next);
        set(reconcile(get().doc, get()));
      },

      undo() {
        last = null;
        const { past, doc, future } = get();
        if (!past.length) return;
        const prev = past[past.length - 1];
        set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future] });
        set(reconcile(prev, get()));
      },

      redo() {
        last = null;
        const { past, doc, future } = get();
        if (!future.length) return;
        const next = future[0];
        set({ doc: next, future: future.slice(1), past: [...past, doc].slice(-HISTORY_LIMIT) });
        set(reconcile(next, get()));
      },

      select: (id) => set({ selection: id }),
      setTool: (tool) => set({ tool, selection: tool === "select" ? get().selection : null }),
      setZoom: (z) => set({ zoom: Math.min(4, Math.max(0.25, z)) }),
      setStyle: (p) => set({ style: { ...get().style, ...p } }),
      setCurrentPage: (k) => set({ currentPage: k }),
    };
  });
}

export const editorStore = createEditorStore();

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editorStore, selector);
}
