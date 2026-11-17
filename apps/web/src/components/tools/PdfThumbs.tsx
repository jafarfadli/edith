"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { destroyPdf, loadPdf } from "@/lib/pdf";
import { t } from "@/lib/strings";
import type { ToolOptions } from "@/lib/tools";

/** Width the pages are drawn at, CSS px. */
const THUMB = 160;

/** The PDF a tool is about to work on, page by page, before it runs: to see where things are (where the roman numbers
 *  should stop, which pages to take). `labels`: text shown on a page where the tool will write it (`position`), e.g.
 *  its page number to be; `picked`: pages shown chosen; `onPick`: a press on a page (1-based). A locked PDF shows
 *  nothing. */
export function PdfThumbs({ file, labels, position = "bottom-center", picked, accent, onPick, pickTitle, onPages }: {
  file: File;
  labels?: Map<number, string> | null;
  position?: ToolOptions["position"];
  picked?: Set<number>;
  /** Pages whose label stands out (the roman part). */
  accent?: (n: number) => boolean;
  onPick?: (n: number) => void;
  pickTitle?: (n: number) => string;
  onPages?: (total: number) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const report = useRef(onPages);
  useEffect(() => { report.current = onPages; });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    let live = true;
    let doc: PDFDocumentProxy | null = null;
    loadPdf(url).then((d) => {
      doc = d;
      if (!live) return;
      setPdf(d);
      report.current?.(d.numPages);
    }, () => { if (live) setPdf(null); });
    return () => { live = false; URL.revokeObjectURL(url); if (doc) destroyPdf(doc); };
  }, [file]);

  if (!pdf) return null;
  return (
    <div className="max-h-[28rem] overflow-y-auto rounded-lg bg-canvas p-3 ring-1 ring-inset ring-line" data-testid="tool-preview">
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
        {Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((n) => (
          <Thumb key={n} pdf={pdf} n={n} label={labels?.get(n)} position={position} picked={picked?.has(n) ?? false}
            accent={accent?.(n) ?? false} onPick={onPick} title={pickTitle?.(n)} />
        ))}
      </ol>
    </div>
  );
}

function Thumb({ pdf, n, label, position, picked, accent, onPick, title }: {
  pdf: PDFDocumentProxy; n: number; label?: string; position: ToolOptions["position"]; picked: boolean; accent: boolean;
  onPick?: (n: number) => void; title?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setNear(true); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let live = true;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (THUMB * (window.devicePixelRatio || 1)) / base.width });
      const c = canvas.current;
      if (!live || !c) return;
      setRatio(base.height / base.width);
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = page.render({ canvas: c, viewport: vp });
      await task.promise.catch(() => undefined);
    })().catch(() => undefined);
    return () => { live = false; task?.cancel(); };
  }, [near, pdf, n]);

  const [vert, horiz] = position.split("-");
  const Tag = onPick ? "button" : "div";
  return (
    <li className="flex flex-col items-center gap-1">
      <Tag type={onPick ? "button" : undefined} onClick={onPick ? () => onPick(n) : undefined} title={title}
        aria-pressed={onPick ? picked : undefined} aria-label={onPick ? title ?? t.pages.pageN(n) : undefined} data-testid="tool-thumb"
        className={`relative w-full overflow-hidden rounded-[2px] bg-paper shadow-sheet transition-shadow ${picked ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas" : ""} ${onPick ? "cursor-pointer hover:ring-2 hover:ring-accent/60 hover:ring-offset-2 hover:ring-offset-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" : ""}`}
        style={{ aspectRatio: `1 / ${ratio}` }}>
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        {label && (
          <span data-testid="thumb-label"
            className={`absolute rounded px-1 py-px font-mono text-[10px] font-semibold leading-tight shadow-sm ${accent ? "bg-accent text-accent-ink" : "bg-ink text-base"} ${vert === "top" ? "top-1.5" : "bottom-1.5"} ${horiz === "left" ? "left-1.5" : horiz === "right" ? "right-1.5" : "left-1/2 -translate-x-1/2"}`}>
            {label}
          </span>
        )}
      </Tag>
      <span className="text-2xs tabular-nums text-faint">{n}</span>
    </li>
  );
}
