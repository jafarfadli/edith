"use client";

import { useState } from "react";
import { Loader2, ScanText, X } from "lucide-react";
import type { Rect } from "@edith/ops";
import { toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { areaKey, isLowConfidence, ocrQualityMessage } from "@/lib/ocr";
import { srcKey } from "@/lib/sources";
import { t } from "@/lib/strings";
import { useEditor } from "@/store/editor";
import { imageTextOf, isPrint, ocrStateOf, PAGE_RUN, useText } from "@/store/text";
import type { ImageTextRect } from "@/lib/api";
import { ICON_SM } from "../../ui/icon";
import { POPOVER } from "../../ui/styles";
import { runPageOcr } from "./ocrRun";

/** Gap (px) between the pill and the picture's top-right corner, inside the picture. */
const INSET = 8;
/** Gap (px) for the small button of a picture that may hold text (it is often small: a logo, one line). */
const SMALL_INSET = 2;
const NONE: ImageTextRect[] = [];
/** Pictures that may hold text one page shows a button on, at most. */
const MAX_MAYBE = 6;

/** The box of `rects` as shown (the page may be turned), in screen pixels. */
function shown(rects: Rect[], geom: PageGeom, scale: number) {
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  const corners = ([[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as Pt[]).map((p) => toScreen(p, geom, scale));
  return { right: Math.max(...corners.map((c) => c[0])), top: Math.min(...corners.map((c) => c[1])), bottom: Math.max(...corners.map((c) => c[1])) };
}

/** The top-right corner of `rects` as shown, as CSS for a box placed inside it. */
function corner(rects: Rect[], geom: PageGeom, scale: number, inset: number) {
  const { right, top } = shown(rects, geom, scale);
  return { right: `calc(100% - ${right - inset}px)`, top: top + inset } as const;
}

/** Size (px) of the small button of a picture that may hold text, and the least it shrinks to in a thin picture. */
const SMALL = 24, SMALLEST = 16;

/** The small button inside the picture's top-right corner; in a picture too thin for it (one pictured line) smaller
 *  and centred on the picture's height, so it covers neither what lies above nor below (a rule under a letterhead). */
function smallPlace(r: Rect, geom: PageGeom, scale: number) {
  const { right, top, bottom } = shown([r], geom, scale);
  const h = bottom - top;
  const size = Math.round(Math.min(SMALL, Math.max(SMALLEST, h - 2 * SMALL_INSET)));
  const y = h >= size + 2 * SMALL_INSET ? top + SMALL_INSET : top + (h - size) / 2;
  return { right: `calc(100% - ${right - SMALL_INSET}px)`, top: y, width: size, height: size } as const;
}

/** Over the top-right corner of a page's pictures of print (M5d): "Kenali teks (OCR)" until OCR of the page ran (again
 *  after it failed), "Mengenali teks…" while it runs (any OCR of the document: one at a time), then what it found. Over
 *  each picture that only maybe holds text (a logo with its name, one pictured line): a small button reading that
 *  picture alone, until it was read. */
export function OcrButton({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const src = useEditor((s) => {
    const entry = s.doc.pages.find((p) => p.pageKey === pageKey);
    return entry && "doc" in entry.src ? entry.src : null;
  });
  const rects = useText((s) => (src ? imageTextOf(src, s.imageText) : NONE));
  const state = useText((s) => (src ? ocrStateOf(src, s.ocr) : undefined));
  const busy = useText((s) => !!src && Object.entries(s.ocr).some(([k, v]) => v.status === "loading" && k.startsWith(src.doc + ":")
    && k !== srcKey(src.doc, src.index)));
  const [hidden, setHidden] = useState(false);
  if (!src || !rects.length) return null;
  const print = rects.filter(isPrint);
  // A page of many such pictures (icons, a gallery of logos) shows none of their buttons: the picture's menu and the
  // area tool still read any of them.
  const maybeAll = rects.filter((r) => !isPrint(r));
  const maybe = maybeAll.length > MAX_MAYBE ? [] : maybeAll.filter((r) => !state?.areas?.includes(areaKey(r)));
  const loading = state?.status === "loading";
  const pill = `absolute z-[12] inline-flex h-7 max-w-[calc(100%-16px)] items-center gap-1.5 px-2.5 text-xs ${POPOVER}`;

  let main: React.ReactNode = null;
  if (print.length && !(hidden && state?.full && !loading)) {
    const place = corner(print, geom, scale, INSET);
    if (state?.full && !loading) {
      const why = ocrQualityMessage(state.quality ?? "empty", state.angle ?? 0);
      const low = state.paragraphs.filter(isLowConfidence).length;
      main = (
        // Clicks go through the pill to the page under it (an OCR paragraph or object in the picture's corner); only its
        // close button takes them.
        <div role="status" data-testid="ocr-status" title={why ?? t.ocr.foundHint} className={`${pill} pointer-events-none cursor-default pr-1`} style={place}>
          <ScanText {...ICON_SM} className={why ? "text-muted" : "text-accent-text"} />
          {why ? <span className="truncate text-muted">{t.ocr.short[state.quality as keyof typeof t.ocr.short] ?? why}</span> : (
            <span className="truncate">
              {t.ocr.found(state.paragraphs.length)}
              {low > 0 && <span className="text-warn"> · {t.ocr.toCheck(low)}</span>}
            </span>
          )}
          <button type="button" aria-label={t.ocr.hideStatus} title={t.ocr.hideStatus} data-testid="ocr-status-close"
            className="pointer-events-auto grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:bg-line hover:text-ink"
            onPointerDown={(e) => e.stopPropagation()} onClick={() => setHidden(true)}>
            <X size={12} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      );
    } else {
      const running = loading && state?.running === PAGE_RUN;
      main = (
        <button type="button" data-testid="ocr-button" title={t.ocr.hint} disabled={loading || busy} aria-busy={running}
          className={`${pill} font-medium transition-colors hover:bg-line disabled:cursor-default disabled:hover:bg-raised`} style={place}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => { void runPageOcr(src.doc, src.index); }}>
          {running ? <Loader2 {...ICON_SM} className="animate-spin text-accent-text" /> : <ScanText {...ICON_SM} className="text-accent-text" />}
          {running ? t.ocr.running : t.ocr.run}
        </button>
      );
    }
  }
  return (
    <>
      {main}
      {maybe.map((r) => {
        const running = loading && state?.running === areaKey(r);
        return (
          <button key={areaKey(r)} type="button" data-testid="ocr-maybe" aria-label={t.ocr.maybe} title={t.ocr.maybe}
            disabled={loading || busy} aria-busy={running}
            className={`absolute z-[12] grid place-items-center ${POPOVER} transition-colors hover:bg-line disabled:cursor-default disabled:hover:bg-raised`}
            style={smallPlace(r, geom, scale)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { void runPageOcr(src.doc, src.index, { x: r.x, y: r.y, w: r.w, h: r.h }); }}>
            {running ? <Loader2 {...ICON_SM} className="animate-spin text-accent-text" /> : <ScanText {...ICON_SM} className="text-accent-text" />}
          </button>
        );
      })}
    </>
  );
}
