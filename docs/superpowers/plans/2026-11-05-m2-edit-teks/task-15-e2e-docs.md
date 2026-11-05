# Task 15: E2E — edit a paragraph, Find & Replace, download, verify; README

**Files:**
- Create: `apps/api/scripts/e2e_text_pdf.py`, `apps/web/e2e/fixtures/text.pdf` (generated, committed), `apps/web/e2e/pdfSpans.ts`, `apps/web/e2e/text.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything (Tasks 1–14); M1 `e2e/pdfText.ts` (`pdfInfo`), Playwright config (starts uvicorn :8000 and `next dev` :3000).
- Produces: `pdfSpans(file: string): Span[][]` (`{ text, font, origin: [x, y], size }` per page, read with PyMuPDF through `uv run` in `apps/api`, U+00A0 shown as space); E2E test "edit an original paragraph, find & replace, download".

- [ ] **Step 1: Fixture PDF**

`apps/api/scripts/e2e_text_pdf.py`:
```python
"""Writes apps/web/e2e/fixtures/text.pdf for the text-editing E2E test.

Paragraph 1: standard Helvetica (not embedded → edited with Arimo), contains "penting" and "lama".
Paragraph 2: embedded full Tinos (reusable → edited with the PDF's own font), contains "lama".
"""
import pymupdf

from edith.settings import REPO_ROOT

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "text.pdf"
FONTS = REPO_ROOT / "packages" / "fonts" / "files"
FIRST = ("Paragraf pertama berisi kata penting yang akan ditebalkan, lalu kata lama yang nanti diganti "
         "lewat fitur cari dan ganti di editor.")
SECOND = "Paragraf kedua memakai font asli yang tertanam dan juga menyimpan kata lama."


def build() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    assert page.insert_textbox(pymupdf.Rect(72, 90, 372, 160), FIRST, fontname="helv", fontsize=12) >= 0
    page.insert_font(fontname="TN", fontfile=str(FONTS / "Tinos-Regular.ttf"))
    assert page.insert_textbox(pymupdf.Rect(72, 290, 372, 360), SECOND, fontname="TN", fontsize=12) >= 0
    return doc.tobytes(garbage=3, deflate=True)


if __name__ == "__main__":
    OUT.write_bytes(build())
    print("wrote", OUT)
```

Run: `cd apps/api && uv run python -m scripts.e2e_text_pdf`
Expected: `wrote …/apps/web/e2e/fixtures/text.pdf` (~290 KB). Paragraph 1 lines start at x 72 with baselines ≈ 102.9 / 120.6 / 138.3 ("Paragraf pertama … akan", "ditebalkan, … lewat fitur", "cari dan ganti di editor."); paragraph 2 at ≈ 300.7 / 312.5.

- [ ] **Step 2: PyMuPDF span reader for the test**

`apps/web/e2e/pdfSpans.ts`:
```ts
import { execFileSync } from "node:child_process";
import path from "node:path";

export interface Span { text: string; font: string; origin: [number, number]; size: number }

const SCRIPT = `
import json, sys, pymupdf
doc = pymupdf.open(sys.argv[1])
print(json.dumps([[{"text": s["text"].replace("\\xa0", " "), "font": s["font"], "origin": s["origin"], "size": s["size"]}
                   for b in page.get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"]]
                  for page in doc]))
`;

/** Text spans per page as PyMuPDF reads them (font names, baselines) — via the API's Python env. */
export function pdfSpans(file: string): Span[][] {
  const out = execFileSync("uv", ["run", "python", "-c", SCRIPT, file], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return JSON.parse(out) as Span[][];
}
```

- [ ] **Step 3: The E2E test**

`apps/web/e2e/text.spec.ts`:
```ts
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfInfo } from "./pdfText";
import { pdfSpans } from "./pdfSpans";

// apps/api/scripts/e2e_text_pdf.py: paragraph 1 (Helvetica 12) in Rect(72, 90, 372, 160), paragraph 2 (embedded Tinos) from y = 290.
const TEXT_PDF = path.join(__dirname, "fixtures", "text.pdf");

/** Selects `word` inside the rich text editor (as a double-click on it would). */
async function selectWord(page: Page, word: string) {
  await page.getByTestId("text-editor").evaluate((el, w) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + w.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`"${w}" not in the editor`);
  }, word);
}

