import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");
type Box = { x: number; y: number; width: number; height: number };
type Op = { id: string; type: string; rect?: { x: number; y: number; w: number; h: number } };

const GREEN = "#16a34a";
const MOD = "ControlOrMeta";

async function open(page: Page): Promise<Box> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page").first()).toBeVisible();
  await expect(page.getByTestId("overlay").first()).toBeVisible();
  return (await page.getByTestId("page").first().boundingBox())!;
}

/** A filled rectangle from `a` to `b` (page-box pixels at 100 % zoom); the shape tool selects it once drawn. */
async function rect(page: Page, box: Box, a: [number, number], b: [number, number]) {
  await page.keyboard.press("r");
  const noFill = page.getByRole("checkbox", { name: "Tanpa isi" });
  if (await noFill.isChecked()) await noFill.uncheck();
  await page.getByRole("button", { name: "Isi", exact: true }).click();
  await page.getByRole("button", { name: `Isi ${GREEN}` }).click();
  await page.mouse.move(box.x + a[0], box.y + a[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (a[0] + b[0]) / 2, box.y + (a[1] + b[1]) / 2, { steps: 3 });
  await page.mouse.move(box.x + b[0], box.y + b[1], { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId("mini-bar")).toBeVisible();
}

/** The page's rectangles as the autosaved draft holds them, in z-order. The draft lags an edit by 0.5 s (a debounce):
 *  `rects` waits that out; `settled` polls it instead. */
async function rects(page: Page, count = 3): Promise<{ x: number; y: number; w: number; h: number }[]> {
  await page.waitForTimeout(650);
  return draftRects(page, count);
}

async function draftRects(page: Page, count = 3): Promise<{ x: number; y: number; w: number; h: number }[]> {
  let found: Op[] = [];
  await expect.poll(async () => {
    found = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith("edith:draft:"));
      const d = k ? JSON.parse(localStorage.getItem(k)!) : null;
      return d ? (d.order as string[]).map((id) => d.objects[id]) : [];
    });
    return found.length;
  }).toBe(count);
  return found.map((o) => o.rect!);
}

/** Waits until the draft shows `fn`'s result (the autosave is debounced). */
async function settled<T>(_page: Page, fn: () => Promise<T>, expected: T) {
  await expect.poll(fn, { timeout: 5000 }).toEqual(expected);
}

/** Columns / rows (canvas pixels) of the overlay's canvases holding the smart-guide colour. */
async function guideLines(page: Page): Promise<{ cols: number[]; rows: number[]; count: number }> {
  return page.evaluate(() => {
    const cols = new Map<number, number>(), rows = new Map<number, number>();
    let count = 0;
    for (const c of document.querySelectorAll<HTMLCanvasElement>('[data-testid="overlay"] canvas')) {
      const w = c.width, h = c.height, d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // #f5316f, solid (a 1 px line on a whole pixel) or half-covered.
        if (d[i + 3] > 100 && d[i] > 220 && d[i + 1] > 30 && d[i + 1] < 90 && d[i + 2] > 80 && d[i + 2] < 140) {
          cols.set(x, (cols.get(x) ?? 0) + 1); rows.set(y, (rows.get(y) ?? 0) + 1); count++;
        }
      }
    }
    const long = (m: Map<number, number>) => [...m].filter(([, n]) => n >= 40).map(([k]) => k).sort((a, b) => a - b);
    return { cols: long(cols), rows: long(rows), count };
  });
}

const groupCount = (page: Page) => page.getByTestId("group-count");
const A: [[number, number], [number, number]] = [[100, 150], [160, 190]];
const B: [[number, number], [number, number]] = [[240, 250], [300, 290]];
const C: [[number, number], [number, number]] = [[400, 350], [460, 390]];

async function threeRects(page: Page, box: Box) {
  await rect(page, box, ...A);
  await rect(page, box, ...B);
  await rect(page, box, ...C);
  await page.mouse.click(box.x + 560, box.y + 700); // empty page: deselect
  await expect(page.getByTestId("mini-bar")).toHaveCount(0);
}

/** A drag from `from` to `to` (page-box pixels), in steps. `mod`: Cmd/Ctrl is held from the start of the move (no
 *  snapping); `during` runs with the button down, before the release. */
async function drag(page: Page, box: Box, from: [number, number], to: [number, number], opts: { mod?: boolean; during?: () => Promise<void> } = {}) {
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  if (opts.mod) await page.keyboard.down(MOD);
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await opts.during?.();
  await page.mouse.up();
  if (opts.mod) await page.keyboard.up(MOD);
}

