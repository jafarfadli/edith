import { expect, test } from "@playwright/test";
import path from "node:path";

// The command palette: Ctrl/Cmd+K or ? finds what the editor does by name or by everyday words, and runs it.
const SENSITIVE = path.join(__dirname, "fixtures", "sensitive.pdf");
const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("Ctrl/Cmd+K finds the personal data search by an everyday word and opens it; ? lists everything", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SENSITIVE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page")).toHaveCount(1);
  await page.waitForTimeout(800);

  await page.keyboard.press(`${MOD}+k`);
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  await page.keyboard.type("sensor nik");
  await expect(palette.getByRole("option")).toHaveText(["Cari data pribadi"]);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, "palette.png") });
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Sensor otomatis" })).toBeVisible();
  await page.keyboard.press("Escape");

  // ? from the canvas: the whole list, grouped, with the shortcuts; a click runs one.
  await page.mouse.click(10, 300);
  await page.keyboard.press("?");
  await expect(palette).toBeVisible();
  await expect(palette.getByText("Alat", { exact: true })).toBeVisible();
  await palette.getByRole("option", { name: /^Highlight/ }).click();
  await expect(page.getByRole("button", { name: "Markup", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a PDF dropped on the editor opens as a new tab", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SENSITIVE);
  await expect(page).toHaveURL(/\/edit\//);
  const first = page.url();
  const bytes = (await import("node:fs")).readFileSync(path.join(__dirname, "fixtures", "sample.pdf")).toString("base64");
  // A drop as the browser makes it: a DataTransfer holding the file.
  await page.evaluate(async (b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([data], "sample.pdf", { type: "application/pdf" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, cancelable: true }));
  }, bytes);
  await expect(page).not.toHaveURL(first);
  await expect(page.getByTestId("page")).toHaveCount(3);
  await expect(page.getByTestId("doc-tabs").locator('button[title$=".pdf"]')).toHaveText(["sensitive.pdf", "sample.pdf"]);
});
