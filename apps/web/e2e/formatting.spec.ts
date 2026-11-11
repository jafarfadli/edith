import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfShapes, type DrawingInfo } from "./pdfShapes";
import { pdfChars, pdfSpans } from "./pdfSpans";

// apps/api/scripts/e2e_format_pdf.py: one 14 pt line (baseline 120, x 56) in embedded Arimo styles, "Peserta " regular,
// "Budi Santoso" bold italic with a drawn underline (y 121.4 … 122.3, x 108.14 … 198.36), " wajib " regular, "hadir"
// italic, " tepat waktu." regular; a table border at y 127 and, below, a paragraph underlined whole (y 171.4 … 172.3).
const PDF = path.join(__dirname, "fixtures", "formatting.pdf");
const OLD_BAR = { x0: 108.14, x1: 198.36 };

const bars = (ds: DrawingInfo[], y0: number) =>
  ds.filter((d) => d.fill && Math.abs(d.rect[1] - y0) < 0.15 && d.rect[3] - d.rect[1] < 1.5).map((d) => ({ x0: d.rect[0], x1: d.rect[2] }));

async function toolbarState(page: Page) {
  const pressed = async (name: string) => (await page.getByRole("button", { name, exact: true }).getAttribute("aria-pressed")) === "true";
  return { bold: await pressed("Tebal"), italic: await pressed("Miring"), underline: await pressed("Garis bawah") };
}

/** Puts the caret `offset` characters into the first occurrence of `word` in the rich editor. */
async function caretIn(page: Page, word: string, offset: number) {
  await page.getByTestId("text-editor").evaluate((el, [w, k]) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.textContent!.indexOf(w as string);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i + (k as number));
      range.collapse(true);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`${w} not in the editor`);
  }, [word, offset] as const);
}

test("an edit inside an underlined bold italic name keeps its style; the underline follows the text", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 150, box.y + 115);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("Budi Santoso");

  // The toolbar shows the original's style where the caret is: the embedded Arimo Bold Italic, underlined.
  await caretIn(page, "Budi", 2);
  await expect.poll(() => toolbarState(page)).toEqual({ bold: true, italic: true, underline: true });
  await caretIn(page, "hadir", 2);
  await expect.poll(() => toolbarState(page)).toEqual({ bold: false, italic: true, underline: false });
  await caretIn(page, "wajib", 2);
  await expect.poll(() => toolbarState(page)).toEqual({ bold: false, italic: false, underline: false });

  await caretIn(page, "Budi", 4);
  await page.keyboard.type("man");
  await expect(editor).toContainText("Budiman Santoso");
  await expect.poll(() => toolbarState(page)).toEqual({ bold: true, italic: true, underline: true });
  await page.screenshot({ path: test.info().outputPath("editing.png"), clip: { x: box.x, y: box.y + 90, width: 420, height: 100 } });
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("committed.png"), clip: { x: box.x, y: box.y + 90, width: 420, height: 100 } });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = test.info().outputPath("formatting.pdf");
  await (await downloadPromise).saveAs(file);

  // Bold italic stays bold italic (the embedded program, or its bundled stand-in for a letter the subset lacks), italic
  // stays italic, regular stays regular.
  const line = pdfSpans(file)[0].filter((s) => Math.abs(s.origin[1] - 120) < 0.5 && s.text.trim());
  const styleOf = (word: string) => line.filter((s) => s.text.includes(word) || word.includes(s.text.trim())).map((s) => s.font);
  expect(line.map((s) => s.text).join("").replace(/\s+/g, " ").trim()).toBe("Peserta Budiman Santoso wajib hadir tepat waktu.");
  for (const f of styleOf("Budiman Santoso")) expect(f).toMatch(/Bold.?Italic/i);
  for (const f of styleOf("hadir")) expect(f).toMatch(/Italic/i);
  for (const f of styleOf("hadir")) expect(f).not.toMatch(/Bold/i);
  for (const f of styleOf("wajib")) expect(f).not.toMatch(/Bold|Italic/i);

  // The underline runs under the longer name, in the original's place and thickness; the old bar is gone; the table
  // border and the next paragraph's underline are untouched.
  const chars = pdfChars(file)[0].filter((c) => Math.abs(c.origin[1] - 120) < 0.5);
  const text = chars.map((c) => c.c).join("");
  const start = chars[text.indexOf("Budiman")].origin[0], end = chars[text.indexOf("Santoso") + 6].x1;
  const drawings = pdfShapes(file)[0].drawings;
  const under = bars(drawings, 121.4);
  expect(under).toHaveLength(1);
  expect(under[0].x0).toBeCloseTo(start, 0);
  expect(Math.abs(under[0].x1 - end)).toBeLessThan(0.6);
  expect(Math.abs(under[0].x1 - OLD_BAR.x1)).toBeGreaterThan(10);
  expect(bars(drawings, 171.4)).toHaveLength(1);
  expect(drawings.some((d) => d.items.includes("l") && Math.abs(d.rect[1] - 127) < 0.1 && d.rect[0] < 41 && d.rect[2] > 554)).toBe(true);
});
