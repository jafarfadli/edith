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
