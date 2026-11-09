import * as fontkit from "fontkit";
import type { BundledFont, FontRef, OriginalFont } from "@edith/ops";
import type { CjkScript, FallbackFonts } from "@/lib/fallback";

export interface FontMetrics {
  unitsPerEm: number; ascent: number; descent: number;
  advance(ch: string): number;
  /** Whether the font maps code point `cp` to a glyph (its cmap). Test doubles may omit it (= every glyph). */
  hasGlyph?(cp: number): boolean;
}

export function metricsFromBuffer(buf: ArrayBuffer | Uint8Array): FontMetrics {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const font = fontkit.create(bytes as Buffer) as unknown as fontkit.Font;
  if (typeof font.glyphsForString !== "function") throw new Error("font collection, not a font");
  const cache = new Map<string, number>();
  return {
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: Math.abs(font.descent),
    advance(ch: string) {
      let w = cache.get(ch);
      if (w === undefined) {
        w = font.glyphsForString(ch).reduce((sum, g) => sum + g.advanceWidth, 0);
        cache.set(ch, w);
      }
      return w;
    },
    hasGlyph: (cp: number) => font.hasGlyphForCodePoint(cp),
  };
}

/** True when `m` has a glyph for every character of `text`. */
export function covers(m: FontMetrics, text: string): boolean {
  if (!m.hasGlyph) return true;
  for (const ch of text) if (!m.hasGlyph(ch.codePointAt(0)!)) return false;
  return true;
}

/** Glyph advance in thousandths of an em, truncated — exactly what PyMuPDF writes into the PDF /W array. */
function milliEm(ch: string, m: FontMetrics): number {
  return Math.floor((m.advance(ch) * 1000) / m.unitsPerEm);
}

/** The original PDF's horizontal scale and spacing of a run (Run.hScale / charSpacing / wordSpacing, pt): the pen
 *  advance of a character is hScale · advance · size + charSpacing (+ wordSpacing for " "). Same rule as the
 *  bake's run_width (apps/api/edith/bake/text.py). */
export interface Spacing { hScale?: number; charSpacing?: number; wordSpacing?: number }

export function spaced(sp?: Spacing): boolean {
  return !!sp && ((sp.hScale ?? 1) !== 1 || !!sp.charSpacing || !!sp.wordSpacing);
}

function advance(ch: string, m: FontMetrics, size: number, sp: Spacing): number {
  return (milliEm(ch, m) / 1000) * size * (sp.hScale ?? 1) + (sp.charSpacing ?? 0) + (ch === " " ? sp.wordSpacing ?? 0 : 0);
}

export function textWidth(text: string, m: FontMetrics, size: number, sp?: Spacing): number {
  if (spaced(sp)) {
    let w = 0;
    for (const ch of text) w += advance(ch, m, size, sp!);
    return w;
  }
  let milli = 0;
  for (const ch of text) milli += milliEm(ch, m);
  return (milli / 1000) * size;
}

export function charOffsets(text: string, m: FontMetrics, size: number, sp?: Spacing): number[] {
  const out: number[] = [];
  if (spaced(sp)) {
    let x = 0;
    for (const ch of text) {
      out.push(x);
      x += advance(ch, m, size, sp!);
    }
    return out;
  }
  let milli = 0;
  for (const ch of text) {
    out.push((milli / 1000) * size);
    milli += milliEm(ch, m);
  }
  return out;
}

export type Style = "regular" | "bold" | "italic" | "bolditalic";

export function isOriginal(f: FontRef): f is OriginalFont {
  return f.kind === "original";
}

/** Key of an embedded font in the font table: its ref, prefixed by the imported PDF it comes from (refs are
 *  xref numbers, unique only per document). */
export function fontId(f: OriginalFont): string {
  return f.doc ? `${f.doc}/${f.ref}` : f.ref;
}

function style(f: BundledFont): Style {
  if (f.bold && f.italic) return "bolditalic";
  if (f.bold) return "bold";
  if (f.italic) return "italic";
  return "regular";
}

/** Styles to try when a family lacks the requested one — same order as the API's FontRegistry.path. */
const STYLE_FALLBACK: Record<Style, Style[]> = {
  regular: ["regular"],
  bold: ["bold", "regular"],
  italic: ["italic", "regular"],
  bolditalic: ["bolditalic", "bold", "italic", "regular"],
};

export function pickFile(files: Partial<Record<Style, string>>, wanted: Style): string {
  for (const s of STYLE_FALLBACK[wanted]) if (files[s]) return files[s]!;
  throw new Error("font family has no regular style");
}

export function fontKey(f: FontRef): string {
  if (isOriginal(f)) return f.doc ? `orig-${f.doc}-${f.ref}` : `orig-${f.ref}`;
  const s = style(f);
  return `${f.family}-${s === "bolditalic" ? "bold-italic" : s}`;
}

export function cssFamily(f: FontRef): string {
  return `edith-${fontKey(f)}`;
}

interface Family { category: string; files: Partial<Record<Style, string>> }
/** `cjk`: the optional CJK pack, only the families (and styles) whose files were fetched (scripts/sync-fonts.mjs). */
interface Manifest { default: string; families: Record<string, Family>; cjk?: Record<string, Family & { script: CjkScript }> }

