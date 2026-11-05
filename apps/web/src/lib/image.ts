export function fitImage(pxW: number, pxH: number, pageW: number, pageH: number) {
  const natW = pxW * 0.75, natH = pxH * 0.75;
  const s = Math.min(1, (pageW * 0.5) / natW, (pageH * 0.5) / natH);
  const w = natW * s, h = natH * s;
  return { x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}
