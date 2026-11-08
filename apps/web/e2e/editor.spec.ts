import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfInfo } from "./pdfText";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

async function dragOnPage(page: Page, pageIndex: number, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId("page").nth(pageIndex).boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
}

test("edit and download a PDF", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page")).toHaveCount(3);
  await expect(page.getByTestId("thumb")).toHaveCount(3);

  // Rotate page 2 right via its thumbnail menu.
  await page.getByTestId("thumb").nth(1).getByRole("button", { name: "Menu halaman" }).click();
  await page.getByRole("menuitem", { name: "Putar kanan" }).click();

  // Delete page 3.
  await page.getByTestId("thumb").nth(2).getByRole("button", { name: "Menu halaman" }).click();
  await page.getByRole("menuitem", { name: "Hapus halaman" }).click();
  await expect(page.getByTestId("page")).toHaveCount(2);

  // Redact "Page 0" on page 1 (zoom 100%: 1 pt = 1 px; text at x=72, baseline y=72).
  await page.getByRole("button", { name: "Penghapus pilihan" }).click();
  await page.getByRole("menuitem", { name: "Redaksi" }).click();
  await dragOnPage(page, 0, [60, 50], [180, 80]);

  // Rectangle on page 1.
  await page.getByRole("button", { name: "Bentuk pilihan" }).click();
  await page.getByRole("menuitem", { name: "Persegi" }).click();
  await dragOnPage(page, 0, [100, 200], [250, 300]);

  // Text box on page 1.
  await page.getByRole("button", { name: "Teks", exact: true }).click();
  const p1 = (await page.getByTestId("page").first().boundingBox())!;
  await page.mouse.click(p1.x + 100, p1.y + 400);
  const editor = page.getByTestId("text-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Halo Edith");
  await page.mouse.click(p1.x + 500, p1.y + 700); // blur → commit
  await expect(editor).toHaveCount(0);

  // Undo/redo sanity: undo the text, redo it back.
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const download = await downloadPromise;
  const file = path.join(test.info().outputDir, "out.pdf");
  await download.saveAs(file);

  const info = await pdfInfo(file);
  expect(info.pages.length).toBe(2);
  expect(info.pages[0].text).not.toContain("Page 0");
  expect(info.pages[0].text).toContain("Halo Edith");
  expect(info.pages[1].text).toContain("Page 1");
  expect(info.pages[1].rotation).toBe(90);
});

test("rejects a non-PDF upload with an Indonesian message", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("bukan pdf") });
  // Next.js also renders its own route-announcer role=alert, so filter by text.
  await expect(page.getByRole("alert").filter({ hasText: "bukan PDF" })).toBeVisible();
});

test("place an Indonesian preset stamp and a custom stamp with date", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("page")).toHaveCount(3);

  await page.getByRole("button", { name: "Gambar pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  const dialog = page.getByRole("dialog", { name: "Pilih stamp" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Gambar pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  await expect(dialog.getByRole("button", { name: "TANDA TANGAN DI SINI", exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Indonesia" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("button", { name: "DISETUJUI", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "APPROVED", exact: true })).toHaveCount(0);
  await dialog.getByRole("radio", { name: "English" }).click();
  await expect(dialog.getByRole("button", { name: "APPROVED", exact: true })).toBeVisible();
  await dialog.getByRole("radio", { name: "Indonesia" }).click();
  await dialog.getByRole("button", { name: "DISETUJUI", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Warna" })).toBeVisible(); // stamp selected: color swatches

  await page.getByRole("button", { name: "Gambar pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  await page.getByRole("tab", { name: "Kustom" }).click();
  await page.getByRole("textbox", { name: "Teks stamp" }).fill("DIPERIKSA");
  await page.getByRole("button", { name: "Tambahkan stamp" }).click();
  await expect(page.getByRole("dialog", { name: "Pilih stamp" })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Warna" })).toBeVisible();
});
