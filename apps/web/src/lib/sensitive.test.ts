import { describe, expect, it } from "vitest";
import type { CharLine } from "./markup";
import { findSensitive, isNik } from "./sensitive";

/** A line of `text`, each character 5 pt wide from x = 100. */
const line = (text: string, baseline = 200): CharLine =>
  ({ text, boxes: Array.from(text).map((_, i) => [100 + i * 5, 105 + i * 5] as [number, number]), baseline, size: 10 });

const kinds = (text: string) => findSensitive([line(text)]).map((f) => [f.kind, f.text]);

describe("findSensitive", () => {
  it("finds a NIK, plain or grouped, and only a real one", () => {
    expect(kinds("NIK : 3201234508910004")).toEqual([["nik", "3201234508910004"]]);
    expect(kinds("NIK 3201 2345 0891 0004")).toEqual([["nik", "3201 2345 0891 0004"]]);
    expect(kinds("Kode 9999999999999999")).toEqual([]); // province 99, month 99
    expect(isNik("3201230508910004")).toBe(true); // a man born on the 5th; the ones above, a woman (day + 40)
    expect(isNik("3201233208910004")).toBe(false); // day 32
  });

  it("finds NPWP, mobile numbers and email", () => {
    expect(kinds("NPWP 01.234.567.8-901.234")).toEqual([["npwp", "01.234.567.8-901.234"]]);
    expect(kinds("HP 0812-3456-7890 / +62 812 3456 789")).toEqual([["phone", "0812-3456-7890"], ["phone", "+62 812 3456 789"]]);
    expect(kinds("Telp kantor (021) 555-1234")).toEqual([]); // a landline is not a mobile
    expect(kinds("Email: budi.santoso@contoh.co.id")).toEqual([["email", "budi.santoso@contoh.co.id"]]);
  });

  it("takes digits for an account number only where the line says so", () => {
    expect(kinds("No. Rek BCA 123 456 7890 a.n. Budi")).toEqual([["account", "123 456 7890"]]);
    expect(kinds("Nomor surat 1234567890")).toEqual([]);
  });

  it("puts each finding where its characters are", () => {
    const [f] = findSensitive([line("HP 081234567890")]);
    expect(f.rects).toEqual([{ x: 115, y: 191, w: 60, h: 11.5 }]);
  });
});
