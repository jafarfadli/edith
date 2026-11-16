/** Edith's mark: a sheet cut through by one stroke of a blade, the upper part shifted a little: changed, precisely.
 *  On the bench (dark) only: the sheet is chalk, the cut the cutter's yellow, the fold the bench showing through. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <defs>
        <clipPath id="edith-cut-top"><path d="M0 0H32V11.5L0 23.5Z" /></clipPath>
        <clipPath id="edith-cut-bottom"><path d="M0 23.5 32 11.5V32H0Z" /></clipPath>
      </defs>
      <path clipPath="url(#edith-cut-bottom)" d="M7 4h12l6 6v18H7z" fill="var(--ink)" />
      <g clipPath="url(#edith-cut-top)" transform="translate(.9 -1.6)">
        <path d="M7 4h12l6 6v18H7z" fill="var(--ink)" />
        <path d="M19 4v6h6" fill="none" stroke="var(--base)" strokeWidth="1.4" />
      </g>
      <path d="M2.5 21.8 29.5 11.7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 text-ink">
      <LogoMark size={size} />
      <span className="font-wide text-lg font-bold tracking-tight">Edith</span>
    </span>
  );
}
