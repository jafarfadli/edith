/** A file one tool page hands to the next ("Lanjutkan dengan"), so the result of Merge goes into Compress without being
 *  downloaded and chosen again. Kept in memory: it lives as long as the page does, across client-side navigation. */
let pending: File | null = null;

export function handOff(file: File): void {
  pending = file;
}

/** The handed file, if any (left in place: a component may read it twice while it mounts). */
export function peekHandoff(): File | null {
  return pending;
}

export function clearHandoff(): void {
  pending = null;
}