test("edit an original paragraph, find & replace, download", async ({ page }) => {
  await page.goto("/");
  const textLoaded = page.waitForResponse((r) => /\/documents\/[^/]+\/text$/.test(r.url()) && r.ok());
  await page.getByTestId("file-input").setInputFiles(TEXT_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await textLoaded;
  const box = (await page.getByTestId("page").first().boundingBox())!; // zoom 100 %: 1 pt = 1 px

  // Double-click paragraph 1 → rich editor with its text; make "penting" bold; click away to commit.
  const editor = page.getByTestId("text-editor");
  await expect(async () => { // the paragraph targets appear once the overlay and its fonts are ready
    await page.mouse.dblclick(box.x + 150, box.y + 110);
    await expect(editor).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(editor).toContainText("kata penting yang");
  await selectWord(page, "penting");
  await page.getByRole("button", { name: "Tebal", exact: true }).click();
  await expect(editor.locator("span[data-run]").filter({ hasText: /^penting$/ })).toHaveCount(1); // its own run now
  await page.mouse.click(box.x + 500, box.y + 700);
  await expect(editor).toHaveCount(0);

  // Find & Replace: "lama" is in both paragraphs (the edited one is now a text.edit op).
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Cari teks" }).fill("lama");
  await expect(page.getByTestId("find-bar")).toContainText("1 dari 2");
  await page.getByRole("button", { name: "Tampilkan ganti" }).click();
  await page.getByRole("textbox", { name: "Ganti dengan" }).fill("baru");
  await page.getByRole("button", { name: "Ganti semua" }).click();
  await expect(page.getByTestId("find-bar")).toContainText("0 dari 0");

  // Replace All is one undo step.
  await page.getByRole("button", { name: "Tutup" }).click();
  await page.getByRole("button", { name: "Urungkan" }).click();
  await page.keyboard.press("ControlOrMeta+f");
  await page.getByRole("textbox", { name: "Cari teks" }).fill("lama");
  await expect(page.getByTestId("find-bar")).toContainText("1 dari 2");
  await page.getByRole("button", { name: "Tutup" }).click();
  await page.getByRole("button", { name: "Ulangi" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, "text.pdf");
  await (await downloadPromise).saveAs(file);

  const text = (await pdfInfo(file)).pages[0].text;
  expect(text).not.toContain("lama");
  expect(text).toContain("baru");
  expect(text).toContain("penting");

  const spans = pdfSpans(file)[0];
  const bold = spans.find((s) => s.text.includes("penting"))!;
  expect(bold.font).toMatch(/Arimo.*Bold/);
  expect(bold.text.trim()).toBe("penting");
  expect(spans.find((s) => s.text.includes("Paragraf pertama"))!.font).toMatch(/Arimo/);
  expect(spans.find((s) => s.text.includes("Paragraf kedua"))!.font).toMatch(/Tinos/);

  // Unchanged text keeps its lines: every original line still starts at the same place with the same word.
  for (const s of pdfSpans(TEXT_PDF)[0]) {
    const after = spans.find((x) => Math.abs(x.origin[0] - s.origin[0]) <= 0.5 && Math.abs(x.origin[1] - s.origin[1]) <= 0.5);
    expect(after?.text.split(" ")[0]).toBe(s.text.split(" ")[0]);
  }

  // The baked baselines are where the editor laid the lines out (±0.5 pt).
  const draft = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("edith:draft:"))!;
    return JSON.parse(localStorage.getItem(key)!) as { objects: Record<string, { type: string; box: { rect: { y: number }; layout: { baseline: number }[] } }> };
  });
  const edits = Object.values(draft.objects).filter((o) => o.type === "text.edit");
  expect(edits).toHaveLength(2);
  for (const op of edits) {
    for (const line of op.box.layout) {
      const y = op.box.rect.y + line.baseline;
      expect(spans.some((s) => Math.abs(s.origin[1] - y) <= 0.5)).toBe(true);
    }
  }
});
```

Run: `npm run e2e -w apps/web`
Expected: 3 passed (the two M1 tests and this one). If the double-click lands before the paragraph overlay is ready, `toPass()` retries it.

- [ ] **Step 4: README**

In `README.md`:
- Replace the first paragraph with:
```markdown
Editor PDF berbasis web: unggah PDF, edit teks aslinya (rich text per kata, Cari & Ganti), tambah teks, bentuk, gambar, gambar bebas, whiteout, redaksi, atur halaman, lalu unduh.
```
- Replace the `packages/fonts` bullet with:
```markdown
- `packages/fonts` — 21 family font bersama (Arimo/Tinos/Cousine/Carlito/Caladea sebagai pengganti metrik font PDF, plus pilihan pengguna; OFL/Apache 2.0, lihat `packages/fonts/LICENSES.md`). Unduh ulang: `node packages/fonts/scripts/fetch.mjs`.
```
- At the end of the "Tes" section add:
```markdown
Fixture yang dihasilkan dari kode API (jalankan ulang setelah mengubah ekstraksi atau fixture-nya):

    cd apps/api && uv run python -m scripts.text_fixture   # apps/web/src/lib/fixtures/text.json
    cd apps/api && uv run python -m scripts.e2e_text_pdf   # apps/web/e2e/fixtures/text.pdf
```

- [ ] **Step 5: Full verification**

Run, from the repo root:
```bash
(cd apps/api && uv run pytest -q) && npm run check -w packages/ops && npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run e2e -w apps/web
```
Expected: every command succeeds; pytest warning-free; lint 0 problems; E2E 3 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts/e2e_text_pdf.py apps/web/e2e README.md
git commit -m "test(e2e): edit an original paragraph, find and replace, verify the PDF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
