# Task 10: Web store — history coalescing, `putObjects`, `textEditFor`; `text.edit` geometry

**Files:**
- Modify: `apps/web/src/store/editor.ts`, `apps/web/src/store/editor.test.ts`, `apps/web/src/lib/objects.ts`, `apps/web/src/lib/objects.test.ts`, `apps/web/src/components/editor/PropertiesBar.tsx`, `apps/web/src/components/editor/Editor.tsx`

**Interfaces:**
- Consumes: Task 2 `TextEdit` type.
- Produces:
  ```ts
  // store/editor.ts
  export const COALESCE_MS = 1000;
  export function createEditorStore(now?: () => number): StoreApi<EditorState>
  updateObject(id: string, patch: Partial<ContentOp>, opts?: { coalesce?: string }): void  // same key within COALESCE_MS → same undo step
  putObjects(ops: ContentOp[]): void                // add or replace several objects, one undo step
  export function textEditFor(doc: EditorDoc, pageKey: string, paragraphId: string): TextEdit | undefined
  // lib/objects.ts
  export function isTextOp(op: ContentOp | undefined): op is TextAdd | TextEdit
  ```
  `opBounds`/`moveOp`/`resizeOp` treat `text.edit` like `text.add` (box rect; resize changes x/width only). Coalescing resets on undo/redo and on any non-coalesced change. Coalesce keys used: `props:<id>` (stroke/fill/width controls), `nudge:<id>` (arrow keys); Task 12 adds `text-style:<id>`.

- [ ] **Step 1: Failing tests**

In `apps/web/src/store/editor.test.ts` change the store import to
`import { createEditorStore, HISTORY_LIMIT, pageGeom, textEditFor, type DocInfo } from "@/store/editor";`
and append:
```ts

describe("history coalescing and batches", () => {
  it("merges updates with the same key inside the window into one undo step", () => {
    let t = 0;
    const st = createEditorStore(() => t);
    st.getState().init(info);
    st.getState().addObject(white("a"));
    for (const x of [1, 2, 3]) { t += 300; st.getState().updateObject("a", { rect: { x, y: 0, w: 10, h: 10 } } as Partial<ContentOp>, { coalesce: "nudge:a" }); }
    expect(st.getState().past.length).toBe(2); // add + one coalesced update
    st.getState().undo();
    expect((st.getState().doc.objects.a as { rect: { x: number } }).rect.x).toBe(0);
  });

  it("starts a new step after the window, with another key, or after undo", () => {
    let t = 0;
    const st = createEditorStore(() => t);
    st.getState().init(info);
    st.getState().addObject(white("a"));
    const move = (x: number, key = "k") => st.getState().updateObject("a", { rect: { x, y: 0, w: 10, h: 10 } } as Partial<ContentOp>, { coalesce: key });
    move(1); t += 2000; move(2);
    expect(st.getState().past.length).toBe(3);
    move(3, "other");
    expect(st.getState().past.length).toBe(4);
    st.getState().undo(); move(4, "other");
    expect(st.getState().past.length).toBe(4);
  });

  it("putObjects adds and replaces in one step", () => {
    s().addObject(white("a"));
    s().putObjects([{ ...white("a"), rect: { x: 9, y: 9, w: 1, h: 1 } } as ContentOp, white("b")]);
    expect(s().doc.order).toEqual(["a", "b"]);
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(9);
    s().undo();
    expect(s().doc.order).toEqual(["a"]);
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(0);
  });

  it("finds the text.edit of a paragraph", () => {
    const box = { rect: { x: 0, y: 0, w: 10, h: 10 }, align: "left" as const, lineHeight: 12, paragraphs: [], layout: [] };
    s().addObject({ id: "e", type: "text.edit", pageKey: "o1", paragraphId: "g2", box } as ContentOp);
    expect(textEditFor(s().doc, "o1", "g2")?.id).toBe("e");
    expect(textEditFor(s().doc, "o0", "g2")).toBeUndefined();
  });
});
```

