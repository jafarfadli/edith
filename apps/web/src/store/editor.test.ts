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
