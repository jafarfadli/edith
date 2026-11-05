"use client";

import { useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { screenSize, type PageGeom } from "@/lib/coords";
import type { PageEntry } from "@/store/editor";

const THUMB_W = 120;

export function Thumbnail({ pdf, entry, geom }: { pdf: PDFDocumentProxy; entry: PageEntry; geom: PageGeom }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = screenSize(geom, 1);
  const scale = THUMB_W / base.width;
  const size = screenSize(geom, scale);

  useEffect(() => {
    if (!("doc" in entry.src) || !canvas.current) return;
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
        console.warn("pdf.js thumbnail render failed", e);
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, entry.src, geom.rotation, scale]);

  return (
    <div className="relative bg-white ring-1 ring-line" style={{ width: size.width, height: size.height }}>
      {"doc" in entry.src && <canvas ref={canvas} style={{ width: size.width, height: size.height }} />}
    </div>
  );
}
