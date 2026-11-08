export type Rotation = 0 | 90 | 180 | 270;
export interface CropBox { x: number; y: number; w: number; h: number }
/** `width`/`height`: the page's unrotated size; `crop`: its visible part (pages.layout crop), in page coordinates. */
export interface PageGeom { width: number; height: number; rotation: Rotation; crop?: CropBox | null }
export type Pt = [number, number];

export function normRotation(deg: number): Rotation {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;
}

/** The visible part of the page in page coordinates (the whole page when it is not cropped). */
export function pageBounds(g: PageGeom): CropBox {
  return g.crop ?? { x: 0, y: 0, w: g.width, h: g.height };
}

/** The visible part as a page of its own: coordinates relative to its top-left corner. */
function visible(g: PageGeom): { geom: PageGeom; dx: number; dy: number } {
  if (!g.crop) return { geom: g, dx: 0, dy: 0 };
  return { geom: { width: g.crop.w, height: g.crop.h, rotation: g.rotation }, dx: g.crop.x, dy: g.crop.y };
}

export function screenSize(g: PageGeom, scale: number) {
  const { width, height } = visible(g).geom;
  const swap = g.rotation === 90 || g.rotation === 270;
  return {
    width: (swap ? height : width) * scale,
    height: (swap ? width : height) * scale,
  };
}

function rotateToScreen(x: number, y: number, W: number, H: number, rotation: Rotation, s: number): Pt {
  switch (rotation) {
    case 0: return [x * s, y * s];
    case 90: return [(H - y) * s, x * s];
    case 180: return [(W - x) * s, (H - y) * s];
    case 270: return [y * s, (W - x) * s];
  }
}

export function toScreen([x, y]: Pt, g: PageGeom, s: number): Pt {
  const v = visible(g);
  return rotateToScreen(x - v.dx, y - v.dy, v.geom.width, v.geom.height, g.rotation, s);
}

export function toPage([X, Y]: Pt, g: PageGeom, s: number): Pt {
  const v = visible(g);
  const { width: W, height: H } = v.geom;
  const x = X / s, y = Y / s;
  let p: Pt;
  switch (g.rotation) {
    case 0: p = [x, y]; break;
    case 90: p = [y, H - x]; break;
    case 180: p = [W - x, H - y]; break;
    case 270: p = [W - y, x]; break;
  }
  return [p[0] + v.dx, p[1] + v.dy];
}

/** Konva attributes of the group that holds a page's objects (page coordinates inside). */
export function groupTransform(g: PageGeom, s: number) {
  const v = visible(g);
  const { width: W, height: H } = v.geom;
  const offset = { offsetX: v.dx, offsetY: v.dy };
  switch (g.rotation) {
    case 0: return { x: 0, y: 0, rotation: 0, scale: s, ...offset };
    case 90: return { x: H * s, y: 0, rotation: 90, scale: s, ...offset };
    case 180: return { x: W * s, y: H * s, rotation: 180, scale: s, ...offset };
    case 270: return { x: 0, y: W * s, rotation: 270, scale: s, ...offset };
  }
}

/** Where the whole (uncropped) page's top-left corner lies relative to the visible part, in screen pixels:
 *  a canvas with the whole page rendered on it goes there. */
export function cropOffset(g: PageGeom, s: number): Pt {
  if (!g.crop) return [0, 0];
  const full: PageGeom = { width: g.width, height: g.height, rotation: g.rotation };
  const { x, y, w, h } = g.crop;
  const corners = ([[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as Pt[]).map((p) => toScreen(p, full, s));
  return [-Math.min(...corners.map((c) => c[0])), -Math.min(...corners.map((c) => c[1]))];
}
