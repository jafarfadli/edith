import { beforeEach, describe, expect, it } from "vitest";
import { editorStore, type DocInfo } from "@/store/editor";
import { applyCrop, clearCrop, cropStore } from "./cropStore";

const info: DocInfo = {
  docId: "D".repeat(22), sha256: "s", fileName: "a.pdf",
  pages: [0, 1].map((i) => ({ index: i, width: i ? 300 : 600, height: 800, rotation: 0, hasText: true })),
};

beforeEach(() => { editorStore.getState().init(info); cropStore.getState().close(); });

describe("crop editing", () => {
  it("starts from the page inset by 5 %", () => {
    cropStore.getState().open("o0");
    expect(cropStore.getState()).toMatchObject({ pageKey: "o0", rect: { x: 30, y: 40, w: 540, h: 720 } });
  });

  it("applies to this page or to all pages, clamped to each", () => {
    cropStore.getState().open("o0");
    cropStore.getState().setRect({ x: 100, y: 100, w: 400, h: 500 });
    applyCrop(false);
    expect(editorStore.getState().doc.pages.map((p) => p.crop ?? null)).toEqual([{ x: 100, y: 100, w: 400, h: 500 }, null]);
    expect(cropStore.getState().pageKey).toBeNull();
    cropStore.getState().open("o0"); // resumes from the existing crop
    expect(cropStore.getState().rect).toEqual({ x: 100, y: 100, w: 400, h: 500 });
    applyCrop(true);
    expect(editorStore.getState().doc.pages[1].crop).toEqual({ x: 100, y: 100, w: 200, h: 500 });
  });

  it("removes a crop", () => {
    editorStore.getState().setCrop(["o0"], { x: 1, y: 1, w: 100, h: 100 });
    cropStore.getState().open("o0");
    clearCrop();
    expect(editorStore.getState().doc.pages[0].crop).toBeUndefined();
  });
});