export class FontStore implements FallbackFonts {
  private manifest?: Promise<Manifest>;
  private manifestNow: Manifest | null = null;
  private han: CjkScript = "sc";
  private loaded = new Map<string, FontMetrics>();
  private pending = new Map<string, Promise<FontMetrics>>();
  /** Bundled font files by URL (see file()). */
  private files = new Map<string, Promise<{ buf: ArrayBuffer; metrics: FontMetrics }>>();
  private originalUrl: ((f: OriginalFont) => string) | null = null;

  constructor(private baseUrl = "/fonts") {}

  /** Where original (embedded) fonts of the open document and its imports come from; forgets the previous document's. */
  setOriginalSource(url: ((f: OriginalFont) => string) | null): void {
    this.originalUrl = url;
    for (const key of [...this.loaded.keys(), ...this.pending.keys()]) {
      if (key.startsWith("orig-")) { this.loaded.delete(key); this.pending.delete(key); }
    }
  }

  private getManifest(): Promise<Manifest> {
    if (!this.manifest) {
      const url = `${this.baseUrl}/manifest.json`;
      const p = fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(`font fetch failed: ${url} (${r.status})`);
        return (this.manifestNow = (await r.json()) as Manifest);
      });
      this.manifest = p;
      p.catch(() => { if (this.manifest === p) this.manifest = undefined; });
    }
    return this.manifest;
  }

  /** Families of the font picker (the CJK pack only serves as a fallback). */
  async families(): Promise<string[]> {
    return Object.keys((await this.getManifest()).families);
  }

  ready(): Promise<unknown> {
    return this.getManifest();
  }

  cjkFamily(script: CjkScript, category: string): string | null {
    const wanted = category === "serif" ? "serif" : "sans";
    const found = Object.entries(this.manifestNow?.cjk ?? {}).filter(([, f]) => f.script === script);
    return (found.find(([, f]) => f.category === wanted) ?? found[0])?.[0] ?? null;
  }

  categoryOf(family: string): string | null {
    const m = this.manifestNow;
    return (m?.families[family] ?? m?.cjk?.[family])?.category ?? null;
  }

  hanScript(): CjkScript {
    return this.han;
  }

  /** The script of the open document's Han characters (see documentScript). */
  setHanScript(script: CjkScript): void {
    this.han = script;
  }

  private async url(f: FontRef): Promise<string> {
    if (isOriginal(f)) {
      if (!this.originalUrl) throw new Error(`no source for original font ${f.ref}`);
      return this.originalUrl(f);
    }
    const m = await this.getManifest();
    // CJK pack families serve as fallbacks and as the API's substitutes of CJK fonts (GET /text).
    const fam = m.families[f.family] ?? m.cjk?.[f.family];
    if (!fam) throw new Error(`unknown font family ${f.family}`);
    return `${this.baseUrl}/${pickFile(fam.files, style(f))}`;
  }

  /** Downloads and parses a font file. Bundled files are shared by URL (`shared`): a family without italics (the CJK
   *  pack) serves italic from its regular file and bold italic from its bold one, fetched and parsed once. A failed
   *  file is forgotten, so a later load retries it. */
  private file(url: string, shared: boolean): Promise<{ buf: ArrayBuffer; metrics: FontMetrics }> {
    const cached = shared ? this.files.get(url) : undefined;
    if (cached) return cached;
    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`font fetch failed: ${url} (${res.status})`);
      const buf = await res.arrayBuffer();
      return { buf, metrics: metricsFromBuffer(buf) };
    })();
    if (shared) {
      this.files.set(url, p);
      p.catch(() => { if (this.files.get(url) === p) this.files.delete(url); });
    }
    return p;
  }

  load(f: FontRef): Promise<FontMetrics> {
    const key = fontKey(f);
    const done = this.loaded.get(key);
    if (done) return Promise.resolve(done);
    let p = this.pending.get(key);
    if (!p) {
      p = (async () => {
        const url = await this.url(f);
        const { buf, metrics } = await this.file(url, !isOriginal(f));
        if (typeof document !== "undefined") {
          // One face per CSS family name (cssFamily), made from the shared bytes: no second download or fontkit parse.
          const face = new FontFace(cssFamily(f), buf);
          await face.load();
          document.fonts.add(face);
        }
        // Not stored when setOriginalSource() dropped this load meanwhile (another document).
        if (this.pending.get(key) === p) this.loaded.set(key, metrics);
        return metrics;
      })();
      const settled = p;
      this.pending.set(key, settled);
      const clear = () => { if (this.pending.get(key) === settled) this.pending.delete(key); };
      settled.then(clear, clear);
    }
    return p;
  }

  /** Metrics of a loaded font, or null. */
  peek(f: FontRef): FontMetrics | null {
    return this.loaded.get(fontKey(f)) ?? null;
  }

  get(f: FontRef): FontMetrics {
    const m = this.peek(f);
    if (!m) throw new Error(`font not loaded: ${fontKey(f)}`);
    return m;
  }
}

export const fontStore = new FontStore();
