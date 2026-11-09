import type { Run } from "@edith/ops";

export function runsText(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

/** Same character style (everything but the text). */
export function sameStyle(a: Run, b: Run): boolean {
  return JSON.stringify(a.font) === JSON.stringify(b.font) && a.size === b.size && a.color === b.color
    && (a.bgColor ?? null) === (b.bgColor ?? null) && !!a.underline === !!b.underline && !!a.strike === !!b.strike
    && (a.hScale ?? 1) === (b.hScale ?? 1) && (a.charSpacing ?? 0) === (b.charSpacing ?? 0)
    && (a.wordSpacing ?? 0) === (b.wordSpacing ?? 0);
}

/** Merges neighbours with the same style and drops empty runs; an empty paragraph keeps one empty run. */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) out[out.length - 1] = { ...last, text: last.text + r.text };
    else out.push(r);
  }
  return out.length ? out : runs.length ? [{ ...runs[0], text: "" }] : [];
}

/** The run holding character `offset` (the last run when `offset` is the end). */
export function styleAt(runs: Run[], offset: number): Run {
  let pos = 0;
  for (const r of runs) {
    if (offset < pos + r.text.length) return r;
    pos += r.text.length;
  }
  return runs[runs.length - 1];
}

/** The parts of `runs` covering characters [start, end). */
export function sliceRuns(runs: Run[], start: number, end: number): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const a = Math.max(start, pos), b = Math.min(end, pos + r.text.length);
    if (a < b) out.push({ ...r, text: r.text.slice(a - pos, b - pos) });
    pos += r.text.length;
  }
  return out;
}

export function paragraphsEqual(a: Run[][], b: Run[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i];
    return p.length === q.length && p.every((r, k) => r.text === q[k].text && sameStyle(r, q[k]));
  });
}
