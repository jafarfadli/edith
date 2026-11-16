"use client";

import { useRef } from "react";
import { t } from "@/lib/strings";

/** What the editor can do, as stickers dropped on the bench under the headline: each one shows its feature instead of
 *  naming it (a highlighted word, a ticked box, a signature, a stamp, a redacted number, a scan, crop marks). They
 *  fall in one after another and can be pushed around with the mouse. Screen readers get the plain list. */

const SCRIBBLE = "M3 26c6-10 10-22 14-20s-6 22-2 22 8-16 12-15-2 11 2 11 6-9 9-8-1 7 3 7 7-5 10-5 4 3 9 1 14-6 18-8";

function Check() {
  return (
    <svg viewBox="0 0 18 18" className="h-[1.05em] w-[1.05em]" aria-hidden>
      <rect x="1.5" y="1.5" width="15" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 9.5 8 12.5 13.5 5.5" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} className="draw-in [animation-delay:1.9s]" />
    </svg>
  );
}

function CropMarks() {
  const corner = "M1 7V1h6";
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="pointer-events-none absolute -inset-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+0.75rem)] overflow-visible" aria-hidden>
      {[[0, 0, 0], [100, 0, 90], [100, 40, 180], [0, 40, 270]].map(([x, y, r]) => (
        <path key={r} d={corner} transform={`translate(${x} ${y}) rotate(${r})`} fill="none" stroke="var(--accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** `at`: a nudge off the row (rem, left and top), so they lie thrown down and overlapping rather than in a row. */
const STICKERS: { rot: number; at: [number, number]; className: string; body: React.ReactNode }[] = [
  {
    rot: -4, at: [0, 0],
    className: "rounded-full bg-paper px-5 py-2.5 font-wide text-xl font-bold tracking-tight text-paper-ink",
    body: <>Edit teks <span className="marker-sweep rounded-[3px] px-1">asli</span></>,
  },
  {
    rot: 7, at: [-0.6, 0.4],
    className: "rounded-full border border-chalk/70 px-4 py-2 font-condensed text-lg font-semibold uppercase tracking-wide text-ink",
    body: <span className="flex items-center gap-2"><Check /> Isi form</span>,
  },
  {
    rot: -9, at: [-0.5, -0.3],
    className: "rounded-full border border-dashed border-line-strong px-4 py-1.5",
    body: (
      <svg viewBox="0 0 90 36" className="h-8 w-20" aria-hidden>
        <path d={SCRIBBLE} fill="none" stroke="var(--chalk)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1}
          className="draw-in [animation-delay:2.1s] [animation-duration:1.6s]" />
      </svg>
    ),
  },
  {
    rot: -13, at: [0.2, -0.5],
    className: "rounded-md border-2 border-accent px-3 py-1 font-wide text-lg font-extrabold uppercase tracking-[0.18em] text-accent-text outline outline-1 outline-offset-2 outline-accent/60",
    body: <>Disetujui</>,
  },
  {
    rot: 3, at: [-0.9, 0.3],
    className: "rounded-full bg-accent px-5 py-2 font-condensed text-xl font-bold uppercase tracking-wide text-accent-ink",
    body: <>Highlight</>,
  },
  {
    rot: -2, at: [-0.4, -0.2],
    className: "rounded-full bg-paper px-4 py-2 font-mono text-sm font-medium text-paper-ink",
    body: <span className="flex items-center gap-2">NIK <span className="inline-block h-[1.1em] w-24 rounded-[2px] bg-paper-ink" /></span>,
  },
  {
    rot: 10, at: [0.3, -0.6],
    className: "ocr-scan relative overflow-hidden rounded-full border border-chalk/70 px-4 py-2 font-mono text-lg font-semibold tracking-[0.3em] text-ink",
    body: <>OCR</>,
  },
  {
    rot: -6, at: [-0.2, -0.4],
    className: "relative mx-2 px-3 py-1 font-wide text-2xl font-extrabold tracking-tight text-ink",
    body: <><CropMarks />Crop</>,
  },
];

export function Stickers() {
  const drag = useRef<{ el: HTMLElement; x: number; y: number; dx: number; dy: number } | null>(null);

  function down(e: React.PointerEvent<HTMLElement>) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = e.currentTarget;
    const [dx, dy] = (el.dataset.at ?? "0,0").split(",").map(Number);
    drag.current = { el, x: e.clientX, y: e.clientY, dx, dy };
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-held");
  }
  function move(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const x = d.dx + e.clientX - d.x, y = d.dy + e.clientY - d.y;
    d.el.style.transform = `translate(${x}px, ${y}px)`;
    d.el.dataset.at = `${x},${y}`;
  }
  function up() {
    drag.current?.el.classList.remove("is-held");
    drag.current = null;
  }

  return (
    <>
      <ul className="sr-only">{t.upload.can.map((item) => <li key={item}>{item}</li>)}</ul>
      <div aria-hidden className="flex max-w-lg flex-wrap items-center gap-x-1.5 gap-y-1">
        {STICKERS.map((s, i) => (
          <span key={i} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            className={`sticker select-none whitespace-nowrap ${s.className}`}
            style={{ "--r": `${s.rot}deg`, marginLeft: `${s.at[0]}rem`, marginTop: `${s.at[1]}rem`, animationDelay: `${1150 + i * 90}ms` } as React.CSSProperties}>
            {s.body}
          </span>
        ))}
      </div>
    </>
  );
}
