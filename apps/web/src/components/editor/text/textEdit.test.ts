import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentOp, FontRef, Run, TextAdd, TextEdit } from "@edith/ops";
import type { Paragraph } from "@/lib/api";
import { fontStore, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { noticeStore } from "@/lib/notices";
import { t } from "@/lib/strings";
import { boxLineHeight, newBox } from "@/lib/textbox";
import { editorStore, type DocInfo } from "@/store/editor";
import { textStore } from "@/store/text";
import { afterTextCommitted, commitEditing, materializeParagraph, startParagraphEdit, startTextAt, textEditStore, whenTextCommitted } from "./textEdit";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "abc", fileName: "a.pdf",
  pages: [{ index: 0, width: 595, height: 842, rotation: 0, hasText: true }],
};
const arimo = metricsFromBuffer(readFileSync(path.resolve(__dirname, "../../../../../../packages/fonts/files/Arimo-Regular.ttf")));
/** An "original" font that only has the glyphs of "Halo ". */
const original: FontMetrics = { ...arimo, hasGlyph: (cp) => "Halo ".includes(String.fromCodePoint(cp)) };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

let fontsLoaded = false;
let gate: ReturnType<typeof deferred>;
/** Characters only Noto Sans has (the substitute Carlito and Arimo lack them). */
let notoOnly = "";
const limited = (m: FontMetrics): FontMetrics => ({ ...m, hasGlyph: (cp) => !notoOnly.includes(String.fromCodePoint(cp)) && (m.hasGlyph?.(cp) ?? true) });
const notoSans: FontMetrics = { ...arimo, hasGlyph: () => true };
const metricsOf = (f: FontRef) => (isOriginal(f) ? original : f.family === "Noto Sans" ? notoSans : limited(arimo));