In `apps/web/src/lib/objects.test.ts` add `isTextOp` to the `@/lib/objects` import and append:
```ts

describe("text.edit ops", () => {
  const box = { rect: { x: 10, y: 20, w: 100, h: 30 }, align: "left" as const, lineHeight: 12, paragraphs: [], layout: [] };
  const op = { id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g0", box } as ContentOp;

  it("are text ops placed by their box", () => {
    expect(isTextOp(op)).toBe(true);
    expect(isTextOp({ id: "w", type: "whiteout.add", pageKey: "o0", rect: box.rect } as ContentOp)).toBe(false);
    expect(opBounds(op)).toEqual(box.rect);
    expect(opBounds(moveOp(op, 5, -5))).toEqual({ x: 15, y: 15, w: 100, h: 30 });
    expect(opBounds(resizeOp(op, { x: 0, y: 20, w: 50, h: 99 }))).toEqual({ x: 0, y: 20, w: 50, h: 30 }); // width only
  });
});
```

Run: `npm test -w apps/web`
Expected: FAIL — `textEditFor`/`isTextOp` not exported.

- [ ] **Step 2: Store**

In `apps/web/src/store/editor.ts`:
- `import type { ContentOp, TextEdit } from "@edith/ops";`
- In `EditorState`, replace the `updateObject` line with:
```ts
  /** `coalesce`: successive updates with the same key within COALESCE_MS are one undo step (slider drags, typing a size). */
  updateObject(id: string, patch: Partial<ContentOp>, opts?: { coalesce?: string }): void;
  /** Adds or replaces several objects as one undo step (Replace All). */
  putObjects(ops: ContentOp[]): void;
```
- Below `export const HISTORY_LIMIT = 100;` add `export const COALESCE_MS = 1000;`
- Replace the line `export function createEditorStore(): StoreApi<EditorState> {` and the `commit` helper with:
```ts
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
```
- Replace `updateObject` with:
```ts
      updateObject(id, patch, opts) {
        commit((d) => {
          const cur = d.objects[id];
          if (!cur) return d;
          return { ...d, objects: { ...d.objects, [id]: { ...cur, ...patch, id: cur.id, type: cur.type } as ContentOp } };
        }, opts?.coalesce);
      },

      putObjects(ops) {
        if (!ops.length) return;
        commit((d) => {
          const objects = { ...d.objects };
          const order = [...d.order];
          for (const op of ops) {
            if (!objects[op.id]) order.push(op.id);
            objects[op.id] = op;
          }
          return { ...d, objects, order };
        });
      },
```
- Make `last = null;` the first statement of both `undo()` and `redo()`.

- [ ] **Step 3: Object geometry**

In `apps/web/src/lib/objects.ts`:
- `import type { ContentOp, Rect, TextAdd, TextEdit } from "@edith/ops";`
- Above `opBounds` add:
```ts
export function isTextOp(op: ContentOp | undefined): op is TextAdd | TextEdit {
  return op?.type === "text.add" || op?.type === "text.edit";
}
```
- In `opBounds`, `moveOp` and `resizeOp`, change each `case "text.add":` to `case "text.add": case "text.edit":`.

- [ ] **Step 4: Use coalescing**

`apps/web/src/components/editor/PropertiesBar.tsx`: in `set()`, replace `s.updateObject(o.id, p as Partial<ContentOp>);` with
```ts
      s.updateObject(o.id, p as Partial<ContentOp>, { coalesce: `props:${o.id}` }); // a slider drag is one undo step
```

`apps/web/src/components/editor/Editor.tsx`: in `nudge`, replace `st.updateObject(op.id, moveOp(op, x1 - x0, y1 - y0));` with
```ts
    st.updateObject(op.id, moveOp(op, x1 - x0, y1 - y0), { coalesce: `nudge:${op.id}` }); // held arrow keys: one undo step
```

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store apps/web/src/lib/objects.ts apps/web/src/lib/objects.test.ts apps/web/src/components/editor/PropertiesBar.tsx apps/web/src/components/editor/Editor.tsx
git commit -m "feat(web): coalesced history, batch puts and text.edit geometry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
