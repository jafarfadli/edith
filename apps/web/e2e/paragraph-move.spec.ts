import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Original text is moved like any object from the first click: arrow keys nudge it (it becomes its text.edit op), and
// dragging it shows the smart guides and snaps. apps/api/scripts/e2e_text_pdf.py: paragraph 1 in Rect(72, 90, …),
// paragraph 2 from y = 290, both starting at x = 72.
const TEXT_PDF = path.join(__dirname, "fixtures", "text.pdf");
const P1 = { x: 72, y: 88, w: 290, h: 56 };

type DraftOp = { id: string; type: string; box: { rect: { x: number; y: number } } };
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
  return Object.values((key ? JSON.parse(localStorage.getItem(key)!) : { objects: {} }).objects as Record<string, DraftOp>);
});
const edits = async (page: Page) => (await draftOps(page)).filter((o) => o.type === "text.edit");

async function open(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(TEXT_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  return (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px
}

/** Selects the original paragraph at (x, y) (its targets appear once the text and fonts are in). */
async function selectParagraph(page: Page, x: number, y: number) {
  const del = page.getByTestId("properties-bar").getByRole("button", { name: "Hapus teks" });
  await expect(async () => {
    await page.mouse.click(x, y);
    await expect(del).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Columns (canvas pixels) of the overlay's canvases holding the smart-guide colour (#f5316f). */
const guideColumns = (page: Page) => page.evaluate(() => {
  const cols = new Map<number, number>();
  for (const c of document.querySelectorAll<HTMLCanvasElement>('[data-testid="overlay"] canvas')) {
    const w = c.width, h = c.height, d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] > 100 && d[i] > 220 && d[i + 1] > 30 && d[i + 1] < 90 && d[i + 2] > 80 && d[i + 2] < 140) cols.set(x, (cols.get(x) ?? 0) + 1);
    }
  }
  return [...cols].filter(([, n]) => n >= 40).map(([k]) => k);
});

test("arrow keys move original text from the first click, held presses included, in screen points", async ({ page }) => {
  const box = await open(page);
  await selectParagraph(page, box.x + P1.x + 20, box.y + P1.y + 10);
  expect(await edits(page)).toHaveLength(0); // only selected: no edit yet

  // Three quick presses (before the fonts are in): all of them count.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await edits(page)).length).toBe(1);
  const x0 = (await edits(page))[0].box.rect.x;
  expect(x0).toBeGreaterThan(P1.x);
  expect(x0).toBeLessThan(P1.x + 8); // 72 + 3, give or take the paragraph's own padding

  // Now an object: the next presses move it, Shift by 10.
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await edits(page))[0].box.rect.x).toBeCloseTo(x0 + 10, 1);
  expect(await edits(page)).toHaveLength(1);
});

test("dragging original text from the first click shows the smart guides and snaps to the other paragraph", async ({ page }) => {
  const box = await open(page);
  const x = box.x + P1.x + 20, y = box.y + P1.y + 10;
  await selectParagraph(page, x, y);
  expect(await guideColumns(page)).toEqual([]);

  // 4 px right of where it started: within the snap distance of paragraph 2's left edge, which has the same x.
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + i / 2, y + 40);
  await expect.poll(async () => (await guideColumns(page)).length).toBeGreaterThan(0);
  await page.mouse.up();
  await expect.poll(async () => (await guideColumns(page)).length).toBe(0); // gone after the drop
  await expect.poll(async () => (await edits(page)).length).toBe(1); // the drop made it an edit (fonts, then autosave)
  const [edit] = await edits(page);
  expect(Math.abs(edit.box.rect.x - P1.x)).toBeLessThan(2); // snapped back to the left edge it shares with paragraph 2, not 4 px off
});

// A scanned page (apps/api/scripts/e2e_scan_pdf.py): OCR's body paragraph starts at (72, 300). Needs Tesseract (ind+eng),
// as ocr.spec.ts does.
const SCAN = path.join(__dirname, "fixtures", "scan.pdf");

test("text OCR read moves like any object: arrow keys and drag, from the first click; its cover stays where the print was", async ({ page }) => {
  const { execFileSync } = await import("node:child_process");
  let ok = false;
  try { ok = /^ind$/m.test(execFileSync("tesseract", ["--list-langs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { /* none */ }
  test.skip(!ok && process.env.EDITH_REQUIRE_TESSERACT !== "1", "tesseract with ind+eng is not installed");

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(SCAN);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!;
  await page.getByTestId("ocr-button").click();
  await expect(page.getByTestId("ocr-status")).toContainText(/Hasil OCR: \d+ paragraf/, { timeout: 45_000 });
  await page.getByTestId("ocr-status-close").click();

  type Op = { type: string; box: { rect: { x: number; y: number } }; cover: { x: number; y: number } };
  const ocrEdits = async () => (await draftOps(page) as unknown as Op[]).filter((o) => o.type === "text.ocr_edit");
  const del = page.getByTestId("properties-bar").getByRole("button", { name: "Hapus teks" });
  await expect(async () => {
    await page.mouse.click(box.x + 150, box.y + 300);
    await expect(del).toBeVisible({ timeout: 1000 });
  }).toPass();
  expect(await ocrEdits()).toHaveLength(0); // only selected

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => (await ocrEdits()).length).toBe(1);
  const [a] = await ocrEdits();
  const cover = { ...a.cover };

  // Dragged by the pointer afterwards (the edit is an object now): 40 px down.
  const y = box.y + 300 + a.box.rect.y - 300 + 10;
  await page.mouse.move(box.x + a.box.rect.x + 30, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + a.box.rect.x + 30, y + i * 5);
  await page.mouse.up();
  await expect.poll(async () => (await ocrEdits())[0].box.rect.y).toBeGreaterThan(a.box.rect.y + 20);
  expect((await ocrEdits())[0].cover).toEqual(cover); // the covers stay on the print
  expect(await ocrEdits()).toHaveLength(1);
});

test("text OCR read can be dragged straight after the first click: the text moves, the covers stay", async ({ page }) => {
  const { execFileSync } = await import("node:child_process");
  let ok = false;
  try { ok = /^ind$/m.test(execFileSync("tesseract", ["--list-langs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { /* none */ }
  test.skip(!ok && process.env.EDITH_REQUIRE_TESSERACT !== "1", "tesseract with ind+eng is not installed");

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(SCAN);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!;
  await page.getByTestId("ocr-button").click();
  await expect(page.getByTestId("ocr-status")).toContainText(/Hasil OCR: \d+ paragraf/, { timeout: 45_000 });
  await page.getByTestId("ocr-status-close").click();

  const del = page.getByTestId("properties-bar").getByRole("button", { name: "Hapus teks" });
  await expect(async () => {
    await page.mouse.click(box.x + 150, box.y + 300);
    await expect(del).toBeVisible({ timeout: 1000 });
  }).toPass();

  const x = box.x + 150, y = box.y + 300;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + 3, y + i * 5);
  await page.mouse.up();
  await expect.poll(async () => (await draftOps(page)).filter((o) => o.type === "text.ocr_edit").length).toBe(1);
  const [op] = (await draftOps(page)).filter((o) => o.type === "text.ocr_edit") as unknown as { box: { rect: { y: number } }; cover: { y: number } }[];
  expect(op.box.rect.y).toBeGreaterThan(300 + 20); // moved down about 40
  expect(op.cover.y).toBeLessThan(300); // the cover is still on the print
});

