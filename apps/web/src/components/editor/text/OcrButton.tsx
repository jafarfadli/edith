"use client";

import { Loader2, ScanText } from "lucide-react";
import type { Rect } from "@edith/ops";
import { toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { isLowConfidence, ocrQualityMessage } from "@/lib/ocr";
import { srcKey } from "@/lib/sources";
import { t } from "@/lib/strings";
import { useEditor } from "@/store/editor";
import { imageTextOf, ocrStateOf, useText } from "@/store/text";
import { ICON_SM } from "../../ui/icon";
import { POPOVER } from "../../ui/styles";
import { runPageOcr } from "./ocrRun";

/** Gap (px) between the pill and the picture's top-right corner, inside the picture. */
const INSET = 8;
const NONE: Rect[] = [];

/** Over the top-right corner of a page's pictures of print (M5d): "Kenali teks (OCR)" until OCR ran (again after it
 *  failed), "Mengenali teks…" while it runs (any page of the document: one at a time), then what it found. */
export function OcrButton({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const src = useEditor((s) => {
    const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
    return entry && "doc" in entry.src ? entry.src : null;
  });
  const rects = useText((s) => (src ? imageTextOf(src, s.imageText) : NONE));
  const state = useText((s) => (src ? ocrStateOf(src, s.ocr) : undefined));
  const busy = useText((s) => !!src && Object.entries(s.ocr).some(([k, v]) => v.status === "loading" && k.startsWith(src.doc + ":")
    && k !== srcKey(src.doc, src.index)));
  if (!src || !rects.length) return null;

  // The top-right corner of the pictures, as shown (the page may be turned).
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  const corners = ([[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as Pt[]).map((p) => toScreen(p, geom, scale));
  const right = Math.max(...corners.map((c) => c[0])), top = Math.min(...corners.map((c) => c[1]));
  const place = { right: `calc(100% - ${right - INSET}px)`, top: top + INSET } as const;
  const pill = `absolute z-[12] inline-flex h-7 max-w-[calc(100%-16px)] items-center gap-1.5 px-2.5 text-xs ${POPOVER}`;

  if (state?.status === "ready") {
    const why = ocrQualityMessage(state.quality ?? "empty", state.angle ?? 0);
    const low = state.paragraphs.filter(isLowConfidence).length;
    return (
      <div role="status" data-testid="ocr-status" title={why ?? t.ocr.foundHint} className={`${pill} pointer-events-auto cursor-default`} style={place}
        onPointerDown={(e) => e.stopPropagation()}>
        <ScanText {...ICON_SM} className={why ? "text-muted" : "text-accent-text"} />
        {why ? <span className="truncate text-muted">{t.ocr.short[state.quality as keyof typeof t.ocr.short] ?? why}</span> : (
          <span className="truncate">
            {t.ocr.found(state.paragraphs.length)}
            {low > 0 && <span className="text-warn"> · {t.ocr.toCheck(low)}</span>}
          </span>
        )}
      </div>
    );
  }
  const running = state?.status === "loading";
  return (
    <button type="button" data-testid="ocr-button" title={t.ocr.hint} disabled={running || busy} aria-busy={running}
      className={`${pill} font-medium transition-colors hover:bg-line disabled:cursor-default disabled:hover:bg-raised`} style={place}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => { void runPageOcr(src.doc, src.index); }}>
      {running ? <Loader2 {...ICON_SM} className="animate-spin text-accent-text" /> : <ScanText {...ICON_SM} className="text-accent-text" />}
      {running ? t.ocr.running : t.ocr.run}
    </button>
  );
}
