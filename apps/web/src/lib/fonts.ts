import * as fontkit from "fontkit";
import type { BundledFont } from "@edith/ops";

export interface FontMetrics { unitsPerEm: number; ascent: number; descent: number; advance(ch: string): number }

export function metricsFromBuffer(buf: ArrayBuffer | Uint8Array): FontMetrics {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const font = fontkit.create(bytes as Buffer) as unknown as fontkit.Font;
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
  };
}

/** Glyph advance in thousandths of an em, truncated — exactly what PyMuPDF writes into the PDF /W array. */
function milliEm(ch: string, m: FontMetrics): number {
  return Math.floor((m.advance(ch) * 1000) / m.unitsPerEm);
}

export function textWidth(text: string, m: FontMetrics, size: number): number {
  let milli = 0;
  for (const ch of text) milli += milliEm(ch, m);
  return (milli / 1000) * size;
}

export function charOffsets(text: string, m: FontMetrics, size: number): number[] {
  const out: number[] = [];
  let milli = 0;
  for (const ch of text) {
    out.push((milli / 1000) * size);
    milli += milliEm(ch, m);
  }
  return out;
}

export type Style = "regular" | "bold" | "italic" | "bolditalic";

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

export function fontKey(f: BundledFont): string {
  const s = style(f);
  return `${f.family}-${s === "bolditalic" ? "bold-italic" : s}`;
}

export function cssFamily(f: BundledFont): string {
  return `edith-${fontKey(f)}`;
}

interface Manifest { default: string; families: Record<string, { category: string; files: Partial<Record<Style, string>> }> }

export class FontStore {
  private manifest?: Promise<Manifest>;
  private loaded = new Map<string, FontMetrics>();
  private pending = new Map<string, Promise<FontMetrics>>();

  constructor(private baseUrl = "/fonts") {}

  private getManifest(): Promise<Manifest> {
    if (!this.manifest) {
      const url = `${this.baseUrl}/manifest.json`;
      const p = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`font fetch failed: ${url} (${r.status})`);
        return r.json() as Promise<Manifest>;
      });
      this.manifest = p;
      p.catch(() => { if (this.manifest === p) this.manifest = undefined; });
    }
    return this.manifest;
  }

  async families(): Promise<string[]> {
    return Object.keys((await this.getManifest()).families);
  }

  load(f: BundledFont): Promise<FontMetrics> {
    const key = fontKey(f);
    const done = this.loaded.get(key);
    if (done) return Promise.resolve(done);
    let p = this.pending.get(key);
    if (!p) {
      p = (async () => {
        const manifest = await this.getManifest();
        const fam = manifest.families[f.family];
        if (!fam) throw new Error(`unknown font family ${f.family}`);
        const url = `${this.baseUrl}/${pickFile(fam.files, style(f))}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`font fetch failed: ${url} (${res.status})`);
        const buf = await res.arrayBuffer();
        const metrics = metricsFromBuffer(buf);
        if (typeof document !== "undefined") {
          const face = new FontFace(cssFamily(f), buf);
          await face.load();
          document.fonts.add(face);
        }
        this.loaded.set(key, metrics);
        return metrics;
      })();
      this.pending.set(key, p);
      p.catch(() => { if (this.pending.get(key) === p) this.pending.delete(key); });
    }
    return p;
  }

  get(f: BundledFont): FontMetrics {
    const m = this.loaded.get(fontKey(f));
    if (!m) throw new Error(`font not loaded: ${fontKey(f)}`);
    return m;
  }
}

export const fontStore = new FontStore();
