export type Rotation = 0 | 90 | 180 | 270;
export interface PageGeom { width: number; height: number; rotation: Rotation }
export type Pt = [number, number];

export function normRotation(deg: number): Rotation {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;
}

export function screenSize(g: PageGeom, scale: number) {
  const swap = g.rotation === 90 || g.rotation === 270;
  return {
    width: (swap ? g.height : g.width) * scale,
    height: (swap ? g.width : g.height) * scale,
  };
}

export function toScreen([x, y]: Pt, g: PageGeom, s: number): Pt {
  const { width: W, height: H } = g;
  switch (g.rotation) {
    case 0: return [x * s, y * s];
    case 90: return [(H - y) * s, x * s];
    case 180: return [(W - x) * s, (H - y) * s];
    case 270: return [y * s, (W - x) * s];
  }
}

export function toPage([X, Y]: Pt, g: PageGeom, s: number): Pt {
  const { width: W, height: H } = g;
  const x = X / s, y = Y / s;
  switch (g.rotation) {
    case 0: return [x, y];
    case 90: return [y, H - x];
    case 180: return [W - x, H - y];
    case 270: return [W - y, x];
  }
}

export function groupTransform(g: PageGeom, s: number) {
  const { width: W, height: H } = g;
  switch (g.rotation) {
    case 0: return { x: 0, y: 0, rotation: 0, scale: s };
    case 90: return { x: H * s, y: 0, rotation: 90, scale: s };
    case 180: return { x: W * s, y: H * s, rotation: 180, scale: s };
    case 270: return { x: 0, y: W * s, rotation: 270, scale: s };
  }
}
