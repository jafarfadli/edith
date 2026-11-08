"use client";

import { useCallback, useEffect, useRef } from "react";
import { useStore } from "zustand";
import { pickVisible, pruneRatios } from "@/lib/visible";
import { editorStore, pageGeom, useEditor } from "@/store/editor";
import { cropStore } from "./pages/cropStore";
import { PageView, type OverlayRender } from "./PageView";

export function PageList({ overlay }: { overlay?: OverlayRender }) {
  const pages = useEditor((s) => s.doc.pages);
  const info = useEditor((s) => s.info)!;
  const zoom = useEditor((s) => s.zoom);
  const cropping = useStore(cropStore, (s) => s.pageKey);
  const ratios = useRef(new Map<string, number>());

  const keys = useRef<ReadonlySet<string>>(new Set(pages.map((p) => p.pageKey)));

  useEffect(() => {
    keys.current = new Set(pages.map((p) => p.pageKey));
    pruneRatios(ratios.current, keys.current);
  }, [pages]);

  const onVisible = useCallback((key: string, ratio: number) => {
    ratios.current.set(key, ratio);
    const best = pickVisible(ratios.current, keys.current);
    if (best && best !== editorStore.getState().currentPage) editorStore.getState().setCurrentPage(best);
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 px-6 py-8">
      {pages.map((entry) => (
        <PageView key={entry.pageKey} entry={entry} geom={pageGeom(entry.pageKey === cropping ? { ...entry, crop: null } : entry, info)} scale={zoom} overlay={overlay} onVisible={onVisible} />
      ))}
    </div>
  );
}
