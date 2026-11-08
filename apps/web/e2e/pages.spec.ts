import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfReport, wordBox } from "./pdfAnnots";
import { pdfShapes } from "./pdfShapes";

// apps/api/scripts/e2e_pages_pdf.py: pages.pdf = "Halaman satu/dua/tiga" (A4), field `nama` on page 1;
// import.pdf = "Impor A/B" (400 × 500), page 1 also "kata penting di sini" and its own field `nama` at (72, 230).
const PAGES_PDF = path.join(__dirname, "fixtures", "pages.pdf");
const IMPORT_PDF = path.join(__dirname, "fixtures", "import.pdf");

async function pageBox(page: Page, index: number) {
  return (await page.getByTestId("page").nth(index).boundingBox())!; // zoom 100 %: 1 pt = 1 px
}

async function shapeTool(page: Page, name: string) {
  await page.getByRole("button", { name: "Bentuk pilihan" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("manage pages, import, crop, shapes, copy/paste, align and the annotations panel", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(PAGES_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page")).toHaveCount(3);

  // Kelola Halaman: rotate page 3, duplicate page 1, delete page 2, then Simpan (one undo step).
  await page.getByRole("button", { name: "Kelola Halaman" }).click();
  const modal = page.getByRole("dialog", { name: "Kelola Halaman" });
  const tile = (key: string) => modal.locator(`[data-testid="manage-page"][data-page-key="${key}"]`);
  await tile("o2").click();
  await modal.getByRole("button", { name: /Putar kanan/ }).click();
  await modal.getByRole("button", { name: "Batal pilih" }).click();
  await tile("o0").click();
  await modal.getByRole("button", { name: /Duplikat/ }).click();
  await modal.getByRole("button", { name: "Batal pilih" }).click();
  await tile("o1").click();
  await modal.getByRole("button", { name: /Hapus/ }).click();
  await expect(modal.getByTestId("manage-page")).toHaveCount(3);
  await modal.getByRole("button", { name: "Simpan" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByTestId("page")).toHaveCount(3);

  // Impor PDF after the last page, from the "+" below it.
  await page.getByRole("button", { name: "Sisipkan halaman" }).last().click();
  const chooser = page.waitForEvent("filechooser");
  const importedText = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByRole("menuitem", { name: "Impor PDF" }).click();
  await (await chooser).setFiles(IMPORT_PDF);
  await expect(page.getByTestId("page")).toHaveCount(5);
  await expect(page.getByTestId("page-indicator")).toHaveText("4/5"); // scrolled to the first imported page
  await importedText;
  const top = Math.round((await page.locator("#page-scroller").boundingBox())!.y);
  await expect.poll(async () => Math.round((await pageBox(page, 3)).y)).toBe(top); // the smooth scroll has settled

  // On the imported page: edit its first paragraph, highlight "penting", fill its own `nama` field.
  let box = await pageBox(page, 3);
  const editor = page.getByTestId("text-editor");
  await expect(async () => { // the paragraph targets appear once the overlay and its fonts are ready
    await page.mouse.dblclick(box.x + 90, box.y + 66);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("Impor A");
  await editor.focus(); // else a typed space would scroll the page
  await page.keyboard.press("End");
  await page.keyboard.type(" diedit");
  await expect(editor).toContainText("Impor A diedit");
  await page.mouse.click(box.x + 300, box.y + 400);
  await expect(editor).toHaveCount(0);
  // Committing can scroll the page list: bring the imported page back to the top.
  await page.getByTestId("thumb").nth(3).click();
  await expect.poll(async () => Math.round((await pageBox(page, 3)).y)).toBe(top);
  box = await pageBox(page, 3);
  const [w0, , w1] = wordBox(IMPORT_PDF, "penting");
  const chars = page.waitForResponse((r) => /\/pages\/0\/chars$/.test(r.url()) && r.ok());
  await page.getByRole("button", { name: "Penanda", exact: true }).click();
  await chars;
  await page.mouse.move(box.x + w0 + 1, box.y + 196);
  await page.mouse.down();
  await page.mouse.move(box.x + (w0 + w1) / 2, box.y + 196, { steps: 3 });
  await page.mouse.move(box.x + w1 - 1, box.y + 196, { steps: 3 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Pilih", exact: true }).click();
  await page.getByTestId("page").nth(3).getByRole("textbox", { name: "nama", exact: true }).fill("Impor Budi");

  // Back to page 1 (its thumbnail scrolls it to the top); fill the main PDF's `nama` (same name, other field).
  await page.getByTestId("thumb").nth(0).click();
  await expect(page.getByTestId("page-indicator")).toHaveText("1/5");
  await expect.poll(async () => Math.round((await pageBox(page, 0)).y)).toBe(top); // the smooth scroll has settled
  await page.getByTestId("page").nth(0).getByRole("textbox", { name: "nama", exact: true }).fill("Utama Budi");

  // A dashed, half-transparent rectangle on page 1, turned 90° with the rotation handle.
  box = await pageBox(page, 0);
  await shapeTool(page, "Persegi");
  await page.mouse.move(box.x + 100, box.y + 250);
  await page.mouse.down(); // (well below the `nama` field at y 100–120: its input would cover the rotation handle)
  await page.mouse.move(box.x + 175, box.y + 300, { steps: 3 });
  await page.mouse.move(box.x + 250, box.y + 350, { steps: 3 });
  await page.mouse.up();
  await page.getByRole("combobox", { name: "Gaya garis" }).selectOption("dashed");
  await page.getByRole("slider", { name: "Opasitas" }).fill("0.5");
  await expect(page.getByTestId("mini-bar")).toBeVisible();
  // Konva's rotater sits 50 px above the top edge's middle; dragging it to the right of the centre turns 90°.
  await page.mouse.move(box.x + 175, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 230, box.y + 230, { steps: 4 });
  await page.mouse.move(box.x + 300, box.y + 300, { steps: 4 });
  await page.mouse.up();

  // A polygon closed on its first vertex, and a cloud finished with Enter.
  await shapeTool(page, "Poligon");
  for (const [x, y] of [[350, 150], [450, 150], [400, 230], [350, 150]]) await page.mouse.click(box.x + x, box.y + y);
  await shapeTool(page, "Awan");
  for (const [x, y] of [[350, 300], [470, 300], [470, 380], [350, 380]]) await page.mouse.click(box.x + x, box.y + y);
  await page.keyboard.press("Enter");

  // A check mark, deleted again from the Anotasi panel.
  await page.getByRole("button", { name: "Centang", exact: true }).click();
  await page.mouse.click(box.x + 500, box.y + 600);
  await page.getByRole("button", { name: "Pilih", exact: true }).click();

  // Anotasi panel: a click selects the rectangle; copy it, paste it on page 2, line it up with the page's left edge.
  await page.getByRole("tab", { name: /Anotasi/ }).click();
  const items = page.getByTestId("annotation-item");
  await expect(items).toHaveCount(6); // + the edited paragraph and the highlight on the imported page
  await items.filter({ hasText: "Persegi" }).click();
  await expect(page.getByTestId("mini-bar")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+c");
  await page.getByRole("button", { name: "Halaman berikutnya" }).click();
  await expect(page.getByTestId("page-indicator")).toHaveText("2/5");
  await expect.poll(async () => Math.round((await pageBox(page, 1)).y)).toBe(top); // scrolling closes menus: let it settle
  await page.keyboard.press("ControlOrMeta+v");
  await expect(items).toHaveCount(7);
  await page.getByTestId("mini-bar").getByRole("button", { name: "Lainnya" }).click();
  await page.getByRole("menuitem", { name: "Ratakan ke kiri halaman" }).click();

  // Crop page 2 (the default crop: 5 % in from every edge).
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  await page.getByTestId("crop-bar").getByRole("button", { name: "Terapkan ke halaman ini" }).click();
  await expect(page.getByTestId("crop-overlay")).toHaveCount(0);
  box = await pageBox(page, 1);
  expect(Math.round(box.width)).toBe(536); // 595 × 0.9

  // The panel: the polygon is selected from it, the check mark deleted.
  await items.filter({ hasText: "Poligon" }).click();
  await expect(page.getByTestId("mini-bar")).toBeVisible();
  await page.getByRole("button", { name: "Hapus Centang" }).click();
  await expect(items).toHaveCount(6);

  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "pages.pdf");
  await (await pending).saveAs(file);

  const pages = pdfShapes(file);
  // Page text includes the filled fields' appearances; the duplicate shares the main PDF's `nama` field.
  expect(pages.map((p) => p.text)).toEqual(["Halaman satu Utama Budi", "Halaman satu Utama Budi", "Halaman tiga",
    "kata penting di sini Impor A diedit Impor Budi", "Impor B"]);
  expect(pages.map((p) => p.rotation)).toEqual([0, 0, 90, 0, 0]);
  expect([pages[3].width, pages[3].height]).toEqual([400, 500]);
  // Crop: 5 % in from each edge, applied last.
  expect(pages[1].cropbox.map((v) => Math.round(v))).toEqual([30, 42, 565, 800]);

  const red = (d: { color: number[] | null }) => d.color && d.color[0] > 0.8 && d.color[1] < 0.2;
  const [rect] = pages[0].drawings.filter((d) => red(d) && d.dashes === "[ 6 4 ] 0");
  expect(rect.strokeOpacity).toBeCloseTo(0.5);
  // 150 × 100 turned 90° around its centre (175, 300): 100 × 150.
  expect(rect.rect.map((v) => Math.round(v))).toEqual([125, 225, 225, 375]);
  const polygon = pages[0].drawings.find((d) => red(d) && d.items.length === 3 && d.items.every((i) => i === "l"));
  expect(polygon).toBeTruthy();
  const cloud = pages[0].drawings.find((d) => red(d) && d.items.every((i) => i === "c"));
  expect(cloud!.items.length).toBeGreaterThan(16);
  expect(pages[0].drawings.filter((d) => d.color && d.color[2] > 0.6 && d.color[0] < 0.2)).toHaveLength(0); // the check mark is gone
  // The pasted copy: dashed and translucent too, its left edge on the page's left edge (before the crop: x = 0).
  const [copy] = pages[1].drawings.filter((d) => red(d) && d.dashes === "[ 6 4 ] 0");
  expect(copy.strokeOpacity).toBeCloseTo(0.5);
  expect(Math.round(copy.rect[0] + 29.75)).toBe(0);

  // The imported page's highlight and both `nama` fields: the imported one renamed, each with its own value.
  const report = pdfReport(file);
  expect(report.pages[3].annots.map((a) => a.type)).toEqual(["Highlight"]);
  expect(report.pages[0].widgets).toEqual([{ name: "nama", value: "Utama Budi" }]);
  expect(report.pages[1].widgets).toEqual([{ name: "nama", value: "Utama Budi" }]);
  expect(report.pages[3].widgets).toHaveLength(1);
  expect(report.pages[3].widgets[0].name).toMatch(/^nama \[\d+\]$/);
  expect(report.pages[3].widgets[0].value).toBe("Impor Budi");
});
