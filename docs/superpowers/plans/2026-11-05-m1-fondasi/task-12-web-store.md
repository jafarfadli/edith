# Task 12: Editor store, history, compaction, drafts

**Files:**
- Create: `apps/web/src/store/editor.ts`, `apps/web/src/store/editor.test.ts`, `apps/web/src/lib/compact.ts`, `apps/web/src/lib/compact.test.ts`, `apps/web/src/lib/draft.ts`, `apps/web/src/lib/draft.test.ts`, `apps/web/src/lib/id.ts`
- Modify: `apps/web/package.json` (dep `zustand`)

**Interfaces:**
- Consumes: `@edith/ops` (`ContentOp`, `Op`, `PagesLayout`), `@/lib/coords` (`PageGeom`, `Rotation`, `normRotation`).
- Produces:
```ts
// lib/id.ts
export function newId(prefix?: string): string;         // crypto.randomUUID based; newId("u") → "u-<uuid>"
// store/editor.ts
export interface StructurePage { index: number; width: number; height: number; rotation: number; hasText: boolean }
export interface DocInfo { docId: string; sha256: string; fileName: string; pages: StructurePage[] }
export type PageSrc = { doc: string; index: number } | { blank: { width: number; height: number } };
export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation }
export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[] }
export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan";
export interface ToolStyle { stroke: string; fill: string | null; width: number; color: string; fontFamily: string; fontSize: number; bold: boolean; italic: boolean; align: "left" | "center" | "right" | "justify" }
export interface EditorState {
  info: DocInfo | null; doc: EditorDoc; past: EditorDoc[]; future: EditorDoc[];
  selection: string | null; tool: Tool; zoom: number; style: ToolStyle; currentPage: string | null;
  init(info: DocInfo, restored?: EditorDoc | null): void;
  addObject(op: ContentOp): void;
  updateObject(id: string, patch: Partial<ContentOp>): void;
  deleteObject(id: string): void;
  rotatePage(pageKey: string, delta: 90 | -90): void;
  deletePage(pageKey: string): void;          // no-op when only one page is left
  insertBlankAfter(pageKey: string | null): string;  // returns new pageKey; null = at start
  movePage(pageKey: string, toIndex: number): void;
  undo(): void; redo(): void;
  select(id: string | null): void; setTool(t: Tool): void; setZoom(z: number): void;
  setStyle(p: Partial<ToolStyle>): void; setCurrentPage(k: string | null): void;
}
export const HISTORY_LIMIT = 100;
export function createEditorStore(): StoreApi<EditorState>;  // zustand/vanilla
export const editorStore: StoreApi<EditorState>;
export function useEditor<T>(selector: (s: EditorState) => T): T;
export function pageGeom(entry: PageEntry, info: DocInfo): PageGeom;
// lib/compact.ts
export function compact(doc: EditorDoc): Op[];   // [pages.layout, ...content ops in order whose pageKey still exists]
// lib/draft.ts
export function saveDraft(sha256: string, doc: EditorDoc): void;
export function loadDraft(sha256: string): EditorDoc | null;
export function clearDraft(sha256: string): void;
```
Rules: every mutating action pushes the previous `doc` onto `past` (max `HISTORY_LIMIT`, oldest dropped) and clears `future`. `init` resets history. Zoom clamps to [0.25, 4]. Deleting the selected object clears selection.

- [ ] **Step 1: Deps + id helper**

Run: `npm install -w apps/web zustand@^5`

`apps/web/src/lib/id.ts`:
```ts
export function newId(prefix?: string): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}-${id}` : id;
}
```

- [ ] **Step 2: Failing store tests**

`apps/web/src/store/editor.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { createEditorStore, HISTORY_LIMIT, pageGeom, type DocInfo } from "@/store/editor";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "abc", fileName: "a.pdf",
  pages: [0, 1, 2].map((i) => ({ index: i, width: 595, height: 842, rotation: i === 2 ? 90 : 0, hasText: true })),
};
const white = (id: string, pageKey = "o0"): ContentOp =>
  ({ id, type: "whiteout.add", pageKey, rect: { x: 0, y: 0, w: 10, h: 10 } }) as ContentOp;

let store: ReturnType<typeof createEditorStore>;
beforeEach(() => { store = createEditorStore(); store.getState().init(info); });
const s = () => store.getState();

