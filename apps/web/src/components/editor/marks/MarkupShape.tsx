"use client";

import { Rect } from "react-konva";
import type { AnnotAdd } from "@edith/ops";
import { markupLine } from "@/lib/markup";
import { CANVAS } from "@/lib/theme";

/** Text markup as MuPDF draws it: a highlight fills each quad (its layer multiplies it over the page),
 *  underline/strike draw a line per quad (the whole quad stays clickable). */
export function MarkupShape({ op, selected = false }: { op: AnnotAdd; selected?: boolean }) {
  const quads = op.quads ?? [];
  const kind = op.kind;
  return (
    <>
      {quads.map((q, i) => (
        <Rect key={i} x={q.x} y={q.y} width={q.w} height={q.h} fill={kind === "highlight" ? op.color : "transparent"} />
      ))}
      {(kind === "underline" || kind === "strike") && quads.map((q, i) => {
        const l = markupLine(kind, q);
        return <Rect key={`l${i}`} x={l.x} y={l.y} width={l.w} height={l.h} fill={op.color} listening={false} />;
      })}
      {selected && quads.map((q, i) => (
        <Rect key={`s${i}`} x={q.x - 1} y={q.y - 1} width={q.w + 2} height={q.h + 2} stroke={CANVAS.accent} strokeWidth={1}
          strokeScaleEnabled={false} dash={[4, 3]} listening={false} />
      ))}
    </>
  );
}
