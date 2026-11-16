import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// "Opsi unduhan": the edited document as only some pages, as pictures, compressed or locked; a page's menu opens it
// for that page. sample.pdf: three pages.
const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

async function open(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("thumb")).toHaveCount(3);
}

async function go(page: Page): Promise<{ name: string; data: Buffer }> {
  const d = page.waitForEvent("download");
  await page.getByTestId("download-options-go").click();
  const got = await d;
  const file = path.join(test.info().outputDir, got.suggestedFilename());
  await got.saveAs(file);
  await expect(page.getByTestId("download-dialog")).toHaveCount(0);
  return { name: got.suggestedFilename(), data: readFileSync(file) };
}

const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

test("download some pages, as pictures, or locked with a password", async ({ page }) => {
  await open(page);
  await page.getByTestId("download-options").click();
  const dialog = page.getByTestId("download-dialog");
  await dialog.getByLabel("Halaman").fill("2-3");
  const some = await go(page);
  expect(some.name).toBe("sample.pdf");
  expect(pageCount(some.data)).toBe(2);

  await page.getByTestId("download-options").click();
  await dialog.getByRole("button", { name: "Images" }).click();
  await dialog.getByRole("button", { name: "JPG" }).click();
  const pics = await go(page);
  expect(pics.name).toBe("sample.zip");
  expect(pics.data.subarray(0, 2).toString()).toBe("PK");

  await page.getByTestId("download-options").click();
  await dialog.getByLabel("Add password").check();
  await dialog.getByLabel("Kata sandi baru").fill("kunci");
  await dialog.getByLabel("Ulangi kata sandi").fill("kunc");
  await expect(page.getByTestId("download-options-go")).toBeDisabled();
  await dialog.getByLabel("Ulangi kata sandi").fill("kunci");
  await dialog.getByRole("button", { name: "High" }).click();
  const locked = await go(page);
  expect(locked.data.toString("latin1")).toContain("/Encrypt");
  await page.keyboard.press("Escape");
});

test("a page's menu downloads that page as a picture", async ({ page }) => {
  await open(page);
  await page.getByTestId("thumb").nth(1).hover();
  await page.getByTestId("thumb").nth(1).getByRole("button", { name: "Menu halaman" }).click();
  await page.getByRole("menuitem", { name: "Unduh halaman ini…" }).click();
  const dialog = page.getByTestId("download-dialog");
  await expect(dialog.getByLabel("Halaman")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Images" }).click();
  const one = await go(page);
  expect(one.name).toBe("sample.png");
  expect(one.data.subarray(1, 4).toString()).toBe("PNG");
});
