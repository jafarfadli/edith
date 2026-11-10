import type { FontRef, Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { cssFamily, fontId, fontKey, isOriginal } from "@/lib/fonts";
import { normalizeRuns } from "@/lib/runs";

/** Embedded fonts by `fontId`. */
export type FontTable = Record<string, DocFont>;

/** Character style of a run — the attributes of the rich editor's `run` mark. */
export interface RunAttrs {
  font: FontRef; size: number; color: string; bgColor: string | null; underline: boolean; strike: boolean;
  /** The original PDF's horizontal scale and spacing (Run.hScale / charSpacing / wordSpacing): carried unchanged, so
   *  edited original text keeps the original's widths. Absent = 1 / 0 / 0. */
  hScale?: number; charSpacing?: number; wordSpacing?: number;
  /** Where, how thick and in which colour the original PDF drew the underline / strikethrough (Run.underlineTop,
   *  strikeTop, decorThickness, decorColor): carried with the run, so an edit draws them as the original did. */
  underlineTop?: number; strikeTop?: number; decorThickness?: number; decorColor?: string;
}
/** A style change from the properties bar; only the given fields change. */
export interface StylePatch {
  family?: string; bold?: boolean; italic?: boolean; size?: number; color?: string;
  bgColor?: string | null; underline?: boolean; strike?: boolean;
}

export function attrsOf(r: Run): RunAttrs {
  return { font: r.font, size: r.size, color: r.color, bgColor: r.bgColor ?? null, underline: !!r.underline, strike: !!r.strike, ...spacingOf(r), ...decorOf(r) };
}

type DecorFields = Pick<Run, "underlineTop" | "strikeTop" | "decorThickness" | "decorColor">;

/** The decoration geometry and colour fields of `a` that apply (Run.underlineTop / strikeTop / decorThickness /
 *  decorColor): an underline's only while it is underlined, a strikethrough's while struck through. */
export function decorOf(a: { underline?: boolean | null; strike?: boolean | null; underlineTop?: number | null; strikeTop?: number | null;
  decorThickness?: number | null; decorColor?: string | null }): { underlineTop?: number; strikeTop?: number; decorThickness?: number; decorColor?: string } {
  const some = !!a.underline || !!a.strike;
  const out: DecorFields = {};
  if (a.underline && a.underlineTop != null) out.underlineTop = a.underlineTop;
  if (a.strike && a.strikeTop != null) out.strikeTop = a.strikeTop;
  if (some && a.decorThickness != null) out.decorThickness = a.decorThickness;
  if (some && a.decorColor) out.decorColor = a.decorColor;
  return out as { underlineTop?: number; strikeTop?: number; decorThickness?: number; decorColor?: string };
}

/** The non-default spacing fields of `a` (Run.hScale / charSpacing / wordSpacing). */
export function spacingOf(a: Pick<Run, "hScale" | "charSpacing" | "wordSpacing">): Pick<Run, "hScale" | "charSpacing" | "wordSpacing"> {
  return {
    ...(a.hScale !== undefined && a.hScale !== null && a.hScale !== 1 ? { hScale: a.hScale } : {}),
    ...(a.charSpacing ? { charSpacing: a.charSpacing } : {}),
    ...(a.wordSpacing ? { wordSpacing: a.wordSpacing } : {}),
  };
}

/** A run with `a`'s style; default decoration fields are left out (as the API's defaults). */
export function runOf(text: string, a: RunAttrs): Run {
  return {
    text, font: a.font, size: a.size, color: a.color,
    ...(a.bgColor ? { bgColor: a.bgColor } : {}),
    ...(a.underline ? { underline: true } : {}),
    ...(a.strike ? { strike: true } : {}),
    ...spacingOf(a),
    ...decorOf(a),
  };
}

/** Family/bold/italic a font shows as in the properties bar; `original` is the `fontId` of an embedded font. */
export function fontStyle(f: FontRef, fonts: FontTable): { family: string; bold: boolean; italic: boolean; original: string | null } {
  if (isOriginal(f)) {
    const info = fonts[fontId(f)];
    return { family: info?.substitute.family ?? "Arimo", bold: info?.bold ?? false, italic: info?.italic ?? false, original: fontId(f) };
  }
  return { family: f.family, bold: f.bold ?? false, italic: f.italic ?? false, original: null };
}

/** `f` with a family/bold/italic change. An original font keeps being original when the document
 *  embeds a reusable variant of its family with the wanted style; otherwise it becomes its substitute. */
export function patchFont(f: FontRef, patch: StylePatch, fonts: FontTable): FontRef {
  if (patch.family === undefined && patch.bold === undefined && patch.italic === undefined) return f;
  const cur = fontStyle(f, fonts);
  const bold = patch.bold ?? cur.bold;
  const italic = patch.italic ?? cur.italic;
  if (isOriginal(f) && patch.family === undefined) {
    const info = fonts[fontId(f)];
    // A variant from the same PDF only.
    const variant = info && Object.values(fonts).find((x) => x.reusable && x.doc === info.doc && x.family === info.family && x.bold === bold && x.italic === italic);
    if (variant) return variant.doc ? { kind: "original", ref: variant.ref, doc: variant.doc } : { kind: "original", ref: variant.ref };
  }
  return { kind: "bundled", family: patch.family ?? cur.family, bold, italic };
}

/** `a` with the patch applied. The original's measured scale and spacing (hScale / charSpacing / wordSpacing) stay
 *  only while the font and size do: they were measured against that font program at that size. */
export function applyPatch(a: RunAttrs, p: StylePatch, fonts: FontTable): RunAttrs {
  const font = patchFont(a.font, p, fonts);
  const size = p.size ?? a.size;
  return {
    font, size,
    color: p.color ?? a.color,
    bgColor: p.bgColor !== undefined ? p.bgColor : a.bgColor,
    underline: p.underline ?? a.underline,
    strike: p.strike ?? a.strike,
    ...(fontKey(font) === fontKey(a.font) && size === a.size ? spacingOf(a) : {}),
    // The original's decoration geometry stays (in ems: it follows a size change); turned off, it goes.
    ...decorOf({ ...a, underline: p.underline ?? a.underline, strike: p.strike ?? a.strike }),
  };
}

/** Inline CSS of a run in the rich editor; sizes scale with the `--edith-scale` variable (zoom). */
export function runCss(a: RunAttrs, standIn?: FontRef | null): string {
  const deco = [a.underline && "underline", a.strike && "line-through"].filter(Boolean).join(" ") || "none";
  const decorated = a.underline || a.strike;
  return [
    // `standIn`: an original font's bundled substitute, for the letters its subset lacks (the export draws them in it):
    // typed into a bold italic name, they show bold italic, not in the browser's default face.
    `font-family:"${cssFamily(a.font)}"${standIn ? `,"${cssFamily(standIn)}"` : ""}`,
    `font-size:calc(var(--edith-scale, 1) * ${a.size}px)`,
    `color:${a.color}`,
    a.bgColor ? `background-color:${a.bgColor}` : "",
    `text-decoration-line:${deco}`,
    // The original's line colour and thickness (its position is the browser's: CSS has no baseline-relative offset).
    decorated && a.decorColor ? `text-decoration-color:${a.decorColor}` : "",
    decorated && a.decorThickness ? `text-decoration-thickness:calc(var(--edith-scale, 1) * ${a.decorThickness * a.size}px)` : "",
  ].filter(Boolean).join(";");
}

/** Tiptap/ProseMirror JSON as used by the rich editor: doc → paragraph → text with one `run` mark. */
export interface RichMark { type: string; attrs?: Record<string, unknown> }
export interface RichNode { type: string; text?: string; marks?: RichMark[]; content?: RichNode[] }

export function runsToDoc(paragraphs: Run[][]): RichNode {
  return {
    type: "doc",
    content: paragraphs.map((p) => {
      const content = p.filter((r) => r.text).map((r) => ({ type: "text", text: r.text, marks: [{ type: "run", attrs: { ...attrsOf(r) } }] }));
      return content.length ? { type: "paragraph", content } : { type: "paragraph" };
    }),
  };
}

/** Rich editor JSON → runs. Text without a run mark (typed into an empty box, pasted) takes the
 *  previous text's style, else `fallback`. */
export function docToRuns(doc: RichNode, fallback: RunAttrs): Run[][] {
  let last = fallback;
  const paragraphs = (doc.content ?? []).filter((n) => n.type === "paragraph").map((p) => {
    const runs = (p.content ?? []).filter((n) => n.type === "text" && n.text).map((n) => {
      const mark = n.marks?.find((m) => m.type === "run");
      if (mark?.attrs) {
        const a = mark.attrs as Partial<RunAttrs>;
        // a mark parsed from foreign HTML may lack fields or carry nulls: those inherit the previous style
        last = {
          font: a.font ?? last.font,
          size: a.size ?? last.size,
          color: a.color ?? last.color,
          bgColor: "bgColor" in a ? a.bgColor ?? null : last.bgColor,
          underline: "underline" in a ? a.underline ?? false : last.underline,
          strike: "strike" in a ? a.strike ?? false : last.strike,
          ...spacingOf("hScale" in a || "charSpacing" in a || "wordSpacing" in a ? a : last),
          ...decorOf("underlineTop" in a || "strikeTop" in a || "decorThickness" in a || "decorColor" in a
            ? { ...a, underline: "underline" in a ? a.underline : last.underline, strike: "strike" in a ? a.strike : last.strike } : last),
        };
      }
      return runOf(n.text!, last);
    });
    return normalizeRuns(runs.length ? runs : [runOf("", last)]);
  });
  return paragraphs.length ? paragraphs : [[runOf("", fallback)]];
}
