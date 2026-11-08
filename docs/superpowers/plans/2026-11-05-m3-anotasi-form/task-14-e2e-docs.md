# Task 14: E2E: highlight, note, signature from the library, stamp, link, form + flatten; README

One browser test runs the whole milestone on a generated fixture and checks the downloaded PDFs with PyMuPDF (via `uv run` in `apps/api`, like M2's `pdfSpans`).

**Files:**
- Modify: `README.md`
- Create: `apps/api/scripts/e2e_annots_pdf.py`
- Create: `apps/web/e2e/annots.spec.ts`
- Generate (new): `apps/web/e2e/fixtures/annots.pdf`
- Create: `apps/web/e2e/pdfAnnots.ts`

**Interfaces:**
- Consumes: everything above; M1 Playwright config (starts uvicorn :8000 and `next dev` :3000; `reuseExistingServer` — stop other dev servers on those ports first).
- Produces: `apps/api/scripts/e2e_annots_pdf.py` → `apps/web/e2e/fixtures/annots.pdf` (committed); `apps/web/e2e/pdfAnnots.ts` (`pdfReport(file) -> {isForm, pages: [{text, annots, links, widgets, images (placements)}]}`, `wordBox(file, word, index?)`); E2E test "highlight, note, signature, stamp, link and form, then download".

- [ ] **Step 1: Write the E2E test**

The test imports `./pdfAnnots` and needs `e2e/fixtures/annots.pdf`; Step 3 creates both (and the fixture generator).

Create `apps/web/e2e/annots.spec.ts`:
```ts
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfReport, wordBox } from "./pdfAnnots";

// apps/api/scripts/e2e_annots_pdf.py: page 1 = a Helvetica line with "penting" (baseline 80), text field `nama`
// at (72, 100)–(272, 120), checkbox `setuju` at (72, 130); page 2 = "Halaman kedua".
const ANNOTS_PDF = path.join(__dirname, "fixtures", "annots.pdf");

async function pageBox(page: Page, index = 0) {
  return (await page.getByTestId("page").nth(index).boundingBox())!; // zoom 100 %: 1 pt = 1 px
}

async function download(page: Page, name: string): Promise<string> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const file = path.join(test.info().outputDir, name);
  await (await pending).saveAs(file);
  return file;
}

test("highlight, note, signature, stamp, link and form, then download", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(ANNOTS_PDF);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page")).toHaveCount(2);
  const box = await pageBox(page);

  // Highlight "penting": the highlight tool loads the page's character boxes, then a drag selects the word.
  const [x0, , x1] = wordBox(ANNOTS_PDF, "penting");
  const chars = page.waitForResponse((r) => /\/pages\/0\/chars$/.test(r.url()) && r.ok());
  await page.getByRole("button", { name: "Penanda", exact: true }).click(); // default sub-tool: Stabilo
  await chars;
  await page.mouse.move(box.x + x0 + 1, box.y + 76);
  await page.mouse.down();
  await page.mouse.move(box.x + (x0 + x1) / 2, box.y + 76, { steps: 3 });
  await page.mouse.move(box.x + x1 - 1, box.y + 76, { steps: 3 });
  await page.mouse.up();

  // Sticky note with text.
  await page.getByRole("button", { name: "Catatan", exact: true }).click();
  await page.mouse.click(box.x + 400, box.y + 200);
  await page.getByRole("textbox", { name: "Isi catatan" }).fill("Periksa pasal ini");

  // Typed signature (saved to the library), then the same signature again from the library.
  await page.getByRole("button", { name: "Tanda Tangan", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Tanda tangan" });
  await modal.getByRole("textbox", { name: "Nama Anda" }).fill("Budi Santoso");
  await modal.getByRole("radio", { name: "Great Vibes" }).click();
  await modal.getByRole("button", { name: "Tambahkan", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole("button", { name: "Tanda Tangan", exact: true }).click();
  await modal.getByRole("button", { name: "Pakai tanda tangan" }).first().click();
  await expect(modal).toHaveCount(0);

  // A preset stamp.
  await page.getByRole("button", { name: "Gambar pilihan" }).click();
  await page.getByRole("menuitem", { name: "Stamp" }).click();
  await page.getByRole("dialog", { name: "Pilih stamp" }).getByRole("button", { name: "APPROVED", exact: true }).click();

  // A link to page 2.
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.mouse.move(box.x + 72, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 310, { steps: 3 });
  await page.mouse.move(box.x + 200, box.y + 320, { steps: 3 });
  await page.mouse.up();
  const popover = page.getByTestId("link-popover");
  await popover.getByRole("radio", { name: "Ke halaman" }).click();
  await popover.getByRole("combobox", { name: "Halaman tujuan" }).selectOption({ label: "Halaman 2" });
  await popover.getByRole("button", { name: "Simpan link" }).click();
  await expect(popover).toHaveCount(0);

  // Fill the form.
  await page.getByRole("textbox", { name: "nama", exact: true }).fill("Budi Santoso");
  await page.getByRole("checkbox", { name: "setuju" }).check();

  // Download with the form kept: native annotations, link, signatures, stamp and field values.
  const kept = pdfReport(await download(page, "annots.pdf"));
  const p1 = kept.pages[0];
  const hl = p1.annots.find((a) => a.type === "Highlight")!;
  expect(hl.stroke.map((c) => Math.round(c * 255))).toEqual([0xff, 0xeb, 0x3b]);
  const xs = hl.vertices.map((v) => v[0]), ys = hl.vertices.map((v) => v[1]);
  expect(Math.abs(Math.min(...xs) - x0)).toBeLessThanOrEqual(1);
  expect(Math.abs(Math.max(...xs) - x1)).toBeLessThanOrEqual(1);
  expect(Math.min(...ys)).toBeCloseTo(80 - 0.9 * 12, 1);
  expect(Math.max(...ys)).toBeCloseTo(80 + 0.25 * 12, 1);
  const note = p1.annots.find((a) => a.type === "Text")!;
  expect(note.content).toBe("Periksa pasal ini");
  expect(note.rect.map(Math.round)).toEqual([400, 200, 416, 216]);
  const [link] = p1.links;
  expect([link.kind, link.page]).toEqual([1, 1]); // LINK_GOTO → page 2
  expect(link.from.map(Math.round)).toEqual([72, 300, 200, 320]);
  expect(p1.images).toBe(2); // the typed signature and the same one again from the library
  expect(p1.text).toContain("APPROVED");
  expect(kept.isForm).toBe(true);
  expect(Object.fromEntries(p1.widgets.map((w) => [w.name, w.value]))).toEqual({ nama: "Budi Santoso", setuju: "Yes" });

  // Flattened: the fields become page content, the annotations stay.
  await page.getByRole("checkbox", { name: "Ratakan form" }).check();
  const flat = pdfReport(await download(page, "annots-flat.pdf"));
  expect(flat.isForm).toBe(false);
  expect(flat.pages[0].widgets).toEqual([]);
  expect(flat.pages[0].text).toContain("Budi Santoso");
  expect(flat.pages[0].annots.map((a) => a.type)).toEqual(expect.arrayContaining(["Highlight", "Text"]));
  expect(flat.pages[0].links).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run e2e -w apps/web -- e2e/annots.spec.ts`
Expected: `Error: Cannot find module './pdfAnnots'` (no tests run).

- [ ] **Step 3: Fixture generator and README**

Modify `README.md` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/README.md
+++ b/README.md
@@ -1,6 +1,6 @@
 # Edith
 
-Editor PDF berbasis web: unggah PDF, edit teks aslinya (rich text per kata, Cari & Ganti), tambah teks, bentuk, gambar, gambar bebas, whiteout, redaksi, atur halaman, lalu unduh.
+Editor PDF berbasis web: unggah PDF, edit teks aslinya (rich text per kata, Cari & Ganti), tambah teks, bentuk, gambar, gambar bebas, whiteout, redaksi, stabilo/garis bawah/coret dan catatan (anotasi PDF asli), tanda tangan (dengan pustaka di browser), stamp, centang/silang, link, isi form (opsional diratakan), atur halaman, lalu unduh.
 
 ## Struktur
 
@@ -27,6 +27,7 @@ Fixture yang dihasilkan dari kode API (jalankan ulang setelah mengubah ekstraksi
 
     cd apps/api && uv run python -m scripts.text_fixture   # apps/web/src/lib/fixtures/text.json
     cd apps/api && uv run python -m scripts.e2e_text_pdf   # apps/web/e2e/fixtures/text.pdf
+    cd apps/api && uv run python -m scripts.e2e_annots_pdf # apps/web/e2e/fixtures/annots.pdf
 
 Setelah mengubah `apps/api/edith/ops.py`:
```

Create `apps/api/scripts/e2e_annots_pdf.py`:
```python
"""Writes apps/web/e2e/fixtures/annots.pdf for the annotations & forms E2E test.

Page 1: one Helvetica 12 pt line containing "penting" (baseline y = 80), a text field `nama` and a
checkbox `setuju` (on-state `Yes`). Page 2: "Halaman kedua" (the target of a link).
"""
import pymupdf

from edith.settings import REPO_ROOT

OUT = REPO_ROOT / "apps" / "web" / "e2e" / "fixtures" / "annots.pdf"
LINE = "Perjanjian ini memuat kata penting yang perlu ditandai."


def build() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 80), LINE, fontname="helv", fontsize=12)
    for kind, name, rect in ((pymupdf.PDF_WIDGET_TYPE_TEXT, "nama", (72, 100, 272, 120)),
                             (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, "setuju", (72, 130, 86, 144))):
        w = pymupdf.Widget()
        w.field_type, w.field_name, w.rect = kind, name, pymupdf.Rect(rect)
        w.field_value = "" if kind == pymupdf.PDF_WIDGET_TYPE_TEXT else False
        page.add_widget(w)
    doc.new_page(width=595, height=842).insert_text((72, 80), "Halaman kedua", fontname="helv", fontsize=12)
    return doc.tobytes(garbage=3, deflate=True)


