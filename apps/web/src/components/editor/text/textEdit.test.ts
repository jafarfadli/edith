import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fontStore, metricsFromBuffer, type FontMetrics } from "@/lib/fonts";
import { newBox } from "@/lib/textbox";
import { editorStore, type DocInfo } from "@/store/editor";
import { afterTextCommitted, commitEditing, startTextAt, textEditStore, whenTextCommitted } from "./textEdit";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "abc", fileName: "a.pdf",
  pages: [{ index: 0, width: 595, height: 842, rotation: 0, hasText: true }],
};
const arimo = metricsFromBuffer(readFileSync(path.resolve(__dirname, "../../../../../../packages/fonts/files/Arimo-Regular.ttf")));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

let fontsLoaded = false;
let gate: ReturnType<typeof deferred>;

beforeEach(() => {
  fontsLoaded = false;
  gate = deferred();
  editorStore.getState().init(info);
  textEditStore.setState({ editing: null });
  vi.spyOn(fontStore, "load").mockImplementation(async () => { await gate.promise; fontsLoaded = true; return arimo; });
  vi.spyOn(fontStore, "peek").mockImplementation(() => (fontsLoaded ? arimo : null));
  vi.spyOn(fontStore, "get").mockImplementation((): FontMetrics => {
    if (!fontsLoaded) throw new Error("font not loaded");
    return arimo;
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const style = { family: "Arimo", bold: false, italic: false, size: 14, color: "#111111", align: "left" as const };
function openSession(id = "t1") {
  textEditStore.getState().start({ id, pageKey: "o0", box: newBox([100, 400], style), isNew: true });
}

describe("text commit while fonts load", () => {
  it("whenTextCommitted resolves only after the op is in the document", async () => {
    openSession();
    const commit = commitEditing("Halo");
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

  it("does not start a new session during the pending window, and does afterwards", async () => {
    openSession();
    const commit = commitEditing("Halo");
    startTextAt("o0", [10, 10]);
    expect(textEditStore.getState().editing).toBeNull();
    gate.resolve();
    await commit;
    startTextAt("o0", [10, 10]);
    expect(textEditStore.getState().editing).not.toBeNull();
  });

  it("undo requested during the pending window runs after the box landed", async () => {
    openSession();
    const commit = commitEditing("Halo");
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
    const commit = commitEditing("Halo");
    editorStore.getState().setTool("text");
    textEditStore.getState().start({ id: "t2", pageKey: "o0", box: newBox([5, 5], style), isNew: true });
    gate.resolve();
    await commit;
    expect(editorStore.getState().doc.objects.t1).toBeDefined();
    expect(editorStore.getState().tool).toBe("text");
  });
});