describe("editor store", () => {
  it("init builds default pages", () => {
    expect(s().doc.pages.map((p) => p.pageKey)).toEqual(["o0", "o1", "o2"]);
    expect(s().doc.pages[0].src).toEqual({ doc: info.docId, index: 0 });
  });

  it("add/update/delete with undo/redo", () => {
    s().addObject(white("a"));
    s().updateObject("a", { rect: { x: 5, y: 5, w: 10, h: 10 } } as Partial<ContentOp>);
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(5);
    s().undo();
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(0);
    s().undo();
    expect(s().doc.objects.a).toBeUndefined();
    s().redo(); s().redo();
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(5);
    s().select("a");
    s().deleteObject("a");
    expect(s().doc.order).toEqual([]);
    expect(s().selection).toBeNull();
  });

  it("new action clears redo stack", () => {
    s().addObject(white("a"));
    s().undo();
    s().addObject(white("b"));
    s().redo();
    expect(Object.keys(s().doc.objects)).toEqual(["b"]);
  });

  it("caps history", () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s().addObject(white(`w${i}`));
    expect(s().past.length).toBe(HISTORY_LIMIT);
  });

  it("page operations", () => {
    s().rotatePage("o0", 90);
    s().rotatePage("o0", 90);
    s().rotatePage("o1", -90);
    expect(s().doc.pages.map((p) => p.rotate)).toEqual([180, 270, 0]);
    s().movePage("o2", 0);
    expect(s().doc.pages.map((p) => p.pageKey)).toEqual(["o2", "o0", "o1"]);
    const k = s().insertBlankAfter("o2");
    expect(s().doc.pages[1]).toEqual({ pageKey: k, src: { blank: { width: 595, height: 842 } }, rotate: 0 });
    const first = s().insertBlankAfter(null);
    expect(s().doc.pages[0].pageKey).toBe(first);
    s().deletePage("o0");
    expect(s().doc.pages.map((p) => p.pageKey)).not.toContain("o0");
  });

  it("refuses to delete the last page", () => {
    s().deletePage("o0"); s().deletePage("o1"); s().deletePage("o2");
    expect(s().doc.pages.length).toBe(1);
  });

  it("pageGeom combines source rotation and layout rotation", () => {
    s().rotatePage("o2", 90);
    const g = pageGeom(s().doc.pages[2], info);
    expect(g).toEqual({ width: 595, height: 842, rotation: 180 });
  });

  it("clamps zoom", () => {
    s().setZoom(10);
    expect(s().zoom).toBe(4);
    s().setZoom(0.01);
    expect(s().zoom).toBe(0.25);
  });

  it("init with restored draft", () => {
    s().addObject(white("a"));
    const saved = s().doc;
    const other = createEditorStore();
    other.getState().init(info, saved);
    expect(other.getState().doc.order).toEqual(["a"]);
    expect(other.getState().past).toEqual([]);
  });
});
```

`apps/web/src/lib/compact.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { compact } from "@/lib/compact";
import type { EditorDoc } from "@/store/editor";

const op = (id: string, pageKey: string): ContentOp =>
  ({ id, type: "whiteout.add", pageKey, rect: { x: 0, y: 0, w: 1, h: 1 } }) as ContentOp;

describe("compact", () => {
  it("emits layout first then objects in order, dropping orphans", () => {
    const doc: EditorDoc = {
      pages: [
        { pageKey: "o1", src: { doc: "D", index: 1 }, rotate: 90 },
        { pageKey: "u-b", src: { blank: { width: 100, height: 200 } }, rotate: 0 },
      ],
      objects: { a: op("a", "o1"), b: op("b", "o0"), c: op("c", "u-b") },
      order: ["c", "b", "a"],
    };
    const ops = compact(doc);
    expect(ops[0]).toEqual({ id: "layout", type: "pages.layout", pages: doc.pages });
    expect(ops.slice(1).map((o) => o.id)).toEqual(["c", "a"]);
  });
});
```

`apps/web/src/lib/draft.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft";

class MemStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new MemStorage(); });

