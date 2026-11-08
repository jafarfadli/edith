"use client";

import { useEffect, useRef } from "react";
import type { RenderTask } from "pdfjs-dist";
import { cropOffset, screenSize, type PageGeom } from "@/lib/coords";
import type { PageEntry } from "@/store/editor";
import { usePdf } from "@/store/pdfs";

/** The pdf.js rendering of a page's source (the edited PDF or an imported one). A cropped page is rendered
 *  whole and shifted so only the crop shows (the parent clips it). Blank pages draw nothing. */
export function PageCanvas({ entry, geom, scale, label }: { entry: PageEntry; geom: PageGeom; scale: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pdf = usePdf("doc" in entry.src ? entry.src.doc : null);
  const full = screenSize({ ...geom, crop: null }, scale);
  const [left, top] = cropOffset(geom, scale);

  useEffect(() => {
    if (!pdf || !("doc" in entry.src) || !canvas.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const index = entry.src.index;
    (async () => {
      try {
        const page = await pdf.getPage(index + 1);
        if (cancelled || !canvas.current) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr, rotation: geom.rotation });
        const c = canvas.current;
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        task = page.render({ canvas: c, viewport });
        await task.promise;
      } catch (e) {
        if (cancelled || (e as { name?: string })?.name === "RenderingCancelledException") return;
        console.warn(`pdf.js ${label} render failed`, e);
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, entry.src, geom.rotation, scale, label]);

  if (!("doc" in entry.src)) return null;
  return <canvas ref={canvas} className="absolute" style={{ left, top, width: full.width, height: full.height }} />;
}
