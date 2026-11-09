import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfInfo } from "./pdfText";
import { pdfSpans } from "./pdfSpans";

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

/** Puts the caret of the rich text editor after its last character (focus alone may leave it at the start). */
async function caretAtEnd(page: Page) {
  const editor = page.getByTestId("text-editor");
  await editor.evaluate((el) => {
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
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

  // The letterhead's invisible text: a double-click opens no editor; a notice says why and how to replace it.
  const status = page.getByRole("status").filter({ hasText: "sebenarnya gambar" });
  await expect(async () => {
    await page.mouse.move(box.x + 150, box.y + 75);
    await page.mouse.dblclick(box.x + 150, box.y + 75);
    await expect(status).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(status).toContainText("Whiteout");
  await expect(page.getByTestId("text-editor")).toHaveCount(0);

  // A single click on text that is a picture is a click on the empty page: it deselects, and explains nothing.
  const miniBar = page.getByTestId("mini-bar");
  await page.getByRole("button", { name: "Centang", exact: true }).click();
  await page.mouse.click(box.x + 540, box.y + 600);
  await page.getByRole("button", { name: "Pilih", exact: true }).click();
  await page.mouse.click(box.x + 540, box.y + 600);
  await expect(miniBar).toBeVisible();
  await page.mouse.click(box.x + 300, box.y + 400);
  await expect(miniBar).toHaveCount(0);
  const scan = page.getByRole("status").filter({ hasText: "hasil pindai" });
  await expect(scan).toHaveCount(0);
  // The pictured form body explains itself on a double-click.
  await page.mouse.dblclick(box.x + 300, box.y + 400);
  await expect(scan).toBeVisible();

  // Under the text tool a click there still adds a text box (Whiteout, then new text) and explains once.
  await scan.getByRole("button", { name: "Tutup" }).click();
  await expect(scan).toHaveCount(0);
  await page.getByRole("button", { name: "Teks", exact: true }).click();
  await page.mouse.click(box.x + 300, box.y + 330);
  await expect(scan).toBeVisible();
  await expect(page.getByTestId("text-editor")).toBeVisible();
  await page.getByRole("button", { name: "Pilih", exact: true }).click(); // the empty new box goes away
  await expect(page.getByTestId("text-editor")).toHaveCount(0);

  // The visible paragraph is still editable; the export keeps both pictures and does not draw the letterhead twice.
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 120, box.y + 196);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("Paragraf biasa yang terlihat.");
  await caretAtEnd(page);
  await page.keyboard.type(" Diubah.");
  await expect(editor).toContainText("terlihat. Diubah.");
  await page.mouse.click(box.x + 450, box.y + 560);
  await expect(editor).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "picture-text.pdf");
  await (await download).saveAs(file);
  const text = (await pdfInfo(file)).pages[0].text;
  // The original words keep their glyphs (M5d) and " Diubah." is drawn after them: one line, read by position.
  const line = pdfSpans(file)[0].filter((s) => s.text.includes("Paragraf biasa") || s.text.includes("Diubah"));
  expect(new Set(line.map((s) => Math.round(s.origin[1]))).size).toBe(1);
  expect(line.sort((a, b) => a.origin[0] - b.origin[0]).map((s) => s.text.trim()).join(" ")).toBe("Paragraf biasa yang terlihat. Diubah.");
  expect(text.split("Paragraf biasa yang terlihat.").length - 1).toBe(1);
  expect(text.split("SEKRETARIAT JENDERAL").length - 1).toBe(1); // the invisible layer once, nothing drawn over it
});

type DraftOp = { type: string; paragraphId?: string };
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
  return Object.values((key ? JSON.parse(localStorage.getItem(key)!) : { objects: {} }).objects as Record<string, DraftOp>);
});

test("a draft's edit of text that turned out to be a picture is dropped on load, and the export works", async ({ page }) => {
  const box = await open(page);
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 120, box.y + 196);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await caretAtEnd(page);
  await page.keyboard.type(" Diubah.");
  await expect(editor).toContainText("terlihat. Diubah.");
  await page.mouse.click(box.x + 450, box.y + 560);
  await expect.poll(() => draftOps(page)).toEqual([expect.objectContaining({ type: "text.edit", paragraphId: "g0" })]);

  // As a draft made before M5c could hold it: the same edit aimed at the letterhead's invisible text (g1).
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"))!;
    const draft = JSON.parse(localStorage.getItem(key)!);
    for (const op of Object.values(draft.objects) as DraftOp[]) op.paragraphId = "g1";
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "ternyata gambar dihapus" })).toBeVisible();
  await expect.poll(() => draftOps(page)).toEqual([]); // the autosave keeps the draft without it
  await expect(page.getByRole("button", { name: "Urungkan" })).toBeDisabled(); // no undo step brings it back

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  await (await download).saveAs(path.join(test.info().outputDir, "dropped.pdf"));
});
