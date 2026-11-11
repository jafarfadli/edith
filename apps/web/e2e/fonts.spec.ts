import { expect, test } from "@playwright/test";
import path from "node:path";
import { pdfSpans } from "./pdfSpans";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

test("the font picker lists document fonts by their familiar names; choosing one stores and bakes its substitute", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page").first()).toBeVisible();

  await page.getByRole("button", { name: "Teks", exact: true }).click();
  const box = (await page.getByTestId("page").first().boundingBox())!;
  await page.mouse.click(box.x + 100, box.y + 400);
  const editor = page.getByTestId("text-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Surat Dinas");

  // The picker: "Umum / Dokumen" first, the familiar name before the substitute, then one group per design.
  const picker = page.getByRole("combobox", { name: "Font", exact: true });
  await expect(picker.locator("optgroup")).toHaveCount(5);
  await expect.poll(() => picker.locator("optgroup").evaluateAll((gs) => gs.map((g) => g.getAttribute("label")))).toEqual(
    ["Umum / Dokumen", "Sans", "Serif", "Mono", "Script"],
  );
  const common = await picker.locator("optgroup").first().locator("option").allTextContents();
  expect(common.slice(0, 8)).toEqual([
    "Times New Roman · Tinos", "Arial · Arimo", "Calibri · Carlito", "Cambria · Caladea", "Courier New · Cousine",
    "Georgia · Gelasio", "Verdana · DejaVu Sans", "Tahoma · Open Sans",
  ]);
  // Each family is listed once (a document font only in the top group); the stored value is the family id.
  const values = await picker.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(new Set(values).size).toBe(values.length);
  expect(values).toContain("Inter");
  expect(await picker.locator("option", { hasText: "Times New Roman" }).getAttribute("value")).toBe("Tinos");

  await page.keyboard.press("ControlOrMeta+a");
  await picker.selectOption({ label: "Georgia · Gelasio" });
  await expect(picker).toHaveValue("Gelasio");
  await page.mouse.click(box.x + 500, box.y + 700); // blur → commit
  await expect(editor).toHaveCount(0);

  // The draft keeps the stable family id, and the baked PDF is drawn with that family.
  const draft = () => page.evaluate(() => Object.entries(localStorage).map(([, v]) => v).find((v) => v.includes("Surat Dinas")) ?? "");
  await expect.poll(draft).toContain('"family":"Gelasio"');
  expect(await draft()).not.toContain("Georgia");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "fonts.pdf");
  await (await downloadPromise).saveAs(file);
  const span = pdfSpans(file)[0].find((s) => s.text.includes("Surat Dinas"))!;
  expect(span.font).toMatch(/Gelasio/);
});
