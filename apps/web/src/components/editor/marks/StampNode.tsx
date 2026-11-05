"use client";

import { useEffect, useState } from "react";
import { Rect, Shape } from "react-konva";
import type { StampAdd } from "@edith/ops";
import { charOffsets, cssFamily, fontStore } from "@/lib/fonts";
import { STAMP_FONT, stampBorder, stampLayout, stampTexts } from "@/lib/stamps";

/** A stamp as the bake draws it: rounded border, then the lines glyph by glyph at PDF-quantized offsets. */
export function StampNode({ op }: { op: StampAdd }) {
  const [metrics, setMetrics] = useState(() => fontStore.peek(STAMP_FONT));
  useEffect(() => {
    if (metrics) return;
    let alive = true;
    fontStore.load(STAMP_FONT).then((m) => { if (alive) setMetrics(m); }).catch((e) => console.warn("stamp font failed", e));
    return () => { alive = false; };
  }, [metrics]);

  const { x, y, w, h } = op.rect;
  const b = stampBorder(w, h);
  return (
    <>
      <Rect x={x + b.x} y={y + b.y} width={b.w} height={b.h} cornerRadius={b.radius} stroke={op.color} strokeWidth={b.width} fill="transparent" />
      {metrics && (
        <Shape
          listening={false}
          sceneFunc={(ctx) => {
            const c = ctx._context as CanvasRenderingContext2D & { fontKerning?: string };
            c.save();
            c.textBaseline = "alphabetic";
            c.textAlign = "left";
            if ("fontKerning" in c) c.fontKerning = "none";
            c.fillStyle = op.color;
            for (const line of stampLayout(w, h, stampTexts(op), metrics)) {
              c.font = `${line.size}px "${cssFamily(STAMP_FONT)}"`;
              const offs = charOffsets(line.text, metrics, line.size);
              let i = 0;
              for (const ch of line.text) c.fillText(ch, x + line.x + offs[i++], y + line.baseline);
            }
            c.restore();
          }}
        />
      )}
    </>
  );
}
