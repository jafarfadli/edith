/** What lies around the blank sheet on the start page, beyond the pencil and the cutter: the sheet under it peeking
 *  out, a paper clip on its edge, a ring left by a mug on the bench, and the sheet's size measured off in chalk like
 *  a technical drawing (A4, 210 × 297 mm), the lines growing once. Decoration only: aria-hidden, never in
 *  the way of the pointer. Placed inside the sheet's box, which it overhangs. */

/** An arrowhead in chalk, pointing left (turned for the other ends). */
function Head({ turn }: { turn: number }) {
  return (
    <svg viewBox="0 0 8 8" className="h-2 w-2 shrink-0" style={{ rotate: `${turn}deg` }}>
      <path d="M7 1 1 4l6 3" fill="none" stroke="var(--chalk)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A dimension line along the box it is given, as on a technical drawing: end ticks, arrowheads, the measure in the
 *  middle; the line grows out from the label once. */
function Dimension({ vertical, label, className }: { vertical?: boolean; label: string; className: string }) {
  const tick = vertical ? "h-px w-3.5" : "h-3.5 w-px";
  const line = `measure-grow flex-1 bg-chalk/60 ${vertical ? "w-px" : "h-px"}`;
  return (
    <div className={`absolute flex items-center opacity-70 ${vertical ? "flex-col" : ""} ${className}`}>
      <span className={`shrink-0 bg-chalk/60 ${tick}`} />
      <Head turn={vertical ? 90 : 0} />
      <span className={`${line} ${vertical ? "origin-bottom" : "origin-right"}`} />
      <span className={`shrink-0 whitespace-nowrap px-2 font-mono text-2xs text-chalk ${vertical ? "py-2 [writing-mode:vertical-rl]" : ""}`}>{label}</span>
      <span className={`${line} ${vertical ? "origin-top" : "origin-left"}`} />
      <Head turn={vertical ? 270 : 180} />
      <span className={`shrink-0 bg-chalk/60 ${tick}`} />
    </div>
  );
}

export function SheetDecor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
      {/* The mug ring, behind everything, half under the sheet's left edge. */}
      <svg viewBox="0 0 100 100" className="absolute -left-28 top-[26%] -z-20 w-44 rotate-12 opacity-[0.14]">
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--chalk)" strokeWidth="5" strokeDasharray="70 6 120 4 40 10" />
        <circle cx="50" cy="50" r="36.5" fill="none" stroke="var(--chalk)" strokeWidth="1.2" strokeDasharray="40 14 90 8" />
      </svg>
      {/* The sheet underneath, a little turned. */}
      <div className="animate-settle absolute inset-0 -z-10 translate-x-3 translate-y-2 rotate-[4deg] rounded-[2px] bg-[oklch(93%_0.003_80)] shadow-sheet [animation-delay:.1s]">
        <div className="absolute bottom-10 right-4 flex w-1/3 flex-col items-end gap-1.5">
          <span className="h-1 w-full rounded-full bg-paper-ink/15" />
          <span className="h-1 w-2/3 rounded-full bg-paper-ink/15" />
        </div>
      </div>
      {/* A paper clip over the sheet's right edge. */}
      <svg viewBox="0 0 22 50" className="absolute -right-2.5 top-[22%] z-10 w-5 rotate-[8deg] drop-shadow-[0_2px_2px_oklch(0%_0_0/0.35)]">
        <path d="M7 34V9a5 5 0 0 1 10 0v29a7.5 7.5 0 0 1-15 0V14" fill="none" stroke="oklch(80% 0.006 240)" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <Dimension label="210 mm" className="inset-x-0 -top-16 h-4 [@media(max-height:780px)]:hidden" />
      <Dimension vertical label="297 mm" className="inset-y-0 -right-12 w-4 max-xl:hidden" />
    </div>
  );
}
