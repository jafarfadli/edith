import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfChars, pdfSpans, type Char } from "./pdfSpans";

// apps/api/scripts/e2e_wrap_pdf.py (tests.pdfs.make_wrap_pdf): three Helvetica 11 paragraphs at a 14 pt leading whose
// widest line has no room for one more letter in its box — justified (column 72…523), centred, right-aligned (523).
// One letter typed into that line must not re-wrap the paragraph (M5d), and the words before it stay where they were.
const PDF = path.join(__dirname, "fixtures", "wrap.pdf");

type Op = { type: string; paragraphId: string; box: { layout: { source?: number | null; prefix?: { source: number; segments: number } | null }[] } };
const draftOps = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
  const draft = key ? (JSON.parse(localStorage.getItem(key)!) as { objects: Record<string, Op> }) : null;
  return Object.values(draft?.objects ?? {});
});

/** Opens the paragraph under (x, y), types "x" after `word`, commits. */
async function typeAfter(page: Page, box: { x: number; y: number }, at: [number, number], word: string) {
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + at[0], box.y + at[1]);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText(word);
  await page.waitForTimeout(300); // the editor puts its caret at the end once it has focus: set ours after that
  await editor.evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.textContent!.indexOf(w);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i + w.length);
      range.collapse(true);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`${w} not in the editor`);
  }, word);
  await page.waitForTimeout(150); // the editor takes the DOM selection on selectionchange
  await page.keyboard.type("x");
  await expect(editor).toContainText(`${word}x`);
  await page.mouse.click(box.x + 560, box.y + 800);
  await expect(editor).toHaveCount(0);
}

/** The words on a baseline: text, origin x of the first glyph, right edge of the last, from PyMuPDF's characters. */
function words(chars: Char[], baseline: number): { text: string; x: number; x1: number }[] {
  const out: { text: string; x: number; x1: number }[] = [];
  let cur: { text: string; x: number; x1: number } | null = null;
  for (const c of chars.filter((ch) => Math.abs(ch.origin[1] - baseline) < 0.5).sort((a, b) => a.origin[0] - b.origin[0])) {
    if (!c.c.trim()) { cur = null; continue; }
    if (cur && c.origin[0] - cur.x1 > 1) cur = null;
    if (!cur) { cur = { text: "", x: c.origin[0], x1: c.x1 }; out.push(cur); }
    cur.text += c.c;
    cur.x1 = c.x1;
  }
  return out;
}

test("one letter in the widest line of a justified, a centred and a right-aligned paragraph: no re-wrap", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  await typeAfter(page, box, [200, 116], "memberikan"); // justified, line 1 (baseline 120)
  await typeAfter(page, box, [300, 310], "Elektro"); // centred, line 2 (baseline 314)
  await typeAfter(page, box, [400, 490], "Studi"); // right-aligned, line 2 (baseline 494)

  await expect.poll(async () => (await draftOps(page)).filter((o) => o.type === "text.edit").length).toBe(3);
  const ops = Object.fromEntries((await draftOps(page)).filter((o) => o.type === "text.edit").map((o) => [o.paragraphId, o]));
  // Three lines each, the other two kept; the justified line keeps its first three words' glyphs.
  expect(ops.g1.box.layout.map((l) => l.source ?? null)).toEqual([null, 1, 2]);
  expect(ops.g1.box.layout[0].prefix?.source).toBe(0);
  expect(ops.g2.box.layout.map((l) => l.source ?? null)).toEqual([0, null, 2]);
  expect(ops.g3.box.layout.map((l) => l.source ?? null)).toEqual([0, null, 2]);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "wrap.pdf");
  await (await downloadPromise).saveAs(file);
  const before = pdfChars(PDF)[0], after = pdfChars(file)[0];

  // Every line still starts with the same word, on the same baseline.
  for (const y of [120, 134, 148, 300, 314, 328, 480, 494, 508]) expect(words(after, y)[0]?.text).toBe(words(before, y)[0].text);

  // Justified: the first three words where they were (original glyphs: Helvetica), the line still ends at 523.
  const j0 = words(before, 120), j1 = words(after, 120);
  expect(j1.map((w) => w.text).join(" ")).toBe(j0.map((w) => w.text).join(" ").replace("memberikan", "memberikanx"));
  for (let i = 0; i < 3; i++) expect(Math.abs(j1[i].x - j0[i].x)).toBeLessThan(0.5);
  expect(Math.abs(j1.at(-1)!.x1 - 523)).toBeLessThan(0.5);
  const helv = pdfSpans(file)[0].filter((s) => Math.abs(s.origin[1] - 120) < 0.5 && s.font === "Helvetica");
  expect(helv.map((s) => s.text.trim()).join(" ")).toBe("Kerja praktek bertujuan");

  // Centred: every word keeps its place relative to the others; the line stays centred on the page.
  const c0 = words(before, 314), c1 = words(after, 314);
  const shift = c1[0].x - c0[0].x;
  expect(shift).toBeLessThan(0); // the line grew around its centre
  for (let i = 0; i < 3; i++) expect(Math.abs(c1[i].x - c0[i].x - shift)).toBeLessThan(0.5);
  expect(Math.abs((c1[0].x + c1.at(-1)!.x1) / 2 - 297.5)).toBeLessThan(0.5);

  // Right-aligned: the words after the edit stay, the line still ends at 523, the words before keep their spacing.
  const r0 = words(before, 494), r1 = words(after, 494);
  for (let i = 3; i < r0.length; i++) expect(Math.abs(r1[i].x - r0[i].x)).toBeLessThan(0.5);
  expect(Math.abs(r1.at(-1)!.x1 - 523)).toBeLessThan(0.5);
  const rshift = r1[0].x - r0[0].x;
  for (let i = 0; i < 3; i++) expect(Math.abs(r1[i].x - r0[i].x - rshift)).toBeLessThan(0.5);

  // Nothing doubled: each line's text once.
  const all = after.map((c) => c.c).join("");
  for (const w of ["Kerjapraktekbertujuan", "SekolahTeknik", "KepalaProgram"]) expect(all.replace(/\s/g, "").split(w)).toHaveLength(2);
});
