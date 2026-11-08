import type { BundledFont, FontRef, Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { covers, fontId, fontKey, fontStore, isOriginal, type FontMetrics } from "@/lib/fonts";

/** Fonts of the edited PDF and its imports, by `fontId`. */
export type FontTable = Record<string, DocFont>;
export type Peek = (f: FontRef) => FontMetrics | null;
export type CjkScript = "kr" | "jp" | "sc";

/** What the font fallback needs to know about the font manifest (FontStore implements it). */
export interface FallbackFonts {
  /** The family of the optional CJK pack for `script` in design `category` (serif, else sans); null when the pack
   *  was not fetched or the manifest is not loaded yet. */
  cjkFamily(script: CjkScript, category: string): string | null;
  /** Category of a bundled or CJK family (sans | serif | mono | script); null when unknown. */
  categoryOf(family: string): string | null;
  /** The script Han characters (shared by Chinese, Japanese and Korean) are drawn in: the document's. */
  hanScript(): CjkScript;
  /** Loads what the lookups need (the manifest); awaited before resolving with loads. */
  ready?(): Promise<unknown>;
}
type Loader = { load(f: FontRef): Promise<FontMetrics>; peek: Peek };

const ARIMO = "Arimo";
const NOTO_SANS = "Noto Sans";
/** Rounds of loading in prepareRuns: one per step of the longest chain (original, substitute, CJK, Arimo, Noto Sans). */
const MAX_ROUNDS = 6;

const inRange = (cp: number, ranges: [number, number][]) => ranges.some(([a, b]) => cp >= a && cp <= b);
// Jamo, compatibility jamo, parenthesized and circled Hangul (inside the enclosed CJK block), syllables, half-width forms.
const HANGUL: [number, number][] = [[0x1100, 0x11ff], [0x3130, 0x318f], [0x3200, 0x321e], [0x3260, 0x327f], [0xa960, 0xa97f],
  [0xac00, 0xd7af], [0xd7b0, 0xd7ff], [0xffa0, 0xffdc]];
const KANA: [number, number][] = [[0x3040, 0x30ff], [0x31f0, 0x31ff], [0x32d0, 0x32fe], [0xff66, 0xff9f], [0x1b000, 0x1b16f]];
// Bopomofo (and its extension): Chinese phonetic letters.
const BOPOMOFO: [number, number][] = [[0x3100, 0x312f], [0x31a0, 0x31bf]];
// Han ideographs plus the CJK punctuation, symbols and full-width forms every CJK font has.
const HAN: [number, number][] = [[0x2e80, 0x2fdf], [0x3000, 0x303f], [0x3190, 0x31ef], [0x3200, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xffef], [0x20000, 0x3134f]];

/** The CJK script a character needs: Hangul → kr, kana → jp, Bopomofo → sc, Han / CJK punctuation → `han` (the
 *  document's); else null. The specific ranges are tested before Han, whose blocks contain some of them. */
export function cjkScript(cp: number, han: CjkScript): CjkScript | null {
  if (inRange(cp, HANGUL)) return "kr";
  if (inRange(cp, KANA)) return "jp";
  if (inRange(cp, BOPOMOFO)) return "sc";
  if (inRange(cp, HAN)) return han;
  return null;
}

/** Combining marks, zero-width joiner and variation selectors 1–16: they belong to the character before them. */
const ATTACHES = /^[\p{M}‍︀-️]$/u;

/** The script of a document's Han characters: Korean when it has Hangul (at least as much as kana), Japanese when it
 *  has kana, else Simplified Chinese. */
export function documentScript(texts: Iterable<string>): CjkScript {
  let hangul = 0, kana = 0;
  for (const text of texts) {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (inRange(cp, HANGUL)) hangul++;
      else if (inRange(cp, KANA)) kana++;
    }
  }
  if (hangul && hangul >= kana) return "kr";
  return kana ? "jp" : "sc";
}

