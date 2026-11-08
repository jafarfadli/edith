import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentOp, TextAdd, TextEdit } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { fontStore, metricsFromBuffer } from "@/lib/fonts";
import { noticeStore } from "@/lib/notices";
import { findMatches, nextMatchIndex } from "@/lib/search";
import { t } from "@/lib/strings";
import { buildTargets } from "@/lib/targets";
import { editorStore, type DocInfo } from "@/store/editor";
import { textStore } from "@/store/text";
import { applyReplacements } from "./replace";

const arimo = metricsFromBuffer(readFileSync(path.resolve(__dirname, "../../../../../../packages/fonts/files/Arimo-Regular.ttf")));
const info: DocInfo = { docId: "D".repeat(22), sha256: "abc", fileName: "a.pdf", pages: [{ index: 0, width: 595, height: 842, rotation: 0, hasText: true }] };
const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const para: Paragraph = {
  id: "g0", rect: { x: 72, y: 88, w: 200, h: 16 }, align: "left", lineHeight: 14, editable: true,
  runs: [{ text: "kata lama di sini", font, size: 12, color: "#000000" }],
  lines: [{ rect: { x: 72, y: 88, w: 200, h: 16 }, baseline: 100, size: 12, start: 0, end: 17 }],
};
const box = (text: string) => ({ rect: { x: 72, y: 300, w: 200, h: 14 }, align: "left" as const, lineHeight: 14,
  paragraphs: [[{ text, font, size: 12, color: "#ff0000" }]], layout: [] });

beforeEach(() => {
  editorStore.getState().init(info);
  textStore.setState({ status: "ready", docId: info.docId, pages: { 0: [para] }, fonts: {} });
  vi.spyOn(fontStore, "load").mockResolvedValue(arimo);
  vi.spyOn(fontStore, "peek").mockReturnValue(arimo);
  vi.spyOn(fontStore, "get").mockReturnValue(arimo);
});
afterEach(() => vi.restoreAllMocks());

