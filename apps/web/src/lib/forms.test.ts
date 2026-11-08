import { describe, expect, it } from "vitest";
import type { FormField } from "@/lib/api";
import { fieldFontSize, fieldValue, isEditable } from "@/lib/forms";

const field = (p: Partial<FormField>): FormField => ({
  name: "f", type: "text", value: "", onState: null, options: null, page: 0, rect: { x: 0, y: 0, w: 100, h: 20 },
  readOnly: false, multiline: false, fontSize: 0, ...p,
});

describe("forms", () => {
  const merah = field({ name: "warna", type: "radio", value: "Off", onState: "Merah" });
  const biru = field({ name: "warna", type: "radio", value: "Biru", onState: "Biru" });
  const all = [merah, biru];

  it("shows the PDF's value until the user sets one", () => {
    expect(fieldValue(field({ value: "awal" }), undefined, [])).toBe("awal");
    expect(fieldValue(field({ value: "awal" }), { f: "baru" }, [])).toBe("baru");
    expect(fieldValue(field({ type: "checkbox", value: "Yes", onState: "Yes" }), {}, [])).toBe(true);
    expect(fieldValue(field({ type: "checkbox", value: "Off", onState: "Yes" }), {}, [])).toBe(false);
    expect(fieldValue(field({ type: "checkbox", value: "Off", onState: "Yes" }), { f: true }, [])).toBe(true);
  });

  it("reads a radio group's value from the chosen button", () => {
    expect(fieldValue(merah, {}, all)).toBe("Biru");
    expect(fieldValue(merah, { warna: "Merah" }, all)).toBe("Merah");
    expect(fieldValue(merah, {}, [merah, { ...biru, value: "Off" }])).toBe("Off");
  });

  it("knows which fields get an input and their font size", () => {
    expect([isEditable(field({})), isEditable(field({ type: "button" })), isEditable(field({ readOnly: true }))]).toEqual([true, false, false]);
    expect(fieldFontSize(field({ fontSize: 11 }))).toBe(11);
    expect(fieldFontSize(field({}))).toBe(13);
    expect(fieldFontSize(field({ multiline: true, rect: { x: 0, y: 0, w: 100, h: 60 } }))).toBe(12);
  });
});