beforeEach(() => {
  fontsLoaded = false;
  notoOnly = "";
  gate = deferred();
  editorStore.getState().init(info);
  textEditStore.setState({ editing: null, current: null, paragraph: null });
  textStore.setState({ fonts: { f7: { ref: "f7", name: "Calibri", embedded: true, format: "ttf", reusable: true, family: "calibri", bold: false, italic: false, substitute: { kind: "bundled", family: "Carlito", bold: false, italic: false } } } });
  vi.spyOn(fontStore, "load").mockImplementation(async (f) => { await gate.promise; fontsLoaded = true; return metricsOf(f); });
  vi.spyOn(fontStore, "peek").mockImplementation((f) => (fontsLoaded ? metricsOf(f) : null));
  vi.spyOn(fontStore, "get").mockImplementation((f): FontMetrics => {
    if (!fontsLoaded) throw new Error("font not loaded");
    return metricsOf(f);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const style = { family: "Arimo", bold: false, italic: false, size: 14, color: "#111111", align: "left" as const };
const font = { kind: "bundled" as const, family: "Arimo", bold: false, italic: false };
const runs = (text: string, f: FontRef = font): Run[][] => [[{ text, font: f, size: 14, color: "#111111" }]];

function openSession(id = "t1") {
  textEditStore.getState().start({ id, pageKey: "o0", box: newBox([100, 400], style), isNew: true, kind: "text.add" });
}

function openParagraph(text: string, f: FontRef = font) {
  const box = { ...newBox([72, 90], style), paragraphs: runs(text, f) };
  textEditStore.getState().start({ id: "e1", pageKey: "o0", box, isNew: true, kind: "text.edit", paragraphId: "g3", initial: box.paragraphs });
}

describe("text commit while fonts load", () => {
  it("whenTextCommitted resolves only after the op is in the document", async () => {
    openSession();
    const commit = commitEditing(runs("Halo"));
    expect(editorStore.getState().doc.objects.t1).toBeUndefined();

    let settled = false;
    const waiter = whenTextCommitted().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve();
    await waiter;
    expect(editorStore.getState().doc.objects.t1).toBeDefined();
    await commit;
    expect(editorStore.getState().selection).toBe("t1");
  });

  it("whenTextCommitted resolves immediately when nothing is pending", async () => {
    await expect(whenTextCommitted()).resolves.toBeUndefined();
  });

  it("does not start a new box during the pending window, and does afterwards with the text tool", async () => {
    openSession();
    editorStore.getState().setTool("text");
    const commit = commitEditing(runs("Halo"));
    startTextAt("o0", [10, 10]);
    expect(textEditStore.getState().editing).toBeNull();
    gate.resolve();
    await commit;
    startTextAt("o0", [10, 10]); // the commit switched to the select tool
    expect(textEditStore.getState().editing).toBeNull();
    editorStore.getState().setTool("text");
    startTextAt("o0", [10, 10]);
    expect(textEditStore.getState().editing).not.toBeNull();
  });

  it("undo requested during the pending window runs after the box landed", async () => {
    openSession();
    const commit = commitEditing(runs("Halo"));
    afterTextCommitted(() => editorStore.getState().undo());
    gate.resolve();
    await commit;
    await whenTextCommitted();
    await Promise.resolve();
    expect(editorStore.getState().doc.objects.t1).toBeUndefined(); // added, then undone, in that order
    editorStore.getState().redo();
    expect(editorStore.getState().doc.objects.t1).toBeDefined();
  });

  it("leaves tool/selection alone if another session started meanwhile", async () => {
    openSession();
    const commit = commitEditing(runs("Halo"));
    editorStore.getState().setTool("text");
    textEditStore.getState().start({ id: "t2", pageKey: "o0", box: newBox([5, 5], style), isNew: true, kind: "text.add" });
    gate.resolve();
    await commit;
    expect(editorStore.getState().doc.objects.t1).toBeDefined();
    expect(editorStore.getState().tool).toBe("text");
  });
});

describe("editing an original paragraph", () => {
  beforeEach(() => { gate.resolve(); fontsLoaded = true; });

  it("adds a text.edit op for the paragraph, as one undo step", async () => {
    openParagraph("Halo dunia");
    await commitEditing(runs("Halo semua"));
    const op = editorStore.getState().doc.objects.e1 as TextEdit;
    expect(op).toMatchObject({ type: "text.edit", pageKey: "o0", paragraphId: "g3" });
    expect(op.box.layout.map((l) => l.segments.map((s) => s.text).join(""))).toEqual(["Halo semua"]);
    editorStore.getState().undo();
    expect(editorStore.getState().doc.objects.e1).toBeUndefined();
  });

  it("adds nothing when the text did not change", async () => {
    openParagraph("Halo dunia");
    await commitEditing(runs("Halo dunia"));
    expect(editorStore.getState().doc.order).toEqual([]);
  });

  it("keeps an emptied paragraph as an op (the original text is removed)", async () => {
    openParagraph("Halo dunia");
    await commitEditing(runs(""));
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.layout).toEqual([{ baseline: expect.any(Number), segments: [] }]);
  });

  it("swaps an original font for its substitute when a new character has no glyph", async () => {
    const orig = { kind: "original" as const, ref: "f7" };
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo", orig));
    expect(editorStore.getState().doc.order).toEqual([]); // unchanged
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo!", orig));
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0][0].font)
      .toEqual({ kind: "bundled", family: "Carlito", bold: false, italic: false });
  });
});

describe("rich text boxes", () => {
  beforeEach(() => { gate.resolve(); fontsLoaded = true; });

  it("a text box's line height follows its largest run size", async () => {
    openSession();
    const big = { text: "besar", font, size: 30, color: "#111111" };
    await commitEditing([[...runs("Halo ")[0], big]]);
    const op = editorStore.getState().doc.objects.t1 as TextAdd;
    expect(op.box.lineHeight).toBe(36);
    expect(op.box.paragraphs[0].map((r) => r.size)).toEqual([14, 30]);
  });

  it("an original paragraph keeps its line spacing", async () => {
    openParagraph("Halo dunia");
    textEditStore.getState().update({ ...textEditStore.getState().editing!.box, lineHeight: 15 });
    await commitEditing([[{ text: "Halo dunia", font, size: 30, color: "#111111" }]]);
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.lineHeight).toBe(15);
  });

  it("boxLineHeight ignores empty runs unless all are empty", () => {
    expect(boxLineHeight([[{ text: "", font, size: 40, color: "#000000" }, { text: "a", font, size: 10, color: "#000000" }]])).toBe(12);
    expect(boxLineHeight([[{ text: "", font, size: 20, color: "#000000" }]])).toBe(24);
  });
});

