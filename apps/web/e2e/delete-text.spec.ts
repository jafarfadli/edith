import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pdfInk, pdfPixels } from "./pdfPixels";
import { pdfInfo } from "./pdfText";

// apps/api/scripts/e2e_text_pdf.py: paragraph 1 (Helvetica 12, three lines) in Rect(72, 90, 372, 160), paragraph 2
// (embedded Tinos, two lines) from y = 290.
const TEXT_PDF = path.join(__dirname, "fixtures", "text.pdf");
const P1 = { x: 72, y: 88, w: 290, h: 56 }, P2 = { x: 72, y: 288, w: 280, h: 30 };
/** Screenshots of the UI states for a design check, when set (a directory). */
const SHOTS = process.env.E2E_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `delete-text-${name}.png`) });
}

async function open(page: Page, file = TEXT_PDF) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  return (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px
}

type DraftOp = { id: string; type: string; paragraphId?: string; box: { paragraphs: { text: string }[][] } };
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
  return Object.values((key ? JSON.parse(localStorage.getItem(key)!) : { objects: {} }).objects as Record<string, DraftOp>);
});
/** The draft's text edits as [paragraph id, text]. */
const edits = async (page: Page) => (await draftOps(page)).filter((o) => o.type.startsWith("text."))
  .map((o) => [o.paragraphId, o.box.paragraphs.map((p) => p.map((r) => r.text).join("")).join("\n")]);

async function download(page: Page, name: string): Promise<string> {
  const d = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, name);
  await (await d).saveAs(file);
  return file;
}

/** Selects the original paragraph at (x, y) with the select tool (its targets appear once the text and fonts are in). */
async function selectParagraph(page: Page, x: number, y: number) {
  const del = page.getByTestId("properties-bar").getByRole("button", { name: "Hapus teks" });
  await expect(async () => {
    await page.mouse.click(x, y);
    await expect(del).toBeVisible({ timeout: 1000 });
  }).toPass();
}

test("Delete removes a selected original paragraph's text from the export, the neighbour stays; undo brings it back", async ({ page }) => {
  const box = await open(page);
  await selectParagraph(page, box.x + 150, box.y + 110);
  await expect(page.getByTestId("tool-hint")).toContainText("Tekan Delete untuk menghapus");
  await shot(page, "1-selected");

  await page.keyboard.press("Delete");
  await expect.poll(() => edits(page)).toEqual([["g0", ""]]);
  await shot(page, "2-deleted");
  // The deleted paragraph stays selected, with the way back in the bar; its place still selects it.
  const bar = page.getByTestId("properties-bar");
  await expect(bar.getByRole("button", { name: "Kembalikan teks asli" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Hapus teks" })).toHaveCount(0);
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(bar).toHaveCount(0);
  await page.mouse.click(box.x + 100, box.y + 135); // the third line's place
  await expect(bar.getByRole("button", { name: "Kembalikan teks asli" })).toBeVisible();
  // Delete again: nothing (it would otherwise bring the original back).
  await page.keyboard.press("Delete");
  await page.waitForTimeout(300);
  expect(await edits(page)).toEqual([["g0", ""]]);

  const file = await download(page, "deleted.pdf");
  const text = (await pdfInfo(file)).pages[0].text;
  expect(text).not.toContain("Paragraf pertama");
  expect(text).not.toContain("cari dan ganti");
  expect(text).toContain("Paragraf kedua memakai font asli");
  expect(pdfInk(file, 0, P1)).toBe(0);
  expect(pdfInk(file, 0, P2)).toBe(pdfInk(TEXT_PDF, 0, P2));
  expect(pdfInk(TEXT_PDF, 0, P1)).toBeGreaterThan(500);

  // Undo: the text is back, as it was.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => edits(page)).toEqual([]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => edits(page)).toEqual([["g0", ""]]);
  // "Kembalikan teks asli" too.
  await page.mouse.click(box.x + 100, box.y + 135);
  await bar.getByRole("button", { name: "Kembalikan teks asli" }).click();
  await expect.poll(() => edits(page)).toEqual([]);
  const back = await download(page, "restored.pdf");
  expect((await pdfInfo(back)).pages[0].text).toContain("Paragraf pertama berisi kata penting");
});

test("in the editor: select all, Delete, click away deletes the text (not discarded, not reverted)", async ({ page }) => {
  const box = await open(page);
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 150, box.y + 300);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("Paragraf kedua");
  // The editor takes focus a frame or two after it shows (Tiptap focuses after attaching, in requestAnimationFrame):
  // keys pressed before that went to the page (select all selected the page, Delete did nothing, nothing landed).
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await shot(page, "3-editor-empty");
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);
  await expect.poll(() => edits(page)).toEqual([["g1", ""]]);
  // A reload restores it from the draft.
  await page.reload();
  await expect(page.getByTestId("page").first()).toBeVisible();
  await expect.poll(() => edits(page)).toEqual([["g1", ""]]);
  const file = await download(page, "editor.pdf");
  const text = (await pdfInfo(file)).pages[0].text;
  expect(text).not.toContain("Paragraf kedua");
  expect(text).toContain("Paragraf pertama berisi kata penting");
  expect(pdfInk(file, 0, P2)).toBe(0);
  expect(pdfInk(file, 0, P1)).toBe(pdfInk(TEXT_PDF, 0, P1));
});

test("Delete on an edited paragraph deletes its text; the right-click menus delete, edit and restore text", async ({ page }) => {
  const box = await open(page);
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 150, box.y + 110);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await editor.pressSequentially(" Tambahan.");
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await edits(page))[0]?.[1]).toContain("Tambahan.");
  await page.mouse.click(box.x + 150, box.y + 110); // the edit, selected
  await expect(page.getByTestId("properties-bar").getByRole("button", { name: "Kembalikan teks asli" })).toBeVisible();
  await page.keyboard.press("Backspace");
  await expect.poll(() => edits(page)).toEqual([["g0", ""]]);

  // Right-click on the other (original) paragraph: Edit teks, Hapus teks.
  await page.mouse.click(box.x + 150, box.y + 300, { button: "right" });
  const menu = page.getByTestId("text-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([/^Edit teks/, /^Hapus teks/]);
  await shot(page, "4-paragraph-menu");
  await menu.getByRole("menuitem", { name: /Hapus teks/ }).click();
  await expect.poll(async () => (await edits(page)).sort()).toEqual([["g0", ""], ["g1", ""]]);
  let text = (await pdfInfo(await download(page, "both.pdf"))).pages[0].text;
  expect(text).not.toContain("Paragraf");
  expect(text).not.toContain("Tambahan");

  // Right-click on the deleted paragraph's place: its menu restores the original.
  await page.mouse.click(box.x + 100, box.y + 120, { button: "right" });
  const objectMenu = page.getByTestId("object-menu");
  await expect(objectMenu.getByRole("menuitem", { name: /Hapus teks/ })).toBeDisabled();
  await shot(page, "5-edit-menu");
  await objectMenu.getByRole("menuitem", { name: "Kembalikan teks asli" }).click();
  await expect.poll(() => edits(page)).toEqual([["g1", ""]]);
  text = (await pdfInfo(await download(page, "one.pdf"))).pages[0].text;
  expect(text).toContain("Paragraf pertama berisi kata penting");
  expect(text).not.toContain("Paragraf kedua");

  // "Edit teks" from the menu opens the paragraph for typing.
  await page.mouse.click(box.x + 150, box.y + 110, { button: "right" });
  await page.getByTestId("text-menu").getByRole("menuitem", { name: "Edit teks" }).click();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Paragraf pertama");
});

