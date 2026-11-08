"use client";

import { ChevronLeft, ChevronRight, Hand, Minus, Plus } from "lucide-react";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { toolKey } from "@/lib/toolKeys";
import { ICON } from "../ui/icon";
import { Tip } from "../ui/Tooltip";

export function scrollToPage(pageKey: string) {
  // The page itself, not its thumbnail (which carries the same data-page-key and comes first in the DOM).
  document.querySelector(`[data-testid="page"][data-page-key="${pageKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Page and zoom controls floating at the bottom of the canvas. */
export function ZoomPill() {
  const zoom = useEditor((s) => s.zoom);
  const pages = useEditor((s) => s.doc.pages);
  const current = useEditor((s) => s.currentPage);
  const tool = useEditor((s) => s.tool);
  const idx = Math.max(0, pages.findIndex((p) => p.pageKey === current));
  const go = (d: number) => { const p = pages[idx + d]; if (p) scrollToPage(p.pageKey); };
  const s = editorStore.getState();
  const btn = "grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:text-faint/60";

  return (
    <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-panel p-1 text-xs text-ink shadow-pop">
      <button className={btn} onClick={() => go(-1)} disabled={idx === 0} aria-label={t.editor.prevPage}><ChevronLeft {...ICON} /></button>
      <span data-testid="page-indicator" className="min-w-12 text-center tabular-nums">{pages.length ? idx + 1 : 0}/{pages.length}</span>
      <button className={btn} onClick={() => go(1)} disabled={idx >= pages.length - 1} aria-label={t.editor.nextPage}><ChevronRight {...ICON} /></button>
      <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />
      <button className={btn} onClick={() => s.setZoom(Math.round((zoom - 0.1) * 10) / 10)} aria-label={t.editor.zoomOut}><Minus {...ICON} /></button>
      <span className="min-w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button className={btn} onClick={() => s.setZoom(Math.round((zoom + 0.1) * 10) / 10)} aria-label={t.editor.zoomIn}><Plus {...ICON} /></button>
      <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />
      <Tip label={t.editor.pan} keys={toolKey("pan")} side="top">
        <button className={`${btn} ${tool === "pan" ? "bg-accent/20 text-accent-text" : ""}`} onClick={() => s.setTool(tool === "pan" ? "select" : "pan")}
          aria-label={t.editor.pan} aria-pressed={tool === "pan"}><Hand {...ICON} /></button>
      </Tip>
    </div>
  );
}
