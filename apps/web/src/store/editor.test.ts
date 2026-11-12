import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { createEditorStore, HISTORY_LIMIT, pageGeom, textEditFor, type DocInfo } from "@/store/editor";

const info: DocInfo = {
  docId: "D".repeat(22), editId: "E".repeat(22), fileName: "a.pdf",
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
    // o2's source is rotated 90°: the blank page takes the shape it shows on screen (landscape).
    expect(s().doc.pages[1]).toEqual({ pageKey: k, src: { blank: { width: 842, height: 595 } }, rotate: 0 });
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

  it("undo clears selection of a vanished object", () => {
    s().addObject(white("a"));
    s().select("a");
    s().undo();
    expect(s().selection).toBeNull();
  });

  it("undo moves currentPage off a vanished page", () => {
    const k = s().insertBlankAfter("o0");
    s().setCurrentPage(k);
    s().undo();
    expect(s().doc.pages.map((p) => p.pageKey)).toContain(s().currentPage);
    expect(s().currentPage).toBe("o0");
  });

  it("deletePage reconciles selection and currentPage", () => {
    s().addObject(white("a", "o1"));
    s().select("a");
    s().setCurrentPage("o1");
    s().deletePage("o1");
    expect(s().selection).toBeNull();
    expect(s().currentPage).toBe("o0");
  });

  it("addObject with an existing id replaces in place", () => {
    s().addObject(white("a"));
    s().addObject(white("b"));
    s().addObject({ ...white("a"), rect: { x: 9, y: 9, w: 1, h: 1 } } as ContentOp);
    expect(s().doc.order).toEqual(["a", "b"]);
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(9);
    expect(s().past.length).toBe(3);
  });

  it("updateObject cannot change id or type", () => {
    s().addObject(white("a"));
    s().updateObject("a", { id: "z", type: "redact.add" } as unknown as Partial<ContentOp>);
    expect(s().doc.objects.z).toBeUndefined();
    expect(s().doc.objects.a.id).toBe("a");
    expect(s().doc.objects.a.type).toBe("whiteout.add");
  });

  it("movePage clamps the index and no-ops without history", () => {
    s().movePage("o0", 99);
    expect(s().doc.pages.map((p) => p.pageKey)).toEqual(["o1", "o2", "o0"]);
    const n = s().past.length;
    s().movePage("o0", 99);
    s().movePage("o1", -5);
    expect(s().past.length).toBe(n);
  });
});

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

  it("sets form values with undo, coalescing typing into one step", () => {
    let t = 0;
    const st = createEditorStore(() => t);
    st.getState().init(info);
    st.getState().setFormValue("nama", "B", { coalesce: "form:nama" });
    t = 300; st.getState().setFormValue("nama", "Bu", { coalesce: "form:nama" });
    t = 600; st.getState().setFormValue("setuju", true);
    expect(st.getState().doc.forms).toEqual({ nama: "Bu", setuju: true });
    st.getState().undo();
    expect(st.getState().doc.forms).toEqual({ nama: "Bu" });
    st.getState().undo();
    expect(st.getState().doc.forms).toBeUndefined();
    const before = st.getState().past.length;
    st.getState().redo(); st.getState().setFormValue("nama", "Bu"); // same value: no new step
    expect(st.getState().past.length).toBe(before + 1);
  });
});

describe("page actions (M4)", () => {
  const I = "I".repeat(22);
  it("duplicates a page with its objects as one undo step", () => {
    s().addObject(white("a", "o1"));
    const k = s().duplicatePage("o1")!;
    expect(s().doc.pages.map((p) => p.pageKey)).toEqual(["o0", "o1", k, "o2"]);
    expect(Object.values(s().doc.objects).filter((o) => o.pageKey === k)).toHaveLength(1);
    s().undo();
    expect(s().doc.pages).toHaveLength(3);
    expect(Object.keys(s().doc.objects)).toEqual(["a"]);
  });

  it("imports pages of another PDF and gives them their own geometry", () => {
    expect(s().insertImportAfter("o0", I)).toEqual([]); // unknown until registered
    s().addImport(I, [{ index: 0, width: 300, height: 400, rotation: 90, hasText: false }]);
    const [k] = s().insertImportAfter("o0", I);
    expect(s().doc.pages[1]).toEqual({ pageKey: k, src: { doc: I, index: 0 }, rotate: 0 });
    expect(pageGeom(s().doc.pages[1], s().info!)).toEqual({ width: 300, height: 400, rotation: 90 });
    s().undo();
    expect(s().info!.imports![I]).toHaveLength(1); // the registry is not undone
  });

  it("crops and replaces the document as single undo steps", () => {
    s().setCrop(["o0"], { x: 10, y: 20, w: 100, h: 200 });
    expect(pageGeom(s().doc.pages[0], info).crop).toEqual({ x: 10, y: 20, w: 100, h: 200 });
    const next = { ...s().doc, pages: s().doc.pages.slice(1) };
    s().select(null);
    s().replaceDoc(next);
    expect(s().doc.pages.map((p) => p.pageKey)).toEqual(["o1", "o2"]);
    expect(s().currentPage).toBe("o1");
    s().undo();
    expect(s().doc.pages).toHaveLength(3);
    s().undo();
    expect(s().doc.pages[0].crop).toBeUndefined();
  });
});

describe("imported form fields", () => {
  it("keep their values apart from the edited PDF's, with undo", () => {
    const I = "I".repeat(22);
    s().addImport(I, [{ index: 0, width: 300, height: 400, rotation: 0, hasText: true }], [{ name: "nama" } as never]);
    expect(s().info!.importFields).toEqual({ [I]: [{ name: "nama" }] });
    s().setFormValue("nama", "Utama");
    s().setFormValue("nama", "Impor", undefined, I);
    expect(s().doc.forms).toEqual({ nama: "Utama" });
    expect(s().doc.importForms).toEqual({ [I]: { nama: "Impor" } });
    s().setFormValue("nama", "Main", undefined, info.docId); // the edited PDF's own id = no doc
    expect(s().doc.forms).toEqual({ nama: "Main" });
    s().undo(); s().undo();
    expect(s().doc.importForms?.[I]).toBeUndefined();
  });
});
