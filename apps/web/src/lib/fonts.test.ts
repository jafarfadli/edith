import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { charOffsets, cssFamily, fontKey, metricsFromBuffer, textWidth } from "@/lib/fonts";

const ttf = (name: string) => readFileSync(path.resolve(__dirname, "../../../../packages/fonts/files", name));

describe("fonts", () => {
  const arimo = metricsFromBuffer(ttf("Arimo-Regular.ttf"));

  it("reads metrics", () => {
    expect(arimo.unitsPerEm).toBe(2048);
    expect(arimo.ascent).toBeGreaterThan(0);
    expect(arimo.descent).toBeGreaterThan(0);
  });

  it("measures without kerning, with PDF-quantized widths (floor of 1/1000 em)", () => {
    // Arimo "A" = 1366/2048 em = 666.99 milli-em → 666 → 13.32 pt at 20 pt, as stored in the baked PDF.
    expect(textWidth("A", arimo, 20)).toBeCloseTo(13.32, 6);
    expect(textWidth("AV", arimo, 20)).toBeCloseTo(textWidth("A", arimo, 20) + textWidth("V", arimo, 20), 6);
  });

  it("char offsets accumulate", () => {
    const o = charOffsets("AVA", arimo, 10);
    expect(o[0]).toBe(0);
    expect(o[2]).toBeCloseTo(textWidth("AV", arimo, 10));
  });

  it("keys", () => {
    const f = { kind: "bundled" as const, family: "Tinos", bold: true, italic: false };
    expect(fontKey(f)).toBe("Tinos-bold");
    expect(cssFamily({ ...f, bold: false })).toBe("edith-Tinos-regular");
  });
});
