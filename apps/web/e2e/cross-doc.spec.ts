import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfReport } from "./pdfAnnots";
import { pdfInfo } from "./pdfText";

// Copy and paste between documents: the clipboard is shared by every PDF opened in this browser. text.pdf
// (apps/api/scripts/e2e_text_pdf.py): paragraph 1 ("Paragraf pertama …", three lines) in Rect(72, 90, 372, 160); sample.pdf:
// three pages of text.
const TEXT_PDF = path.join(__dirname, "fixtures", "text.pdf");
const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");
const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** Opens `file` (keeping what localStorage holds: the clipboard); the page's box at zoom 100 % (1 pt = 1 px). */
async function open(page: Page, file: string) {
  await page.goto("/");
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  await page.waitForTimeout(800); // the page draws
  return (await page.getByTestId("page").first().boundingBox())!;
}

type DraftOp = { id: string; type: string; assetId?: string; box?: { paragraphs: { text: string }[][] } };
/** The objects of the open edit's draft (the edit id is the URL's). */
const draftOps = (page: Page) => page.evaluate(() => {
  const id = location.pathname.split("/").pop();
  const raw = localStorage.getItem(`edith:draft:${id}`);
  return Object.values((raw ? JSON.parse(raw) : { objects: {} }).objects as Record<string, DraftOp>);
});
const textOf = (op: DraftOp) => op.box!.paragraphs.map((p) => p.map((r) => r.text).join("")).join(" ");

async function download(page: Page, name: string): Promise<string> {
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = path.join(test.info().outputDir, name);
  await (await d).saveAs(file);
  return file;
}

test("a paragraph of one PDF and an area of another, pasted into a third document", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());

  // 1. The first paragraph of text.pdf, copied as text.
  let box = await open(page, TEXT_PDF);
  const del = page.getByTestId("properties-bar").getByRole("button", { name: "Hapus teks" });
  await expect(async () => {
    await page.mouse.click(box.x + 150, box.y + 110);
    await expect(del).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.keyboard.press(`${MOD}+c`);
  await page.waitForTimeout(300);

  // 2. Into sample.pdf: a text box of its own with that text.
  box = await open(page, SAMPLE);
  await page.mouse.click(box.x + 300, box.y + 700); // the canvas has focus, nothing selected
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(async () => (await draftOps(page)).filter((o) => o.type === "text.add").map(textOf).join(" ")).toContain("Paragraf pertama");
  const withText = await download(page, "with-text.pdf");
  expect((await pdfInfo(withText)).pages[0].text).toContain("Paragraf pertama");

  // 3. An area of sample.pdf's page taken as a picture…
  await page.getByRole("button", { name: "Image pilihan" }).click();
  await page.getByRole("menuitem", { name: "Salin area halaman" }).click();
  await expect(page.getByTestId("tool-hint")).toContainText("menyalinnya sebagai gambar");
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 160, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText("Area disalin")).toBeVisible();

  // 4. …pasted into text.pdf: uploaded to that document, and in its export.
  box = await open(page, TEXT_PDF);
  await page.mouse.click(box.x + 300, box.y + 700);
  await page.keyboard.press(`${MOD}+v`);
  await expect.poll(async () => (await draftOps(page)).filter((o) => o.type === "image.add").length).toBe(1);
  const image = (await draftOps(page)).find((o) => o.type === "image.add")!;
  expect(image.assetId).not.toMatch(/^area-/);
  const withPicture = await download(page, "with-picture.pdf");
  expect(pdfReport(withPicture).pages[0].images).toBeGreaterThanOrEqual(1);
});

test("another PDF opens as a tab; the tabs switch between the documents and close", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await open(page, SAMPLE);
  const first = page.url();
  await expect(page.getByTestId("doc-tabs")).toHaveCount(0); // one document: no row

  await page.getByTestId("open-another-input").setInputFiles(TEXT_PDF);
  await expect(page).not.toHaveURL(first);
  const tabs = page.getByTestId("doc-tabs");
  await expect(tabs.locator('button[title$=".pdf"]')).toHaveText(["sample.pdf", "text.pdf"]);
  await expect(tabs.getByRole("button", { name: "text.pdf", exact: true })).toHaveAttribute("aria-current", "page");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, "tabs.png") });

  await tabs.getByRole("button", { name: "sample.pdf", exact: true }).click();
  await expect(page).toHaveURL(first);
  await expect(page.getByTestId("page")).toHaveCount(3);

  // The menu lists the recent edits too: text.pdf is open already.
  await page.getByRole("button", { name: "Tutup text.pdf" }).click();
  await expect(page.getByTestId("doc-tabs")).toHaveCount(0);
  await expect(page).toHaveURL(first);
});
