import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentOp, FontRef, Run, TextAdd, TextEdit } from "@edith/ops";
import type { OcrParagraph, Paragraph } from "@/lib/api";
import { fontStore, isOriginal, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { noticeStore } from "@/lib/notices";
import { t } from "@/lib/strings";
import { boxLineHeight, newBox, relayout } from "@/lib/textbox";
import { editorStore, type DocInfo } from "@/store/editor";
import { textStore } from "@/store/text";
import { moveOp, resizeOp } from "@/lib/objects";
import { afterTextCommitted, commitEditing, deleteObjectOrText, deleteSelectedParagraph, isDeletedText, materializeParagraph, paragraphPreview, paragraphStartBox, resizedParagraph, startOcrEdit, startParagraphEdit, startTextAt, textEditStore, textSessionBusy, updateTextOp, whenTextCommitted } from "./textEdit";

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

  it("stamps a new edit decorV 1 (its runs carry the original's decorations); an old unstamped op stays unstamped", async () => {
    openParagraph("Halo dunia");
    await commitEditing(runs("Halo semua"));
    expect((editorStore.getState().doc.objects.e1 as TextEdit).decorV).toBe(1);
    // An op from a draft made before decorations: edited again, it keeps behaving as it did (no stamp).
    const old = { ...(editorStore.getState().doc.objects.e1 as TextEdit) };
    delete old.decorV;
    editorStore.getState().putObjects([old]);
    textEditStore.getState().start({ id: "e1", pageKey: "o0", box: old.box, isNew: false, kind: "text.edit", paragraphId: "g3" });
    await commitEditing(runs("Halo semua lagi"));
    expect(editorStore.getState().doc.objects.e1).not.toHaveProperty("decorV");
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

  it("keeps the original font for the characters it has and uses the substitute for a new one", async () => {
    const orig = { kind: "original" as const, ref: "f7" };
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo", orig));
    expect(editorStore.getState().doc.order).toEqual([]); // unchanged
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo!", orig));
    expect((editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0].map((r) => [r.text, r.font])).toEqual([
      ["Halo", orig], ["!", { kind: "bundled", family: "Carlito", bold: false, italic: false }]]);
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

  const committed = () => (editorStore.getState().doc.objects.e1 as TextEdit).box.paragraphs[0].map((r) => [r.text, r.font]);

  it("goes original → substitute → Arimo → Noto Sans per character when the fonts are loaded (fast path)", async () => {
    gate.resolve(); fontsLoaded = true; notoOnly = "ꙮ";
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo ꙮ", orig));
    expect(committed()).toEqual([["Halo ", orig], ["ꙮ", noto]]);
  });

  it("keeps an edited paragraph's first baseline when a fallback font is taller", async () => {
    gate.resolve(); fontsLoaded = true; notoOnly = "ꙮ";
    const tall: FontMetrics = { ...notoSans, ascent: notoSans.ascent * 2 };
    const pick = (f: FontRef) => (!isOriginal(f) && f.family === "Noto Sans" ? tall : metricsOf(f));
    vi.spyOn(fontStore, "peek").mockImplementation(pick);
    vi.spyOn(fontStore, "get").mockImplementation(pick);
    const before = relayout({ ...newBox([72, 90], style), paragraphs: runs("Halo", orig) }, pick);
    textEditStore.getState().start({ id: "e1", pageKey: "o0", box: before, isNew: true, kind: "text.edit", paragraphId: "g3", initial: before.paragraphs });
    await commitEditing(runs("Halo ꙮ", orig));
    const after = (editorStore.getState().doc.objects.e1 as TextEdit).box;
    expect(after.layout[0].baseline).toBeGreaterThan(before.layout[0].baseline); // the taller line …
    expect(after.rect.y + after.layout[0].baseline).toBeCloseTo(before.rect.y + before.layout[0].baseline); // … stays put
  });

  it("does the same while fonts load (slow path)", async () => {
    notoOnly = "ꙮ";
    openParagraph("Halo", orig);
    const commit = commitEditing(runs("Halo ꙮ", orig));
    gate.resolve();
    await commit;
    expect(committed()).toEqual([["Halo ", orig], ["ꙮ", noto]]);
  });

  it("commits when a CJK pack font the fallback chose cannot load (the next fallback draws), not when the user's font can't", async () => {
    gate.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(fontStore, "cjkFamily").mockReturnValue("Noto Serif KR"); // a family no other test uses: failures are remembered
    const failing = (f: FontRef) => !isOriginal(f) && (f.family === "Noto Serif KR" || f.family === "Lato");
    const load = vi.mocked(fontStore.load).getMockImplementation()!;
    const peek = vi.mocked(fontStore.peek).getMockImplementation()!;
    const tried: string[] = [];
    vi.mocked(fontStore.load).mockImplementation(async (f) => {
      if (failing(f)) { tried.push(f.kind === "bundled" ? f.family : ""); throw new Error("404"); }
      return load(f);
    });
    vi.mocked(fontStore.peek).mockImplementation((f) => (failing(f) ? null : peek(f)));
    openParagraph("Halo", orig);
    await commitEditing(runs("Halo 변", orig));
    expect(committed()).toEqual([["Halo ", orig], ["변", noto]]);
    expect(textEditStore.getState().editing).toBeNull();
    expect(tried).toEqual(["Noto Serif KR"]);
    const lato = { kind: "bundled" as const, family: "Lato", bold: false, italic: false };
    openSession();
    await commitEditing(runs("Halo", lato));
    expect(editorStore.getState().doc.objects.t1).toBeUndefined();
    expect(textEditStore.getState().editing).not.toBeNull(); // kept editable
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

  it("textSessionBusy: while a paragraph edit starts, is open, and while its commit waits for fonts", async () => {
    expect(textSessionBusy()).toBe(false);
    fontsLoaded = false;
    gate = deferred();
    const starting = startParagraphEdit("o0", para);
    expect(textSessionBusy()).toBe(true); // fonts loading, no session yet
    gate.resolve();
    await starting;
    expect(textEditStore.getState().editing).not.toBeNull();
    expect(textSessionBusy()).toBe(true);
    fontsLoaded = false;
    gate = deferred();
    const commit = commitEditing(runs("Halo baru"));
    expect(textEditStore.getState().editing).toBeNull();
    expect(textSessionBusy()).toBe(true); // committing
    gate.resolve();
    await commit;
    expect(textSessionBusy()).toBe(false);
  });

  it("textSessionBusy clears when the paragraph's fonts fail to load", async () => {
    fontsLoaded = false;
    vi.spyOn(fontStore, "load").mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await startParagraphEdit("o0", para);
    expect(textEditStore.getState().editing).toBeNull();
    expect(textSessionBusy()).toBe(false);
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
    expect(op).toMatchObject({ type: "text.edit", paragraphId: "g2", decorV: 1 });
    expect(op.box.rect.x).toBe(82);
    expect(editorStore.getState().selection).toBe(op.id);
    editorStore.getState().undo();
    expect(editorStore.getState().doc.order).toEqual([]);
  });
});

describe("live resize of an original paragraph", () => {
  beforeEach(() => { gate.resolve(); fontsLoaded = true; });
  const para: Paragraph = {
    id: "g2", rect: { x: 72, y: 88, w: 160, h: 16 }, align: "left", lineHeight: 14, editable: true,
    runs: [{ text: "Halo dunia yang indah sekali hari ini", font, size: 14, color: "#111111" }],
    lines: [{ rect: { x: 72, y: 88, w: 160, h: 16 }, baseline: 100, size: 14, start: 0, end: 37 }],
  };

  it("the preview wraps at the width it is given, each time, and is the box a release lands", async () => {
    const base = await paragraphStartBox(para);
    const lines = (w: number) => paragraphPreview("o0", para, base, 72, w).box.layout.length;
    expect(lines(160)).toBeLessThan(lines(100));
    expect(lines(100)).toBeLessThan(lines(50));
    expect(lines(160)).toBe(lines(160)); // the base is not changed by a frame
    const live = paragraphPreview("o0", para, base, 80, 90);
    expect(live).toMatchObject({ type: "text.edit", paragraphId: "g2", pageKey: "o0" });
    expect(live.box.rect).toMatchObject({ x: 80, w: 90 }); // the frame's own width, not the box's plus the drag
    await materializeParagraph("o0", para, resizedParagraph(80, 90));
    const landed = Object.values(editorStore.getState().doc.objects)[0] as TextEdit;
    expect(landed.box).toEqual(live.box);
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
    textStore.setState({ docId: info.docId, pages: { [`${info.docId}:0`]: [g3] } });
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

  it("keeps the marks on the lines an edit leaves alone: those keep their original glyphs (LayoutLine.source)", async () => {
    gate.resolve();
    await startParagraphEdit("o0", g3);
    const e = textEditStore.getState().editing!;
    expect(e.box.paragraphs.map((p) => p[0].text)).toEqual(["Halo", "lama"]); // "lama" would fit after "Halo": a hard break
    await commitEditing([e.box.paragraphs[0], [{ ...e.box.paragraphs[1][0], text: "lamb" }]]);
    const doc = editorStore.getState().doc;
    const op = Object.values(doc.objects).find((o) => o.type === "text.edit") as TextEdit;
    expect(op.box.layout.map((l) => l.source ?? null)).toEqual([0, null]);
    expect(Object.keys(doc.objects).sort()).toEqual([op.id, "h1", "h4", "n", "s3"].sort()); // only u2 (line 2) went
    // Reopened and committed again unchanged: the same op, nothing new to undo.
    const before = editorStore.getState().past.length;
    textEditStore.getState().start({ id: op.id, pageKey: "o0", box: op.box, isNew: false, kind: "text.edit", paragraphId: "g3" });
    await commitEditing(op.box.paragraphs);
    expect(editorStore.getState().past.length).toBe(before);
  });

  it.each([
    ["moved (drag, nudge)", (op: TextEdit) => moveOp(op, 5, 0)],
    ["resized", (op: TextEdit) => resizeOp(op, { ...op.box.rect, w: op.box.rect.w + 30 })],
    ["restyled (relayout)", (op: TextEdit) => ({ box: relayout(op.box, () => metricsOf(font)) })],
  ])("removes the marks on kept lines once the edit is %s, in the same undo step, with a notice", async (_how, change) => {
    gate.resolve();
    await startParagraphEdit("o0", g3);
    const e = textEditStore.getState().editing!;
    await commitEditing([e.box.paragraphs[0], [{ ...e.box.paragraphs[1][0], text: "lamb" }]]);
    const op = Object.values(editorStore.getState().doc.objects).find((o) => o.type === "text.edit") as TextEdit;
    expect(editorStore.getState().doc.objects.h1).toBeDefined(); // on the kept line 1
    noticeStore.setState({ notice: null });
    const before = editorStore.getState().past.length;
    updateTextOp(op.id, change(op));
    const after = editorStore.getState();
    expect((after.doc.objects[op.id] as TextEdit).box.layout.every((l) => l.source == null)).toBe(true);
    expect(after.doc.objects.h1).toBeUndefined();
    expect(after.doc.order).not.toContain("h1");
    expect(Object.keys(after.doc.objects).sort()).toEqual([op.id, "h4", "n", "s3"].sort());
    expect(after.past.length).toBe(before + 1);
    expect(noticeStore.getState().notice).toEqual({ kind: "info", text: t.text.markupRemoved });
    editorStore.getState().undo();
    expect(editorStore.getState().doc.objects.h1).toBeDefined();
    expect(editorStore.getState().doc.objects[op.id]).toEqual(op);
  });

  it("leaves marks alone when the change keeps the lines (or the op is not a text.edit)", async () => {
    gate.resolve();
    await startParagraphEdit("o0", g3);
    const e = textEditStore.getState().editing!;
    await commitEditing([e.box.paragraphs[0], [{ ...e.box.paragraphs[1][0], text: "lamb" }]]);
    const op = Object.values(editorStore.getState().doc.objects).find((o) => o.type === "text.edit") as TextEdit;
    noticeStore.setState({ notice: null });
    updateTextOp("h4", { color: "#00ff00" } as Partial<ContentOp>);
    updateTextOp(op.id, { box: { ...op.box, paragraphs: op.box.paragraphs } });
    expect(editorStore.getState().doc.objects.h1).toBeDefined();
    expect(noticeStore.getState().notice).toBeNull();
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

describe("deleting text", () => {
  const g3: Paragraph = {
    id: "g3", rect: { x: 72, y: 88, w: 200, h: 30 }, align: "left", lineHeight: 14, editable: true,
    runs: [{ text: "Halo lama", font, size: 12, color: "#000000" }],
    lines: [{ rect: { x: 72, y: 89, w: 200, h: 14 }, baseline: 100, size: 12, start: 0, end: 4 },
      { rect: { x: 72, y: 103, w: 120, h: 14 }, baseline: 114, size: 12, start: 5, end: 9 }],
  };
  const g4: Paragraph = { ...g3, id: "g4", rect: { x: 72, y: 200, w: 200, h: 14 }, runs: [{ text: "Tetangga", font, size: 12, color: "#000000" }],
    lines: [{ rect: { x: 72, y: 200, w: 200, h: 14 }, baseline: 211, size: 12, start: 0, end: 8 }] };
  const ocrPara: OcrParagraph = {
    id: "ocr4", rect: { x: 72, y: 290, w: 300, h: 26 }, align: "left", lineHeight: 15, editable: true,
    runs: [{ text: "Halo dunia dua", font, size: 11, color: "#000000" }],
    lines: [{ rect: { x: 72, y: 290, w: 300, h: 12 }, baseline: 300, size: 11, start: 0, end: 10 },
      { rect: { x: 72, y: 305, w: 40, h: 12 }, baseline: 315, size: 11, start: 11, end: 14 }],
    ocr: true, confidence: 0.9, cover: { x: 70.5, y: 288.5, w: 303, h: 30 },
    covers: [{ x: 70.5, y: 288.5, w: 303, h: 15 }, { x: 70.5, y: 303.5, w: 43, h: 15 }], coverColor: "#f7f5eb", coverUniform: true,
  };
  const mark = (id: string, y: number) => ({ id, type: "annot.add", pageKey: "o0", kind: "highlight", quads: [{ x: 80, y, w: 40, h: 13.8 }], color: "#ffeb3b" }) as ContentOp;
  const edits = () => Object.values(editorStore.getState().doc.objects).filter((o) => o.type === "text.edit") as TextEdit[];
  const text = (op: { box: { paragraphs: Run[][] } }) => op.box.paragraphs.map((p) => p.map((r) => r.text).join("")).join("\n");

  beforeEach(() => {
    gate.resolve();
    fontsLoaded = true;
    textStore.setState({ docId: info.docId, pages: { [`${info.docId}:0`]: [g3, g4] }, ocr: { [`${info.docId}:0`]: { status: "ready", quality: "ok", paragraphs: [ocrPara] } } });
    editorStore.getState().addObject(mark("h1", 89.2));
    editorStore.getState().addObject(mark("h2", 199.2)); // on the neighbour
    noticeStore.setState({ notice: null });
  });

  it("Delete on a selected original paragraph: a blank text.edit over the whole paragraph, selected, one undo step; its marks go", async () => {
    const before = editorStore.getState().past.length;
    textEditStore.getState().selectParagraph({ pageKey: "o0", id: "g3" });
    expect(deleteSelectedParagraph()).toBe(true);
    await vi.waitFor(() => expect(edits()).toHaveLength(1));
    const [op] = edits();
    expect(op).toMatchObject({ paragraphId: "g3", pageKey: "o0" });
    expect(text(op)).toBe("");
    expect(op.box.paragraphs[0]).toHaveLength(1); // the style kept for typing into it again
    expect(op.box.layout).toEqual([{ baseline: expect.any(Number), segments: [] }]);
    expect(op.box.rect.y + op.box.layout[0].baseline).toBeCloseTo(100); // on the first original baseline
    expect(op.box.rect.y).toBeLessThanOrEqual(g3.rect.y);
    expect(op.box.rect.y + op.box.rect.h).toBeGreaterThanOrEqual(g3.rect.y + g3.rect.h); // its place stays a target
    const st = editorStore.getState();
    expect(st.selection).toBe(op.id);
    expect(textEditStore.getState().paragraph).toBeNull();
    expect(Object.keys(st.doc.objects).sort()).toEqual([op.id, "h2"].sort()); // the neighbour's mark stays
    expect(noticeStore.getState().notice).toEqual({ kind: "info", text: t.text.markupRemoved });
    expect(st.past.length).toBe(before + 1);
    st.undo();
    expect(Object.keys(editorStore.getState().doc.objects).sort()).toEqual(["h1", "h2"]);
  });

  it("nothing to delete without a selected paragraph, or with another tool", () => {
    expect(deleteSelectedParagraph()).toBe(false);
    textEditStore.getState().selectParagraph({ pageKey: "o0", id: "g3" });
    editorStore.getState().setTool("text");
    expect(deleteSelectedParagraph()).toBe(false);
  });

  it("every character removed in the editor deletes the text: the op stays, blank, not reverted", async () => {
    await startParagraphEdit("o0", g3);
    await commitEditing(runs(""));
    const [op] = edits();
    expect(text(op)).toBe("");
    expect(op.box.rect.y + op.box.rect.h).toBeGreaterThanOrEqual(g3.rect.y + g3.rect.h);
    // Spaces only is no text either.
    await startParagraphEdit("o0", g3);
    await commitEditing(runs("   "));
    expect(text(edits()[0])).toBe("");
  });

  it("Delete on a text.edit takes its text (one undo step, the op stays); on a deleted one it does nothing", async () => {
    await startParagraphEdit("o0", g3);
    await commitEditing(runs("Halo baru"));
    const [op] = edits();
    const before = editorStore.getState().past.length;
    deleteObjectOrText(op.id);
    const blank = editorStore.getState().doc.objects[op.id] as TextEdit;
    expect(text(blank)).toBe("");
    expect(isDeletedText(blank)).toBe(true);
    expect(editorStore.getState().past.length).toBe(before + 1);
    deleteObjectOrText(op.id); // already deleted: not the op (which would bring the original back)
    expect(editorStore.getState().doc.objects[op.id]).toEqual(blank);
    expect(editorStore.getState().past.length).toBe(before + 1);
    editorStore.getState().undo();
    expect(text(editorStore.getState().doc.objects[op.id] as TextEdit)).toBe("Halo baru");
    deleteObjectOrText("h2"); // any other object goes
    expect(editorStore.getState().doc.objects.h2).toBeUndefined();
  });

  it("an OCR paragraph: a blank text.ocr_edit that keeps its covers; Delete on an OCR edit takes its text", async () => {
    textEditStore.getState().selectParagraph({ pageKey: "o0", id: "ocr4" });
    expect(deleteSelectedParagraph()).toBe(true);
    await vi.waitFor(() => expect(Object.values(editorStore.getState().doc.objects).some((o) => o.type === "text.ocr_edit")).toBe(true));
    const op = Object.values(editorStore.getState().doc.objects).find((o) => o.type === "text.ocr_edit") as Extract<ContentOp, { type: "text.ocr_edit" }>;
    expect(op).toMatchObject({ paragraphId: "ocr4", cover: ocrPara.cover, covers: ocrPara.covers, coverColor: "#f7f5eb" });
    expect(text(op)).toBe("");
    expect(op.box.rect.y + op.box.rect.h).toBeGreaterThanOrEqual(ocrPara.cover.y + ocrPara.cover.h);
    expect(editorStore.getState().selection).toBe(op.id);
    editorStore.getState().undo();
    await startOcrEdit("o0", ocrPara);
    await commitEditing(runs("Baru"));
    const edited = Object.values(editorStore.getState().doc.objects).find((o) => o.type === "text.ocr_edit")!;
    deleteObjectOrText(edited.id);
    expect(isDeletedText(editorStore.getState().doc.objects[edited.id])).toBe(true);
  });
});

describe("paragraphs OCR read (M5d)", () => {
  beforeEach(() => { gate.resolve(); fontsLoaded = true; });
  const ocrPara: OcrParagraph = {
    id: "ocr4", rect: { x: 72, y: 290, w: 300, h: 12 }, align: "left", lineHeight: 15, editable: true,
    runs: [{ text: "Halo dunia", font, size: 11, color: "#000000" }],
    lines: [{ rect: { x: 72, y: 290, w: 300, h: 12 }, baseline: 300, size: 11, start: 0, end: 10 }],
    ocr: true, confidence: 0.9, cover: { x: 70.5, y: 288.5, w: 303, h: 15 }, covers: [{ x: 70.5, y: 288.5, w: 303, h: 15 }], coverColor: "#f7f5eb", coverUniform: true,
  };

  it("an edit becomes a text.ocr_edit with its cover, first baseline in place, one undo step; undo brings the picture back", async () => {
    await startOcrEdit("o0", ocrPara);
    const e = textEditStore.getState().editing!;
    expect(e).toMatchObject({ kind: "text.ocr_edit", paragraphId: "ocr4", isNew: true, ocr: { cover: ocrPara.cover, coverColor: "#f7f5eb" } });
    expect(e.box.rect.y + e.box.layout[0].baseline).toBeCloseTo(300);
    await commitEditing(runs("Halo dunia baru"));
    const ops = Object.values(editorStore.getState().doc.objects);
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<ContentOp, { type: "text.ocr_edit" }>;
    expect(op).toMatchObject({ type: "text.ocr_edit", pageKey: "o0", paragraphId: "ocr4", cover: ocrPara.cover, covers: ocrPara.covers, coverColor: "#f7f5eb" });
    expect(op.box.rect.y + op.box.layout[0].baseline).toBeCloseTo(300);
    expect(editorStore.getState().selection).toBe(op.id);
    editorStore.getState().undo();
    expect(editorStore.getState().doc.objects).toEqual({});
    editorStore.getState().redo();
    expect(Object.keys(editorStore.getState().doc.objects)).toEqual([op.id]);
  });

  it("opening an edited OCR paragraph again edits its op; opened and left unchanged adds nothing", async () => {
    await startOcrEdit("o0", ocrPara);
    await commitEditing(textEditStore.getState().editing!.box.paragraphs);
    expect(editorStore.getState().doc.objects).toEqual({});
    await startOcrEdit("o0", ocrPara);
    await commitEditing(runs("Lain"));
    const [id] = Object.keys(editorStore.getState().doc.objects);
    await startOcrEdit("o0", ocrPara);
    expect(textEditStore.getState().editing).toMatchObject({ id, isNew: false, kind: "text.ocr_edit" });
    await commitEditing(runs("Lain lagi"));
    expect(Object.keys(editorStore.getState().doc.objects)).toEqual([id]);
  });

  it("rejects an OCR session without its cover", () => {
    expect(() => textEditStore.getState().start({ id: "x", pageKey: "o0", box: newBox([0, 0], style), isNew: true, kind: "text.ocr_edit", paragraphId: "ocr1" }))
      .toThrow(/cover/);
  });
});
