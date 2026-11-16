/** Edith's mark, in plain shapes: a girl in a graduation cap on a tile of the cutter's yellow. An original character. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M7 19a9 9 0 0 1 18 0v7h-4.2v-7h-9.6v7H7z" fill="oklch(24% 0.012 50)" />
      <circle cx="16" cy="20" r="6.6" fill="oklch(90% 0.04 62)" />
      <path d="M9.6 18.4c1.5-3.4 3.7-5 6.4-5s4.9 1.6 6.4 5c-3 0-5.1-.9-6.4-2.4-1.3 1.5-3.4 2.4-6.4 2.4z" fill="oklch(24% 0.012 50)" />
      <circle cx="13.6" cy="21.2" r=".95" fill="oklch(20% 0.01 50)" />
      <circle cx="18.4" cy="21.2" r=".95" fill="oklch(20% 0.01 50)" />
      <path d="M16 4.5 28 9 16 13.5 4 9z" fill="#fff" />
      <path d="M16 9l7.5 2.4v5.4" stroke="oklch(24% 0.012 50)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <circle cx="23.5" cy="17.4" r="1.3" fill="oklch(24% 0.012 50)" />
    </svg>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <LogoMark size={size} />
      <span className="font-wide text-lg font-bold tracking-tight">Edith</span>
    </span>
  );
}
