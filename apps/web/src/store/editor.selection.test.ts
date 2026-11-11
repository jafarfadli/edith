import { beforeEach, describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import { COALESCE_MS, createEditorStore, type DocInfo } from "@/store/editor";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "abc", fileName: "a.pdf",
  pages: [0, 1].map((i) => ({ index: i, width: 595, height: 842, rotation: 0, hasText: true })),
};
const white = (id: string, pageKey = "o0", x = 0): ContentOp =>
  ({ id, type: "whiteout.add", pageKey, rect: { x, y: 0, w: 10, h: 10 } }) as ContentOp;

let clock = 0;
let store: ReturnType<typeof createEditorStore>;
beforeEach(() => {
  clock = 1000;
  store = createEditorStore(() => clock);
  store.getState().init(info);
  for (const [id, key] of [["a", "o0"], ["b", "o0"], ["c", "o0"], ["z", "o1"]] as const) store.getState().addObject(white(id, key));
});
const s = () => store.getState();

describe("multi-selection", () => {
  it("select keeps the single-selection behaviour: primary and the set agree", () => {
    s().select("a");
    expect(s().selection).toBe("a");
    expect(s().selected).toEqual(["a"]);
    s().select(null);
    expect(s().selection).toBeNull();
    expect(s().selected).toEqual([]);
  });

  it("selectMany sets the set; the primary is the last (or the given one, moved last)", () => {
    s().selectMany(["a", "b", "c"]);
    expect(s().selected).toEqual(["a", "b", "c"]);
    expect(s().selection).toBe("c");
    s().selectMany(["a", "b", "c"], "a");
    expect(s().selected).toEqual(["b", "c", "a"]);
    expect(s().selection).toBe("a");
    s().selectMany([]);
    expect(s().selection).toBeNull();
  });

  it("selectMany drops unknown ids and duplicates", () => {
    s().selectMany(["a", "nope", "a", "b"]);
    expect(s().selected).toEqual(["a", "b"]);
  });

  it("toggleSelected adds, then removes; the primary follows", () => {
    s().select("a");
    s().toggleSelected("b");
    expect(s().selected).toEqual(["a", "b"]);
    expect(s().selection).toBe("b");
    s().toggleSelected("b");
    expect(s().selected).toEqual(["a"]);
    expect(s().selection).toBe("a");
    s().toggleSelected("a");
    expect(s().selection).toBeNull();
  });

  it("toggleSelected on an object of another page starts a new selection (no cross-page selection)", () => {
    s().select("a");
    s().toggleSelected("z");
    expect(s().selected).toEqual(["z"]);
  });

  it("toggleSelected on an unknown id changes nothing", () => {
    s().select("a");
    s().toggleSelected("nope");
    expect(s().selected).toEqual(["a"]);
  });

  it("deleting one selected object keeps the others selected", () => {
    s().selectMany(["a", "b", "c"]);
    s().deleteObject("c");
    expect(s().selected).toEqual(["a", "b"]);
    expect(s().selection).toBe("b");
  });

  it("putObjects removing selected objects prunes them", () => {
    s().selectMany(["a", "b"]);
    s().putObjects([], ["a"]);
    expect(s().selected).toEqual(["b"]);
  });

  it("undo that removes selected objects prunes them", () => {
    s().addObject(white("d"));
    s().selectMany(["a", "d"]);
    s().undo();
    expect(s().selected).toEqual(["a"]);
    expect(s().selection).toBe("a");
  });

  it("a tool other than select clears it; select keeps it", () => {
    s().selectMany(["a", "b"]);
    s().setTool("select");
    expect(s().selected).toEqual(["a", "b"]);
    s().setTool("rect");
    expect(s().selected).toEqual([]);
    expect(s().selection).toBeNull();
  });

  it("init clears it", () => {
    s().selectMany(["a", "b"]);
    s().init(info);
    expect(s().selected).toEqual([]);
  });

  it("deleting a page drops the selected objects on it", () => {
    s().select("z");
    s().deletePage("o1");
    expect(s().selected).toEqual([]);
  });
});

describe("putObjects as a group commit", () => {
  const moved = (id: string, x: number) => white(id, "o0", x);

  it("replaces several objects in one undo step", () => {
    s().putObjects([moved("a", 5), moved("b", 6)]);
    s().undo();
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(0);
    expect((s().doc.objects.b as { rect: { x: number } }).rect.x).toBe(0);
    expect(s().doc.objects.c).toBeDefined(); // one step undid only the group
  });

  it("coalesces under a key; the window is per call", () => {
    s().putObjects([moved("a", 1)], [], { coalesce: "nudge", within: 400 });
    clock += 300;
    s().putObjects([moved("a", 2)], [], { coalesce: "nudge", within: 400 });
    clock += 300; // 300 ms since the last one: still the same step
    s().putObjects([moved("a", 3)], [], { coalesce: "nudge", within: 400 });
    s().undo();
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(0);
  });

  it("starts a new step once the window has passed", () => {
    s().putObjects([moved("a", 1)], [], { coalesce: "nudge", within: 400 });
    clock += 500;
    s().putObjects([moved("a", 2)], [], { coalesce: "nudge", within: 400 });
    s().undo();
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(1);
  });

  it("the default window stays COALESCE_MS for updateObject", () => {
    s().updateObject("a", { rect: { x: 1, y: 0, w: 10, h: 10 } } as Partial<ContentOp>, { coalesce: "k" });
    clock += COALESCE_MS - 1;
    s().updateObject("a", { rect: { x: 2, y: 0, w: 10, h: 10 } } as Partial<ContentOp>, { coalesce: "k" });
    s().undo();
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(0);
  });

  it("breakCoalesce ends the step", () => {
    s().putObjects([moved("a", 1)], [], { coalesce: "nudge", within: 400 });
    s().breakCoalesce();
    s().putObjects([moved("a", 2)], [], { coalesce: "nudge", within: 400 });
    s().undo();
    expect((s().doc.objects.a as { rect: { x: number } }).rect.x).toBe(1);
  });
});
