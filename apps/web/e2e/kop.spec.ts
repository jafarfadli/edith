import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pdfInk, pdfPixels } from "./pdfPixels";
import { pdfInfo } from "./pdfText";

// apps/api/scripts/e2e_kop_pdf.py: a letterhead like a reference "Nota Dinas" — each line a grey picture of its own,
// under the same lines as invisible text (narrower, in Times) — "KEMENTERIAN CONTOH DAN DIGITAL RI" / "SEKRETARIAT
// JENDERAL" (one paragraph, pictures in (140, 30)–(520, 52) and (140, 48)–(360, 70)), "BIRO UMUM DAN ORGANISASI"
// ((140, 66)–(520, 88)); an address line pictured alone with no text over it ((140, 92)–(520, 106)); a logo of an
// emblem over its name ((40, 34)–(112, 108)); a double rule at y 116/119; a visible body line on baseline 160.
const PDF = path.join(__dirname, "fixtures", "kop.pdf");
const NEW = "KEMENTERIAN BARU DAN DIGITAL RI";
const SHOTS = process.env.E2E_SHOTS;

function hasTesseract(): boolean {
  try {
    const langs = execFileSync("tesseract", ["--list-langs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /^ind$/m.test(langs) && /^eng$/m.test(langs);
  } catch {
    return false;
  }
}

async function open(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  return (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px
}

type Box = { x: number; y: number; w: number; h: number };
type DraftOp = { type: string; paragraphId?: string; cover?: Box; covers?: Box[]; coverColor?: string; box?: { paragraphs: { text: string }[][] } };
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
  return Object.values((key ? JSON.parse(localStorage.getItem(key)!) : { objects: {} }).objects as Record<string, DraftOp>);
});

async function selectAll(page: Page) {
  await page.getByTestId("text-editor").evaluate((el) => {
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
}

/** The original and the export's top of page rendered one above the other (for a person to look at). */
function sideBySide(original: string, exported: string, out: string) {
  const script = `
import sys, pymupdf
clip = pymupdf.Rect(30, 20, 560, 175)
a = pymupdf.open(sys.argv[1])[0].get_pixmap(dpi=200, clip=clip)
b = pymupdf.open(sys.argv[2])[0].get_pixmap(dpi=200, clip=clip)
both = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, a.width, a.height * 2 + 8), False)
both.clear_with(180)
a.set_origin(0, 0); both.copy(a, a.irect)
b.set_origin(0, a.height + 8); both.copy(b, b.irect)
both.save(sys.argv[3])
`;
  execFileSync("uv", ["run", "python", "-c", script, original, exported, out], { cwd: path.join(__dirname, "..", "..", "api") });
}

test("the letterhead's text under its picture edits in place: the old print is covered, the new text drawn once", async ({ page }) => {
  const box = await open(page);
  // Said once the first page's hidden text is known to be editable.
  await expect(page.getByRole("status").filter({ hasText: "teks tersembunyi" })).toBeVisible();

  // A double-click on the second line opens the whole paragraph (both lines), in place.
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 200, box.y + 58);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("KEMENTERIAN CONTOH DAN DIGITAL RI");
  await expect(editor).toContainText("SEKRETARIAT JENDERAL");
  await selectAll(page);
  await page.keyboard.type(NEW);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "kop-1-editing.png"), clip: { x: box.x, y: box.y, width: 595, height: 200 } });
  await page.mouse.click(box.x + 300, box.y + 600);
  await expect(editor).toHaveCount(0);
  await expect.poll(() => draftOps(page)).toEqual([expect.objectContaining({ type: "text.ocr_edit", paragraphId: "hg1" })]);
  const [op] = await draftOps(page);
  expect(op.covers).toHaveLength(2); // one per line of the old print
  expect(op.coverColor).toBe("#ffffff");
  for (const c of op.covers!) expect(c.x).toBeGreaterThanOrEqual(140); // inside the pictures: never the logo
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "kop-2-edited.png"), clip: { x: box.x, y: box.y, width: 595, height: 200 } });
  await page.getByRole("tab", { name: /Anotasi/ }).click();
  await expect(page.getByText("Teks gambar diedit")).toBeVisible();

  // A reload restores the edit from the draft; the export needs nothing else.
  await page.reload();
  await expect(page.getByTestId("page").first()).toBeVisible();
  await expect.poll(() => draftOps(page)).toHaveLength(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "kop.pdf");
  await (await download).saveAs(file);
  if (SHOTS) sideBySide(PDF, file, path.join(SHOTS, "kop-3-export-vs-original.png"));

  const text = (await pdfInfo(file)).pages[0].text;
  expect(text.split(NEW).length - 1).toBe(1);
  expect(text).not.toContain("SEKRETARIAT"); // the invisible words under the covers went
  expect(text).not.toContain("CONTOH DAN DIGITAL");
  expect(text).toContain("BIRO UMUM DAN ORGANISASI"); // the next paragraph's, untouched
  expect(text).toContain("Nomor: 123/ND/2026");
  // Outside the covers the page is as it was: the logo, the third line's print, the address, the rule, the body line.
  const outside: [number, number][] = [[76 / 595, 62 / 842], [200 / 595, 76 / 842], [200 / 595, 100 / 842], [300 / 595, 116 / 842], [100 / 595, 156 / 842]];
  expect(pdfPixels(file, 0, outside)).toEqual(pdfPixels(PDF, 0, outside));
  // Where the second line's print was: paper only (the new text is one line).
  expect(pdfInk(file, 0, { x: 150, y: 54, w: 190, h: 10 })).toBe(0);
  expect(pdfInk(PDF, 0, { x: 150, y: 54, w: 190, h: 10 })).toBeGreaterThan(100);
});