test("a drag on the empty page selects what it touches; Shift toggles; a click on the empty page clears", async ({ page }) => {
  const box = await open(page);
  await threeRects(page, box);

  // A and B are touched (B only by the corner); C is far away.
  await drag(page, box, [60, 120], [250, 260]);
  await expect(groupCount(page)).toHaveText("2 objek dipilih");

  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 430, box.y + 370); // C
  await page.keyboard.up("Shift");
  await expect(groupCount(page)).toHaveText("3 objek dipilih");
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 430, box.y + 370);
  await page.keyboard.up("Shift");
  await expect(groupCount(page)).toHaveText("2 objek dipilih");

  await page.mouse.click(box.x + 560, box.y + 700);
  await expect(groupCount(page)).toHaveCount(0);

  // A marquee touching only a corner of C selects it alone (a single object: its mini-bar, no group bar).
  await drag(page, box, [455, 385], [520, 430]);
  await expect(page.getByTestId("mini-bar")).toBeVisible();
  await expect(groupCount(page)).toHaveCount(0);

  // Escape clears.
  await drag(page, box, [60, 120], [250, 260]);
  await expect(groupCount(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(groupCount(page)).toHaveCount(0);
});

test("the marquee works at another zoom and does not leave its page", async ({ page }) => {
  let box = await open(page);
  await threeRects(page, box);
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Perbesar" }).click();
  await expect(page.getByText("150%")).toBeVisible();
  box = (await page.getByTestId("page").first().boundingBox())!;
  const z = 1.5;
  const at = (p: [number, number]): [number, number] => [p[0] * z, p[1] * z];
  await drag(page, box, at([60, 120]), at([250, 260]));
  await expect(groupCount(page)).toHaveText("2 objek dipilih");
  await page.mouse.click(box.x + 560 * z, box.y + 700 * z);
  // Dragging past the page's edge stops at the edge: A, B and C are all inside the dragged area.
  await drag(page, box, at([60, 120]), [box.width + 200, box.height - 20]);
  await expect(groupCount(page)).toHaveText("3 objek dipilih");
});

test("dragging one object of a selection moves them all, and one undo puts them back", async ({ page }) => {
  const box = await open(page);
  await threeRects(page, box);
  await drag(page, box, [60, 120], [250, 260]); // A and B
  await expect(groupCount(page)).toHaveText("2 objek dipilih");
  // Cmd/Ctrl while dragging: no snapping, so the move is exactly the pointer's.
  await drag(page, box, [130, 170], [160, 200], { mod: true });
  const moved = await rects(page);
  expect(moved[0]).toMatchObject({ x: 130, y: 180 });
  expect(moved[1]).toMatchObject({ x: 270, y: 280 });
  expect(moved[2]).toMatchObject({ x: 400, y: 350 }); // C untouched
  await expect(groupCount(page)).toHaveText("2 objek dipilih"); // still selected as a group

  await page.keyboard.press(`${MOD}+z`);
  await settled(page, async () => (await draftRects(page)).map((r) => [r.x, r.y]), [[100, 150], [240, 250], [400, 350]]);
});

test("the group's handles scale every member with its box; one undo puts them back", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A);
  await rect(page, box, ...B);
  await page.mouse.click(box.x + 560, box.y + 700);
  await drag(page, box, [60, 120], [320, 300]);
  await expect(groupCount(page)).toHaveText("2 objek dipilih");
  // The group's box is (100, 150) – (300, 290); its bottom-right handle to (400, 390).
  await drag(page, box, [300, 290], [400, 390]);
  const [a, b] = await rects(page, 2);
  expect(a.x).toBeCloseTo(100, 0);
  expect(a.w).toBeCloseTo(90, 0); // 60 * 300 / 200
  expect(b.x).toBeCloseTo(310, 0); // 100 + 140 * 1.5
  expect(b.y).toBeCloseTo(150 + 100 * (240 / 140), 0);
  await page.keyboard.press(`${MOD}+z`);
  await settled(page, async () => (await draftRects(page, 2)).map((r) => [r.x, r.w]), [[100, 60], [240, 60]]);
});

test("a click on one object of a group makes it the only selection", async ({ page }) => {
  const box = await open(page);
  await threeRects(page, box);
  await drag(page, box, [60, 120], [250, 260]);
  await expect(groupCount(page)).toBeVisible();
  await page.mouse.click(box.x + 130, box.y + 170); // A
  await expect(groupCount(page)).toHaveCount(0);
  await expect(page.getByTestId("mini-bar")).toBeVisible();
});