if __name__ == "__main__":
    OUT.write_bytes(build())
    print("wrote", OUT)
```

Create `apps/web/e2e/pdfAnnots.ts`:
```ts
import { execFileSync } from "node:child_process";
import path from "node:path";

export interface AnnotInfo { type: string; stroke: number[]; vertices: number[][]; rect: number[]; content: string }
export interface LinkInfo { kind: number; page: number | null; uri: string | null; from: number[] }
export interface PageReport { text: string; annots: AnnotInfo[]; links: LinkInfo[]; widgets: { name: string; value: string | boolean }[]; images: number }  // images = placements
export interface PdfReport { isForm: boolean; pages: PageReport[] }

const SCRIPT = `
import json, sys, pymupdf
doc = pymupdf.open(sys.argv[1])
pages = []
for page in doc:
    pages.append({
        "text": page.get_text(),
        "annots": [{"type": a.type[1], "stroke": a.colors["stroke"], "vertices": [list(v) for v in (a.vertices or [])],
                    "rect": list(a.rect), "content": a.info["content"]} for a in page.annots()],
        "links": [{"kind": l["kind"], "page": l.get("page"), "uri": l.get("uri"), "from": list(l["from"])} for l in page.get_links()],
        "widgets": [{"name": w.field_name, "value": w.field_value} for w in page.widgets()],
        "images": len(page.get_image_info()),
    })
print(json.dumps({"isForm": bool(doc.is_form_pdf), "pages": pages}))
`;

