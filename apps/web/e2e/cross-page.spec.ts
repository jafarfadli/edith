import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// An object dragged off its page onto another lands there, where the pointer drops it (one undo step); Alt+drag leaves
// the original and puts a copy there. sample.pdf: three A4 pages, one under the other.
const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");
type Op = { id: string; type: string; pageKey: string; rect: { x: number; y: number; w: number; h: number } };

const draft = (page: Page) => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith("edith:draft:"));
  const d = k ? JSON.parse(localStorage.getItem(k)!) : null;
  return d ? (d.order as string[]).map((id) => d.objects[id]) as Op[] : [];
});

async function open(page: Page) {
  await page.setViewportSize({ width: 1280, height: 1800 }); // pages 1 and 2 both in view
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("overlay").nth(1)).toBeVisible();
  await page.waitForTimeout(500); // the pages settle in their place
  const pages = page.getByTestId("page");
  return { p1: (await pages.nth(0).boundingBox())!, p2: (await pages.nth(1).boundingBox())! };
}

async function drawRect(page: Page, box: { x: number; y: number }) {
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 130, { steps: 3 });
  await page.mouse.move(box.x + 180, box.y + 160, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId("mini-bar")).toBeVisible();
  await expect.poll(async () => (await draft(page)).length).toBe(1);
}

/** A drag from (x, y) to (x2, y2) in steps, `alt` held from the press. */
async function drag(page: Page, from: [number, number], to: [number, number], alt = false) {
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from[0] + (to[0] - from[0]) * i / 12, from[1] + (to[1] - from[1]) * i / 12);
  await expect(page.getByTestId("cross-page-ghost")).toBeVisible();
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
  await expect(page.getByTestId("cross-page-ghost")).toHaveCount(0);
}

test("an object dragged onto another page moves there, where it is dropped; undo brings it back", async ({ page }) => {
  const { p1, p2 } = await open(page);
  await drawRect(page, p1);
  const [before] = await draft(page);
  const from: [number, number] = [p1.x + 140, p1.y + 130];
  await drag(page, from, [p2.x + 240, p2.y + 230]); // 100 pt right and down of the same spot, on page 2
  await expect.poll(async () => (await draft(page))[0].pageKey).not.toBe(before.pageKey);
  const [after] = await draft(page);
  expect(await draft(page)).toHaveLength(1);
  expect(after.id).toBe(before.id);
  expect(after.rect.x).toBeCloseTo(before.rect.x + 100, 0);
  expect(after.rect.y).toBeCloseTo(before.rect.y + 100, 0);
  await expect(page.getByTestId("mini-bar")).toBeVisible(); // still selected, on its new page

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await draft(page))[0].pageKey).toBe(before.pageKey);
  expect((await draft(page))[0].rect).toEqual(before.rect);
});

test("Alt+drag onto another page leaves the original and puts a copy there", async ({ page }) => {
  const { p1, p2 } = await open(page);
  await drawRect(page, p1);
  const [orig] = await draft(page);
  await drag(page, [p1.x + 140, p1.y + 130], [p2.x + 140, p2.y + 130], true);
  await expect.poll(async () => (await draft(page)).length).toBe(2);
  const [a, b] = await draft(page);
  expect(a).toEqual(orig);
  expect(b.pageKey).not.toBe(orig.pageKey);
  expect(b.rect.x).toBeCloseTo(orig.rect.x, 0);
  expect(b.rect.y).toBeCloseTo(orig.rect.y, 0);
});
