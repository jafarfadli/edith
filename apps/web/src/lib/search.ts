import type { Run, TextBox } from "@edith/ops";
import { normalizeRuns, runsText, sliceRuns, styleAt } from "@/lib/runs";

/** Something searchable: an original paragraph or a text op. Its text is its paragraphs joined by "\n". */
export interface SearchTarget { key: string; pageKey: string; paragraphs: Run[][] }
export interface Match { key: string; pageKey: string; start: number; end: number }

export function boxText(paragraphs: Run[][]): string {
  return paragraphs.map(runsText).join("\n");
}

/** Lower-cases character by character so offsets stay valid ("İ" would grow when lower-cased whole). */
function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const lower = s[i].toLowerCase();
    out += lower.length === 1 ? lower : s[i];
  }
  return out;
}

export function findMatches(targets: SearchTarget[], query: string, caseSensitive: boolean): Match[] {
  if (!query) return [];
  const q = caseSensitive ? query : fold(query);
  const out: Match[] = [];
  for (const t of targets) {
    const text = caseSensitive ? boxText(t.paragraphs) : fold(boxText(t.paragraphs));
    for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + q.length)) {
      out.push({ key: t.key, pageKey: t.pageKey, start: i, end: i + q.length });
    }
  }
  return out;
}

/** Index of the first match at or after offset `pos` of target `key`, else the first match of a later
 *  target (`order` = target keys in search order), else 0 (wrap around). */
export function nextMatchIndex(matches: Match[], order: string[], key: string, pos: number): number {
  const rank = new Map(order.map((k, i) => [k, i]));
  const at = rank.get(key) ?? -1;
  const i = matches.findIndex((m) => (m.key === key ? m.start >= pos : (rank.get(m.key) ?? -1) > at));
  return i < 0 ? 0 : i;
}

/** (paragraph index, offset in it) of box-text offset `o`. */
function locate(paragraphs: Run[][], o: number): [number, number] {
  let from = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const len = runsText(paragraphs[i]).length;
    if (o <= from + len) return [i, o - from];
    from += len + 1;
  }
  const last = paragraphs.length - 1;
  return [last, runsText(paragraphs[last]).length];
}

/** Replaces characters [start, end) of the box text with `text` in the style of the first replaced
 *  character. A range spanning paragraphs joins them. */
export function replaceRange(paragraphs: Run[][], start: number, end: number, text: string): Run[][] {
  const [pi, s] = locate(paragraphs, start);
  const [pj, e] = locate(paragraphs, end);
  const style = styleAt(paragraphs[pi], s);
  const tail = paragraphs[pj];
  const merged = normalizeRuns([...sliceRuns(paragraphs[pi], 0, s), { ...style, text }, ...sliceRuns(tail, e, runsText(tail).length)]);
  return [...paragraphs.slice(0, pi), merged, ...paragraphs.slice(pj + 1)];
}

/** Replaces several non-overlapping ranges (any order). */
export function replaceMatches(paragraphs: Run[][], ranges: { start: number; end: number }[], text: string): Run[][] {
  return [...ranges].sort((a, b) => b.start - a.start).reduce((ps, m) => replaceRange(ps, m.start, m.end, text), paragraphs);
}

/** Pieces of [start, end) inside the laid-out segments of `box`: segment `[line, segment]`, chars `from`–`to` of its text. */
export function matchSegments(box: TextBox, start: number, end: number): { line: number; segment: number; from: number; to: number }[] {
  const runs = box.paragraphs.flat();
  const runStart: number[] = [];
  let offset = 0;
  box.paragraphs.forEach((p) => {
    p.forEach((r) => { runStart.push(offset); offset += r.text.length; });
    offset += 1; // "\n"
  });
  const cursor = runs.map(() => 0);
  const out: { line: number; segment: number; from: number; to: number }[] = [];
  box.layout.forEach((line, li) => line.segments.forEach((seg, si) => {
    const run = runs[seg.runIndex];
    if (!run) return;
    const local = run.text.indexOf(seg.text, cursor[seg.runIndex]);
    if (local < 0) return;
    cursor[seg.runIndex] = local + seg.text.length;
    const g = runStart[seg.runIndex] + local;
    const from = Math.max(start, g), to = Math.min(end, g + seg.text.length);
    if (from < to) out.push({ line: li, segment: si, from: from - g, to: to - g });
  }));
  return out;
}
