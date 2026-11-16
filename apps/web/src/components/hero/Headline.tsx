import { t } from "@/lib/strings";
import { DotWord } from "./DotWord";
import { PaperLetter } from "./PaperLetter";

/** The start page's headline, "EDIT PDF", made of things on the bench and set as one tight block: "EDIT" printed in
 *  dots exactly as wide as "PDF" under it, the "D" of "PDF" a sheet being edited, and the "F" cut through by the
 *  snap-off cutter, its top half slipping along the cut. */
export function Headline() {
  return (
    <h1 className="relative inline-flex select-none flex-col text-[clamp(4.4rem,21vw,8.5rem)] lg:text-[10.5rem]">
      <span className="sr-only">{t.upload.title}</span>
      {/* No width of its own (w-0), so the "PDF" line sets the block's width and the dots fill it. */}
      <DotWord className="block w-0 min-w-full" />
      <span aria-hidden className="-mt-[0.2em] -mb-[0.1em] flex items-center font-wide font-extrabold leading-[0.86] tracking-[-0.045em] text-accent">
        <span className="pdf-rise">P</span>
        <span className="pdf-rise [animation-delay:.08s]"><PaperLetter /></span>
        <span className="cut-letter pdf-rise relative [animation-delay:.16s]">
          <span className="cut-low">F</span>
          <span className="cut-high absolute inset-0">F</span>
          <span className="cut-line absolute" />
        </span>
      </span>
    </h1>
  );
}

/** Eraser crumbs and graphite dust on the bench, drifting a little; scattered the same on every load. */
export function Crumbs({ className }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none ${className ?? ""}`}>
      {Array.from({ length: 44 }, (_, i) => {
        const x = (i * 37 + 11) % 100;
        const y = (i * 53 + 29) % 100;
        const s = 1.5 + ((i * 7) % 3) * 0.75;
        return (
          <span key={i} className="crumb absolute rounded-full bg-chalk"
            style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, opacity: 0.12 + ((i * 13) % 5) * 0.05, animationDelay: `${-(i % 9)}s`, animationDuration: `${7 + (i % 5)}s` }} />
        );
      })}
    </div>
  );
}
