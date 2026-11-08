"use client";

import { useEffect, useRef, useState } from "react";
import { screenSize, type PageGeom } from "@/lib/coords";
import type { PageEntry } from "@/store/editor";
import { PageCanvas } from "./PageCanvas";

export type OverlayRender = (args: { pageKey: string; geom: PageGeom; scale: number }) => React.ReactNode;

export function PageView({ entry, geom, scale, overlay, onVisible }: {
  entry: PageEntry; geom: PageGeom; scale: number;
  overlay?: OverlayRender; onVisible?: (key: string, ratio: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
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

  return (
    <div
      ref={wrap}
      data-testid="page"
      data-page-key={entry.pageKey}
      className="relative mx-auto overflow-hidden bg-white shadow-sm ring-1 ring-line"
      style={{ width: size.width, height: size.height }}
    >
      {near && <PageCanvas entry={entry} geom={geom} scale={scale} label="page" />}
      {near && overlay?.({ pageKey: entry.pageKey, geom, scale })}
    </div>
  );
}