test("arrow keys nudge the selection 1 pt (10 with Shift); quick presses are one undo step", async ({ page }) => {
  const box = await open(page);
  await threeRects(page, box);
  await page.mouse.click(box.x + 130, box.y + 170); // A
  await expect(page.getByTestId("mini-bar")).toBeVisible();

  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await settled(page, async () => (await draftRects(page))[0], { x: 103, y: 160, w: 60, h: 40 });

  // A held key repeats: still the same step. A pause (400 ms) starts another.
  await page.waitForTimeout(600);
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 4; i++) await page.keyboard.down("ArrowLeft");
  await page.keyboard.up("ArrowLeft");
  await settled(page, async () => (await draftRects(page))[0], { x: 98, y: 160, w: 60, h: 40 });

  await page.keyboard.press(`${MOD}+z`);
  await settled(page, async () => (await draftRects(page))[0], { x: 103, y: 160, w: 60, h: 40 });
  await page.keyboard.press(`${MOD}+z`);
  await settled(page, async () => (await draftRects(page))[0], { x: 100, y: 150, w: 60, h: 40 });
});

test("arrow keys nudge a whole group; they leave a text field's own cursor alone", async ({ page }) => {
  const box = await open(page);
  await threeRects(page, box);
  await drag(page, box, [60, 120], [250, 260]);
  await expect(groupCount(page)).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await settled(page, async () => (await draftRects(page)).map((r) => [r.x, r.y]), [[100, 149], [240, 249], [400, 350]]);

  // In the Find field the arrows are the field's.
  await page.keyboard.press(`${MOD}+f`);
  const find = page.getByRole("searchbox").or(page.getByRole("textbox")).first();
  await find.fill("abc");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(700);
  expect((await rects(page)).map((r) => [r.x, r.y])).toEqual([[100, 149], [240, 249], [400, 350]]);
});

test("moving shows guides at the page centre and snaps to it; Cmd/Ctrl turns snapping off", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A);
  const centre = box.width / 2;
  // A's centre is at 130; drop it 3 px right of the page centre.
  const target = Math.round(centre + 3);
  await drag(page, box, [130, 170], [target, 170], {
    during: async () => { expect((await guideLines(page)).cols).toContain(Math.floor(centre)); },
  });
  const [snapped] = await rects(page, 1);
  expect(snapped.x + snapped.w / 2).toBeCloseTo(centre, 0);
  expect((await guideLines(page)).cols).toEqual([]); // gone after the drop

  // Again, with Cmd/Ctrl: no guide, and the box lands where the pointer put it.
  await page.waitForTimeout(100);
  const x0 = snapped.x;
  await drag(page, box, [Math.round(centre), 170], [Math.round(centre) + 31, 170], {
    mod: true,
    during: async () => { expect((await guideLines(page)).cols).toEqual([]); },
  });
  const [free] = await rects(page, 1);
  expect(Math.abs(free.x - (x0 + 31))).toBeLessThan(1.5);
});

test("resizing from a handle snaps the dragged edge to the page centre, and shows the size", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A); // selected: its handles are on
  const centre = box.width / 2;
  await drag(page, box, [160, 190], [Math.round(centre) + 3, 190], {
    during: async () => { expect((await guideLines(page)).cols).toContain(Math.floor(centre)); },
  });
  expect((await guideLines(page)).cols).toEqual([]);
  const [r] = await rects(page, 1);
  expect(r.x).toBeCloseTo(100, 0);
  expect(r.x + r.w).toBeCloseTo(centre, 0);
  expect(r.h).toBeCloseTo(40, 0);
});

test("Alt over another object shows the distances to it", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A);
  await rect(page, box, [300, 150], [360, 190]); // selected
  await page.mouse.click(box.x + 300, box.y + 400); // (empty) deselect
  await page.mouse.click(box.x + 330, box.y + 170); // the second one
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 120, box.y + 160);
  await page.mouse.move(box.x + 130, box.y + 170);
  await expect.poll(async () => (await guideLines(page)).count).toBeGreaterThan(30);
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await guideLines(page)).count).toBe(0);
});

test("Space+drag and the middle button pan the canvas", async ({ page }) => {
  let box = await open(page);
  await rect(page, box, ...A);
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Perbesar" }).click();
  await expect(page.getByText("150%")).toBeVisible();
  box = (await page.getByTestId("page").first().boundingBox())!;
  const scroller = page.locator("#page-scroller");
  const top = () => scroller.evaluate((el) => el.scrollTop);
  const t0 = await top();

  // Focus is on the zoom button (Space would press it): a click on the page gives it back to the canvas.
  await page.mouse.click(box.x + 400, box.y + 600);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 500, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(top).toBeGreaterThan(t0 + 60);
  expect((await rects(page, 1))[0]).toMatchObject({ x: 100, y: 150 }); // nothing was drawn or moved

  const t1 = await top();
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(top).toBeLessThan(t1 - 20);
});