describe("applyReplacements", () => {
  it("replaces in original paragraphs and text ops as one undo step", async () => {
    editorStore.getState().addObject({ id: "t", type: "text.add", pageKey: "o0", box: box("lama dan lama") } as ContentOp);
    const st = editorStore.getState();
    const matches = findMatches(buildTargets(st.doc, textStore.getState().pages), "lama", true);
    expect(matches).toHaveLength(3);
    const before = editorStore.getState().past.length;
    await applyReplacements(matches, "baru");
    const after = editorStore.getState();
    expect(after.past.length).toBe(before + 1);
    const edit = Object.values(after.doc.objects).find((o) => o.type === "text.edit") as TextEdit;
    expect(edit).toMatchObject({ pageKey: "o0", paragraphId: "g0" });
    expect(edit.box.paragraphs[0].map((r) => r.text).join("")).toBe("kata baru di sini");
    expect(edit.box.rect.y + edit.box.layout[0].baseline).toBeCloseTo(100);
    const t = after.doc.objects.t as TextAdd;
    expect(t.box.paragraphs[0]).toEqual([{ text: "baru dan baru", font, size: 12, color: "#ff0000" }]);
    expect(t.box.layout.length).toBe(1);
    editorStore.getState().undo();
    expect(Object.values(editorStore.getState().doc.objects).some((o) => o.type === "text.edit")).toBe(false);
    expect((editorStore.getState().doc.objects.t as TextAdd).box.paragraphs[0][0].text).toBe("lama dan lama");
  });

  it("replaces only the given match", async () => {
    const st = editorStore.getState();
    const [m] = findMatches(buildTargets(st.doc, textStore.getState().pages), "di", true);
    await applyReplacements([m], "DI");
    const edit = Object.values(editorStore.getState().doc.objects)[0] as TextEdit;
    expect(edit.box.paragraphs[0].map((r) => r.text).join("")).toBe("kata lama DI sini");
  });

  it("reports where a replacement ended so Find can move past a replacement containing the query", async () => {
    editorStore.getState().addObject({ id: "t", type: "text.add", pageKey: "o0", box: box("lama dan lama") } as ContentOp);
    const search = () => {
      const targets = buildTargets(editorStore.getState().doc, textStore.getState().pages);
      return { order: targets.map((x) => x.key), matches: findMatches(targets, "lama", true) };
    };
    // Original paragraph (first target): becomes a text.edit op, the next match is in the text box.
    const [para] = search().matches;
    const [r1] = await applyReplacements([para], "lama baru");
    const edit = Object.values(editorStore.getState().doc.objects).find((o) => o.type === "text.edit")!;
    expect(r1).toEqual({ key: `op:${edit.id}`, end: 14 });
    let s = search();
    let i = nextMatchIndex(s.matches, s.order, r1.key, r1.end);
    expect(s.matches[i]).toMatchObject({ key: "op:t", start: 0 });
    // Inside the text box: the next match is the box's second "lama", not the inserted one.
    const [r2] = await applyReplacements([s.matches[i]], "lama baru");
    expect(r2).toEqual({ key: "op:t", end: 9 });
    s = search();
    i = nextMatchIndex(s.matches, s.order, r2.key, r2.end);
    expect(s.matches[i]).toMatchObject({ key: "op:t", start: 14 });
  });

  it("leaves a target alone when it changed while fonts were loading", async () => {
    editorStore.getState().addObject({ id: "t", type: "text.add", pageKey: "o0", box: box("lama") } as ContentOp);
    const matches = findMatches(buildTargets(editorStore.getState().doc, textStore.getState().pages), "lama", true);
    let changed = false;
    vi.spyOn(fontStore, "load").mockImplementation(async () => {
      if (!changed) {
        changed = true;
        editorStore.getState().updateObject("t", { box: box("diketik") } as Partial<ContentOp>);
        editorStore.getState().addObject({ id: "e", type: "text.edit", pageKey: "o0", paragraphId: "g0", box: box("x") } as ContentOp);
      }
      return arimo;
    });
    const before = editorStore.getState().past.length;
    await applyReplacements(matches, "baru");
    const after = editorStore.getState();
    expect(after.past.length).toBe(before + 2); // only the two edits made meanwhile
    expect((after.doc.objects.t as TextAdd).box.paragraphs[0][0].text).toBe("diketik");
    expect(Object.values(after.doc.objects).filter((o) => o.type === "text.edit")).toHaveLength(1);
  });
});

describe("Replace All and markup", () => {
  it("deletes the markup on a replaced original paragraph in the same undo step", async () => {
    noticeStore.setState({ notice: null });
    const st = editorStore.getState();
    st.addObject({ id: "h", type: "annot.add", pageKey: "o0", kind: "highlight", quads: [{ x: 100, y: 89.2, w: 40, h: 13.8 }], color: "#ffeb3b" } as ContentOp);
    st.addObject({ id: "far", type: "annot.add", pageKey: "o0", kind: "underline", quads: [{ x: 100, y: 400, w: 40, h: 13.8 }], color: "#ffeb3b" } as ContentOp);
    st.addObject({ id: "n", type: "annot.add", pageKey: "o0", kind: "note", point: [100, 92], color: "#facc15", content: "x" } as ContentOp);
    const matches = findMatches(buildTargets(editorStore.getState().doc, textStore.getState().pages), "lama", true);
    const before = editorStore.getState().past.length;
    await applyReplacements(matches, "baru");
    const after = editorStore.getState();
    expect(after.past.length).toBe(before + 1);
    expect(after.doc.objects.h).toBeUndefined();
    expect(after.doc.objects.far && after.doc.objects.n).toBeDefined();
    expect(noticeStore.getState().notice).toEqual({ kind: "info", text: t.text.markupRemoved });
    editorStore.getState().undo();
    const undone = editorStore.getState().doc;
    expect(undone.objects.h).toBeDefined();
    expect(Object.values(undone.objects).some((o) => o.type === "text.edit")).toBe(false);
  });
});
