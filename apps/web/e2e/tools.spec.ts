import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pdfInfo } from "./pdfText";

// The "Alat PDF": each tool's page takes files, asks its options and downloads the result; a locked PDF is opened with
// its password, in a tool and on the start page (then edited as any other). sample.pdf: three pages.
const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

/** Runs the tool and returns the downloaded file's name and bytes. */
async function runAndDownload(page: Page): Promise<{ name: string; data: Buffer }> {
  const download = page.waitForEvent("download");
  await page.getByTestId("tool-run").click();
  const d = await download;
  const file = path.join(test.info().outputDir, d.suggestedFilename());
  await d.saveAs(file);
  await expect(page.getByTestId("tool-done")).toContainText(d.suggestedFilename());
  return { name: d.suggestedFilename(), data: readFileSync(file) };
}

/** Pages of a PDF, counted the crude way (enough for these files: one /Type /Page object per page). */
const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

test("the start page lists the tools; merging takes the PDFs in the order set", async ({ page }) => {
  await page.goto("/");
  const grid = page.getByTestId("tools-grid");
  await expect(grid.getByRole("link")).toHaveCount(18);
  await grid.getByRole("link", { name: /Merge PDF/ }).click();
  await expect(page).toHaveURL(/\/tools\/gabung-pdf$/);
  await expect(page.getByRole("heading", { name: "Merge PDF" })).toBeVisible();

  const run = page.getByTestId("tool-run");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await expect(run).toBeDisabled(); // two at least
  await page.getByTestId("tool-input").setInputFiles({ name: "kedua.pdf", mimeType: "application/pdf", buffer: readFileSync(SAMPLE) });
  const files = page.getByTestId("tool-files").getByRole("listitem");
  await expect(files).toHaveCount(2);
  await page.getByRole("button", { name: "Naikkan kedua.pdf" }).click();
  await expect(files.first()).toContainText("kedua.pdf");
  // Rows are dragged into order too.
  await files.nth(0).dragTo(files.nth(1));
  await expect(files.first()).toContainText("sample.pdf");
  await files.nth(1).dragTo(files.nth(0));
  await expect(files.first()).toContainText("kedua.pdf");
  const { name, data } = await runAndDownload(page);
  expect(name).toBe("kedua-gabungan.pdf");
  expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pageCount(data)).toBe(6);

  // The merged PDF goes on to Compress without being chosen again, then into the editor.
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, "next.png"), fullPage: true });
  await page.getByTestId("next-steps").getByRole("button", { name: "Compress PDF" }).click();
  await expect(page).toHaveURL(/\/tools\/kompres-pdf$/);
  await expect(page.getByTestId("tool-files")).toContainText("kedua-gabungan.pdf");
  const small = await runAndDownload(page);
  expect(small.name).toBe("kedua-gabungan-kecil.pdf");
  await page.getByTestId("next-steps").getByRole("button", { name: "Edit di editor" }).click();
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page")).toHaveCount(6);
});

test("PDF to pictures: one page is a PNG, several a ZIP", async ({ page }) => {
  await page.goto("/tools/pdf-ke-gambar");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await page.getByRole("textbox", { name: /^Halaman/ }).fill("2");
  const one = await runAndDownload(page);
  expect(one.name).toBe("sample-gambar.png");
  expect(one.data.subarray(1, 4).toString()).toBe("PNG");
  await page.getByRole("textbox", { name: /^Halaman/ }).fill("1-3");
  await page.getByRole("button", { name: "JPG" }).click();
  const zip = await runAndDownload(page);
  expect(zip.name).toBe("sample-gambar.zip");
  expect(zip.data.subarray(0, 2).toString()).toBe("PK");
});

test("compress to a size: the file comes back no larger than the size asked", async ({ page }) => {
  await page.goto("/tools/kompres-pdf");
  await page.getByTestId("tool-input").setInputFiles(path.join(__dirname, "fixtures", "scan.pdf"));
  await page.getByRole("button", { name: "Ke ukuran tertentu" }).click();
  await page.getByRole("button", { name: "200 KB" }).click();
  await expect(page.getByLabel("Ukuran maksimal (KB)")).toHaveValue("200");
  await page.getByLabel("Ukuran maksimal (KB)").fill("100"); // scan.pdf is about 180 KB
  const { name, data } = await runAndDownload(page);
  expect(name).toBe("scan-kecil.pdf");
  expect(data.length).toBeLessThanOrEqual(100 * 1024);
  await page.getByLabel("Ukuran maksimal (KB)").fill("5");
  await expect(page.getByTestId("tool-run")).toBeDisabled();
});

