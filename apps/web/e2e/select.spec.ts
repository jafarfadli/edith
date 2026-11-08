import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

async function open(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page").first()).toBeVisible();
  await expect(page.getByTestId("overlay").first()).toBeVisible(); // the overlay is a lazy chunk, mounted after the page
  return (await page.getByTestId("page").first().boundingBox())!;
}

test("a canvas click right after another tool selects the object under it", async ({ page }) => {
  const box = await open(page);
  const miniBar = page.getByTestId("mini-bar");
  const check = page.getByRole("button", { name: "Centang", exact: true });
  const select = page.getByRole("button", { name: "Pilih", exact: true });

  // Two check marks (the tool stays active), then straight back to Pilih and a click on the first one.
  await check.click();
  await page.mouse.click(box.x + 150, box.y + 200);
  await page.mouse.click(box.x + 350, box.y + 200);
  await select.click();
  for (let i = 0; i < 6; i++) {
    const x = i % 2 === 0 ? 150 : 350;
    await page.mouse.click(box.x + x, box.y + 200);
    await expect(miniBar).toBeVisible({ timeout: 1000 });
    const bar = (await miniBar.boundingBox())!;
    expect(Math.abs(bar.x + bar.width / 2 - (box.x + x))).toBeLessThan(150); // the bar sits at the clicked mark
    await page.mouse.click(box.x + 250, box.y + 500); // empty page: deselect
    await expect(miniBar).toHaveCount(0);
  }

  // Draw a rectangle (selects it), then click the first check mark immediately.
  await page.getByRole("button", { name: "Bentuk pilihan" }).click();
  await page.getByRole("menuitem", { name: "Persegi", exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 350, { steps: 3 });
  await page.mouse.move(box.x + 300, box.y + 400, { steps: 3 });
  await page.mouse.up();
  await expect(miniBar).toBeVisible();
  await page.mouse.click(box.x + 150, box.y + 200);
  await expect.poll(async () => {
    const b = await miniBar.boundingBox();
    return b ? Math.round(b.y) : null;
  }).toBeLessThan(Math.round(box.y + 300)); // the bar is above the mark, not above the rectangle at y 300
});