describe("font fallback on commit", () => {
  const orig = { kind: "original" as const, ref: "f7" };
  const noto = { kind: "bundled", family: "Noto Sans", bold: false, italic: false };

  it("goes original → substitute → Arimo → Noto Sans when the fonts are loaded (fast path)", async () => {
    gate.resolve(); fontsLoaded = true; notoOnly = "ꙮ";
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo ꙮ", orig));
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0][0].font).toEqual(noto);
  });

  it("does the same while fonts load (slow path)", async () => {
    notoOnly = "ꙮ";
    openParagraph("Halo", orig);
    const commit = commitEditing(runs("Halo ꙮ", orig));
    gate.resolve();
    await commit;
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0][0].font).toEqual(noto);
  });
});

describe("session start", () => {
  it("rejects a text.edit session without a paragraph id", () => {
    expect(() => textEditStore.getState().start({ id: "x", pageKey: "o0", box: newBox([0, 0], style), isNew: true, kind: "text.edit" }))
      .toThrow(/paragraphId/);
  });
});

describe("original paragraphs", () => {
  beforeEach(() => { gate.resolve(); fontsLoaded = true; });
  const para: Paragraph = {
    id: "g2", rect: { x: 72, y: 88, w: 120, h: 16 }, align: "left", lineHeight: 14, editable: true,
    runs: [{ text: "Halo dunia", font, size: 14, color: "#111111" }],
    lines: [{ rect: { x: 72, y: 88, w: 120, h: 16 }, baseline: 100, size: 14, start: 0, end: 10 }],
  };

  it("startParagraphEdit opens a session on the paragraph's own lines", async () => {
    await startParagraphEdit("o0", para);
    const e = textEditStore.getState().editing!;
    expect(e).toMatchObject({ kind: "text.edit", paragraphId: "g2", pageKey: "o0", isNew: true });
    expect(e.box.rect.y + e.box.layout[0].baseline).toBeCloseTo(100);
    expect(e.initial).toEqual(e.box.paragraphs);
  });

  it("startParagraphEdit reopens the paragraph's existing op", async () => {
    await materializeParagraph("o0", para, (b) => b);
    const id = editorStore.getState().selection!;
    await startParagraphEdit("o0", para);
    expect(textEditStore.getState().editing).toMatchObject({ id, isNew: false, kind: "text.edit" });
  });

  it("materializeParagraph adds a moved text.edit op, selected, in one undo step", async () => {
    await materializeParagraph("o0", para, (b) => ({ ...b, rect: { ...b.rect, x: b.rect.x + 10 } }));
    const op = Object.values(editorStore.getState().doc.objects)[0] as TextEdit;
    expect(op).toMatchObject({ type: "text.edit", paragraphId: "g2" });
    expect(op.box.rect.x).toBe(82);
    expect(editorStore.getState().selection).toBe(op.id);
    editorStore.getState().undo();
    expect(editorStore.getState().doc.order).toEqual([]);
  });
});

