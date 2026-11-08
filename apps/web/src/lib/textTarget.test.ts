import { describe, expect, it } from "vitest";
import type { ContentOp } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { textTargetAt } from "@/lib/textTarget";

const para = (id: string, x: number, y: number, editable = true): Paragraph => ({
  id, rect: { x, y, w: 200, h: 30 }, lines: [], runs: [], align: "left", lineHeight: 1.2, editable,
});
const textOp = (id: string, type: "text.add" | "text.edit", x: number, y: number, paragraphId?: string) =>
  ({ id, type, pageKey: "o0", ...(paragraphId ? { paragraphId } : {}), box: { rect: { x, y, w: 100, h: 20 } } }) as unknown as ContentOp;
const highlight = { id: "h", type: "annot.add", pageKey: "o0", kind: "highlight", quads: [{ x: 72, y: 90, w: 50, h: 14 }], color: "#ffeb3b" } as ContentOp;

describe("textTargetAt (double-click through a markup)", () => {
  const paragraphs = [para("g0", 72, 80), para("g1", 72, 200), para("g2", 72, 300, false)];

  it("finds the original paragraph under the point", () => {
    expect(textTargetAt([highlight], paragraphs, [80, 95])).toEqual({ paragraph: paragraphs[0] });
    expect(textTargetAt([highlight], paragraphs, [80, 210])).toEqual({ paragraph: paragraphs[1] });
  });

  it("skips paragraphs that are not editable or already edited, and empty points", () => {
    expect(textTargetAt([], paragraphs, [80, 310])).toBeNull();
    expect(textTargetAt([], paragraphs, [10, 10])).toBeNull();
    const edit = textOp("e", "text.edit", 72, 80, "g0");
    expect(textTargetAt([edit], paragraphs, [150, 110])).toBeNull(); // inside g0 but outside its edit box
  });

  it("prefers the topmost text object containing the point", () => {
    const edit = textOp("e", "text.edit", 72, 80, "g0");
    const added = textOp("a", "text.add", 100, 85);
    expect(textTargetAt([edit, highlight], paragraphs, [80, 95])).toEqual({ op: edit });
    expect(textTargetAt([edit, added], paragraphs, [110, 95])).toEqual({ op: added });
  });
});
