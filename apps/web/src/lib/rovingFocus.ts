/** Arrow-key movement in a popup list. "vertical": a menu (Up/Down); "both": a row of swatches (all four arrows). */
export type Orientation = "vertical" | "both";

/** The item to focus after `key` from item `i` of `n` (wrapping; Home/End jump), or null when the key does not move.
 *  `i` = -1 (focus on the popup, not an item): Down goes to the first item, Up to the last. */
export function moveIndex(key: string, i: number, n: number, orientation: Orientation): number | null {
  if (n === 0) return null;
  const next = key === "ArrowDown" || (orientation === "both" && key === "ArrowRight");
  const prev = key === "ArrowUp" || (orientation === "both" && key === "ArrowLeft");
  if (next) return (i + 1) % n;
  if (prev) return i < 0 ? n - 1 : (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}
