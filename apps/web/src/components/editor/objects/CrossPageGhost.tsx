"use client";

import { useStore } from "zustand";
import { crossPageStore } from "@/store/crossPage";

/** While an object is dragged over another page: that page outlined, and the object's box following the pointer. */
export function CrossPageGhost() {
  const view = useStore(crossPageStore, (s) => s.view);
  if (!view) return null;
  const page = document.querySelector<HTMLElement>(`[data-testid="page"][data-page-key="${view.pageKey}"]`)?.getBoundingClientRect();
  return (
    <div className="pointer-events-none fixed inset-0 z-40" data-testid="cross-page-ghost">
      {page && <div className="absolute rounded-sm outline outline-2 outline-accent" style={{ left: page.left, top: page.top, width: page.width, height: page.height }} />}
      <div className="absolute border border-dashed border-accent bg-accent/10" style={view.box} />
    </div>
  );
}
