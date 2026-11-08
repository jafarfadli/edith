import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfInfo } from "./pdfText";
import { pdfSpans } from "./pdfSpans";

// apps/api/scripts/e2e_text_pdf.py: paragraph 1 (Helvetica 12) in Rect(72, 90, 372, 160), paragraph 2 (embedded Tinos) from y = 290.
const TEXT_PDF = path.join(__dirname, "fixtures", "text.pdf");

/** Selects `word` inside the rich text editor (as a double-click on it would). */
async function selectWord(page: Page, word: string) {
  await page.getByTestId("text-editor").evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + w.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`"${w}" not in the editor`);
  }, word);
}

test("edit an original paragraph, find & replace, download", async ({ page }) => {
  await page.goto("/");
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(TEXT_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  // Double-click paragraph 1 → rich editor with its text; make "penting" bold; click away to commit.
  const editor = page.getByTestId("text-editor");
  await expect(async () => { // the paragraph targets appear once the overlay and its fonts are ready
    await page.mouse.dblclick(box.x + 150, box.y + 110);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("kata penting yang");
  await selectWord(page, "penting");
  await page.getByRole("button", { name: "Tebal", exact: true }).click();
  await expect(editor.locator("span[data-run]").filter({ hasText: /^penting$/ })).toHaveCount(1); // its own run now
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);

  // Find & Replace: "lama" is in both paragraphs (the edited one is now a text.edit op).
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Cari teks" }).fill("lama");
  await expect(page.getByTestId("find-bar")).toContainText("1 dari 2");
  await page.getByRole("button", { name: "Tampilkan ganti" }).click();
  await page.getByRole("textbox", { name: "Ganti dengan" }).fill("baru");
  await page.getByRole("button", { name: "Ganti semua" }).click();
  await expect(page.getByTestId("find-bar")).toContainText("0 dari 0");

  // Replace All is one undo step.
  await page.getByRole("button", { name: "Tutup" }).click();
  await page.getByRole("button", { name: "Urungkan" }).click();
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Cari teks" }).fill("lama");
  await expect(page.getByTestId("find-bar")).toContainText("1 dari 2");
  await page.getByRole("button", { name: "Tutup" }).click();
  await page.getByRole("button", { name: "Ulangi" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "text.pdf");
  await (await downloadPromise).saveAs(file);

  const text = (await pdfInfo(file)).pages[0].text;
  expect(text).not.toContain("\u00a0"); // spaces baked with Tinos read back as U+0020 in pdf.js
  expect(text).toContain("Paragraf kedua memakai font asli");
  expect(text).not.toContain("lama");
  expect(text).toContain("baru");
  expect(text).toContain("penting");

  // Raw PyMuPDF text: a bad ToUnicode would show here as U+00A0 (pdf.js hides it).
  expect(pdfSpans(file, true)[0].map((s) => s.text).join("")).not.toContain("\u00a0");
  const spans = pdfSpans(file)[0];
  const bold = spans.find((s) => s.text.includes("penting"))!;
  expect(bold.font).toMatch(/Arimo.*Bold/);
  expect(bold.text.trim()).toBe("penting");
  expect(spans.find((s) => s.text.includes("Paragraf pertama"))!.font).toMatch(/Arimo/);
  expect(spans.find((s) => s.text.includes("Paragraf kedua"))!.font).toContain("EdithDoc"); // subset at export: MuPDF names it after the family

  // Unchanged text keeps its lines: every original line still starts at the same place with the same word.
  for (const s of pdfSpans(TEXT_PDF)[0]) {
    const after = spans.find((x) => Math.abs(x.origin[0] - s.origin[0]) <= 0.5 && Math.abs(x.origin[1] - s.origin[1]) <= 0.5);
    expect(after?.text.split(" ")[0]).toBe(s.text.split(" ")[0]);
  }

  // The baked baselines are where the editor laid the lines out (±0.5 pt).
  type Draft = { objects: Record<string, { type: string; box: { rect: { y: number }; layout: { baseline: number }[] } }> };
  const readDraft = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
    return key ? (JSON.parse(localStorage.getItem(key)!) as Draft) : null;
  });
  const editsOf = (d: Draft | null) => Object.values(d?.objects ?? {}).filter((o) => o.type === "text.edit");
  await expect.poll(async () => editsOf(await readDraft()).length).toBe(2); // the autosave is debounced
  const edits = editsOf(await readDraft());
  for (const op of edits) {
    for (const line of op.box.layout) {
      const y = op.box.rect.y + line.baseline;
      expect(spans.some((s) => Math.abs(s.origin[1] - y) <= 0.5)).toBe(true);
    }
  }
});

test("warns about unsupported characters while typing, before commit", async ({ page }) => {
  await page.goto("/");
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(TEXT_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!;
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 150, box.y + 110);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByText("beberapa karakter tidak didukung font ini")).toHaveCount(0);
  await editor.pressSequentially("𓀀"); // a hieroglyph: no bundled font, CJK pack included, has it
  await expect(page.getByText("beberapa karakter tidak didukung font ini")).toBeVisible();
});
