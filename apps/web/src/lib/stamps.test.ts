import { describe, expect, it } from "vitest";
import presets from "@edith/ops/stamp-presets.json";
import { STAMP_PRESETS, STAMPS_EN, STAMPS_ID } from "@/lib/stamps";

describe("stamp presets", () => {
  it("equal the shared JSON table (ids, labels, colours)", () => {
    expect(STAMP_PRESETS).toEqual(presets);
    expect(STAMP_PRESETS).toHaveLength(34);
  });
  it("English is the first 17, Indonesian the last 17, with matching colours", () => {
    expect(STAMPS_EN).toEqual(presets.slice(0, 17));
    expect(STAMPS_ID).toEqual(presets.slice(17));
    STAMPS_ID.forEach((p, i) => expect(p.color).toBe(STAMPS_EN[i].color));
  });
});
