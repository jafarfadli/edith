/** Drop ratio entries whose page key no longer exists. */
export function pruneRatios(ratios: Map<string, number>, keys: ReadonlySet<string>): void {
  for (const k of [...ratios.keys()]) if (!keys.has(k)) ratios.delete(k);
}

/** Page key with the highest visible ratio among `keys` (stale entries are removed); null if none visible. */
export function pickVisible(ratios: Map<string, number>, keys: ReadonlySet<string>): string | null {
  pruneRatios(ratios, keys);
  let best: string | null = null;
  let bestRatio = 0;
  for (const [k, r] of ratios) if (r > bestRatio) { best = k; bestRatio = r; }
  return best;
}
