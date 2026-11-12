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

  // The cover above the capitals (page y 116: it starts 0.95 em over the baseline): the commonest colour of a stretch of
  // pixels there, since the new text's glyphs may cross any one of them. It is the tint once the page has been drawn.
  const cover = () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="overlay"] canvas')!;
    const k = canvas.width / canvas.getBoundingClientRect().width;
    const d = canvas.getContext("2d")!.getImageData(Math.round(120 * k), Math.round(116 * k), Math.round(80 * k), 1).data;
    const count = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) { const key = `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`; count.set(key, (count.get(key) ?? 0) + 1); }
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  });
  await expect.poll(async () => {
    const [r, g, b, a] = await cover();
    return a === 255 && Math.abs(r - 255) <= 8 && Math.abs(g - 235) <= 8 && Math.abs(b - 180) <= 8; // the dominant bucket's mean
  }, { timeout: 10_000 }).toBe(true);
});
