"use client";

import type { BundledFont } from "@edith/ops";
import { cssFamily, fontStore } from "@/lib/fonts";

/** A rendered signature image (transparent PNG). */
export interface SignatureImage { dataUrl: string; width: number; height: number }

const TYPED_PX = 96;   // typed signatures are rendered at this font size (px), then scaled down on the page
const PAD = 8;
const MAX_UPLOAD = { w: 900, h: 300 };

export function scriptFont(family: string): BundledFont {
  return { kind: "bundled", family, bold: false, italic: false };
}

/** A typed name in a bundled script font, cropped to its ink (swashes included). */
export async function renderTyped(text: string, family: string, color: string): Promise<SignatureImage> {
  const font = scriptFont(family);
  await fontStore.load(font); // registers the FontFace the canvas draws with
  const css = `${TYPED_PX}px "${cssFamily(font)}"`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = css;
  const m = probe.measureText(text);
  const left = Math.ceil(m.actualBoundingBoxLeft), right = Math.ceil(m.actualBoundingBoxRight);
  const ascent = Math.ceil(m.actualBoundingBoxAscent), descent = Math.ceil(m.actualBoundingBoxDescent);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, left + right + 2 * PAD);
  canvas.height = Math.max(1, ascent + descent + 2 * PAD);
  const c = canvas.getContext("2d")!;
  c.font = css;
  c.fillStyle = color;
  c.textBaseline = "alphabetic";
  c.fillText(text, PAD + left, PAD + ascent);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/** The drawn part of `canvas` (alpha > 0) plus a margin; null when nothing was drawn. */
export function cropDrawing(canvas: HTMLCanvasElement): SignatureImage | null {
  const c = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const px = c.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const sx = Math.max(0, x0 - PAD), sy = Math.max(0, y0 - PAD);
  const w = Math.min(width, x1 + PAD + 1) - sx, h = Math.min(height, y1 + PAD + 1) - sy;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(canvas, sx, sy, w, h, 0, 0, w, h);
  return { dataUrl: out.toDataURL("image/png"), width: w, height: h };
}

/** An uploaded PNG/JPEG, scaled down to fit MAX_UPLOAD, as a PNG (keeps transparency). */
export async function loadUpload(file: File): Promise<SignatureImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_UPLOAD.w / bitmap.width, MAX_UPLOAD.h / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
