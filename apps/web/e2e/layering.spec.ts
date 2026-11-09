import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfPixels } from "./pdfPixels";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");
type Box = { x: number; y: number; width: number; height: number };

const RED = "#e11d48", BLUE = "#2563eb", GREEN = "#16a34a";

async function open(page: Page): Promise<Box> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page").first()).toBeVisible();
  await expect(page.getByTestId("overlay").first()).toBeVisible();
  return (await page.getByTestId("page").first().boundingBox())!;
}

/** A filled rectangle from `a` to `b` (page-box pixels); the shape tool selects it once drawn. */
async function rect(page: Page, box: Box, a: [number, number], b: [number, number], fill: string) {
  await page.keyboard.press("r");
  const noFill = page.getByRole("checkbox", { name: "Tanpa isi" });
  if (await noFill.isChecked()) await noFill.uncheck();
  await page.getByRole("button", { name: "Isi", exact: true }).click();
  await page.getByRole("button", { name: `Isi ${fill}` }).click();
  await page.mouse.move(box.x + a[0], box.y + a[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (a[0] + b[0]) / 2, box.y + (a[1] + b[1]) / 2, { steps: 3 });
  await page.mouse.move(box.x + b[0], box.y + b[1], { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId("mini-bar")).toBeVisible();
}

async function download(page: Page, name: string): Promise<string> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, name);
  await (await pending).saveAs(file);
  return file;
}

const hex = ([r, g, b]: number[]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
/** Pixel colours of the exported page at page-box points. */
function colours(file: string, box: Box, points: [number, number][]) {
  return pdfPixels(file, 0, points.map(([x, y]) => [x / box.width, y / box.height])).map(hex);
}

const menu = (page: Page) => page.getByRole("menu", { name: "Menu objek" });
const item = (page: Page, name: string) => menu(page).getByRole("menuitem", { name });

// Two overlapping rectangles: A (red) drawn first, under B (blue). OVERLAP is inside both, ONLY_A only in A.
const A: [[number, number], [number, number]] = [[100, 150], [300, 350]];
const B: [[number, number], [number, number]] = [[200, 250], [400, 450]];
const OVERLAP: [number, number] = [250, 300], ONLY_A: [number, number] = [140, 190];

test("right-click the lower rectangle, Bawa ke depan: the export draws it on top, one undo step", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A, RED);
  await rect(page, box, ...B, BLUE);
  expect(colours(await download(page, "before.pdf"), box, [OVERLAP, ONLY_A])).toEqual([BLUE, RED]);

  // The browser's menu stays on the empty page; on an object Edith's menu replaces it.
  await page.evaluate(() => {
    (window as unknown as { prevented: boolean[] }).prevented = [];
    window.addEventListener("contextmenu", (e) => (window as unknown as { prevented: boolean[] }).prevented.push(e.defaultPrevented));
  });
  await page.mouse.click(box.x + 480, box.y + 650, { button: "right" });
  await expect(menu(page)).toHaveCount(0);

  await page.mouse.click(box.x + ONLY_A[0], box.y + ONLY_A[1], { button: "right" });
  await expect(menu(page)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { prevented: boolean[] }).prevented)).toEqual([false, true]);
  // A is at the bottom: it can only go up.
  await expect(item(page, "Bawa ke depan")).toBeEnabled();
  await expect(item(page, "Maju satu lapis")).toBeEnabled();
  await expect(item(page, "Mundur satu lapis")).toBeDisabled();
  await expect(item(page, "Kirim ke belakang")).toBeDisabled();
  await item(page, "Bawa ke depan").click();
  await expect(menu(page)).toHaveCount(0);
  expect(colours(await download(page, "front.pdf"), box, [OVERLAP, ONLY_A])).toEqual([RED, RED]);

  // One undo step puts it back under B.
  await page.keyboard.press("ControlOrMeta+z");
  expect(colours(await download(page, "undone.pdf"), box, [OVERLAP])).toEqual([BLUE]);
});

/** Which ends the selected object can still move to, read from the mini-bar's layer menu. */
async function canMove(page: Page): Promise<{ up: boolean; down: boolean }> {
  await page.getByTestId("mini-bar").getByRole("button", { name: "Urutan lapisan" }).click();
  const layers = page.getByRole("menu", { name: "Urutan lapisan" });
  await expect(layers).toBeVisible();
  const up = await layers.getByRole("menuitem", { name: "Bawa ke depan" }).isEnabled();
  const down = await layers.getByRole("menuitem", { name: "Kirim ke belakang" }).isEnabled();
  await page.keyboard.press("Escape");
  await expect(layers).toHaveCount(0);
  return { up, down };
}

