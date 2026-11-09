"use client";

import { useEffect, useState } from "react";
import { Rect, Shape } from "react-konva";
import { charOffsets, cssFamily, fontKey, fontStore, textWidth } from "@/lib/fonts";
import { decorBands } from "@/lib/textDecor";
import { boxFonts } from "@/lib/textbox";
import type { TextOp } from "@/lib/objects";
import { fontsReady } from "./textEdit";
import { useOverflow } from "./useOverflow";
import { CANVAS } from "@/lib/theme";

const OVERFLOW = CANVAS.overflow;

/** Draws a text box glyph-by-glyph at the PDF-quantized offsets — the same positions the API bakes —
 *  with backgrounds under and underline/strike over the glyphs, as the bake does. */
export function TextNode({ op, hidden }: { op: TextOp; hidden: boolean }) {
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

  const overflow = useOverflow(op);
  const runs = box.paragraphs.flat();
  // A text.edit's kept lines (`source`) and kept line prefixes (`prefix`, M5d) are the page's own glyphs: not drawn again
  // (ParagraphLayer leaves them uncovered).
  const drawn = op.type === "text.edit"
    ? box.layout.filter((l) => l.source === undefined || l.source === null)
      .map((l) => (l.prefix ? { ...l, segments: l.segments.slice(l.prefix.segments) } : l))
    : box.layout;
  const { x, y, w, h } = box.rect;
  return (
    <>
      <Rect x={x} y={y} width={w} height={h} fill="transparent" />
      {overflow && !hidden && (
        // Owner decision (M2 backlog): longer text is not pushed down; show that it may cover what follows.
        <Rect name="overflow" x={x - 2} y={y - 2} width={w + 4} height={h + 4} stroke={OVERFLOW} strokeWidth={1.5}
          strokeScaleEnabled={false} dash={[6, 3]} listening={false} />
      )}
      {ready && !hidden && (
        <Shape
          listening={false}
          x={x}
          y={y}
          width={w}
          height={h}
          sceneFunc={(ctx) => {
            const c = ctx._context as CanvasRenderingContext2D & { fontKerning?: string };
            c.save();
            c.textBaseline = "alphabetic";
            c.textAlign = "left";
            if ("fontKerning" in c) c.fontKerning = "none";
            // Same order as the bake: every background, then the glyphs, then underline/strike.
            const bands: { x: number; y: number; w: number; h: number; color: string; over: boolean }[] = [];
            for (const line of drawn) {
              for (const seg of line.segments) {
                const r = runs[seg.runIndex];
                if (!r || !(r.bgColor || r.underline || r.strike)) continue;
                const d = decorBands(seg.x, line.baseline, textWidth(seg.text, fontStore.get(r.font), r.size, r), r);
                if (d.bg) bands.push({ ...d.bg, color: r.bgColor!, over: false });
                if (d.underline) bands.push({ ...d.underline, color: r.color, over: true });
                if (d.strike) bands.push({ ...d.strike, color: r.color, over: true });
              }
            }
            const fill = (over: boolean) => bands.filter((b) => b.over === over).forEach((b) => { c.fillStyle = b.color; c.fillRect(b.x, b.y, b.w, b.h); });
            fill(false);
            for (const line of drawn) {
              for (const seg of line.segments) {
                const r = runs[seg.runIndex];
                if (!r) continue;
                const m = fontStore.get(r.font);
                c.font = `${r.size}px "${cssFamily(r.font)}"`;
                c.fillStyle = r.color;
                const offs = charOffsets(seg.text, m, r.size, r);
                const scale = r.hScale ?? 1; // the original's horizontal scale (Tz): glyphs as narrow as the bake draws them
                let i = 0;
                for (const ch of seg.text) {
                  if (scale === 1) c.fillText(ch, seg.x + offs[i], line.baseline);
                  else {
                    c.save();
                    c.translate(seg.x + offs[i], line.baseline);
                    c.scale(scale, 1);
                    c.fillText(ch, 0, 0);
                    c.restore();
                  }
                  i++;
                }
              }
            }
            fill(true);
            c.restore();
          }}
        />
      )}
    </>
  );
}