const ARIMO_REGULAR: BundledFont = { kind: "bundled", family: ARIMO, bold: false, italic: false };

export function substituteOf(f: FontRef, fonts: FontTable): BundledFont {
  return isOriginal(f) ? fonts[fontId(f)]?.substitute ?? ARIMO_REGULAR : f;
}

/** The fonts that may draw character `cp` of a run set in `font`, in order: the font itself; for an original font, its
 *  substitute; for a CJK character, the CJK pack family of its script in the run's design (serif or sans) when the
 *  pack is there; Arimo (Latin, Greek, Cyrillic); Noto Sans (wider Unicode). Fallbacks keep the run's bold/italic. */
export function fallbackChain(font: FontRef, cp: number, fonts: FontTable, lookup: FallbackFonts): FontRef[] {
  const base = substituteOf(font, fonts);
  const style = { bold: !!base.bold, italic: !!base.italic };
  const chain: FontRef[] = [font];
  if (isOriginal(font)) chain.push(base);
  const script = cjkScript(cp, lookup.hanScript());
  if (script) {
    const family = lookup.cjkFamily(script, lookup.categoryOf(base.family) ?? "sans");
    if (family) chain.push({ kind: "bundled", family, ...style });
  }
  chain.push({ kind: "bundled", family: ARIMO, ...style }, { kind: "bundled", family: NOTO_SANS, ...style });
  const seen = new Set<string>();
  return chain.filter((f) => (seen.has(fontKey(f)) ? false : (seen.add(fontKey(f)), true)));
}

type Resolved = { runs: Run[][] } | { pending: FontRef[] };

/** Fallback fonts the system chose (substitutes, CJK pack, Arimo, Noto Sans) that failed to load (404, timeout, a file
 *  the browser rejects), per font manifest: skipped from then on, never retried in this session. */
const failedFallbacks = new WeakMap<FallbackFonts, Set<string>>();
function failedOf(lookup: FallbackFonts): Set<string> {
  let failed = failedFallbacks.get(lookup);
  if (!failed) failedFallbacks.set(lookup, (failed = new Set()));
  return failed;
}

/** Every character of every run in the first font of its chain that is loaded and has a glyph for it — runs split
 *  where that font changes, so characters an original font has keep it. A combining mark, ZWJ or variation selector
 *  stays with the character before it when that character's font has it. A character no font has stays in the last
 *  font of the chain that loaded. `skip`: fonts that failed to load (never the bundled font the run is set in: the
 *  user picked it). Pending when a font the decision needs is not loaded yet. A run that keeps its font for every
 *  character is returned as is. */
function resolve(paragraphs: Run[][], fonts: FontTable, peek: Peek, lookup: FallbackFonts,
  skip: (f: FontRef) => boolean): Resolved {
  const pending = new Map<string, FontRef>();
  const out = paragraphs.map((runs) => runs.flatMap((r) => {
    const pieces: { font: FontRef; text: string }[] = [];
    for (const ch of r.text) {
      const before = pieces[pieces.length - 1];
      if (before && ATTACHES.test(ch)) {
        const m = peek(before.font);
        if (m && covers(m, ch)) { before.text += ch; continue; }
      }
      let chosen: FontRef | null = null, last: FontRef | null = null;
      for (const f of fallbackChain(r.font, ch.codePointAt(0)!, fonts, lookup)) {
        if ((f !== r.font || isOriginal(f)) && skip(f)) continue;
        const m = peek(f);
        if (!m) { pending.set(fontKey(f), f); chosen = null; last = null; break; }
        last = f;
        if (covers(m, ch)) { chosen = f; break; }
      }
      const font = chosen ?? last ?? r.font;
      const prev = pieces[pieces.length - 1];
      if (prev && fontKey(prev.font) === fontKey(font)) prev.text += ch;
      else pieces.push({ font, text: ch });
    }
    if (pieces.length <= 1 && (!pieces.length || fontKey(pieces[0].font) === fontKey(r.font))) return [r];
    return pieces.map((p) => ({ ...r, text: p.text, font: p.font }));
  }));
  return pending.size ? { pending: [...pending.values()] } : { runs: out };
}