describe("draft", () => {
  it("round-trips and clears", () => {
    const doc = { pages: [], objects: {}, order: ["x"] };
    saveDraft("h", doc);
    expect(loadDraft("h")).toEqual(doc);
    clearDraft("h");
    expect(loadDraft("h")).toBeNull();
  });

  it("survives broken storage", () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() {} };
    expect(() => saveDraft("h", { pages: [], objects: {}, order: [] })).not.toThrow();
    expect(loadDraft("h")).toBeNull();
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL (modules missing).

- [ ] **Step 3: Store**

`apps/web/src/store/editor.ts`:
```ts
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { ContentOp } from "@edith/ops";
import { normRotation, type PageGeom, type Rotation } from "@/lib/coords";
import { newId } from "@/lib/id";

export interface StructurePage { index: number; width: number; height: number; rotation: number; hasText: boolean }
export interface DocInfo { docId: string; sha256: string; fileName: string; pages: StructurePage[] }
export type PageSrc = { doc: string; index: number } | { blank: { width: number; height: number } };
export interface PageEntry { pageKey: string; src: PageSrc; rotate: Rotation }
export interface EditorDoc { pages: PageEntry[]; objects: Record<string, ContentOp>; order: string[] }
export type Tool = "select" | "text" | "whiteout" | "redact" | "ink" | "image" | "rect" | "ellipse" | "line" | "arrow" | "pan";
export interface ToolStyle {
  stroke: string; fill: string | null; width: number; color: string;
  fontFamily: string; fontSize: number; bold: boolean; italic: boolean;
  align: "left" | "center" | "right" | "justify";
}

export interface EditorState {
  info: DocInfo | null; doc: EditorDoc; past: EditorDoc[]; future: EditorDoc[];
  selection: string | null; tool: Tool; zoom: number; style: ToolStyle; currentPage: string | null;
  init(info: DocInfo, restored?: EditorDoc | null): void;
  addObject(op: ContentOp): void;
  updateObject(id: string, patch: Partial<ContentOp>): void;
  deleteObject(id: string): void;
  rotatePage(pageKey: string, delta: 90 | -90): void;
  deletePage(pageKey: string): void;
  insertBlankAfter(pageKey: string | null): string;
  movePage(pageKey: string, toIndex: number): void;
  undo(): void; redo(): void;
  select(id: string | null): void; setTool(t: Tool): void; setZoom(z: number): void;
  setStyle(p: Partial<ToolStyle>): void; setCurrentPage(k: string | null): void;
}

export const HISTORY_LIMIT = 100;
const A4 = { width: 595, height: 842 };
const EMPTY: EditorDoc = { pages: [], objects: {}, order: [] };
const DEFAULT_STYLE: ToolStyle = {
  stroke: "#e11d48", fill: null, width: 2, color: "#111111",
  fontFamily: "Arimo", fontSize: 14, bold: false, italic: false, align: "left",
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

export function createEditorStore(): StoreApi<EditorState> {
  return createStore<EditorState>()((set, get) => {
    const commit = (fn: (d: EditorDoc) => EditorDoc) => {
      const prev = get().doc;
      const next = fn(prev);
      if (next === prev) return;
      set({ doc: next, past: [...get().past, prev].slice(-HISTORY_LIMIT), future: [] });
    };
    const mapPage = (key: string, fn: (p: PageEntry) => PageEntry) =>
      commit((d) => ({ ...d, pages: d.pages.map((p) => (p.pageKey === key ? fn(p) : p)) }));

    return {
      info: null, doc: EMPTY, past: [], future: [],
      selection: null, tool: "select", zoom: 1, style: DEFAULT_STYLE, currentPage: null,

      init(info, restored) {
        const pages: PageEntry[] = info.pages.map((p) => ({ pageKey: `o${p.index}`, src: { doc: info.docId, index: p.index }, rotate: 0 }));
        const doc = restored ?? { pages, objects: {}, order: [] };
        set({ info, doc, past: [], future: [], selection: null, currentPage: doc.pages[0]?.pageKey ?? null });
      },

      addObject(op) {
        commit((d) => ({ ...d, objects: { ...d.objects, [op.id]: op }, order: [...d.order, op.id] }));
      },

      updateObject(id, patch) {
        commit((d) => {
          const cur = d.objects[id];
          if (!cur) return d;
          return { ...d, objects: { ...d.objects, [id]: { ...cur, ...patch } as ContentOp } };
        });
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

      rotatePage(key, delta) {
        mapPage(key, (p) => ({ ...p, rotate: normRotation(p.rotate + delta) }));
      },

      deletePage(key) {
        commit((d) => (d.pages.length <= 1 ? d : { ...d, pages: d.pages.filter((p) => p.pageKey !== key) }));
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
          if (from < 0 || from === toIndex) return d;
          const pages = [...d.pages];
          const [entry] = pages.splice(from, 1);
          pages.splice(Math.max(0, Math.min(toIndex, pages.length)), 0, entry);
          return { ...d, pages };
        });
      },

      undo() {
        const { past, doc, future } = get();
        if (!past.length) return;
        set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future] });
      },

      redo() {
        const { past, doc, future } = get();
        if (!future.length) return;
        set({ doc: future[0], future: future.slice(1), past: [...past, doc].slice(-HISTORY_LIMIT) });
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
```

- [ ] **Step 4: compact + draft**

`apps/web/src/lib/compact.ts`:
```ts
import type { Op } from "@edith/ops";
import type { EditorDoc } from "@/store/editor";

export function compact(doc: EditorDoc): Op[] {
  const keys = new Set(doc.pages.map((p) => p.pageKey));
  const layout = { id: "layout", type: "pages.layout", pages: doc.pages } as Op;
  const content = doc.order.map((id) => doc.objects[id]).filter((op) => op && keys.has(op.pageKey));
  return [layout, ...content];
}
```

`apps/web/src/lib/draft.ts`:
```ts
import type { EditorDoc } from "@/store/editor";

const key = (sha: string) => `edith:draft:${sha}`;

export function saveDraft(sha256: string, doc: EditorDoc): void {
  try { localStorage.setItem(key(sha256), JSON.stringify(doc)); } catch { /* storage full or blocked */ }
}

export function loadDraft(sha256: string): EditorDoc | null {
  try {
    const raw = localStorage.getItem(key(sha256));
    return raw ? (JSON.parse(raw) as EditorDoc) : null;
  } catch {
    return null;
  }
}

export function clearDraft(sha256: string): void {
  try { localStorage.removeItem(key(sha256)); } catch { /* ignore */ }
}
```

Note: a restored draft's `src.doc` values hold the **old** doc id. Task 14 rewrites them to the new `docId` when restoring (`src.doc` of every doc-sourced page is replaced).

Run: `npm test -w apps/web` → Expected: all PASS. `npx tsc --noEmit -p apps/web` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web package-lock.json
git commit -m "feat(web): add editor store with undo/redo, compaction and drafts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
