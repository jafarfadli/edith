import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Dragging the side handle of a text box re-wraps its text at every move, before the mouse is released (the glyphs are
// never scaled with the handle's box), and releasing leaves exactly the last live frame, as one undo step.
const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");
// apps/api/scripts/e2e_text_pdf.py: paragraph 1 (Helvetica 12, several lines) is editable original text.
const TEXT_PDF = path.join(__dirname, "fixtures", "text.pdf");
const TEXT = "Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas tiga belas empat belas lima belas";

type Op = { type: string; box: { rect: { x: number; y: number; w: number; h: number }; layout: unknown[] } };
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
  const draft = key ? (JSON.parse(localStorage.getItem(key)!) as { objects: Record<string, Op> }) : null;
  return Object.values(draft?.objects ?? {});
});

/** Text lines drawn in the overlay canvas between page-relative y0 and y1 (zoom 100 %): runs of rows with ink. */
const inkLines = (page: Page, y0: number, y1: number) => page.evaluate(([a, b]) => {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="overlay"] canvas')!;
  const k = canvas.width / canvas.getBoundingClientRect().width;
  const px = canvas.getContext("2d")!.getImageData(0, Math.round(a * k), canvas.width, Math.round((b - a) * k)).data;
  const isInk = (d: Uint8ClampedArray, i: number) => d[i + 3] > 128 && d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100; // black text, not the blue frame
  let lines = 0, inside = false;
  for (let row = 0; row < Math.round((b - a) * k); row++) {
    let ink = false;
    for (let col = 0; col < canvas.width && !ink; col++) ink = isInk(px, (row * canvas.width + col) * 4);
    if (ink && !inside) lines++;
    inside = ink;
  }
  return lines;
}, [y0, y1]);

test("resizing a text box re-wraps live, Escape cancels, release is one undo step", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  await page.waitForTimeout(500); // the page settles in its place (the layout moves it while it loads)
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  await page.getByRole("button", { name: "Teks", exact: true }).click();
  const editor = page.getByTestId("text-editor");
  await expect(async () => { // the overlay takes the click once it is mounted
    await page.mouse.click(box.x + 100, box.y + 400);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await editor.fill(TEXT);
  await page.mouse.click(box.x + 500, box.y + 700); // blur → commit; the new box is selected
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await draftOps(page)).filter((o) => o.type === "text.add").length).toBe(1);
  const rect = (await draftOps(page))[0].box.rect;
  const undoSteps = async () => (await draftOps(page)).length; // (a probe: the draft holds the committed doc only)
  await page.mouse.click(box.x + rect.x + 20, box.y + rect.y + 10); // (select it again: the drag below must start on its handle)
  await page.waitForTimeout(500); // fonts and the selection settle
  const before = await inkLines(page, rect.y - 5, rect.y + 300);
  expect(before).toBeGreaterThan(1);

  // Drag the right handle narrower in steps: the line count grows while the button is still down; Escape restores.
  const hx = box.x + rect.x + rect.w, hy = box.y + rect.y + rect.h / 2;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  const counts: number[] = [];
  for (const dx of [-40, -80, -120, -160]) {
    await page.mouse.move(hx + dx, hy, { steps: 3 });
    await page.waitForTimeout(100);
    counts.push(await inkLines(page, rect.y - 5, rect.y + 400));
  }
  expect(counts[counts.length - 1]).toBeGreaterThan(before); // narrower box, more lines, mouse still down
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  expect((await draftOps(page))[0].box.rect.w).toBe(rect.w); // the document is untouched until release
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => inkLines(page, rect.y - 5, rect.y + 400)).toBe(before);
  expect((await draftOps(page))[0].box.rect.w).toBe(rect.w);

  // The same drag, released: the box is as wide as the last live frame and the text wraps as it did.
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 160, hy, { steps: 8 });
  await page.waitForTimeout(100);
  const live = await inkLines(page, rect.y - 5, rect.y + 400);
  await page.mouse.up();
  await expect.poll(async () => Math.round((await draftOps(page))[0].box.rect.w)).toBe(Math.round(rect.w - 160));
  expect(await inkLines(page, rect.y - 5, rect.y + 400)).toBe(live);
  expect(live).toBeGreaterThan(before);

  // One undo step brings the first width back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await draftOps(page))[0].box.rect.w).toBe(rect.w);
  void undoSteps;
});

test("resizing the frame of original text re-wraps it live; Escape leaves the page as it was", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const loaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(TEXT_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  const paragraphs = (await (await loaded).json()) as { pages: { paragraphs: { rect: { x: number; y: number; w: number; h: number }; editable: boolean }[] }[] };
  const rect = paragraphs.pages[0].paragraphs.find((p) => p.editable)!.rect;
  await page.waitForTimeout(500); // the page settles in its place
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  // Select the paragraph (a press on it, once its target is there), then drag its right handle in.
  await expect(page.locator('[data-testid="overlay"] canvas').first()).toBeAttached();
  await page.waitForTimeout(1500); // the paragraph targets appear once the overlay and its fonts are ready
  await page.mouse.click(box.x + rect.x + 20, box.y + rect.y + 8);
  await page.waitForTimeout(300);
  const hx = box.x + rect.x + rect.w, hy = box.y + rect.y + rect.h / 2;
  const area: [number, number] = [rect.y - 5, rect.y + rect.h + 200];
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  const before = await inkLines(page, ...area);
  const counts: number[] = [];
  for (const dx of [-60, -120, -180]) {
    await page.mouse.move(hx + dx, hy, { steps: 3 });
    await page.waitForTimeout(150);
    counts.push(await inkLines(page, ...area));
  }
  expect(counts[2]).toBeGreaterThan(before); // more lines in the overlay's redrawn text while the button is down
  expect((await draftOps(page)).length).toBe(0); // nothing is in the document yet
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => inkLines(page, ...area)).toBe(before);
  expect((await draftOps(page)).length).toBe(0);

  // Released instead: the edit lands narrower, with the lines the last live frame showed.
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 180, hy, { steps: 6 });
  await page.waitForTimeout(150);
  const live = await inkLines(page, ...area);
  await page.mouse.up();
  await expect.poll(async () => (await draftOps(page)).length).toBe(1);

  expect(Math.round((await draftOps(page))[0].box.rect.w)).toBe(Math.round(rect.w - 180)); // the frame the handle was dragged to, not the box's plus the drag
  await expect.poll(() => inkLines(page, ...area)).toBe(live);
});
