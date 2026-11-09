import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfReport } from "./pdfAnnots";
import { pdfInfo } from "./pdfText";
import { pdfSpans, type Span } from "./pdfSpans";

// apps/api/scripts/e2e_keep_pdf.py: a three-line Korean + Latin paragraph (baselines 120, 134, 148, x 56) in a
// cmap-less CID subset named Dotum, condensed with Tz 94.7 as Hancom exports it, so Edith's own layout of a line puts
// its words elsewhere (the font program's advances are wider). A one-character edit in the middle line must leave the
// other two lines exactly as they were: same glyphs, same places, same font, their text once.
const PDF = path.join(__dirname, "fixtures", "keep-lines.pdf");
const BASELINES = [120, 134, 148];
const LINE2 = "기재한 경우에는 사증 발급이 거부될 수 있습니다. Applicants must fill in";

const onLine = (s: Span, baseline: number) => Math.abs(s.origin[1] - baseline) < 0.5 && !!s.text.trim();

type Op = { type: string; box: { layout: { source?: number | null }[] } };
/** The objects of the autosaved draft. */
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
  const draft = key ? (JSON.parse(localStorage.getItem(key)!) as { objects: Record<string, Op> }) : null;
  return Object.values(draft?.objects ?? {});
});

/** Opens the fixture and deletes the "s" of "Applicants" in line 2 (a character the subset has: no fallback font). */
async function editLine2(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 200, box.y + 130);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("Applicants must fill in");
  // Delete the "s" of "Applicants" (a character the subset has: no fallback font involved).
  await editor.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.textContent!.indexOf("Applicants");
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i + 9);
      range.setEnd(node, i + 10);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error("Applicants not in the editor");
  });
  await page.keyboard.press("Backspace");
  await expect(editor).toContainText("Applicant must fill in");
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);
  return box;
}

test("a one-character edit keeps the paragraph's other lines exactly where they were", async ({ page }) => {
  await editLine2(page);
  // The op keeps lines 1 and 3 (LayoutLine.source) and redraws line 2 only.
  const editsOf = async () => (await draftOps(page)).filter((o) => o.type === "text.edit");
  await expect.poll(async () => (await editsOf()).length).toBe(1); // the autosave is debounced
  const [op] = await editsOf();
  expect(op.box.layout.map((l) => l.source ?? null)).toEqual([0, null, 2]);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "keep-lines.pdf");
  await (await downloadPromise).saveAs(file);

  const before = pdfSpans(PDF)[0], after = pdfSpans(file)[0];
  // Lines 1 and 3, the title and the line below: every span as it was (text, origin to 0.01 pt, font, size).
  for (const s of before.filter((x) => !onLine(x, BASELINES[1]))) {
    const twin = after.find((x) => Math.abs(x.origin[0] - s.origin[0]) < 0.01 && Math.abs(x.origin[1] - s.origin[1]) < 0.01);
    expect(twin, s.text).toBeDefined();
    expect(twin!.text).toBe(s.text);
    expect(twin!.font).toBe(s.font);
    expect(twin!.size).toBeCloseTo(s.size, 3);
    expect(twin!.bbox[2]).toBeCloseTo(s.bbox[2], 2); // Tz kept: the line ends where it did
  }
  // Line 2 is the edited text, redrawn on its baseline from the paragraph's left edge, in the original font.
  const line2 = after.filter((s) => onLine(s, BASELINES[1]));
  expect(line2.map((s) => s.text).join("").replace(/\s+/g, " ").trim()).toBe(LINE2.replace("Applicants", "Applicant"));
  expect(line2[0].origin[0]).toBeCloseTo(56, 1);
  expect(line2.every((s) => s.font.includes("Dotum"))).toBe(true);

  // Searchable, and the kept text is there once (not redrawn over itself).
  const text = (await pdfInfo(file)).pages[0].text;
  for (const t of ["신청인은 아래 사항을", "every item correctly", "Applicant must fill in"]) expect(text.split(t)).toHaveLength(2);
  expect(text).not.toContain("Applicants");
});

test("at tight leading the cover of the redrawn line leaves the kept line's descenders on screen", async ({ page }) => {
  // The second paragraph (baselines 300, 310, 320 at 10 pt: a 1.0 em leading): edit its middle line.
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px
  // Line 1's g j p q y tails reach 0.25 em below its baseline, into the 0.95 em cover line 2 used to get: the
  // pixel rows 300–302 (the last half pixel of the tails meets line 2's ascenders, where the cover now starts).
  const descenders = { x: box.x + 60, y: box.y + 300, width: 270, height: 2 };
  await page.mouse.move(box.x + 500, box.y + 700);
  await page.waitForTimeout(300);
  const before = await page.screenshot({ clip: descenders });

  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 150, box.y + 307);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("gladly sloppy giggly");
  await editor.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.textContent!.indexOf("sloppy");
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i + 3);
      range.setEnd(node, i + 4);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error("sloppy not in the editor");
  });
  await page.keyboard.press("Backspace");
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await draftOps(page)).filter((o) => o.type === "text.edit").map((o) => o.box.layout.map((l) => l.source ?? null)))
    .toEqual([[0, null, 2]]);
  await page.waitForTimeout(300);
  expect((await page.screenshot({ clip: descenders })).equals(before)).toBe(true);
});

test("a mark on a kept line stays, and goes (with a notice, one undo step) once the edit is moved", async ({ page }) => {
  const box = await editLine2(page);
  await expect.poll(async () => (await draftOps(page)).filter((o) => o.type === "text.edit").length).toBe(1);

  // Highlight the start of line 1: it is still the page's own text, so it can be marked.
  const chars = page.waitForResponse((r) => /\/pages\/0\/chars$/.test(r.url()) && r.ok());
  await page.getByRole("button", { name: "Penanda", exact: true }).click(); // default sub-tool: Stabilo
  await chars;
  await page.mouse.move(box.x + 57, box.y + 116);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 116, { steps: 3 });
  await page.mouse.move(box.x + 150, box.y + 116, { steps: 3 });
  await page.mouse.up();
  const marks = async () => (await draftOps(page)).filter((o) => o.type === "annot.add").length;
  await expect.poll(marks).toBe(1);

  // Select the edited paragraph and nudge it: every line is redrawn now, so the mark on line 1 would float.
  await page.getByRole("button", { name: "Pilih", exact: true }).click();
  await page.mouse.click(box.x + 200, box.y + 134);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Penanda pada teks yang diedit dihapus")).toBeVisible();
  await expect.poll(marks).toBe(0);
  const [op] = (await draftOps(page)).filter((o) => o.type === "text.edit");
  expect(op.box.layout.every((l) => l.source == null)).toBe(true);

  // One undo step brings both back.
  await page.getByRole("button", { name: "Urungkan" }).click();
  await expect.poll(marks).toBe(1);
  await page.getByRole("button", { name: "Ulangi" }).click();
  await expect.poll(marks).toBe(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "keep-lines-moved.pdf");
  await (await downloadPromise).saveAs(file);
  expect(pdfReport(file).pages[0].annots).toEqual([]); // no highlight floating over the moved text
});