test("keyboard shortcuts move the selection one step or to the end; the mini-bar menu shows where it is", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A, RED);
  await rect(page, box, ...B, BLUE);
  await rect(page, box, [150, 200], [350, 400], GREEN); // C: on top of both
  const center: [number, number] = [250, 300]; // inside all three

  await page.mouse.click(box.x + ONLY_A[0], box.y + ONLY_A[1]); // select A (bottom)
  expect(await canMove(page)).toEqual({ up: true, down: false });
  await page.keyboard.press("ControlOrMeta+BracketRight"); // Maju satu lapis: above B, under C
  expect(await canMove(page)).toEqual({ up: true, down: true });
  expect(colours(await download(page, "forward.pdf"), box, [center, [210, 420]])).toEqual([GREEN, BLUE]);
  await page.keyboard.press("ControlOrMeta+Shift+BracketRight"); // Bawa ke depan
  expect(await canMove(page)).toEqual({ up: false, down: true });
  expect(colours(await download(page, "front.pdf"), box, [center])).toEqual([RED]);
  await page.keyboard.press("ControlOrMeta+BracketLeft"); // Mundur satu lapis
  expect(await canMove(page)).toEqual({ up: true, down: true });
  await page.keyboard.press("ControlOrMeta+Shift+BracketLeft"); // Kirim ke belakang
  expect(await canMove(page)).toEqual({ up: true, down: false });
  // Already at the back: nothing to undo for that press, the previous step is undone.
  await page.keyboard.press("ControlOrMeta+Shift+BracketLeft");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await canMove(page)).toEqual({ up: true, down: true });
  await expect(page).toHaveURL(/\/edit\//); // Cmd+[ did not go back in the browser's history
});

test("Alt+click cycles through the objects under the pointer; the menu lists them", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A, RED);
  await rect(page, box, ...B, BLUE);
  await page.getByRole("tab", { name: /Anotasi/ }).click();
  const items = page.getByTestId("annotation-item"); // in z-order: A, then B
  const selected = async () => [await items.nth(0).getAttribute("aria-current"), await items.nth(1).getAttribute("aria-current")];
  const at = { x: box.x + OVERLAP[0], y: box.y + OVERLAP[1] };

  await page.mouse.click(at.x, at.y);
  expect(await selected()).toEqual([null, "true"]); // a plain click takes the topmost
  await page.keyboard.down("Alt");
  await page.mouse.click(at.x, at.y);
  expect(await selected()).toEqual(["true", null]); // the one beneath
  await page.mouse.click(at.x, at.y);
  expect(await selected()).toEqual([null, "true"]); // round to the top again
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up("Alt");
  expect(await selected()).toEqual(["true", null]);

  // Right-click keeps A (selected, under the pointer though beneath B): Bawa ke depan moves A, not B.
  await page.mouse.click(at.x, at.y, { button: "right" });
  const pick = menu(page).getByRole("group", { name: "Pilih elemen di bawah" });
  await expect(pick.getByRole("menuitemradio")).toHaveCount(2);
  await expect(pick.getByRole("menuitemradio").nth(0)).toHaveAttribute("aria-checked", "false"); // B, topmost
  await expect(pick.getByRole("menuitemradio").nth(1)).toHaveAttribute("aria-checked", "true"); // A
  await expect(item(page, "Bawa ke depan")).toBeEnabled();
  await item(page, "Bawa ke depan").click();
  expect(colours(await download(page, "alt.pdf"), box, [OVERLAP])).toEqual([RED]);

  // Pick the one beneath from the menu.
  await page.mouse.click(at.x, at.y, { button: "right" });
  await pick.getByRole("menuitemradio").nth(1).click(); // now B, beneath A
  await expect(menu(page)).toHaveCount(0);
  expect(await selected()).toEqual(["true", null]); // the panel follows the new order: B, then A
});

test("the object menu works from the keyboard and stays inside the window", async ({ page }) => {
  const box = await open(page);
  await rect(page, box, ...A, RED);
  await rect(page, box, ...B, BLUE);

  // Shift+F10 opens it over the selected object (B) with focus on its first enabled item.
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toBeVisible();
  await expect(item(page, "Mundur satu lapis")).toBeFocused(); // B is on top: the first two are disabled
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "Kirim ke belakang")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByTestId("mini-bar")).toBeVisible(); // Escape closed the menu only, B is still selected

  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter"); // Kirim ke belakang
  await expect(menu(page)).toHaveCount(0);
  expect(colours(await download(page, "keys.pdf"), box, [OVERLAP])).toEqual([RED]);

  // Near the bottom-right corner of the window the menu opens up and to the left of the pointer.
  const view = { width: 760, height: 620 };
  await page.setViewportSize(view);
  const scroller = page.locator("#page-scroller");
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  const p = (await page.getByTestId("page").first().boundingBox())!;
  const edge = { x: Math.min(p.x + p.width, view.width) - 30, y: 620 - 24 };
  await rect(page, p, [edge.x - p.x - 40, edge.y - p.y - 14], [edge.x - p.x + 20, edge.y - p.y + 14], GREEN);
  await page.mouse.click(edge.x, edge.y, { button: "right" });
  await expect(menu(page)).toBeVisible();
  const m = (await menu(page).boundingBox())!;
  expect(m.x + m.width).toBeLessThanOrEqual(view.width - 7);
  expect(m.y + m.height).toBeLessThanOrEqual(620 - 7);
  expect(m.x).toBeGreaterThanOrEqual(7);
  expect(m.y).toBeGreaterThanOrEqual(7);
  // An outside press closes it.
  await page.mouse.click(p.x + 20, p.y + 20);
  await expect(menu(page)).toHaveCount(0);
});
