/** Things lying on the bench around the work: drawn, flat, in the bench's greys, with the cutter in the one accent.
 *  Decoration only (aria-hidden), never in the way of a pointer. */

type Props = { className?: string; style?: React.CSSProperties };

/** A snap-off cutter, blade to the left, 260 × 48. */
export function Cutter({ className, style }: Props) {
  return (
    <svg viewBox="0 0 260 48" aria-hidden className={className} style={style}>
      <path d="M2 27 36 17h12v15H24z" fill="oklch(84% 0.004 240)" />
      <path d="M2 27 36 17h12v3H35z" fill="oklch(93% 0.003 240)" />
      <path d="M14 30.5 30 18.5M23 31.5 37 19M32 32 44 19" stroke="oklch(66% 0.005 240)" strokeWidth="1" />
      <rect x="45" y="12" width="20" height="24" rx="2.5" fill="oklch(58% 0.004 240)" />
      <rect x="60" y="8" width="194" height="32" rx="10" fill="var(--accent)" />
      <path d="M70 13.5h174" stroke="oklch(100% 0 0 / 0.35)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="150" y="14" width="94" height="20" rx="6" fill="oklch(25% 0.003 80)" />
      <path d="M158 17v14M165 17v14M172 17v14M179 17v14M186 17v14M193 17v14M200 17v14M207 17v14M214 17v14M221 17v14M228 17v14M235 17v14"
        stroke="oklch(34% 0.003 80)" strokeWidth="2" />
      <rect x="98" y="3.5" width="32" height="12" rx="4" fill="oklch(25% 0.003 80)" />
      <path d="M104 6.5v6M110 6.5v6M116 6.5v6M122 6.5v6" stroke="oklch(36% 0.003 80)" strokeWidth="1.5" />
    </svg>
  );
}

/** A pencil, point to the left, 220 × 22. */
export function Pencil({ className, style }: Props) {
  return (
    <svg viewBox="0 0 220 22" aria-hidden className={className} style={style}>
      <path d="M30 3 3 11l27 8z" fill="oklch(78% 0.03 75)" />
      <path d="M11 8.6 3 11l8 2.4z" fill="oklch(30% 0.003 80)" />
      <rect x="30" y="3" width="160" height="16" fill="oklch(88% 0.004 80)" />
      <path d="M30 8.3h160M30 13.7h160" stroke="oklch(80% 0.004 80)" strokeWidth="1" />
      <rect x="190" y="2.5" width="14" height="17" fill="oklch(66% 0.004 80)" />
      <path d="M194 2.5v17M199 2.5v17" stroke="oklch(56% 0.004 80)" strokeWidth="1" />
      <rect x="204" y="3" width="13" height="16" rx="3" fill="oklch(72% 0.03 20)" />
    </svg>
  );
}

/** A binder clip from above, gripping the edge it sits on, 64 × 56. */
export function BinderClip({ className, style }: Props) {
  return (
    <svg viewBox="0 0 64 56" aria-hidden className={className} style={style}>
      <path d="M20 26 14 3h36l-6 23" fill="none" stroke="var(--chalk)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M6 24h52l-5 30H11z" fill="oklch(17% 0.002 80)" />
      <path d="M8 27h48" stroke="oklch(100% 0 0 / 0.14)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
