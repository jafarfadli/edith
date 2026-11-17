import { expect, test } from "@playwright/test";
import path from "node:path";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

test("tool keys, the hint for the active tool, tooltips with shortcuts", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("page").first()).toBeVisible();
  const bar = page.getByTestId("properties-bar");
  const hint = page.getByTestId("tool-hint");

  // Pilih with nothing selected: no properties bar at all.
  await expect(bar).toHaveCount(0);

  // R picks Persegi: its hint and options appear; Escape goes back to Pilih and the bar goes away.
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toHaveText("Seret di halaman untuk menggambar persegi.");
  await expect(bar.getByRole("combobox", { name: "Gaya garis" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(bar).toHaveCount(0);

  // T: the text tool; letters typed into a field do not switch tools.
  await page.keyboard.press("t");
  await expect(hint).toContainText("Klik teks asli");
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Cari teks" }).fill("v");
  await expect(page.getByRole("button", { name: "Text", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // A tooltip names the tool and its key.
  await page.getByRole("button", { name: "Select", exact: true }).hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Select");
  await expect(tip.locator("kbd")).toHaveText("V");
});

test("the colour popover recolours the word being edited and keeps the editor open", async ({ page }) => {
  await page.goto("/");
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "fixtures", "text.pdf"));
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!;
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 150, box.y + 110);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await editor.evaluate((el) => { // select "penting"
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf("penting");
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + 7);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(r);
      return;
    }
  });
  await page.getByTestId("properties-bar").getByRole("button", { name: "Warna", exact: true }).click();
  await page.getByRole("dialog", { name: "Warna" }).getByRole("button", { name: "Warna #e11d48" }).click();
  await expect(editor).toBeVisible();
  await expect(editor.locator("span[data-run]").filter({ hasText: /^penting$/ })).toHaveCSS("color", "rgb(225, 29, 72)");
});

test("on a narrow window the hint folds to its icon so every option stays in view", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("page").first()).toBeVisible();
  const bar = page.getByTestId("properties-bar");
  const sentence = page.locator("[data-hint-text]");

  await page.keyboard.press("t");
  await expect(sentence).toHaveClass(/sr-only/); // still read out, no longer drawn
  await expect(page.getByTestId("tool-hint")).toContainText("Klik teks asli");
  await expect.poll(() => bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

  // Wide enough again: the sentence comes back.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(sentence).not.toHaveClass(/sr-only/);
  await expect.poll(() => bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test("tool menus and the colour popover work from the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("page").first()).toBeVisible();
  const chevron = page.getByRole("button", { name: "Shape pilihan" });
  const menu = page.getByRole("menu", { name: "Shape" });
  const item = (name: string) => menu.getByRole("menuitem", { name, exact: true });

  // Enter on the chevron opens the menu with focus on the first item; arrows, Home and End move.
  await chevron.focus();
  await page.keyboard.press("Enter");
  await expect(item("Persegi")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item("Elips")).toBeFocused();
  await page.keyboard.press("End");
  await expect(item("Awan")).toBeFocused();
  await page.keyboard.press("ArrowDown"); // wraps
  await expect(item("Persegi")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(item("Awan")).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  // Enter picks Elips: the menu closes and focus is back on the chevron.
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(chevron).toBeFocused();
  await expect(page.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("tool-hint")).toContainText("elips");

  // Escape closes without picking and without leaving the tool; focus returns to the chevron.
  await page.keyboard.press("ArrowDown");
  await expect(item("Persegi")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(chevron).toBeFocused();
  await expect(page.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Tab closes the menu and moves on to the control after the chevron (Gambar).
  await page.keyboard.press("Space");
  await expect(item("Persegi")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Image", exact: true })).toBeFocused();

  // The colour popover of the shape tool: focus on the first swatch, arrows to the third, Enter picks it.
  const chip = page.getByTestId("properties-bar").getByRole("button", { name: "Warna", exact: true });
  const pop = page.getByRole("dialog", { name: "Warna" });
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(pop.getByRole("button", { name: "Warna #111111" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(pop.getByRole("button", { name: "Warna #ffffff" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(pop.getByTestId("eyedropper")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(pop.getByLabel("Warna Kode hex")).toBeFocused();
  // In the hex code Home and End move the caret; Up goes back to the item before it (the hue bar).
  await page.keyboard.press("ArrowUp");
  await expect(pop.getByRole("slider", { name: "Warna Rona" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(pop.getByRole("button", { name: "Warna #e11d48" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pop).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(chip).toHaveCSS("background-color", "rgb(225, 29, 72)");

  // Escape closes the popover and returns focus to the chip.
  await page.keyboard.press("Enter");
  await expect(pop.getByRole("button", { name: "Warna #111111" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(page.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute("aria-pressed", "true");

  // A hex code typed in changes the colour live; "+" saves it, and every colour field offers it from then on.
  await chip.click();
  const hex = pop.getByLabel("Warna Kode hex");
  await hex.fill("0a7");
  await hex.press("Enter");
  await expect(hex).toHaveValue("00aa77");
  await expect(chip).toHaveCSS("background-color", "rgb(0, 170, 119)");
  await pop.getByRole("button", { name: "Simpan warna ini" }).click();
  await page.keyboard.press("Escape");
  await chip.click();
  await pop.getByRole("button", { name: "Warna #e11d48" }).click();
  await chip.click();
  const saved = pop.getByRole("button", { name: "Warna #00aa77" });
  await saved.click();
  await expect(pop).toHaveCount(0);
  await expect(chip).toHaveCSS("background-color", "rgb(0, 170, 119)");
  // The field and the hue bar pick by pointer; Delete on a saved colour drops it.
  await chip.click();
  const field = await pop.getByRole("slider", { name: "Warna Saturasi dan kecerahan" }).boundingBox();
  await page.mouse.click(field!.x + field!.width - 2, field!.y + 2);
  await expect(hex).toHaveValue(/^[0-9a-f]{6}$/);
  expect(await hex.inputValue()).not.toBe("00aa77");
  await saved.focus();
  await page.keyboard.press("Delete");
  await expect(saved).toHaveCount(0);
});

test("the pipette takes a colour from the page", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  // tinted.pdf (apps/api/scripts/e2e_tinted_pdf.py): a cell tinted 255,235,180 at (100, 100)-(300, 130).
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "fixtures", "tinted.pdf"));
  await expect(page).toHaveURL(/\/edit\//);
  await page.waitForTimeout(2000); // the page draws
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px
  // Chromium has its own eyedropper (it cannot be driven from a test): without it the page's picking layer is used.
  await page.evaluate(() => { delete (window as { EyeDropper?: unknown }).EyeDropper; });

  await page.getByRole("button", { name: "Shape", exact: true }).click();
  const chip = page.getByTestId("properties-bar").getByRole("button", { name: "Warna", exact: true });
  const pop = page.getByRole("dialog", { name: "Warna" });
  await chip.click();

  // Escape leaves the picking layer and keeps the popover.
  await pop.getByTestId("eyedropper").click();
  const layer = page.getByTestId("eyedropper-layer");
  await expect(layer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(layer).toHaveCount(0);
  await expect(pop).toBeVisible();

  await pop.getByTestId("eyedropper").click();
  await page.mouse.move(box.x + 120, box.y + 105);
  await expect(layer).toContainText("#ffebb4");
  await page.mouse.down();
  await page.mouse.up();
  await expect(layer).toHaveCount(0);
  await expect(pop.getByLabel("Warna Kode hex")).toHaveValue("ffebb4");
  await expect(chip).toHaveCSS("background-color", "rgb(255, 235, 180)");
  await expect(pop).toBeVisible();
});