describe("markup over an edited paragraph", () => {
  const g3: Paragraph = {
    id: "g3", rect: { x: 72, y: 88, w: 200, h: 30 }, align: "left", lineHeight: 14, editable: true,
    runs: [{ text: "Halo lama", font, size: 12, color: "#000000" }],
    lines: [{ rect: { x: 72, y: 89, w: 200, h: 14 }, baseline: 100, size: 12, start: 0, end: 4 },
      { rect: { x: 72, y: 103, w: 120, h: 14 }, baseline: 114, size: 12, start: 5, end: 9 }],
  };
  const mark = (id: string, kind: "highlight" | "underline" | "strike", y: number, pageKey = "o0") =>
    ({ id, type: "annot.add", pageKey, kind, quads: [{ x: 80, y, w: 40, h: 13.8 }], color: "#ffeb3b" }) as ContentOp;
  const note = { id: "n", type: "annot.add", pageKey: "o0", kind: "note", point: [90, 95], color: "#facc15", content: "x" } as ContentOp;

  beforeEach(() => {
    textStore.setState({ pages: { 0: [g3] } });
    fontsLoaded = true;
    const st = editorStore.getState();
    // On line 1, on line 2, on the next paragraph below (baseline 128), on another page; and a note.
    for (const op of [mark("h1", "highlight", 89.2), mark("u2", "underline", 103.2), mark("s3", "strike", 117.2),
      mark("h4", "highlight", 89.2, "o1"), note]) st.addObject(op);
    noticeStore.setState({ notice: null });
  });

  it("deletes the markup on the paragraph's original lines in the same undo step, with a notice", async () => {
    const before = editorStore.getState().past.length;
    openParagraph("Halo lama");
    await commitEditing(runs("Halo baru"));
    const after = editorStore.getState();
    expect(after.doc.objects.e1).toBeDefined();
    expect(Object.keys(after.doc.objects).sort()).toEqual(["e1", "h4", "n", "s3"]);
    expect(after.past.length).toBe(before + 1);
    expect(noticeStore.getState().notice).toEqual({ kind: "info", text: t.text.markupRemoved });
    editorStore.getState().undo();
    const undone = editorStore.getState().doc;
    expect(undone.objects.e1).toBeUndefined();
    expect(Object.keys(undone.objects).sort()).toEqual(["h1", "h4", "n", "s3", "u2"]);
  });

  it("also when the paragraph is only moved (materialized), in one undo step", async () => {
    gate.resolve();
    const before = editorStore.getState().past.length;
    await materializeParagraph("o0", g3, (b) => ({ ...b, rect: { ...b.rect, x: b.rect.x + 10 } }));
    const after = editorStore.getState();
    const moved = Object.values(after.doc.objects).find((o) => o.type === "text.edit") as TextEdit;
    expect(moved).toMatchObject({ paragraphId: "g3" });
    expect(Object.keys(after.doc.objects).sort()).toEqual([moved.id, "h4", "n", "s3"].sort());
    expect(after.past.length).toBe(before + 1);
    expect(noticeStore.getState().notice).toEqual({ kind: "info", text: t.text.markupRemoved });
    editorStore.getState().undo();
    expect(Object.keys(editorStore.getState().doc.objects).sort()).toEqual(["h1", "h4", "n", "s3", "u2"]);
  });

  it("also when an existing text.edit is edited again, and no notice when nothing was removed", async () => {
    openParagraph("Halo lama");
    await commitEditing(runs("Halo baru"));
    noticeStore.setState({ notice: null });
    editorStore.getState().addObject(mark("h5", "highlight", 89.2));
    const before = editorStore.getState().past.length;
    textEditStore.getState().start({ id: "e1", pageKey: "o0", box: (editorStore.getState().doc.objects.e1 as TextEdit).box, isNew: false, kind: "text.edit", paragraphId: "g3" });
    await commitEditing(runs("Halo lagi"));
    expect(editorStore.getState().doc.objects.h5).toBeUndefined();
    expect(editorStore.getState().past.length).toBe(before + 1);
    editorStore.getState().undo();
    expect(editorStore.getState().doc.objects.h5).toBeDefined();
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0][0].text).toBe("Halo baru");
    noticeStore.setState({ notice: null });
    openSession("t9");
    await commitEditing(runs("Halo"));
    expect(noticeStore.getState().notice).toBeNull(); // a new text box removes nothing
  });
});
