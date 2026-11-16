import { t } from "@/lib/strings";
import { DotWord } from "./DotWord";
import { PaperLetter } from "./PaperLetter";

/** The start page's headline, "EDIT PDF", as one block filling the width it is given: "EDIT" printed in dots across
 *  the full width, and "PDF" under it sized to the same width (a container query), its "D" a sheet being edited and its
 *  "F" cut through by the snap-off cutter, the top half slipping along the cut. On a wide screen the two words drift
 *  apart as the page scrolls. */
export function Headline({ className }: { className?: string }) {
  return (
    <h1 className={`@container select-none ${className ?? ""}`}>
      <span className="sr-only">{t.upload.title}</span>
      <span aria-hidden className="hero-edit block"><DotWord className="block w-full" /></span>
      <span aria-hidden className="hero-pdf -mt-[6.5cqw] -mb-[3cqw] flex items-center font-wide text-[45cqw] font-extrabold leading-[0.86] tracking-[-0.045em] text-accent">
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