test("any picture can be read: a picture's menu, its 'maybe' button and an area dragged with the OCR tool", async ({ page }) => {
  test.skip(!hasTesseract() && process.env.EDITH_REQUIRE_TESSERACT !== "1", "tesseract with ind+eng is not installed");
  const box = await open(page);
  // The address line and the logo only maybe hold text: each has a small button, and nothing reads them unasked.
  const maybe = page.getByTestId("ocr-maybe");
  await expect(maybe).toHaveCount(2);
  await expect(maybe.first()).toHaveAttribute("aria-label", /mungkin berisi teks/);
  // In the thin address picture ((140, 92)–(520, 106)) its button stays on the picture's height: the rule below shows.
  const boxes = await maybe.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  const address = boxes.find((b) => b.top - box.y < 110 && b.left - box.x > 400)!;
  expect(address.top - box.y).toBeGreaterThanOrEqual(90);
  expect(address.bottom - box.y).toBeLessThanOrEqual(108);
  expect(address.right - box.x).toBeLessThanOrEqual(520);
  await expect(page.getByTestId("ocr-button")).toHaveCount(0); // no picture of print: no page OCR

  // Right-click on the address picture: its menu reads it.
  // (Retried as the double-clicks elsewhere: on a slow runner the page's canvas may not take events yet.)
  const menu = page.getByTestId("picture-menu");
  await expect(async () => {
    await page.mouse.move(box.x + 300, box.y + 99);
    await page.mouse.click(box.x + 300, box.y + 99, { button: "right" });
    await expect(menu).toBeVisible({ timeout: 1000 });
  }).toPass();
  await menu.getByRole("menuitem", { name: "Kenali teks di gambar ini (OCR)" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Hasil OCR: 1 paragraf/ })).toBeVisible({ timeout: 45_000 });
  await expect(maybe).toHaveCount(1); // read: its button goes
  // Its menu now says so (right of the paragraph read: on the paragraph its own menu opens).
  await page.mouse.click(box.x + 505, box.y + 99, { button: "right" });
  await expect(page.getByTestId("picture-menu").getByRole("menuitem")).toHaveText("Teks di gambar ini sudah dikenali");
  await page.keyboard.press("Escape");

  // The paragraph read edits like any OCR paragraph.
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 250, box.y + 99);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("Contoh Raya");
  await page.mouse.click(box.x + 300, box.y + 600);
  await expect(editor).toHaveCount(0);

  // The OCR tool: drag around the logo's name.
  await page.getByRole("button", { name: "Kenali teks di area (OCR)" }).click();
  await page.mouse.move(box.x + 44, box.y + 88);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 98, { steps: 4 });
  await page.mouse.move(box.x + 110, box.y + 108, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("status").filter({ hasText: /Hasil OCR: 1 paragraf|tidak menemukan teks/ })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Pilih", exact: true })).toHaveAttribute("aria-pressed", "true"); // back to Pilih
});

test("Escape cancels an area being dragged with the OCR tool: nothing is read", async ({ page }) => {
  const box = await open(page);
  let ocrCalls = 0;
  page.on("request", (r) => { if (/\/ocr$/.test(r.url())) ocrCalls++; });
  await page.getByRole("button", { name: "Kenali teks di area (OCR)" }).click();
  await page.mouse.move(box.x + 44, box.y + 88);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 108, { steps: 4 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Pilih", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(box.x + 120, box.y + 110, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(ocrCalls).toBe(0);
});
