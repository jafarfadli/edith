import type { FontRef, Run } from "@edith/ops";
import type { DocFont } from "@/lib/api";
import { cssFamily, isOriginal } from "@/lib/fonts";
import { normalizeRuns } from "@/lib/runs";

export type FontTable = Record<string, DocFont>;

/** Character style of a run — the attributes of the rich editor's `run` mark. */
export interface RunAttrs { font: FontRef; size: number; color: string; bgColor: string | null; underline: boolean; strike: boolean }
/** A style change from the properties bar; only the given fields change. */
export interface StylePatch {
  family?: string; bold?: boolean; italic?: boolean; size?: number; color?: string;
  bgColor?: string | null; underline?: boolean; strike?: boolean;
}

export function attrsOf(r: Run): RunAttrs {
  return { font: r.font, size: r.size, color: r.color, bgColor: r.bgColor ?? null, underline: !!r.underline, strike: !!r.strike };
}

/** A run with `a`'s style; default decoration fields are left out (as the API's defaults). */
export function runOf(text: string, a: RunAttrs): Run {
  return {
    text, font: a.font, size: a.size, color: a.color,
    ...(a.bgColor ? { bgColor: a.bgColor } : {}),
    ...(a.underline ? { underline: true } : {}),
    ...(a.strike ? { strike: true } : {}),
  };
}

/** Family/bold/italic a font shows as in the properties bar; `original` is the ref of an embedded font. */
export function fontStyle(f: FontRef, fonts: FontTable): { family: string; bold: boolean; italic: boolean; original: string | null } {
  if (isOriginal(f)) {
    const info = fonts[f.ref];
    return { family: info?.substitute.family ?? "Arimo", bold: info?.bold ?? false, italic: info?.italic ?? false, original: f.ref };
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
    const info = fonts[f.ref];
    const variant = info && Object.values(fonts).find((x) => x.reusable && x.family === info.family && x.bold === bold && x.italic === italic);
    if (variant) return { kind: "original", ref: variant.ref };
  }
  return { kind: "bundled", family: patch.family ?? cur.family, bold, italic };
}

export function applyPatch(a: RunAttrs, p: StylePatch, fonts: FontTable): RunAttrs {
  return {
    font: patchFont(a.font, p, fonts),
    size: p.size ?? a.size,
    color: p.color ?? a.color,
    bgColor: p.bgColor !== undefined ? p.bgColor : a.bgColor,
    underline: p.underline ?? a.underline,
    strike: p.strike ?? a.strike,
  };
}

/** Inline CSS of a run in the rich editor; sizes scale with the `--edith-scale` variable (zoom). */
export function runCss(a: RunAttrs): string {
  const deco = [a.underline && "underline", a.strike && "line-through"].filter(Boolean).join(" ") || "none";
  return [
    `font-family:"${cssFamily(a.font)}"`,
    `font-size:calc(var(--edith-scale, 1) * ${a.size}px)`,
    `color:${a.color}`,
    a.bgColor ? `background-color:${a.bgColor}` : "",
    `text-decoration-line:${deco}`,
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
        };
      }
      return runOf(n.text!, last);
    });
    return normalizeRuns(runs.length ? runs : [runOf("", last)]);
  });
  return paragraphs.length ? paragraphs : [[runOf("", fallback)]];
}