function hasTesseract(): boolean {
  try {
    const langs = execFileSync("tesseract", ["--list-langs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /^ind$/m.test(langs) && /^eng$/m.test(langs);
  } catch {
    return false;
  }
}

test("Delete on a paragraph OCR read covers its picture and draws nothing", async ({ page }) => {
  test.skip(!hasTesseract() && process.env.EDITH_REQUIRE_TESSERACT !== "1", "tesseract with ind+eng is not installed");
  // apps/api/scripts/e2e_scan_pdf.py: the body paragraph's three lines start at (72, 300), 15 pt apart.
  const SCAN = path.join(__dirname, "fixtures", "scan.pdf");
  test.setTimeout(180_000); // may wait for a free OCR slot
  const box = await open(page, SCAN);
  // The server reads two pages at once (EDITH_OCR_SLOTS): with more tests reading in parallel it answers "ocr_busy" and
  // the button comes back, as it does for a user, who tries again.
  const button = page.getByTestId("ocr-button");
  await expect(async () => {
    if (await button.isVisible() && await button.isEnabled()) await button.click();
    await expect(page.getByTestId("ocr-status")).toContainText(/Hasil OCR: \d+ paragraf/, { timeout: 15_000 });
  }).toPass({ timeout: 120_000 });
  await page.getByTestId("ocr-status-close").click();
  await selectParagraph(page, box.x + 150, box.y + 300);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await draftOps(page)).map((o) => o.type)).toEqual(["text.ocr_edit"]);
  await shot(page, "6-ocr-deleted");
  const [op] = await draftOps(page) as (DraftOp & { coverColor: string })[];
  expect(op.box.paragraphs.flat().map((r) => r.text).join("")).toBe("");
  const file = await download(page, "ocr.pdf");
  expect((await pdfInfo(file)).pages[0].text).not.toContain("permohonan");
  // Where the three lines were: only the cover's colour; outside it the picture as it was.
  const rgb = [1, 3, 5].map((i) => parseInt(op.coverColor.slice(i, i + 2), 16));
  for (const px of pdfPixels(file, 0, [[120 / 595, 302 / 842], [200 / 595, 318 / 842], [120 / 595, 331 / 842]])) {
    px.forEach((v, i) => expect(Math.abs(v - rgb[i])).toBeLessThanOrEqual(2));
  }
  const outside: [number, number][] = [[297 / 595, 86 / 842], [100 / 595, 368 / 842], [20 / 595, 20 / 842]];
  expect(pdfPixels(file, 0, outside)).toEqual(pdfPixels(SCAN, 0, outside));
});
