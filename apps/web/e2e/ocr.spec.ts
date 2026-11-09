import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pdfPixels } from "./pdfPixels";
import { pdfInfo } from "./pdfText";

// apps/api/scripts/e2e_scan_pdf.py (M5d): a synthetic scanned form (invented content) as one 200 dpi JPEG on off-white
// paper, no text layer. Its body paragraph's three lines start at (72, 300), 15 pt apart, in Tinos 11.
const PDF = path.join(__dirname, "fixtures", "scan.pdf");
const NEW = "Dengan ini saya mengajukan permohonan surat keterangan domisili.";

function hasTesseract(): boolean {
  try {
    const langs = execFileSync("tesseract", ["--list-langs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /^ind$/m.test(langs) && /^eng$/m.test(langs);
  } catch {
    return false;
  }
}

// CI installs Tesseract (ind + eng); without it locally the API answers 503 and there is nothing to read.
test.skip(!hasTesseract() && process.env.EDITH_REQUIRE_TESSERACT !== "1", "tesseract with ind+eng is not installed");

async function open(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  return (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px
}

type DraftOp = { type: string; paragraphId?: string; cover?: { x: number; y: number; w: number; h: number }; coverColor?: string };
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
  return Object.values((key ? JSON.parse(localStorage.getItem(key)!) : { objects: {} }).objects as Record<string, DraftOp>);
});

test("OCR reads a scanned page; an OCR paragraph edits in place, survives a reload and exports over its picture", async ({ page }) => {
  const box = await open(page);
  const button = page.getByTestId("ocr-button");
  await expect(button).toHaveText("Kenali teks (OCR)");
  await button.click();
  const status = page.getByTestId("ocr-status");
  await expect(status).toContainText(/Hasil OCR: \d+ paragraf/, { timeout: 45_000 });
  await expect(page.getByRole("status").filter({ hasText: "klik dua kali untuk mengedit" })).toBeVisible();
  // The status pill can be put away (clicks go through it to the page meanwhile).
  await page.getByTestId("ocr-status-close").click();
  await expect(status).toHaveCount(0);

  // The body paragraph: double-click it, replace its text.
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 150, box.y + 300);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("Dengan ini mengajukan permohonan surat pengantar");
  await expect(editor).toContainText("sebagaimana mestinya.");
  await editor.evaluate((el) => {
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.type(NEW);
  await page.mouse.click(box.x + 300, box.y + 780);
  await expect(editor).toHaveCount(0);
  await expect.poll(() => draftOps(page)).toEqual([expect.objectContaining({ type: "text.ocr_edit", paragraphId: expect.stringMatching(/^ocr\d+$/) })]);
  const [op] = await draftOps(page);
  expect(op.cover!.x).toBeLessThan(72);
  expect(op.cover!.y + op.cover!.h).toBeGreaterThan(330);
  expect(op.cover!.h).toBeLessThan(50);
  await page.getByRole("tab", { name: /Anotasi/ }).click();
  await expect(page.getByText("Teks OCR diedit")).toBeVisible();

  // A reload restores the edit from the draft without OCR running again; the export needs nothing else.
  let ocrCalls = 0;
  page.on("request", (r) => { if (/\/ocr$/.test(r.url())) ocrCalls++; });
  await page.reload();
  await expect(page.getByTestId("ocr-button")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "ocr.pdf");
  await (await download).saveAs(file);
  expect(ocrCalls).toBe(0);

  const text = (await pdfInfo(file)).pages[0].text;
  expect(text.split(NEW).length - 1).toBe(1); // the new text, once (the scan had no text at all)
  // Outside the cover the picture is as it was: the title, the note under the body, a table border, the margin.
  const outside: [number, number][] = [[297 / 595, 86 / 842], [100 / 595, 368 / 842], [72 / 595, 450 / 842], [300 / 595, 104 / 842], [20 / 595, 20 / 842]];
  expect(pdfPixels(file, 0, outside)).toEqual(pdfPixels(PDF, 0, outside));
  // Inside it, where the old 2nd and 3rd lines were (below the new single line): only the cover's colour.
  const cover = op.coverColor!;
  const rgb = [1, 3, 5].map((i) => parseInt(cover.slice(i, i + 2), 16));
  for (const px of pdfPixels(file, 0, [[200 / 595, 318 / 842], [350 / 595, 316 / 842], [120 / 595, 331 / 842]])) {
    px.forEach((v, i) => expect(Math.abs(v - rgb[i])).toBeLessThanOrEqual(2));
  }
});
