"use client";

import { useEffect, useRef } from "react";
import type Konva from "konva";
import { Group, Layer, Rect, Stage, Transformer } from "react-konva";
import { useStore } from "zustand";
import { groupTransform, screenSize, type CropBox, type PageGeom } from "@/lib/coords";
import { MIN_CROP } from "@/lib/pages";
import { t } from "@/lib/strings";
import { useEditor } from "@/store/editor";
import { applyCrop, clearCrop, cropStore, fitRect } from "./cropStore";

const SHADE = "rgba(15,23,42,0.45)";

/** The crop being edited on this page: the rest of the page is shaded, the crop rect can be moved and resized
 *  (kept inside the page), and a bar applies it to this page or to all pages. `geom` is the uncropped page. */
export default function CropOverlay({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const rect = useStore(cropStore, (s) => (s.pageKey === pageKey ? s.rect : null));
  const cropped = useEditor((s) => !!s.doc.pages.find((p) => p.pageKey === pageKey)?.crop);
  const node = useRef<Konva.Rect>(null);
  const tr = useRef<Konva.Transformer>(null);
  const apply = useRef<HTMLButtonElement>(null);
  const open = !!rect;

  useEffect(() => { if (open) apply.current?.focus(); }, [open]);

  useEffect(() => {
    if (!rect) return;
    tr.current?.nodes(node.current ? [node.current] : []);
    tr.current?.getLayer()?.batchDraw();
  }, [rect]);

  useEffect(() => {
    if (!rect) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cropStore.getState().close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rect]);

  if (!rect) return null;
  const size = screenSize(geom, scale);
  const g = groupTransform(geom, scale);
  const W = geom.width, H = geom.height;
  // Commits `r` (or keeps the current rect when it is invalid) and always writes the node back from the result.
  const put = (n: Konva.Node, r: CropBox) => {
    const c = fitRect(r, rect, { width: W, height: H });
    cropStore.getState().setRect(c);
    n.setAttrs({ x: c.x, y: c.y, width: c.w, height: c.h, scaleX: 1, scaleY: 1 });
    n.getLayer()?.batchDraw();
  };

  return (
    <div className="absolute inset-0" style={{ zIndex: 20 }} data-testid="crop-overlay">
      <Stage width={size.width} height={size.height}>
        <Layer>
          <Group x={g.x} y={g.y} rotation={g.rotation} scaleX={g.scale} scaleY={g.scale}>
            <Rect x={0} y={0} width={W} height={rect.y} fill={SHADE} listening={false} />
            <Rect x={0} y={rect.y + rect.h} width={W} height={H - rect.y - rect.h} fill={SHADE} listening={false} />
            <Rect x={0} y={rect.y} width={rect.x} height={rect.h} fill={SHADE} listening={false} />
            <Rect x={rect.x + rect.w} y={rect.y} width={W - rect.x - rect.w} height={rect.h} fill={SHADE} listening={false} />
            <Rect ref={node} name="crop-rect" x={rect.x} y={rect.y} width={rect.w} height={rect.h} stroke="#0f766e" strokeWidth={1.5}
              strokeScaleEnabled={false} dash={[6, 4]} fill="rgba(0,0,0,0.001)" draggable
              onDragMove={(e) => {
                const n = e.target;
                const x = Math.min(Math.max(n.x(), 0), W - rect.w), y = Math.min(Math.max(n.y(), 0), H - rect.h);
                n.position({ x, y });
                cropStore.getState().setRect({ ...rect, x, y });
              }}
              onDragEnd={(e) => put(e.target, { ...rect, x: e.target.x(), y: e.target.y() })}
              onTransformEnd={(e) => {
                const n = e.target;
                const next = { x: n.x(), y: n.y(), w: n.width() * n.scaleX(), h: n.height() * n.scaleY() };
                put(n, next);
              }} />
          </Group>
          <Transformer ref={tr} rotateEnabled={false} flipEnabled={false} keepRatio={false} ignoreStroke
            boundBoxFunc={(old, box) => (box.width < MIN_CROP * scale || box.height < MIN_CROP * scale ? old : box)}
            borderStroke="#0f766e" anchorStroke="#0f766e" anchorSize={9} />
        </Layer>
      </Stage>
      <div role="toolbar" aria-label={t.crop.title} data-testid="crop-bar"
        className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-surface p-1 text-sm shadow-lg ring-1 ring-line">
        <button ref={apply} onClick={() => applyCrop(false)} className="rounded-md bg-accent px-2.5 py-1 text-accent-ink">{t.crop.thisPage}</button>
        <button onClick={() => applyCrop(true)} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.allPages}</button>
        {cropped && <button onClick={clearCrop} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.remove}</button>}
        <button onClick={() => cropStore.getState().close()} className="rounded-md px-2.5 py-1 hover:bg-bg">{t.crop.cancel}</button>
      </div>
    </div>
  );
}
