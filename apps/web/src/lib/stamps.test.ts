import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import presets from "@edith/ops/stamp-presets.json";
import { metricsFromBuffer, textWidth } from "@/lib/fonts";
import { borderWidth, STAMP_PRESETS, STAMPS_EN, STAMPS_ID, stampBorder, stampDate, stampLayout, stampRect, stampTexts, stampTime, STAMP_MARGIN } from "@/lib/stamps";

const bold = metricsFromBuffer(readFileSync(path.resolve(__dirname, "../../../../packages/fonts/files/Arimo-Bold.ttf")));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

describe("stamp presets", () => {
  it("equal the shared JSON table (ids, labels, colours)", () => {
    expect(STAMP_PRESETS).toEqual(presets);
    expect(STAMP_PRESETS).toHaveLength(34);
    expect(new Set(STAMP_PRESETS.map((p) => p.id)).size).toBe(34);
  });
  it("English is the first 17, Indonesian the last 17, with matching colours", () => {
    expect(STAMPS_EN).toEqual(presets.slice(0, 17));
    expect(STAMPS_ID).toEqual(presets.slice(17));
    STAMPS_ID.forEach((p, i) => expect(p.color).toBe(STAMPS_EN[i].color));
  });
});

describe("stamps", () => {
  it("takes preset labels from the shared table", () => {
    expect(stampTexts({ preset: "not-for-public-release" })).toEqual(["NOT FOR PUBLIC RELEASE"]);
    expect(stampTexts({ preset: "disetujui" })).toEqual(["DISETUJUI"]);
  });

  it("joins date and time on a second line", () => {
    expect(stampTexts({ custom: { text: "DIPERIKSA", date: "05/11/2026", time: "14:30" } })).toEqual(["DIPERIKSA", "05/11/2026 14:30"]);
    expect(stampTexts({ custom: { text: "OK", date: null, time: "09:00" } })).toEqual(["OK", "09:00"]);
    expect(stampTexts({ custom: { text: "OK" } })).toEqual(["OK"]);
  });

  it("lays out like the bake (same numbers as apps/api/tests/test_bake_marks.py)", () => {
    const [one] = stampLayout(140, 40, ["APPROVED"], bold);
    expect([r4(one.size), r4(one.x), r4(one.baseline)]).toEqual([20, 13.93, 26.88]);
    const [label, sub] = stampLayout(160, 54, ["DIPERIKSA", "05/11/2026 14:30"], bold);
    expect([r4(label.size), r4(label.x), r4(label.baseline)]).toEqual([19.44, 27.1232, 27]);
    expect([r4(sub.size), r4(sub.x), r4(sub.baseline)]).toEqual([10.8, 37.6856, 42.12]);
    const [narrow] = stampLayout(120, 40, ["NOT FOR PUBLIC RELEASE"], bold);
    expect([r4(narrow.size), r4(narrow.x)]).toEqual([7.8897, 6.8]);
    expect([borderWidth(140, 40), borderWidth(10, 4)]).toEqual([2, 0.5]);
  });

  it("insets the border by half its width", () => {
    expect(stampBorder(140, 40)).toEqual({ x: 1, y: 1, w: 138, h: 38, width: 2, radius: 0.2 * 38 });
  });

  it("sizes a new stamp to its label, centred on the page", () => {
    const r = stampRect({ preset: "approved" }, bold, { width: 595, height: 842 });
    expect(r.h).toBe(40);
    expect(r.w).toBeCloseTo(textWidth("APPROVED", bold, 20) + 2 * (0.12 * 40 + 2) + 1, 6);
    expect(r.x).toBeCloseTo((595 - r.w) / 2, 6);
    const [line] = stampLayout(r.w, r.h, ["APPROVED"], bold);
    expect(line.size).toBe(20); // the label is not shrunk
    expect(stampRect({ custom: { text: "OK", date: "05/11/2026" } }, bold, { width: 595, height: 842 }).h).toBe(54);
  });

  it("formats the date and time lines", () => {
    const d = new Date(2026, 10, 5, 9, 7);
    expect([stampDate(d), stampTime(d)]).toEqual(["05/11/2026", "09:07"]);
  });

  it("clamps a wide stamp to the page width minus margins, with the text shrunk to fit", () => {
    const page = { width: 200, height: 300 };
    const kind = { custom: { text: "TANDA TANGAN DI SINI DAN PARAF", date: "05/11/2026", time: "14:30" } };
    const r = stampRect(kind, bold, page);
    expect(r.w).toBe(page.width - 2 * STAMP_MARGIN);
    expect(r.x).toBe(STAMP_MARGIN);
    expect(r.x + r.w).toBeLessThanOrEqual(page.width);
    const [label] = stampLayout(r.w, r.h, stampTexts(kind), bold);
    expect(label.size).toBeLessThan(0.36 * r.h);
    expect(label.x).toBeGreaterThanOrEqual(0);
    // a very narrow page still gets a stamp inside it
    const tiny = stampRect({ preset: "approved" }, bold, { width: 40, height: 100 });
    expect(tiny.x).toBeGreaterThanOrEqual(0);
    expect(tiny.x + tiny.w).toBeLessThanOrEqual(40);
    // a short label on a normal page is untouched
    expect(stampRect({ preset: "approved" }, bold, { width: 595, height: 842 }).w).toBeLessThan(200);
  });
});