/** Annotations, links, form widgets, images and text of every page, as PyMuPDF reads them (unrotated pages). */
export function pdfReport(file: string): PdfReport {
  const out = execFileSync("uv", ["run", "python", "-c", SCRIPT, file], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return JSON.parse(out) as PdfReport;
}

/** The bbox [x0, y0, x1, y1] of the first occurrence of `word` on page `index`. */
export function wordBox(file: string, word: string, index = 0): number[] {
  const out = execFileSync("uv", ["run", "python", "-c",
    "import json, sys, pymupdf; print(json.dumps(list(pymupdf.open(sys.argv[1])[int(sys.argv[3])].search_for(sys.argv[2])[0])))",
    file, word, String(index)], { cwd: path.join(__dirname, "..", "..", "api"), encoding: "utf8" });
  return JSON.parse(out) as number[];
}
```

Generate the fixture (committed, binary):
```bash
cd apps/api && uv run python -m scripts.e2e_annots_pdf
```
Expected: `wrote …/apps/web/e2e/fixtures/annots.pdf`; "penting" is at x 216.72–256.08 on baseline 80 (`wordBox` reads it from the file, so the test does not hard-code it).

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run e2e -w apps/web -- e2e/annots.spec.ts`
Expected: `1 passed`. Then the whole suite: `npm run e2e -w apps/web` → `4 passed`.

- [ ] **Step 5: Full check**

Run: `cd apps/api && uv run pytest -q` → `295 passed`; `npm test -w apps/web` → `Tests  209 passed (209)`; `npx tsc --noEmit -p apps/web` and `npm run lint -w apps/web` clean; `npm run check -w packages/ops` clean (after committing, the regenerated types have no diff).

`next dev` may rewrite `apps/web/tsconfig.json` (expanded arrays, an extra `.next/dev/dev/types` include): `git checkout apps/web/tsconfig.json` before committing.

- [ ] **Step 6: Commit**

```bash
git add README.md apps/api/scripts/e2e_annots_pdf.py apps/web/e2e/annots.spec.ts apps/web/e2e/fixtures/annots.pdf apps/web/e2e/pdfAnnots.ts
git commit -m "test(e2e): annotations, signatures, stamp, link and forms end to end; docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