test("an object snaps to another one's edge", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, [100, 300], [160, 340]);
  await rect(page, box, [240, 450], [300, 490]);
  await page.mouse.click(box.x + 560, box.y + 700);
  // The second one's left edge (240) dragged to 3 px right of the first one's (100).
  await drag(page, box, [270, 470], [270 - 137, 470], {
    during: async () => { expect((await guideLines(page)).cols).toContain(100); },
  });
  const [, b] = await rects(page, 2);
  expect(b.x).toBeCloseTo(100, 0);
});

test("an object snaps to the spacing between two others", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, [100, 150], [160, 190]);
  await rect(page, box, [400, 150], [460, 190]);
  await rect(page, box, [230, 150], [290, 190]); // between them: the gaps would be equal at x = 250
  await page.mouse.click(box.x + 560, box.y + 700);
  await drag(page, box, [260, 170], [260 + 17, 170]);
  const [, , mid] = await rects(page);
  expect(mid.x).toBeCloseTo(250, 0);
});

test("Cmd/Ctrl+A selects the page's objects; align and distribute are one undo step each", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A);
  await rect(page, box, [240, 200], [300, 240]);
  await rect(page, box, [400, 400], [460, 440]);
  await page.mouse.click(box.x + 560, box.y + 700);
  await page.keyboard.press(`${MOD}+a`);
  await expect(groupCount(page)).toHaveText("3 objek dipilih");

  await page.getByRole("button", { name: "Bagi rata jarak horizontal" }).click();
  await settled(page, async () => (await draftRects(page)).map((r) => r.x), [100, 250, 400]);
  await page.getByRole("button", { name: "Rata kiri", exact: true }).click();
  await settled(page, async () => (await draftRects(page)).map((r) => r.x), [100, 100, 100]);
  await page.getByRole("button", { name: "Rata atas", exact: true }).click();
  await settled(page, async () => (await draftRects(page)).map((r) => r.y), [150, 150, 150]);

  await page.keyboard.press(`${MOD}+z`);
  await settled(page, async () => (await draftRects(page)).map((r) => r.y), [150, 200, 400]);
  await page.keyboard.press(`${MOD}+z`);
  await settled(page, async () => (await draftRects(page)).map((r) => r.x), [100, 250, 400]);
});

test("the align keys (Alt+A/D/W/S/H/V) and Tab / Escape work from the keyboard", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A);
  await rect(page, box, [240, 200], [300, 240]);
  await page.mouse.click(box.x + 560, box.y + 700);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("Alt+KeyD"); // right edges
  await settled(page, async () => (await draftRects(page, 2)).map((r) => r.x + r.w), [300, 300]);
  await page.keyboard.press("Alt+KeyW"); // tops
  await settled(page, async () => (await draftRects(page, 2)).map((r) => r.y), [150, 150]);
  await page.keyboard.press("Escape");
  await expect(groupCount(page)).toHaveCount(0);
});

test("Tab and Shift+Tab walk the page's objects from the selected one", async ({ page }) => {
  const box = await open(page);
  await threeRects(page, box);
  await page.mouse.click(box.x + 130, box.y + 170);
  const bar = page.getByTestId("mini-bar");
  const centreX = async () => { const b = (await bar.boundingBox())!; return Math.round(b.x + b.width / 2 - box.x); };
  const first = await centreX();
  await page.keyboard.press("Tab");
  await expect.poll(centreX).not.toBe(first);
  await page.keyboard.press("Shift+Tab");
  await expect.poll(centreX).toBe(first);
});

test("Delete, cut, copy and paste act on the group, each as one undo step", async ({ page }) => {
  const box = await open(page);
  await threeRects(page, box);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+v`);
  await rects(page, 6);
  await expect(groupCount(page)).toHaveText("3 objek dipilih"); // the pasted copies

  await page.keyboard.press("Delete");
  await rects(page, 3);
  await page.keyboard.press(`${MOD}+z`);
  await rects(page, 6);

  await page.keyboard.press(`${MOD}+a`);
  await expect(groupCount(page)).toHaveText("6 objek dipilih");
  await page.keyboard.press(`${MOD}+x`);
  await rects(page, 0);
  await page.keyboard.press(`${MOD}+z`);
  await rects(page, 6);
  await page.keyboard.press(`${MOD}+v`); // the cut ones come back from the clipboard
  await rects(page, 12);
});

test("Alt+drag copies the selection and leaves the original", async ({ page }) => {
  const box = await open(page);
  await threeRects(page, box);
  await page.mouse.click(box.x + 130, box.y + 170); // A
  await page.keyboard.down("Alt");
  await drag(page, box, [130, 170], [130, 100], { mod: true });
  await page.keyboard.up("Alt");
  const all = await rects(page, 4);
  expect(all[0]).toMatchObject({ x: 100, y: 150 }); // the original stays
  expect(all[3].y).toBeCloseTo(80, 0); // its copy
  expect(all[3].x).toBeCloseTo(100, 0);
});
