import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FontRef, Run, TextEdit } from "@edith/ops";
import { fontStore, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { newBox } from "@/lib/textbox";
import { editorStore, type DocInfo } from "@/store/editor";
import { textStore } from "@/store/text";
import { afterTextCommitted, boxLineHeight, commitEditing, startTextAt, textEditStore, whenTextCommitted } from "./textEdit";

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
const metricsOf = (f: FontRef) => (isOriginal(f) ? original : arimo);

beforeEach(() => {
  fontsLoaded = false;
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
    const op = editorStore.getState().doc.objects.t1 as TextEdit;
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