test("scan document: photos become one PDF page each, with the chosen look", async ({ page }) => {
  // A picture of a page (made by PDF to Image) stands in for a phone photo.
  await page.goto("/tools/pdf-ke-gambar");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await page.getByRole("textbox", { name: /^Halaman/ }).fill("1");
  const photo = await runAndDownload(page);

  await page.goto("/");
  await page.getByTestId("tools-grid").getByRole("link", { name: /Scan Document/ }).click();
  await expect(page).toHaveURL(/\/tools\/scan-dokumen$/);
  await page.getByTestId("tool-input").setInputFiles([
    { name: "foto-1.png", mimeType: "image/png", buffer: photo.data },
    { name: "foto-2.png", mimeType: "image/png", buffer: photo.data },
  ]);
  await page.getByRole("button", { name: "Hitam putih" }).click();
  const { name, data } = await runAndDownload(page);
  expect(name).toBe("foto-1-scan.pdf");
  expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pageCount(data)).toBe(2);
});

test("pas foto: one photo, a colour and a size; the result is shown (or why not)", async ({ page }) => {
  await page.goto("/tools/pas-foto");
  await expect(page.getByRole("heading", { name: "Pas Foto" })).toBeVisible();
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600; c.height = 800;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#cfe3d6"; ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = "#3b3b3b"; ctx.beginPath(); ctx.ellipse(300, 760, 260, 230, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c9a184"; ctx.beginPath(); ctx.ellipse(300, 330, 120, 160, 0, 0, Math.PI * 2); ctx.fill();
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByTestId("tool-input").setInputFiles({ name: "saya.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByRole("button", { name: "Biru" }).click();
  await page.getByRole("button", { name: "2 × 3" }).click();
  await page.getByTestId("tool-run").click();
  // With the model on this server: the picture, 2 × 3 cm at 300 dpi; without it (CI), or when it sees nobody in the
  // drawing: a message.
  const picture = page.getByTestId("tool-picture");
  const error = page.getByTestId("tool-error");
  await expect(picture.or(error)).toBeVisible({ timeout: 30_000 });
  if (await picture.isVisible()) {
    expect(await picture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([236, 354]);
  } else {
    await expect(error).toHaveText(/belum siap di server|Tidak ada orang/);
  }
});

test("ID card to A4: front and back on one sheet, the sides named, the sheet shown", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tools-grid").getByRole("link", { name: /ID Card to A4/ }).click();
  await expect(page).toHaveURL(/\/tools\/kartu-ke-a4$/);
  // A made-up card lying on a dark table.
  const photo = (label: string) => page.evaluate((text) => {
    const c = document.createElement("canvas");
    c.width = 1200; c.height = 900;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#5a4636"; ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = "#bcd7ec"; ctx.fillRect(260, 280, 680, 429);
    ctx.fillStyle = "#1a1a1a"; ctx.font = "bold 40px sans-serif";
    ["PROVINSI CONTOH", text, "NAMA : BUDI CONTOH", "ALAMAT : JALAN CONTOH"].forEach((s, i) => ctx.fillText(s, 290, 350 + i * 80));
    return c.toDataURL("image/jpeg", 0.92).split(",")[1];
  }, label);
  await page.getByTestId("tool-input").setInputFiles([
    { name: "ktp-depan.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await photo("DEPAN"), "base64") },
    { name: "ktp-belakang.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await photo("BELAKANG"), "base64") },
  ]);
  await expect(page.getByTestId("card-side")).toHaveText(["Depan", "Belakang"]);
  await page.getByRole("button", { name: "F4 / Folio" }).click();
  await page.getByRole("button", { name: "Hitam putih" }).click();
  const { name, data } = await runAndDownload(page);
  expect(name).toBe("ktp-depan-kartu.pdf");
  expect(pageCount(data)).toBe(1);
  expect(data.toString("latin1")).toMatch(/MediaBox\s*\[\s*0 0 609\.4\d* 935\.4/);
  await expect(page.getByTestId("tool-sheet")).toBeVisible();
});

test("paper size: an A4 page onto F4, then its content inside thesis margins", async ({ page }) => {
  await page.goto("/tools/ukuran-kertas");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await page.getByRole("button", { name: "F4 / Folio" }).click();
  const whole = await runAndDownload(page);
  expect(whole.name).toBe("sample-f4.pdf");
  expect(whole.data.toString("latin1")).toMatch(/MediaBox\s*\[\s*0 0 609\.4\d* 935\.4/);
  await page.getByRole("button", { name: "Atur ulang margin" }).click();
  await page.getByRole("button", { name: "Skripsi (4-3-3-3)" }).click();
  await expect(page.getByText("kiri dan atas 4 cm")).toBeVisible();
  const laid = await runAndDownload(page);
  expect(pageCount(laid.data)).toBe(3);
});

test("a PDF locked here asks its password to be unlocked, and on the start page to be edited", async ({ page }) => {
  await page.goto("/tools/kunci-pdf");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await page.getByLabel("Kata sandi baru").fill("rahasia");
  await page.getByLabel("Ulangi kata sandi").fill("rahasi");
  await expect(page.getByText("Kata sandi tidak sama.")).toBeVisible();
  await expect(page.getByTestId("tool-run")).toBeDisabled();
  await page.getByLabel("Ulangi kata sandi").fill("rahasia");
  const locked = await runAndDownload(page);
  expect(locked.name).toBe("sample-terkunci.pdf");
  expect(locked.data.toString("latin1")).toContain("/Encrypt");

  // A tool that does not ask up front asks once the server says it is locked.
  await page.goto("/tools/kompres-pdf");
  await page.getByTestId("tool-input").setInputFiles({ name: "terkunci.pdf", mimeType: "application/pdf", buffer: locked.data });
  await page.getByTestId("tool-run").click();
  await expect(page.locator("p[role=alert]")).toContainText("terkunci");
  await page.getByTestId("tool-password").fill("salah");
  await page.getByTestId("tool-run").click();
  await expect(page.locator("p[role=alert]")).toHaveText("Kata sandi salah.");
  await page.getByTestId("tool-password").fill("rahasia");
  const small = await runAndDownload(page);
  expect(small.data.toString("latin1")).not.toContain("/Encrypt");

  await page.goto("/tools/buka-kunci-pdf");
  await page.getByTestId("tool-input").setInputFiles({ name: "terkunci.pdf", mimeType: "application/pdf", buffer: locked.data });
  await expect(page.getByTestId("tool-run")).toBeDisabled(); // the password first
  await page.getByTestId("tool-password").fill("rahasia");
  const open = await runAndDownload(page);
  expect(open.name).toBe("terkunci-terbuka.pdf");
  expect(open.data.toString("latin1")).not.toContain("/Encrypt");

  // The start page: the password, then the editor, as for any PDF.
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles({ name: "terkunci.pdf", mimeType: "application/pdf", buffer: locked.data });
  await expect(page.getByTestId("locked-form")).toBeVisible();
  await page.getByTestId("locked-password").fill("salah");
  await page.getByRole("button", { name: "Buka" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("Kata sandi salah.");
  await page.getByTestId("locked-password").fill("rahasia");
  await page.getByRole("button", { name: "Buka" }).click();
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("thumb")).toHaveCount(3);
});

test("watermark and page numbers: the options go with the PDF", async ({ page }) => {
  await page.goto("/tools/watermark-pdf");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("tool-run")).toBeDisabled(); // the text first
  await page.getByLabel("Teks watermark").fill("RAHASIA");
  await page.getByRole("button", { name: "Merah" }).click();
  const wm = await runAndDownload(page);
  expect(wm.name).toBe("sample-watermark.pdf");
  expect(pageCount(wm.data)).toBe(3);

  await page.goto("/tools/nomor-halaman");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await page.getByRole("button", { name: "Halaman 1 dari 10" }).click();
  await page.getByLabel("Mulai dari nomor").fill("3");
  const nums = await runAndDownload(page);
  expect(nums.name).toBe("sample-bernomor.pdf");

  // A thesis: the cover unnumbered, page 2 in roman (ii), page 3 starting the body at 1.
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Romawi, lalu 1, 2, 3" }).click();
  await page.getByRole("button", { name: "Pola skripsi" }).click();
  await expect(page.getByLabel("Pada halaman")).toHaveValue("2-");
  await page.getByTestId("roman-to").fill("2");
  await expect(page.getByText("halaman 3 dan seterusnya mulai lagi dari 1")).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, "roman.png"), fullPage: true });
  const thesis = await runAndDownload(page);
  const file = path.join(test.info().outputDir, "thesis.pdf");
  writeFileSync(file, thesis.data);
  const text = (await pdfInfo(file)).pages.map((p) => p.text);
  expect(text[0]).not.toMatch(/\bi\b/);
  expect(text[1]).toMatch(/\bii\b/);
  expect(text[2]).toMatch(/\b1\b/);
});

function hasSoffice(): boolean {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 60_000 });
    return true;
  } catch {
    return existsSync("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  }
}

test("PDF to Word, and the Word document back to PDF", async ({ page }) => {
  test.skip(!hasSoffice() && process.env.EDITH_REQUIRE_SOFFICE !== "1", "LibreOffice is not installed");
  test.setTimeout(120_000); // LibreOffice's first run makes its profile
  await page.goto("/tools/pdf-ke-word");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  const word = await runAndDownload(page);
  expect(word.name).toBe("sample.docx");
  expect(word.data.subarray(0, 2).toString()).toBe("PK");

  await page.goto("/tools/office-ke-pdf");
  await page.getByTestId("tool-input").setInputFiles({ name: "kembali.docx", mimeType: "", buffer: word.data });
  await page.getByTestId("tool-input").setInputFiles({ name: "salah.pdf", mimeType: "application/pdf", buffer: readFileSync(SAMPLE) });
  await expect(page.locator("p[role=alert]")).toContainText("Hanya dokumen");
  await page.getByTestId("tool-input").setInputFiles({ name: "kembali.docx", mimeType: "", buffer: word.data });
  const back = await runAndDownload(page);
  expect(back.name).toBe("kembali.pdf");
  expect(back.data.subarray(0, 5).toString()).toBe("%PDF-");
});

test("the PDF's pages are shown before the tool runs: the numbers to be, and pages picked by a press", async ({ page }) => {
  await page.goto("/tools/nomor-halaman");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  const thumbs = page.getByTestId("tool-thumb");
  await expect(thumbs).toHaveCount(3);
  await expect(page.getByTestId("thumb-label")).toHaveText(["1", "2", "3"]);

  // Roman, then 1, 2, 3: a press on page 2 ends the roman part there.
  await page.getByRole("button", { name: "Romawi, lalu 1, 2, 3" }).click();
  await page.getByRole("button", { name: "Pola skripsi" }).click();
  await thumbs.nth(1).click();
  await expect(page.getByTestId("roman-to")).toHaveValue("2");
  await expect(page.getByTestId("thumb-label")).toHaveText(["ii", "1"]);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, "preview.png"), fullPage: true });

  // Extract: presses pick the pages.
  await page.goto("/tools/ambil-halaman");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("tool-thumb")).toHaveCount(3);
  await page.getByTestId("tool-thumb").nth(0).click();
  await page.getByTestId("tool-thumb").nth(2).click();
  await expect(page.getByRole("textbox", { name: /^Halaman/ })).toHaveValue("1, 3");
  await expect(page.getByTestId("tool-thumb").nth(2)).toHaveAttribute("aria-pressed", "true");
});

test("a run says where it is while it waits", async ({ page }) => {
  await page.goto("/tools/pdf-bisa-dicari");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  // The server's answer held back a while, so the waiting can be seen. (An intercepted request reports no upload
  // progress, so here it stays on the upload; a real one goes on to the server's seconds.)
  await page.route(/\/tools\/ocr$/, async (route) => {
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 2500));
    await route.fulfill({ response });
  });
  await page.getByTestId("tool-run").click();
  await expect(page.getByTestId("tool-progress")).toContainText(/Mengunggah… \d+%|Memproses di server/);
  await expect(page.getByTestId("tool-progress")).toHaveCount(0, { timeout: 15_000 });
});
