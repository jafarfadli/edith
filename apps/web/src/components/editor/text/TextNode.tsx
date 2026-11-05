"use client";

import { useEffect, useState } from "react";
import { Rect, Shape } from "react-konva";
import type { TextAdd } from "@edith/ops";
import { charOffsets, cssFamily, fontKey, fontStore } from "@/lib/fonts";
import { boxFonts } from "@/lib/textbox";
import { fontsReady } from "./textEdit";

/** Draws a text box glyph-by-glyph at the PDF-quantized offsets — the same positions the API bakes. */
export function TextNode({ op, hidden }: { op: TextAdd; hidden: boolean }) {
  const { box } = op;
  const keys = boxFonts(box).map(fontKey).join("|");
  const [, setLoaded] = useState(0);
  const ready = fontsReady(box);

  useEffect(() => {
    if (ready) return;
    let alive = true;
    Promise.all(boxFonts(box).map((f) => fontStore.load(f)))
      .then(() => { if (alive) setLoaded((n) => n + 1); })
      .catch((err) => console.warn("text: font load failed", err));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, ready]);

  const runs = box.paragraphs.flat();
  const { x, y, w, h } = box.rect;
  return (
    <>
      <Rect x={x} y={y} width={w} height={h} fill="transparent" />
      {ready && !hidden && (
        <Shape
          listening={false}
          x={x}
          y={y}
          width={w}
          height={h}
          sceneFunc={(ctx) => {
            const c = ctx._context as CanvasRenderingContext2D & { fontKerning?: string; fontVariantLigatures?: string };
            c.save();
            c.textBaseline = "alphabetic";
            c.textAlign = "left";
            if ("fontKerning" in c) c.fontKerning = "none";
            for (const line of box.layout) {
              for (const seg of line.segments) {
                const r = runs[seg.runIndex];
                if (!r) continue;
                const m = fontStore.get(r.font);
                c.font = `${r.size}px "${cssFamily(r.font)}"`;
                c.fillStyle = r.color;
                const offs = charOffsets(seg.text, m, r.size);
                let i = 0;
                for (const ch of seg.text) {
                  c.fillText(ch, seg.x + offs[i], line.baseline);
                  i++;
                }
              }
            }
            c.restore();
          }}
        />
      )}
    </>
  );
}
