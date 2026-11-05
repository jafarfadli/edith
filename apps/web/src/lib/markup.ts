import type { Rect } from "@edith/ops";

/** Where MuPDF's appearance stream draws an underline/strike in quad `q`: a line q.h/16 thick whose
 *  centre is q.h/7 (underline) or 3·q.h/7 (strike) above the quad's bottom. */
export function markupLine(kind: "underline" | "strike", q: Rect): Rect {
  const t = q.h / 16;
  const centre = q.y + q.h - (kind === "underline" ? q.h / 7 : (3 * q.h) / 7);
  return { x: q.x, y: centre - t / 2, w: q.w, h: t };
}
