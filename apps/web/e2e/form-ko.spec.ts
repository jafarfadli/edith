import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pdfInfo } from "./pdfText";
import { pdfSpans, type Span } from "./pdfSpans";

// apps/api/scripts/e2e_form_pdf.py: Korean + Latin in a cmap-less CID subset named Dotum (as Hancom exports it); the
// table labels "1.1 성명 Full name in English" (ends at x 294) and "1.2 성별 Sex" (x 306, baseline 167) share a
// baseline across the cell border at x 300; the cell's right border is at x 545, the rule under the row at y 175.
const FORM = path.join(__dirname, "fixtures", "form-ko.pdf");
const LABEL = "1.1 성명 Full name in English";
const CELL_RIGHT = 545;
const ROW_BOTTOM = 175;
/** The only characters of the edit the embedded Dotum subset lacks. */
const MISSING = "Gdr";

/** Share of differing pixels between two PDFs' renderings of `clip` on page 1 (PyMuPDF, 4×). */
function pixelDiff(a: string, b: string, clip: [number, number, number, number]): number {
  const script = `
import sys, pymupdf
clip = pymupdf.Rect(*map(float, sys.argv[3:7]))
pa, pb = (pymupdf.open(f)[0].get_pixmap(clip=clip, matrix=pymupdf.Matrix(4, 4), colorspace=pymupdf.csGRAY, alpha=False) for f in sys.argv[1:3])
assert (pa.width, pa.height) == (pb.width, pb.height)
dark = sum(1 for v in pa.samples if v < 128)
assert dark > 50, "nothing drawn in the original's clip"
print(sum(1 for x, y in zip(pa.samples, pb.samples) if abs(x - y) > 64) / len(pa.samples))
`;
  const out = execFileSync("uv", ["run", "python", "-c", script, a, b, ...clip.map(String)], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return Number(out.trim());
}

const sameSpan = (a: Span, b: Span) => Math.abs(a.origin[0] - b.origin[0]) < 0.1 && Math.abs(a.origin[1] - b.origin[1]) < 0.1;

test("edit one cell of a Korean form in its own font and download it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(FORM);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  // The cell next to the border is a paragraph of its own: its editor holds only its text.
  const editor = page.getByTestId("text-editor");
  await expect(async () => {
    await page.mouse.dblclick(box.x + 330, box.y + 163);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toHaveText("1.2 성별 Sex");
  await editor.evaluate((el) => {
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
    const i = node.textContent!.indexOf("Sex");
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 3);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.type("Gender");
  await expect(editor).toHaveText("1.2 성별 Gender");
  await expect(page.getByText("beberapa karakter tidak didukung font ini")).toHaveCount(0); // G, d, r: a fallback has them
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);

  // The edit is wider than the label was (it ended at x 360) but grew into its cell instead of wrapping: one line,
  // first baseline kept, inside the cell's right border.
  type Op = { type: string; paragraphId: string; box: { rect: { x: number; y: number; w: number }; layout: { baseline: number }[] } };
  const editsOf = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"));
    const draft = key ? (JSON.parse(localStorage.getItem(key)!) as { objects: Record<string, Op> }) : null;
    return Object.values(draft?.objects ?? {}).filter((o) => o.type === "text.edit");
  });
  await expect.poll(async () => (await editsOf()).length).toBe(1); // the autosave is debounced
  const [op] = await editsOf();
  expect(op.box.layout).toHaveLength(1);
  expect(op.box.rect.y + op.box.layout[0].baseline).toBeCloseTo(167, 1);
  expect(op.box.rect.x).toBeCloseTo(306, 1);
  expect(op.box.rect.w).toBeGreaterThan(360 - 306);
  expect(op.box.rect.x + op.box.rect.w).toBeLessThanOrEqual(CELL_RIGHT);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "form-ko.pdf");
  await (await downloadPromise).saveAs(file);

  // Korean reads back (ToUnicode kept) in the edited and in the untouched cells.
  const text = (await pdfInfo(file)).pages[0].text;
  expect(text).toContain(LABEL);
  expect(text).toContain("<신청서 작성방법>");
  expect(text).not.toContain("Sex");

  const before = pdfSpans(FORM)[0], after = pdfSpans(file)[0];
  // Every other span (the neighbouring cell, the list, the rows below) is untouched: same text, place, font.
  const edited = before.find((s) => s.text === "1.2 성별 Sex")!;
  for (const s of before.filter((x) => x !== edited)) {
    const twin = after.find((x) => sameSpan(x, s));
    expect(twin, s.text).toBeDefined();
    expect(twin!.text).toBe(s.text);
    expect(twin!.font).toContain("Dotum");
  }

  // The edited cell is one line on its original baseline, inside the cell, nothing wrapped below it.
  const line = after.filter((s) => Math.abs(s.origin[1] - 167) < 0.5 && s.origin[0] > 300);
  expect(line.map((s) => s.text).join("")).toBe("1.2 성별 Gender");
  expect(line[0].origin[0]).toBeCloseTo(306, 1);
  for (const s of line) expect(s.bbox[2]).toBeLessThanOrEqual(CELL_RIGHT);
  expect(after.filter((s) => s.origin[0] > 300 && s.origin[1] > 167.5 && s.origin[1] < ROW_BOTTOM)).toEqual([]);

  // Characters the embedded subset has keep it (the original Dotum, not a substitute); only G, d, r use a fallback.
  expect(line[0].text.startsWith("1.2 성별")).toBe(true);
  expect(line[0].font).toContain("Dotum");
  for (const s of line) {
    if (!s.font.includes("Dotum")) expect([...s.text].every((c) => MISSING.includes(c)), `${s.text} in ${s.font}`).toBe(true);
  }
  for (const c of MISSING) expect(line.some((s) => s.text.includes(c) && !s.font.includes("Dotum"))).toBe(true);
  for (const c of "en") expect(line.some((s) => s.text.includes(c) && s.font.includes("Dotum"))).toBe(true);

  // The Korean glyphs are drawn, as before: "1.2 성별" renders like the original's (same font program, same place).
  expect(pixelDiff(FORM, file, [edited.origin[0] - 1, 155, edited.origin[0] + 37, 171])).toBeLessThan(0.01); // "별" ends at +36.3
});
