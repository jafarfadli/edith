"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { screenSize, type PageGeom } from "@/lib/coords";
import type { PageEntry } from "@/store/editor";

export type OverlayRender = (args: { pageKey: string; geom: PageGeom; scale: number }) => React.ReactNode;

export function PageView({ pdf, entry, geom, scale, overlay, onVisible }: {
  pdf: PDFDocumentProxy; entry: PageEntry; geom: PageGeom; scale: number;
  overlay?: OverlayRender; onVisible?: (key: string, ratio: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const size = screenSize(geom, scale);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { setNear(e.isIntersecting); },
      { root: document.getElementById("page-scroller"), rootMargin: "100% 0px" },
    );
    const vis = new IntersectionObserver(
      ([e]) => onVisible?.(entry.pageKey, e.intersectionRatio),
      { root: document.getElementById("page-scroller"), threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(el);
    vis.observe(el);
    return () => { io.disconnect(); vis.disconnect(); onVisible?.(entry.pageKey, 0); };
  }, [entry.pageKey, onVisible]);

  useEffect(() => {
    if (!near || !("doc" in entry.src) || !canvas.current) return;
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
        console.warn("pdf.js render failed", e);
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [near, pdf, entry.src, geom.rotation, scale]);

  return (
    <div
      ref={wrap}
      data-testid="page"
      data-page-key={entry.pageKey}
      className="relative mx-auto bg-white shadow-sm ring-1 ring-line"
      style={{ width: size.width, height: size.height }}
    >
      {"doc" in entry.src && near && (
        <canvas ref={canvas} className="absolute inset-0" style={{ width: size.width, height: size.height }} />
      )}
      {near && overlay?.({ pageKey: entry.pageKey, geom, scale })}
    </div>
  );
}
