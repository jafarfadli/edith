# Task 10: `coords.ts` — page ↔ screen transform

**Files:**
- Create: `apps/web/src/lib/coords.ts`, `apps/web/src/lib/coords.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export type Rotation = 0 | 90 | 180 | 270;
export interface PageGeom { width: number; height: number; rotation: Rotation } // unrotated CropBox size in pt + total rotation (source + layout)
export type Pt = [number, number];
export function normRotation(deg: number): Rotation;
export function screenSize(g: PageGeom, scale: number): { width: number; height: number };
export function toScreen(p: Pt, g: PageGeom, scale: number): Pt;
export function toPage(p: Pt, g: PageGeom, scale: number): Pt;
export function groupTransform(g: PageGeom, scale: number): { x: number; y: number; rotation: number; scale: number }; // Konva Group props so children use page coords
```
Rotation is clockwise, matching PDF `/Rotate` and pdf.js viewports. Page coords: origin top-left of the unrotated CropBox, points.

- [ ] **Step 1: Failing tests**

`apps/web/src/lib/coords.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupTransform, normRotation, screenSize, toPage, toScreen, type PageGeom, type Pt } from "@/lib/coords";

const W = 200, H = 300;
const g = (rotation: 0 | 90 | 180 | 270): PageGeom => ({ width: W, height: H, rotation });

function applyGroup(p: Pt, t: ReturnType<typeof groupTransform>): Pt {
  const r = (t.rotation * Math.PI) / 180;
  const x = p[0] * t.scale, y = p[1] * t.scale;
  return [t.x + x * Math.cos(r) - y * Math.sin(r), t.y + x * Math.sin(r) + y * Math.cos(r)];
}

describe("coords", () => {
  it("normalizes rotation", () => {
    expect(normRotation(-90)).toBe(270);
    expect(normRotation(450)).toBe(90);
    expect(normRotation(360)).toBe(0);
  });

  it("swaps screen size for 90/270", () => {
    expect(screenSize(g(0), 2)).toEqual({ width: 400, height: 600 });
    expect(screenSize(g(90), 2)).toEqual({ width: 600, height: 400 });
  });

  it("maps corners clockwise", () => {
    expect(toScreen([0, 0], g(90), 1)).toEqual([H, 0]);   // top-left goes to top-right
    expect(toScreen([0, H], g(90), 1)).toEqual([0, 0]);   // bottom-left goes to top-left
    expect(toScreen([0, 0], g(180), 1)).toEqual([W, H]);
    expect(toScreen([0, 0], g(270), 1)).toEqual([0, W]);
    expect(toScreen([10, 20], g(0), 2)).toEqual([20, 40]);
  });

  it("round-trips for every rotation and scale", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      for (const s of [0.5, 1, 1.75]) {
        const p: Pt = [37, 121];
        const back = toPage(toScreen(p, g(rot), s), g(rot), s);
        expect(back[0]).toBeCloseTo(37);
        expect(back[1]).toBeCloseTo(121);
      }
    }
  });

  it("groupTransform agrees with toScreen", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const t = groupTransform(g(rot), 1.5);
      for (const p of [[0, 0], [W, 0], [13, 250]] as Pt[]) {
        const a = applyGroup(p, t), b = toScreen(p, g(rot), 1.5);
        expect(a[0]).toBeCloseTo(b[0]);
        expect(a[1]).toBeCloseTo(b[1]);
      }
    }
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL (module not found).

- [ ] **Step 2: Implementation**

`apps/web/src/lib/coords.ts`:
```ts
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
```

Run: `npm test -w apps/web` → Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/coords.ts apps/web/src/lib/coords.test.ts
git commit -m "feat(web): add page/screen coordinate transforms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
