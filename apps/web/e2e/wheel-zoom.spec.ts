import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Ctrl/⌘ + wheel (and a trackpad pinch, which Chrome reports the same way) zooms the pages around the pointer; a plain
// wheel only scrolls.
const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

const zoomPercent = async (page: Page) => Number((await page.locator("text=/^\\d+%$/").first().innerText()).replace("%", ""));

test("ctrl + wheel zooms around the pointer, a plain wheel scrolls", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(await zoomPercent(page)).toBe(100);

  // The point of the first page under the pointer, as a fraction of the page.
  const target = { x: 0.3, y: 0.4 };
  const first = page.locator('#page-scroller [data-testid="page"]').first();
  const box0 = (await first.boundingBox())!;
  const px = box0.x + target.x * box0.width, py = box0.y + target.y * box0.height;
  const fraction = async () => {
    const b = (await first.boundingBox())!;
    return { x: (px - b.x) / b.width, y: (py - b.y) / b.height };
  };

  await page.mouse.move(px, py);
  await page.mouse.wheel(0, 120); // plain wheel: scrolls, zoom untouched
  await page.waitForTimeout(200);
  expect(await zoomPercent(page)).toBe(100);
  await page.evaluate(() => { document.getElementById("page-scroller")!.scrollTop = 0; });
  await page.waitForTimeout(100);

  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
  await page.keyboard.up("Control");
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(130);
  await page.waitForTimeout(400); // the last frames settle
  // Vertically the point stays under the pointer. (Horizontally a page narrower than the view stays centred.)
  expect((await fraction()).y).toBeCloseTo(target.y, 1);

  await page.keyboard.down("Control");
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(20); }
  await page.keyboard.up("Control");
  await expect.poll(() => zoomPercent(page)).toBe(25); // never below the smallest zoom
});
