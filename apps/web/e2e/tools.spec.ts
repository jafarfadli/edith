import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
  await expect(grid.getByRole("link")).toHaveCount(15);
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
  const { name, data } = await runAndDownload(page);
  expect(name).toBe("kedua-gabungan.pdf");
  expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pageCount(data)).toBe(6);
});

test("PDF to pictures: one page is a PNG, several a ZIP", async ({ page }) => {
  await page.goto("/tools/pdf-ke-gambar");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await page.getByLabel("Halaman").fill("2");
  const one = await runAndDownload(page);
  expect(one.name).toBe("sample-gambar.png");
  expect(one.data.subarray(1, 4).toString()).toBe("PNG");
  await page.getByLabel("Halaman").fill("1-3");
  await page.getByRole("button", { name: "JPG" }).click();
  const zip = await runAndDownload(page);
  expect(zip.name).toBe("sample-gambar.zip");
  expect(zip.data.subarray(0, 2).toString()).toBe("PK");
});

test("scan document: photos become one PDF page each, with the chosen look", async ({ page }) => {
  // A picture of a page (made by PDF to Image) stands in for a phone photo.
  await page.goto("/tools/pdf-ke-gambar");
  await page.getByTestId("tool-input").setInputFiles(SAMPLE);
  await page.getByLabel("Halaman").fill("1");
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
