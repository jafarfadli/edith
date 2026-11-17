/** A photo or scan of a signature (or a stamp) on paper made see-through where the paper is, so only the ink lands on
 *  the PDF. The paper's brightness is measured in a grid of cells (a phone photo is lit unevenly) and spread smoothly
 *  between them; each pixel's ink is how much darker it is than the paper around it, and its colour is the ink's own
 *  (the paper's light taken out), so a blue pen stays blue. Works on RGBA pixels in place. */

/** Cells across the longer side of the picture for measuring the paper. */
const GRID = 8;
/** Darker than the paper by less than this share: still paper (noise, grain, faint shadow). */
const PAPER_BAND = 0.12;
/** Darker by this share or more: ink through and through. */
const INK_BAND = 0.45;

const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** The paper's brightness of each cell: a bright percentile of its pixels (most of a cell is paper, the ink is a few
 *  strokes). */
function paperGrid(d: Uint8ClampedArray, w: number, h: number): { cols: number; rows: number; level: Float32Array } {
  const cell = Math.max(1, Math.ceil(Math.max(w, h) / GRID));
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const level = new Float32Array(cols * rows);
  const hist = new Uint32Array(256);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      hist.fill(0);
      let n = 0;
      for (let y = r * cell; y < Math.min(h, (r + 1) * cell); y += 2) {
        for (let x = c * cell; x < Math.min(w, (c + 1) * cell); x += 2) { hist[Math.round(luma(d, (y * w + x) * 4))]++; n++; }
      }
      let seen = 0, v = 255;
      for (; v > 0; v--) { seen += hist[v]; if (seen >= n * 0.25) break; } // the 75th percentile
      level[r * cols + c] = Math.max(v, 40);
    }
  }
  return { cols, rows, level };
}

/** Clears the paper of `data` (RGBA, `w` × `h`) to transparent; returns the box of what is left (x, y, w, h), or
 *  null when nothing is (a blank sheet). */
export function clearPaper(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const { cols, rows, level } = paperGrid(data, w, h);
  const cellW = w / cols, cellH = h / rows;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(rows - 1, Math.max(0, (y + 0.5) / cellH - 0.5));
    const r0 = Math.floor(gy), r1 = Math.min(rows - 1, r0 + 1), fy = gy - r0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(cols - 1, Math.max(0, (x + 0.5) / cellW - 0.5));
      const c0 = Math.floor(gx), c1 = Math.min(cols - 1, c0 + 1), fx = gx - c0;
      const paper = (level[r0 * cols + c0] * (1 - fx) + level[r0 * cols + c1] * fx) * (1 - fy)
        + (level[r1 * cols + c0] * (1 - fx) + level[r1 * cols + c1] * fx) * fy;
      const i = (y * w + x) * 4;
      const dark = 1 - luma(data, i) / paper;
      const a = Math.min(1, Math.max(0, (dark - PAPER_BAND) / (INK_BAND - PAPER_BAND)));
      if (a <= 0) { data[i + 3] = 0; continue; }
      // The ink's own colour: the pixel with the paper's light divided out, kept at least as dark as it looked.
      const k = 255 / paper;
      for (let ch = 0; ch < 3; ch++) data[i + ch] = Math.min(data[i + ch], Math.round(Math.min(255, data[i + ch] * k) * 0.85));
      data[i + 3] = Math.round(a * 255);
      if (a > 0.3) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
