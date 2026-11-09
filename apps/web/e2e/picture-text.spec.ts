import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfInfo } from "./pdfText";

// apps/api/scripts/e2e_picture_pdf.py (M5c): a letterhead pictured as a 1-bit CCITT image in (72, 60)–(432, 132) under
// the same three lines as invisible text, a visible paragraph on baseline 200, and the body of a form pictured as a CCITT
// image in (72, 300)–(512, 480) with no text. The owner's two reports: the letterhead was missing from the editor
// (pdf.js drew no CCITT image without its wasm decoders), and nothing in a pictured form was detected.
const PDF = path.join(__dirname, "fixtures", "picture-text.pdf");
const SCAN = { x: 72, y: 60, w: 360, h: 72 };
const RASTER = { x: 72, y: 300, w: 440, h: 180 };

async function open(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  return (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px
}

/** Share of dark pixels pdf.js drew in `r` (page points) of the page canvas. */
function inkIn(page: Page, r: { x: number; y: number; w: number; h: number }) {
  return page.getByTestId("page").first().locator("canvas").first().evaluate((c: HTMLCanvasElement, r) => {
    const s = c.width / 595;
    const data = c.getContext("2d")!.getImageData(Math.round(r.x * s), Math.round(r.y * s), Math.round(r.w * s), Math.round(r.h * s)).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
    return dark / (data.length / 4);
  }, r);
}

test("a pictured letterhead shows, its invisible text is locked, and a pictured form says why it can't be edited", async ({ page }) => {
  const box = await open(page);
  // Said once the text is known.
  await expect(page.getByRole("status").filter({ hasText: "berupa gambar" })).toBeVisible();
  // pdf.js drew both CCITT pictures (no wasm decoder: none of their pixels).
  await expect.poll(() => inkIn(page, SCAN)).toBeGreaterThan(0.05);
  expect(await inkIn(page, RASTER)).toBeGreaterThan(0.03);

  // The letterhead's invisible text: no editor opens, a notice says why and how to replace it.
  const status = page.getByRole("status").filter({ hasText: "sebenarnya gambar" });
  await expect(async () => {
    await page.mouse.move(box.x + 150, box.y + 75);
    await page.mouse.click(box.x + 150, box.y + 75);
    await expect(status).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(status).toContainText("Whiteout");
  await page.mouse.dblclick(box.x + 150, box.y + 75);
  await expect(page.getByTestId("text-editor")).toHaveCount(0);

  // The pictured form body.
  await page.mouse.click(box.x + 300, box.y + 400);
  await expect(page.getByRole("status").filter({ hasText: "hasil pindai" })).toBeVisible();

  // The visible paragraph is still editable; the export keeps both pictures and does not draw the letterhead twice.
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 120, box.y + 196);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("Paragraf biasa yang terlihat.");
  await page.keyboard.press("End");
  await page.keyboard.type(" Diubah.");
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "picture-text.pdf");
  await (await download).saveAs(file);
  const text = (await pdfInfo(file)).pages[0].text;
  expect(text).toContain("Paragraf biasa yang terlihat. Diubah.");
  expect(text.split("SEKRETARIAT JENDERAL").length - 1).toBe(1); // the invisible layer once, nothing drawn over it
});
