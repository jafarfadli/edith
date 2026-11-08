"use client";

import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";

export function scrollToPage(pageKey: string) {
  // The page itself, not its thumbnail (which carries the same data-page-key and comes first in the DOM).
  document.querySelector(`[data-testid="page"][data-page-key="${pageKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ZoomPill() {
  const zoom = useEditor((s) => s.zoom);
  const pages = useEditor((s) => s.doc.pages);
  const current = useEditor((s) => s.currentPage);
  const tool = useEditor((s) => s.tool);
  const idx = Math.max(0, pages.findIndex((p) => p.pageKey === current));
  const go = (d: number) => { const p = pages[idx + d]; if (p) scrollToPage(p.pageKey); };
  const s = editorStore.getState();
  const btn = "grid h-8 w-8 place-items-center rounded-full hover:bg-white/15 disabled:opacity-40";

  return (
    <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink px-2 py-1 text-sm text-white shadow-lg">
      <button className={btn} onClick={() => go(-1)} disabled={idx === 0} aria-label={t.editor.prevPage}>‹</button>
      <span data-testid="page-indicator" className="min-w-14 text-center tabular-nums">{pages.length ? idx + 1 : 0}/{pages.length}</span>
      <button className={btn} onClick={() => go(1)} disabled={idx >= pages.length - 1} aria-label={t.editor.nextPage}>›</button>
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button className={btn} onClick={() => s.setZoom(Math.round((zoom - 0.1) * 10) / 10)} aria-label={t.editor.zoomOut}>−</button>
      <span className="min-w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button className={btn} onClick={() => s.setZoom(Math.round((zoom + 0.1) * 10) / 10)} aria-label={t.editor.zoomIn}>+</button>
      <span className="mx-1 h-5 w-px bg-white/20" />
      <button className={`${btn} ${tool === "pan" ? "bg-white/20" : ""}`} onClick={() => s.setTool(tool === "pan" ? "select" : "pan")} aria-label={t.editor.pan} aria-pressed={tool === "pan"}>✋</button>
    </div>
  );
}
