import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// An upload is always a clean edit (the same file again does not bring back old changes); edits stay in a list on the
// start page; and when the server has dropped the PDF (it keeps one for an hour) the editor puts it back by itself.
const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Op = { type: string };
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:") && location.pathname.endsWith(k.slice("edith:draft:".length)));
  const draft = key ? (JSON.parse(localStorage.getItem(key)!) as { objects: Record<string, Op> }) : null;
  return Object.values(draft?.objects ?? {});
});

async function upload(page: Page) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  await page.waitForTimeout(500);
}

async function addText(page: Page, text: string) {
  const box = (await page.getByTestId("page").first().boundingBox())!;
  await page.getByRole("button", { name: "Teks", exact: true }).click();
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.click(box.x + 100, box.y + 400);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await editor.fill(text);
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await draftOps(page)).filter((o) => o.type === "text.add").length).toBe(1);
}

test("uploading the same file again is a clean edit; the list continues the old one", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await expect(page.getByTestId("recent-edits")).toHaveCount(0);

  await upload(page);
  await addText(page, "Catatan pertama");
  const firstUrl = page.url();

  // The same file again: nothing of the first edit is in it.
  await page.goto("/");
  await expect(page.getByTestId("recent-edits")).toContainText("sample.pdf");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  expect(page.url()).not.toBe(firstUrl);
  await page.waitForTimeout(1500);
  expect(await draftOps(page)).toHaveLength(0);
  await expect(page.getByText("Perubahan sebelumnya dipulihkan")).toHaveCount(0);

  // The list opens the first edit again, with its change.
  await page.goto("/");
  await page.getByTestId("recent-edits").getByRole("link", { name: /sample\.pdf/ }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.getByText("Perubahan sebelumnya dipulihkan")).toBeVisible();
  expect((await draftOps(page)).filter((o) => o.type === "text.add")).toHaveLength(1);

  // Removing it from the list forgets it.
  await page.goto("/");
  await page.getByRole("button", { name: /Hapus dari daftar/ }).click();
  await expect(page.getByTestId("recent-edits")).toHaveCount(0);
});

test("the server forgetting the PDF is not seen: the editor uploads the kept copy again and goes on", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); });
  await upload(page);
  await addText(page, "Tetap ada");
  await page.getByTestId("image-input").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  const assetOf = async () => ((await draftOps(page)).find((o) => o.type === "image.add") as { assetId?: string } | undefined)?.assetId;
  await expect.poll(assetOf).toBeTruthy();
  const oldAsset = (await assetOf())!;
  const url = page.url();

  // The first structure request of the reopened edit is answered as the server does after an hour.
  let gone = 0, uploads = 0;
  await page.route(/\/documents\/[^/]+\/structure$/, async (route) => {
    if (gone++ === 0) return route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: { code: "doc_expired", message: "expired" } }) });
    return route.continue();
  });
  page.on("request", (r) => { if (r.method() === "POST" && /\/documents$/.test(r.url())) uploads++; });
  await page.goto("/");
  const imageLoaded = page.waitForResponse((r) => /\/assets\/[^/]+$/.test(r.url()) && r.ok());
  await page.goto(url);
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  expect(uploads).toBe(1); // the kept copy went up again
  // The image went up again too, under a new id the draft now names, and it is drawn from there.
  const loadedAsset = (await imageLoaded).url().split("/").pop();
  await expect.poll(assetOf).toBe(loadedAsset);
  expect(await assetOf()).not.toBe(oldAsset);
  await expect(page.getByText(/Sesi dokumen/)).toHaveCount(0);
  await expect(page).toHaveURL(url); // the address is the edit's, not the new document's
  expect((await draftOps(page)).filter((o) => o.type === "text.add")).toHaveLength(1);
});

test("an editor left open while the server drops its PDF puts it back and reopens the edit", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.evaluate(() => { localStorage.clear(); });
  await upload(page);
  await addText(page, "Sesi tidak habis");
  const url = page.url();
  await page.waitForTimeout(800); // the draft is saved

  let gone = 0, uploads = 0;
  await page.route(/\/documents\/[^/]+\/structure$/, async (route) => {
    if (gone++ === 0) return route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: { code: "doc_expired", message: "expired" } }) });
    return route.continue();
  });
  page.on("request", (r) => { if (r.method() === "POST" && /\/documents$/.test(r.url())) uploads++; });

  // The editor's keep-alive comes due: it finds the document gone, puts it back, and the page reopens the edit.
  const reloaded = page.waitForEvent("load");
  await page.clock.fastForward("11:00");
  await reloaded;
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  expect(uploads).toBe(1);
  expect(page.url()).toBe(url);
  await expect(page.getByText("Perubahan sebelumnya dipulihkan")).toBeVisible();
  expect((await draftOps(page)).filter((o) => o.type === "text.add")).toHaveLength(1);
});
