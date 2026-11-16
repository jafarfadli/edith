/** Pencil marks on the bench: each path draws itself once (pathLength 1 + `draw-in`), one after another. */

const STROKE = { fill: "none", stroke: "var(--chalk)", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", pathLength: 1 } as const;

/** A loose hand-drawn ring around a word, 120 × 48 (scaled to the word). */
export function Ring({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden className={className}>
      <path {...STROKE} className="draw-in" style={{ animationDelay: `${delay}ms` }}
        d="M70 5C40 2 9 8 5 22c-4 14 24 22 56 21s56-7 54-21C113 9 86 4 52 6" />
    </svg>
  );
}

/** A curved arrow, drawn from the left end to the head, 160 × 90. */
export function Arrow({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 160 90" aria-hidden className={className}>
      <path {...STROKE} className="draw-in" style={{ animationDelay: `${delay}ms` }} d="M4 70C30 82 70 84 100 62s42-40 50-52" />
      <path {...STROKE} className="draw-in" style={{ animationDelay: `${delay + 500}ms` }} d="M134 16l16-8 1 18" />
    </svg>
  );
}
