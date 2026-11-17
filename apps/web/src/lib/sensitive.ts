import { band, type CharLine } from "@/lib/markup";
import type { Rect } from "@edith/ops";

/** Personal data in a page's text that people black out before they share a document: NIK (with its province, date of
 *  birth and month checked, so an ordinary 16-digit number is not taken for one), NPWP, mobile numbers, email
 *  addresses, and bank account numbers (digits next to "rekening" / "rek." / "account"). Line by line: these never
 *  break across lines in practice. */

export type SensitiveKind = "nik" | "npwp" | "phone" | "email" | "account";

export interface Finding {
  kind: SensitiveKind;
  /** The text as it reads on the page. */
  text: string;
  /** Where it is (page points), one rect per line it covers. */
  rects: Rect[];
}

const digits = (s: string) => s.replace(/\D/g, "");

/** A NIK: 16 digits, the first two a province (11-94), digits 7-8 the day of birth (01-31, +40 for women), 9-10 the
 *  month. */
export function isNik(d: string): boolean {
  if (!/^\d{16}$/.test(d)) return false;
  const province = Number(d.slice(0, 2)), day = Number(d.slice(6, 8)), month = Number(d.slice(8, 10));
  return province >= 11 && province <= 94 && ((day >= 1 && day <= 31) || (day >= 41 && day <= 71)) && month >= 1 && month <= 12;
}

const PATTERNS: { kind: SensitiveKind; re: RegExp; ok?: (m: string, line: string) => boolean }[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "npwp", re: /(?<!\d)\d{2}\.\d{3}\.\d{3}\.\d[-.]\d{3}\.\d{3}(?!\d)/g },
  // 16 digits, in groups or not.
  { kind: "nik", re: /(?<![\d.-])\d(?:[ .-]?\d){15}(?![\d])/g, ok: (m) => isNik(digits(m)) },
  // Indonesian mobile numbers: 08…, +62 8…, 62 8…; 10 to 13 digits in all.
  { kind: "phone", re: /(?<![\d+])(?:\+62|62|0)[ -]?8\d(?:[ .-]?\d){7,10}(?!\d)/g, ok: (m) => { const n = digits(m).replace(/^62/, "0").length; return n >= 10 && n <= 13; } },
  // An account number: 8 to 18 digits on a line that says it is one.
  { kind: "account", re: /(?<![\d.-])\d(?:[ .-]?\d){7,17}(?![\d])/g, ok: (_m, line) => /\b(rek(ening)?|no\.?\s*rek|account|acc|a\/c|va|virtual account)\b/i.test(line) },
];

/** The findings on a page's lines, in reading order; each piece of text is taken by the first kind that fits it. */
export function findSensitive(lines: CharLine[]): Finding[] {
  const out: Finding[] = [];
  for (const line of lines) {
    const chars = Array.from(line.text);
    if (!chars.length) continue;
    // String index (UTF-16) → code point index, as the boxes count code points.
    const at: number[] = [];
    chars.forEach((c, i) => { for (let k = 0; k < c.length; k++) at.push(i); });
    at.push(chars.length);
    const taken: [number, number][] = [];
    const found: { start: number; kind: SensitiveKind; text: string; rect: Rect }[] = [];
    for (const p of PATTERNS) {
      for (const m of line.text.matchAll(p.re)) {
        const s = m.index!, e = s + m[0].length;
        if (taken.some(([a, b]) => s < b && e > a) || (p.ok && !p.ok(m[0], line.text))) continue;
        taken.push([s, e]);
        const from = at[s], to = at[e] - 1;
        const { top, bottom } = band(line);
        found.push({ start: s, kind: p.kind, text: m[0], rect: { x: line.boxes[from][0], y: top, w: line.boxes[to][1] - line.boxes[from][0], h: bottom - top } });
      }
    }
    found.sort((a, b) => a.start - b.start);
    out.push(...found.map(({ kind, text, rect }) => ({ kind, text, rects: [rect] })));
  }
  return out;
}
