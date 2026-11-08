import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { ContentOp, TextEdit } from "@edith/ops";
import type { FormField } from "@/lib/api";
import { normRotation, type PageGeom, type Rotation } from "@/lib/coords";
import { newId } from "@/lib/id";

export interface StructurePage { index: number; width: number; height: number; rotation: number; hasText: boolean }
export interface DocInfo { docId: string; sha256: string; fileName: string; pages: StructurePage[]; fields?: FormField[] }
export type PageSrc = { doc: string; index: number } | { blank: { width: number; height: number } };
export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation }
export type FormValue = string | boolean;
/** `forms`: AcroForm values the user set, by field name (sent as form.set ops); absent in M1/M2 drafts. */
export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[]; forms?: Record<string, FormValue> }
export type MarkupTool = "highlight" | "underline" | "strike";
export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan"
  | MarkupTool | "check" | "cross" | "note" | "link";
export interface ToolStyle {
  stroke: string; fill: string | null; width: number; color: string;
  fontFamily: string; fontSize: number; bold: boolean; italic: boolean;
  align: "left" | "center" | "right" | "justify";
  /** Colors of new text markup, symbols and notes. */
  markup: Record<MarkupTool, string>; symbolColor: string; noteColor: string;
}

export interface EditorState {
  info: DocInfo | null; doc: EditorDoc; past: EditorDoc[]; future: EditorDoc[];
  selection: string | null; tool: Tool; zoom: number; style: ToolStyle; currentPage: string | null;
  init(info: DocInfo, restored?: EditorDoc | null): void;
  addObject(op: ContentOp): void;
  /** `coalesce`: successive updates with the same key within COALESCE_MS are one undo step (slider drags, typing a size). */
  updateObject(id: string, patch: Partial<ContentOp>, opts?: { coalesce?: string }): void;
  /** Adds or replaces several objects and deletes the objects `remove` as one undo step (Replace All). */
  putObjects(ops: ContentOp[], remove?: string[]): void;
  deleteObject(id: string): void;
  /** Sets AcroForm field `name` (every widget of that name); `coalesce` as in updateObject (typing). */
  setFormValue(name: string, value: FormValue, opts?: { coalesce?: string }): void;
  rotatePage(pageKey: string, delta: 90 | -90): void;
  deletePage(pageKey: string): void;
  insertBlankAfter(pageKey: string | null): string;
  movePage(pageKey: string, toIndex: number): void;
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
};

export function pageGeom(entry: PageEntry, info: DocInfo): PageGeom {
  if ("blank" in entry.src) return { ...entry.src.blank, rotation: normRotation(entry.rotate) };
  const p = info.pages[entry.src.index];
  return { width: p.width, height: p.height, rotation: normRotation(p.rotation + entry.rotate) };
}

function sizeOf(entry: PageEntry | undefined, info: DocInfo | null) {
  if (!entry || !info) return A4;
  const g = pageGeom(entry, info);
  return { width: g.width, height: g.height };
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
    const mapPage = (key: string, fn: (p: PageEntry) => PageEntry) =>
      commit((d) => ({ ...d, pages: d.pages.map((p) => (p.pageKey === key ? fn(p) : p)) }));

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
        commit((d) => {
          const cur = d.objects[id];
          if (!cur) return d;
          return { ...d, objects: { ...d.objects, [id]: { ...cur, ...patch, id: cur.id, type: cur.type } as ContentOp } };
        }, opts?.coalesce);
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

      setFormValue(name, value, opts) {
        commit((d) => (d.forms?.[name] === value ? d : { ...d, forms: { ...d.forms, [name]: value } }), opts?.coalesce);
      },

      rotatePage(key, delta) {
        mapPage(key, (p) => ({ ...p, rotate: normRotation(p.rotate + delta) }));
      },

      deletePage(key) {
        commit((d) => (d.pages.length <= 1 ? d : { ...d, pages: d.pages.filter((p) => p.pageKey !== key) }));
        set(reconcile(get().doc, get()));
      },

      insertBlankAfter(key) {
        const pageKey = newId("u");
        commit((d) => {
          const idx = key === null ? -1 : d.pages.findIndex((p) => p.pageKey === key);
          const neighbor = d.pages[Math.max(idx, 0)];
          const entry: PageEntry = { pageKey, src: { blank: sizeOf(neighbor, get().info) }, rotate: 0 };
          const pages = [...d.pages];
          pages.splice(idx + 1, 0, entry);
          return { ...d, pages };
        });
        return pageKey;
      },

      movePage(key, toIndex) {
        commit((d) => {
          const from = d.pages.findIndex((p) => p.pageKey === key);
          if (from < 0) return d;
          const to = Math.max(0, Math.min(toIndex, d.pages.length - 1));
          if (to === from) return d;
          const pages = [...d.pages];
          const [entry] = pages.splice(from, 1);
          pages.splice(to, 0, entry);
          return { ...d, pages };
        });
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
