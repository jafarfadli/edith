// Screenshots of every main UI state, for the visual QA of a design change.
// Usage (from apps/web, servers running): node scripts/ui-shots.mjs <baseUrl> <outDir> [pdf]
//   pdf: the document to open in the editor (default: e2e/fixtures/pages.pdf).
// Exits non-zero on any page error or any state that could not be reached.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const [base = "http://localhost:3000", outDir = "ui-shots", pdf = path.join(here, "..", "e2e", "fixtures", "pages.pdf")] = process.argv.slice(2);
const TEXT_PDF = path.join(here, "..", "e2e", "fixtures", "text.pdf");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];
async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function shot(page, name, clip) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), clip });
  console.log("saved", name);
}
// One UI state; a state that cannot be reached is reported and fails the run, the others still get their shot.
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    errors.push(`${name}: ${String(e.message).split("\n")[0]}`);
  }
}
async function upload(page, file) {
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("page").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
}
const button = (page, name) => page.getByRole("button", { name, exact: true });

// Start page, wide and phone-sized.
let page = await open(1440, 900);
await step("landing", async () => {
  await page.goto(base);
  await shot(page, "landing");
  const phone = await open(375, 812);
  await phone.goto(base);
  await phone.screenshot({ path: path.join(outDir, "landing-375.png"), fullPage: true });
});

// The editor with the document, a tool with options (hint + properties), the shape menu, a tooltip.
await upload(page, pdf);
await shot(page, "editor");
await step("shape-menu", async () => {
  await button(page, "Bentuk pilihan").click();
  await shot(page, "shape-menu");
  await page.getByRole("menuitem", { name: "Persegi", exact: true }).click();
  await shot(page, "tool-rect");
});
await step("tool-text", async () => {
  await button(page, "Teks").click();
  await shot(page, "tool-text");
});
await step("tooltip", async () => {
  await button(page, "Pilih").click();
  await button(page, "Penanda").hover();
  await page.waitForTimeout(900);
  await shot(page, "tooltip", { x: 300, y: 0, width: 800, height: 140 });
  await page.mouse.move(700, 600);
  // The tooltip nearest the right window edge must not be clipped.
  await button(page, "Cari").hover();
  await page.waitForTimeout(900);
  await shot(page, "tooltip-right", { x: 1040, y: 0, width: 400, height: 140 });
  await page.mouse.move(700, 600);
});

// Dialogs: stamp picker, signature, Kelola Halaman; the find bar; the crop overlay.
await step("stamp-picker", async () => {
  await page.getByRole("button", { name: "Gambar pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  await shot(page, "stamp-picker");
  await page.keyboard.press("Escape");
});
await step("signature", async () => {
  await button(page, "Tanda Tangan").click();
  await page.getByRole("textbox", { name: "Nama Anda" }).fill("Budi Santoso");
  await shot(page, "signature");
  await page.keyboard.press("Escape");
});
await step("find", async () => {
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Cari teks" }).fill("a");
  await button(page, "Tampilkan ganti").click();
  await shot(page, "find");
  await page.keyboard.press("Escape");
});
await step("manage-pages", async () => {
  await button(page, "Kelola Halaman").click();
  await page.waitForTimeout(1000);
  await page.getByTestId("manage-page").first().click();
  await shot(page, "manage-pages");
  await button(page, "Batal").click();
});
await step("crop", async () => {
  await button(page, "Crop").click();
  await shot(page, "crop");
  await page.keyboard.press("Escape");
});

// A selected object (mini-bar + properties), the Anotasi panel, the page menu.
await step("selected", async () => {
  await button(page, "Centang").click();
  const box = await page.getByTestId("page").first().boundingBox();
  await page.mouse.click(box.x + 300, box.y + 420);
  await button(page, "Pilih").click();
  await page.getByRole("tab", { name: /Anotasi/ }).click();
  await page.getByTestId("annotation-item").first().click();
  await shot(page, "selected");
});
await step("page-menu", async () => {
  await page.getByRole("tab", { name: "Halaman" }).click();
  await page.getByTestId("thumb").first().hover();
  await page.getByTestId("thumb").first().getByRole("button", { name: "Menu halaman" }).click();
  await shot(page, "page-menu", { x: 0, y: 0, width: 520, height: 420 });
  await page.keyboard.press("Escape");
});

// Narrow window.
await step("editor-1024", async () => {
  const narrow = await open(1024, 768);
  await upload(narrow, pdf);
  await shot(narrow, "editor-1024");
  // Every tool must be reachable: the tool row may not scroll (it hides its scrollbar).
  const hidden = await narrow.getByRole("toolbar", { name: "Alat" }).locator("> div").evaluate((el) => el.scrollWidth - el.clientWidth);
  if (hidden > 1) errors.push(`editor-1024: ${hidden}px of the tool row are cut off`);
  await narrow.keyboard.press("t");
  await shot(narrow, "tool-text-1024");
});

// Editing an original paragraph; a download (info notice) and a failing one (error notice with retry).
await step("text-editing", async () => {
  page = await open(1440, 900);
  await upload(page, TEXT_PDF);
  const p = await page.getByTestId("page").first().boundingBox();
  const editor = page.getByTestId("text-editor");
  for (let i = 0; i < 10 && !(await editor.isVisible()); i++) {
    await page.mouse.dblclick(p.x + 150, p.y + 110);
    await page.waitForTimeout(300);
  }
  await shot(page, "text-editing");
  await page.mouse.click(p.x + 500, p.y + 700);
});
await step("download", async () => {
  const download = page.waitForEvent("download");
  await button(page, "Unduh").click();
  await download;
  await shot(page, "download-notice");
  await page.route("**/documents/*/export", (r) => r.fulfill({ status: 502, contentType: "text/html", body: "Bad Gateway" }));
  await button(page, "Unduh").click();
  await page.getByRole("alert").filter({ hasText: /502/ }).waitFor();
  await shot(page, "download-error");
});

console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
await browser.close();
if (errors.length) process.exit(1);
