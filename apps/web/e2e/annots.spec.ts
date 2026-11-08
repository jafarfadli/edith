import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfReport, wordBox } from "./pdfAnnots";

// apps/api/scripts/e2e_annots_pdf.py: page 1 = a Helvetica line with "penting" (baseline 80), text field `nama`
// at (72, 100)–(272, 120), checkbox `setuju` at (72, 130); page 2 = "Halaman kedua".
const ANNOTS_PDF = path.join(__dirname, "fixtures", "annots.pdf");

async function pageBox(page: Page, index = 0) {
  return (await page.getByTestId("page").nth(index).boundingBox())!; // zoom 100 %: 1 pt = 1 px
}

async function download(page: Page, name: string): Promise<string> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, name);
  await (await pending).saveAs(file);
  return file;
}

test("highlight, note, signature, stamp, link and form, then download", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear()); // no autosave draft or signature library from an earlier run of this fixture
  await page.getByTestId("file-input").setInputFiles(ANNOTS_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page")).toHaveCount(2);
  const box = await pageBox(page);

  // Highlight "penting": the highlight tool loads the page's character boxes, then a drag selects the word.
  const [x0, , x1] = wordBox(ANNOTS_PDF, "penting");
  const chars = page.waitForResponse((r) => /\/pages\/0\/chars$/.test(r.url()) && r.ok());
  await page.getByRole("button", { name: "Penanda", exact: true }).click(); // default sub-tool: Stabilo
  await chars;
  await page.mouse.move(box.x + x0 + 1, box.y + 76);
  await page.mouse.down();
  await page.mouse.move(box.x + (x0 + x1) / 2, box.y + 76, { steps: 3 });
  await page.mouse.move(box.x + x1 - 1, box.y + 76, { steps: 3 });
  await page.mouse.up();

  // Sticky note with text.
  await page.getByRole("button", { name: "Catatan", exact: true }).click();
  await page.mouse.click(box.x + 400, box.y + 200);
  await page.getByRole("textbox", { name: "Isi catatan" }).fill("Periksa pasal ini");

  // Typed signature (saved to the library), then the same signature again from the library.
  await page.getByRole("button", { name: "Tanda Tangan", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Tanda tangan" });
  await modal.getByRole("textbox", { name: "Nama Anda" }).fill("Budi Santoso");
  await modal.getByRole("radio", { name: "Great Vibes" }).click();
  await modal.getByRole("button", { name: "Tambahkan", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: "Tanda Tangan", exact: true }).click();
  await modal.getByRole("button", { name: "Pakai tanda tangan" }).first().click();
  await expect(modal).toHaveCount(0);

  // Preset stamps: the Indonesian one (default language), then the English one.
  const picker = page.getByRole("dialog", { name: "Pilih stamp" });
  await page.getByRole("button", { name: "Gambar pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  await picker.getByRole("button", { name: "DISETUJUI", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await page.getByRole("button", { name: "Gambar pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  await picker.getByRole("radio", { name: "English", exact: true }).click();
  await picker.getByRole("button", { name: "APPROVED", exact: true }).click();
  await expect(picker).toHaveCount(0);

  // A link to page 2.
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.mouse.move(box.x + 72, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 310, { steps: 3 });
  await page.mouse.move(box.x + 200, box.y + 320, { steps: 3 });
  await page.mouse.up();
  const popover = page.getByTestId("link-popover");
  await popover.getByRole("radio", { name: "Ke halaman" }).click();
  await popover.getByRole("combobox", { name: "Halaman tujuan" }).selectOption({ label: "Halaman 2" });
  await popover.getByRole("button", { name: "Simpan link" }).click();
  await expect(popover).toHaveCount(0);

  // Fill the form.
  await page.getByRole("textbox", { name: "nama", exact: true }).fill("Budi Santoso");
  await page.getByRole("checkbox", { name: "setuju" }).check();

  // Download with the form kept: native annotations, link, signatures, stamp and field values.
  const kept = pdfReport(await download(page, "annots.pdf"));
  const p1 = kept.pages[0];
  const hl = p1.annots.find((a) => a.type === "Highlight")!;
  expect(hl.stroke.map((c) => Math.round(c * 255))).toEqual([0xff, 0xeb, 0x3b]);
  const xs = hl.vertices.map((v) => v[0]), ys = hl.vertices.map((v) => v[1]);
  expect(Math.abs(Math.min(...xs) - x0)).toBeLessThanOrEqual(1);
  expect(Math.abs(Math.max(...xs) - x1)).toBeLessThanOrEqual(1);
  expect(Math.min(...ys)).toBeCloseTo(80 - 0.9 * 12, 1);
  expect(Math.max(...ys)).toBeCloseTo(80 + 0.25 * 12, 1);
  const note = p1.annots.find((a) => a.type === "Text")!;
  expect(note.content).toBe("Periksa pasal ini");
  expect(note.author).toBe(""); // /T stays empty
  expect(hl.author).toBe("");
  expect(note.rect.map(Math.round)).toEqual([400, 200, 416, 216]);
  const [link] = p1.links;
  expect([link.kind, link.page]).toEqual([1, 1]); // LINK_GOTO → page 2
  expect(link.from.map(Math.round)).toEqual([72, 300, 200, 320]);
  expect(p1.images).toBe(2); // the typed signature and the same one again from the library
  expect(p1.text).toContain("DISETUJUI");
  expect(p1.text).toContain("APPROVED");
  expect(kept.isForm).toBe(true);
  expect(Object.fromEntries(p1.widgets.map((w) => [w.name, w.value]))).toEqual({ nama: "Budi Santoso", setuju: "Yes" });

  // Flattened: the fields become page content, the annotations stay.
  await page.getByRole("checkbox", { name: "Ratakan form" }).check();
  const flat = pdfReport(await download(page, "annots-flat.pdf"));
  expect(flat.isForm).toBe(false);
  expect(flat.pages[0].widgets).toEqual([]);
  expect(flat.pages[0].text).toContain("Budi Santoso");
  expect(flat.pages[0].annots.map((a) => a.type)).toEqual(expect.arrayContaining(["Highlight", "Text"]));
  expect(flat.pages[0].links).toHaveLength(1);
});