/** The font fallback using only fonts that are already loaded (same result as `prepareRuns` once its fonts are
 *  in); `null` when a font it needs is not loaded yet. */
export function resolveLoadedRuns(paragraphs: Run[][], fonts: FontTable, peek: Peek, lookup: FallbackFonts = fontStore): Run[][] | null {
  const failed = failedOf(lookup);
  const r = resolve(paragraphs, fonts, peek, lookup, (f) => !isOriginal(f) && failed.has(fontKey(f)));
  return "runs" in r ? r.runs : null;
}

async function settle(paragraphs: Run[][], fonts: FontTable, store: Loader, lookup: FallbackFonts): Promise<Run[][] | null> {
  await lookup.ready?.().catch(() => {}); // the manifest: bundled and CJK families
  const failed = failedOf(lookup);
  const originals = new Set<string>(); // per call: the document's own fonts (another document has others)
  const picked = new Set(paragraphs.flat().filter((r) => !isOriginal(r.font)).map((r) => fontKey(r.font)));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const r = resolve(paragraphs, fonts, (f) => store.peek(f), lookup, (f) => (isOriginal(f) ? originals : failed).has(fontKey(f)));
    if ("runs" in r) return r.runs;
    const results = await Promise.allSettled(r.pending.map((f) => store.load(f)));
    results.forEach((x, i) => {
      if (x.status !== "rejected") return;
      const f = r.pending[i], key = fontKey(f);
      if (isOriginal(f)) originals.add(key); // counts as having no glyphs
      else if (picked.has(key)) throw x.reason; // the font the user picked won't load: no silent change of their choice
      else {
        failed.add(key); // a fallback the system chose: the next one of the chain draws instead
        console.warn(`fallback font ${key} failed to load; using the next fallback`, x.reason);
      }
    });
  }
  return null;
}

/** Loads the fonts the paragraphs need, character by character along each run's fallback chain (an original font
 *  that fails to load counts as having no glyphs, a fallback font that fails is skipped for good), and returns the
 *  runs split by the font that draws them. CJK pack fonts load only when a character needs them. Rejects when the
 *  bundled font a run is set in (the user's pick) cannot be loaded. */
export async function prepareRuns(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore, lookup: FallbackFonts = fontStore): Promise<Run[][]> {
  const out = await settle(paragraphs, fonts, store, lookup);
  if (!out) throw new Error("font fallback did not settle");
  await Promise.all(out.flat().map((r) => store.load(r.font)));
  return out;
}

/** Loads the fonts `prepareRuns` would, so `resolveLoadedRuns` and `hasUnsupportedChars` can answer synchronously.
 *  Never rejects: a font that fails to load just stays unresolved. */
export async function preloadFallback(paragraphs: Run[][], fonts: FontTable, store: Loader = fontStore, lookup: FallbackFonts = fontStore): Promise<void> {
  await settle(paragraphs, fonts, store, lookup).catch(() => null);
}

/** True when some character has no glyph in any font of its chain (with the loaded fonts): the bake draws it with a
 *  builtin font or as a box (CJK without the pack or with a pack font that failed to load, emoji, rare symbols …).
 *  False while a font of a chain is loading. */
export function hasUnsupportedChars(paragraphs: Run[][], fonts: FontTable, peek: Peek, lookup: FallbackFonts = fontStore): boolean {
  const resolved = resolveLoadedRuns(paragraphs, fonts, peek, lookup);
  if (!resolved) return false;
  return resolved.flat().some((r) => {
    const m = peek(r.font);
    return !!m && !covers(m, r.text.replace(/[\n\r\t]/g, ""));
  });
}
