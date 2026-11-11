import { expect, test } from "@playwright/test";
import path from "node:path";

// The white cover of edited original text is painted in the page's own background (a tinted table cell), and leaves
// the cell's border (apps/api/scripts/e2e_tinted_pdf.py: tint 255,235,180; text 12 pt, baseline 126.5, border at 130).
const TINTED = path.join(__dirname, "fixtures", "tinted.pdf");

test("the cover of edited text in a tinted cell is the tint, not white", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const loaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(TINTED);
  await expect(page).toHaveURL(/\/edit\//);
  await loaded;
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await page.waitForTimeout(2500); // the page draws and settles
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  await page.mouse.dblclick(box.x + 150, box.y + 118);
  const editor = page.getByTestId("text-editor");
  await expect(editor).toBeVisible();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.type("10 Oktober 2026"); // the whole line changes: all its old glyphs are covered
  await page.mouse.click(box.x + 450, box.y + 400);
  await expect(editor).toHaveCount(0);

  // A point of the cover above the capitals (page y 116: the cover starts 0.95 em over the baseline), between glyphs.
  const px = (x: number, y: number) => page.evaluate(([px, py]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="overlay"] canvas')!;
    const k = canvas.width / canvas.getBoundingClientRect().width;
    return Array.from(canvas.getContext("2d")!.getImageData(Math.round(px * k), Math.round(py * k), 1, 1).data);
  }, [x, y]);
  await expect.poll(async () => (await px(150, 116))[3], { timeout: 10_000 }).toBe(255); // the cover is there
  const [r, g, b, a] = await px(150, 116);
  expect(a).toBe(255);
  [[r, 255], [g, 235], [b, 180]].forEach(([got, want]) => expect(Math.abs(got - want)).toBeLessThanOrEqual(8)); // the dominant bucket's mean
});
