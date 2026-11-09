/** Colours drawn on the canvas (Konva and inline styles cannot read CSS variables). They mirror tokens in
 *  app/globals.css: change both together. */
export const CANVAS = {
  /** --accent: selection outlines, transformer handles, the crop rectangle, editable-paragraph outlines. */
  accent: "#246bf6",
  /** Shade outside a crop: --base at 55 %. */
  cropShade: "rgba(14, 15, 18, 0.55)",
  /** --warn on paper: the outline of a text box that runs past its original paragraph. */
  overflow: "#d97706",
  /** A neutral grey on paper: the outline of text that can't be edited (a locked paragraph, an image of print). */
  locked: "#6b7280",
  /** --warn on paper: the outline of a paragraph OCR read with low confidence ("perlu dicek", M5d). */
  ocrLow: "#d97706",
  /** The "hasil OCR" badge over an OCR paragraph: --raised and --ink. */
  badge: "#2f3138",
  badgeInk: "#f1f2f4",
} as const;
