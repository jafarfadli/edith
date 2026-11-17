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
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = path.join(test.info().outputDir, name);
  await (await pending).saveAs(file);
  return file;
}

test("highlight, signature, stamp and form, then download", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear()); // no autosave draft or signature library from an earlier run of this fixture
  await page.getByTestId("file-input").setInputFiles(ANNOTS_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page")).toHaveCount(2);
  const box = await pageBox(page);

  // Highlight "penting": the highlight tool loads the page's character boxes, then a drag selects the word.
  const [x0, , x1] = wordBox(ANNOTS_PDF, "penting");
  const chars = page.waitForResponse((r) => /\/pages\/0\/chars$/.test(r.url()) && r.ok());
  await page.getByRole("button", { name: "Markup", exact: true }).click(); // default sub-tool: Stabilo
  await chars;
  await page.mouse.move(box.x + x0 + 1, box.y + 76);
  await page.mouse.down();
  await page.mouse.move(box.x + (x0 + x1) / 2, box.y + 76, { steps: 3 });
  await page.mouse.move(box.x + x1 - 1, box.y + 76, { steps: 3 });
  await page.mouse.up();

  // Sticky notes and links have no tool since M5 (hidden, the bake still supports them).
  await expect(page.getByRole("button", { name: "Catatan", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Link", exact: true })).toHaveCount(0);

  // Typed signature (saved to the library), then the same signature again from the library.
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Tanda tangan" });
  await modal.getByRole("textbox", { name: "Nama Anda" }).fill("Budi Santoso");
  await modal.getByRole("radio", { name: "Great Vibes" }).click();
  await modal.getByRole("button", { name: "Tambahkan", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  await modal.getByRole("button", { name: "Pakai tanda tangan" }).first().click();
  await expect(modal).toHaveCount(0);

  // Preset stamps: the Indonesian one (default language), then the English one.
  const picker = page.getByRole("dialog", { name: "Pilih stamp" });
  await page.getByRole("button", { name: "Image pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  await picker.getByRole("button", { name: "DISETUJUI", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await page.getByRole("button", { name: "Image pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  await picker.getByRole("radio", { name: "English", exact: true }).click();
  await picker.getByRole("button", { name: "APPROVED", exact: true }).click();
  await expect(picker).toHaveCount(0);

  // Fill the form.
  await page.getByRole("textbox", { name: "nama", exact: true }).fill("Budi Santoso");
  await page.getByRole("checkbox", { name: "setuju" }).check();

  // Download with the form kept: the highlight, signatures, stamps and field values.
  const kept = pdfReport(await download(page, "annots.pdf"));
  const p1 = kept.pages[0];
  const hl = p1.annots.find((a) => a.type === "Highlight")!;
  expect(hl.stroke.map((c) => Math.round(c * 255))).toEqual([0xff, 0xeb, 0x3b]);
  const xs = hl.vertices.map((v) => v[0]), ys = hl.vertices.map((v) => v[1]);
  expect(Math.abs(Math.min(...xs) - x0)).toBeLessThanOrEqual(1);
  expect(Math.abs(Math.max(...xs) - x1)).toBeLessThanOrEqual(1);
  expect(Math.min(...ys)).toBeCloseTo(80 - 0.9 * 12, 1);
  expect(Math.max(...ys)).toBeCloseTo(80 + 0.25 * 12, 1);
  expect(hl.author).toBe(""); // /T stays empty
  expect(p1.annots.map((a) => a.type)).toEqual(["Highlight"]);
  expect(p1.links).toEqual([]);
  expect(p1.images).toBe(2); // the typed signature and the same one again from the library
  expect(p1.text).toContain("DISETUJUI");
  expect(p1.text).toContain("APPROVED");
  expect(kept.isForm).toBe(true);
  expect(Object.fromEntries(p1.widgets.map((w) => [w.name, w.value]))).toEqual({ nama: "Budi Santoso", setuju: "Yes" });

  // Flattened: the fields become page content, the annotations stay.
  await page.getByRole("checkbox", { name: "Flatten form" }).check();
  const flat = pdfReport(await download(page, "annots-flat.pdf"));
  expect(flat.isForm).toBe(false);
  expect(flat.pages[0].widgets).toEqual([]);
  expect(flat.pages[0].text).toContain("Budi Santoso");
  expect(flat.pages[0].annots.map((a) => a.type)).toEqual(["Highlight"]);
});

test("an uploaded photo of a signature lands without its paper", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(ANNOTS_PDF);
  await expect(page).toHaveURL(/\/edit\//);

  // A "photo": greyish paper lit from one side, a dark blue scribble across it.
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600; c.height = 300;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 600, 0);
    g.addColorStop(0, "rgb(235,232,225)"); g.addColorStop(1, "rgb(175,172,165)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 600, 300);
    ctx.strokeStyle = "rgb(20,35,120)"; ctx.lineWidth = 7; ctx.beginPath();
    ctx.moveTo(120, 180); ctx.bezierCurveTo(200, 40, 260, 260, 340, 120); ctx.bezierCurveTo(400, 60, 440, 220, 480, 150);
    ctx.stroke();
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Tanda tangan" });
  await modal.getByRole("tab", { name: "Unggah" }).click();
  await modal.getByTestId("signature-file").setInputFiles({ name: "ttd.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  const preview = modal.getByRole("img", { name: "Pratinjau tanda tangan" });
  await expect(preview).toBeVisible();
  // Cut to the ink (wider than tall), the corners see-through, the stroke opaque.
  const seen = await preview.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
    return { w: c.width, h: c.height, corner: d[3], far: d[d.length - 1], opaque };
  });
  expect(seen.w).toBeLessThan(600);
  expect(seen.w).toBeGreaterThan(seen.h);
  expect(seen.corner).toBe(0);
  expect(seen.far).toBe(0);
  expect(seen.opaque).toBeGreaterThan(500);
  await modal.getByRole("button", { name: "Tambahkan", exact: true }).click();
  await expect(modal).toHaveCount(0);
});
