/** Edith's mark: a girl graduating, her mortarboard a sheet of paper with its corner folded (the sheet of the icons),
 *  the tassel and stole in the cutter's yellow. An original character, drawn for the bench (dark) background. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={className}>
      <path d="M13 64c1.2-8 8-12.5 19-12.5S49.8 56 51 64z" fill="oklch(19% 0.002 80)" stroke="var(--ink)" strokeWidth="1.4" />
      <path d="M25.5 52.2 32 58.5l6.5-6.3" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M16.5 38c0-10 6.5-16.5 15.5-16.5S47.5 28 47.5 38v8.5c-2.4 2-5.6 2-8 0V37h-15v9.5c-2.4 2-5.6 2-8 0z"
        fill="oklch(26% 0.012 50)" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" />
      <ellipse cx="32" cy="39.5" rx="11.5" ry="12.5" fill="oklch(90% 0.04 60)" />
      <path d="M20.6 34.5c1.6-6.6 6.2-10 11.4-10 5.3 0 9.8 3.3 11.4 9.3-3.6-.9-6.8-3.6-8.4-6.3-2.6 3.8-8 6.5-14.4 7z" fill="oklch(26% 0.012 50)" />
      <ellipse cx="27.3" cy="40.6" rx="1.8" ry="2.2" fill="oklch(20% 0.01 50)" />
      <ellipse cx="36.7" cy="40.6" rx="1.8" ry="2.2" fill="oklch(20% 0.01 50)" />
      <circle cx="27.9" cy="39.8" r=".6" fill="#fff" />
      <circle cx="37.3" cy="39.8" r=".6" fill="#fff" />
      <circle cx="24.2" cy="44.6" r="1.9" fill="oklch(74% 0.09 35)" opacity=".45" />
      <circle cx="39.8" cy="44.6" r="1.9" fill="oklch(74% 0.09 35)" opacity=".45" />
      <path d="M29.8 46c1.3 1.3 3.1 1.3 4.4 0" fill="none" stroke="oklch(20% 0.01 50)" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M21.5 23.5c0-2.2 4.7-3.7 10.5-3.7s10.5 1.5 10.5 3.7v3.3c-3.1-1.7-6.8-2.4-10.5-2.4s-7.4.7-10.5 2.4z"
        fill="oklch(19% 0.002 80)" stroke="var(--ink)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M32 7 51.6 14.1v4.2L32 25.5 6 16.2z" fill="oklch(97% 0.004 90)" />
      <path d="M51.6 14.1v4.2l-5.2-1.9z" fill="oklch(82% 0.005 90)" />
      <path d="M32 16.2 47.5 19.8V30" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M45.9 29.5h3.2l.8 5h-4.8z" fill="var(--accent)" />
      <circle cx="32" cy="16.2" r="1.5" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 text-ink">
      <LogoMark size={size} />
      <span className="font-wide text-lg font-bold tracking-tight">Edith</span>
    </span>
  );
}
