# Task 19: Playwright E2E, Docker, CI, README

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/editor.spec.ts`, `apps/web/e2e/fixtures/sample.pdf` (generated, committed), `apps/web/e2e/pdfText.ts`
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/ci.yml`, `README.md`
- Modify: `apps/web/package.json` (scripts `e2e`), `apps/web/vitest.config.ts` (exclude e2e)

**Interfaces:**
- Consumes: everything from Tasks 1–18 through the UI (test ids: `file-input`, `page`, `thumb`, `overlay`, `text-editor`; aria-labels from `t.editor`).
- Produces: `npm run e2e -w apps/web` runs API (port 8000) + web (port 3000) and the E2E flow; `docker compose up --build` serves the app at http://localhost:3000.

- [ ] **Step 1: Fixture PDF**

Run from repo root:
```bash
mkdir -p apps/web/e2e/fixtures
cd apps/api && uv run python -c "from tests.pdfs import make_pdf; open('../web/e2e/fixtures/sample.pdf','wb').write(make_pdf(pages=3))"
```
Expected: `apps/web/e2e/fixtures/sample.pdf` exists (3 pages, text "Page 0/1/2" at (72, 72)).

- [ ] **Step 2: Playwright setup**

Run: `npm install -w apps/web -D @playwright/test && npx playwright install chromium`

`apps/web/playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: [
    { command: "uv run uvicorn edith.main:app --port 8000", cwd: "../api", url: "http://localhost:8000/health", reuseExistingServer: true, timeout: 60_000 },
    { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
  ],
});
```

Add script to `apps/web/package.json`: `"e2e": "playwright test"`.
In `apps/web/vitest.config.ts` keep `include: ["src/**/*.test.ts"]` (e2e files live outside `src`, nothing to change if already so).

`apps/web/e2e/pdfText.ts`:
```ts
import { readFile } from "node:fs/promises";

export async function pdfInfo(path: string): Promise<{ pages: { text: string; rotation: number }[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push({ text: content.items.map((it) => ("str" in it ? it.str : "")).join(" "), rotation: page.rotate });
  }
  return { pages };
}
```

- [ ] **Step 3: E2E test**

`apps/web/e2e/editor.spec.ts`:
```ts
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pdfInfo } from "./pdfText";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");

async function dragOnPage(page: Page, pageIndex: number, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId("page").nth(pageIndex).boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
}

test("edit and download a PDF", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page).toHaveURL(/\/edit\//);
  await expect(page.getByTestId("page")).toHaveCount(3);
  await expect(page.getByTestId("thumb")).toHaveCount(3);

  // Rotate page 2 right via its thumbnail menu.
  await page.getByTestId("thumb").nth(1).getByRole("button", { name: "Menu halaman" }).click();
  await page.getByRole("menuitem", { name: "Putar kanan" }).click();

  // Delete page 3.
  await page.getByTestId("thumb").nth(2).getByRole("button", { name: "Menu halaman" }).click();
  await page.getByRole("menuitem", { name: "Hapus halaman" }).click();
  await expect(page.getByTestId("page")).toHaveCount(2);

  // Redact "Page 0" on page 1 (zoom 100%: 1 pt = 1 px; text at x=72, baseline y=72).
  await page.getByRole("button", { name: "Penghapus pilihan" }).click();
  await page.getByRole("menuitem", { name: "Redaksi" }).click();
  await dragOnPage(page, 0, [60, 50], [180, 80]);

  // Rectangle on page 1.
  await page.getByRole("button", { name: "Bentuk pilihan" }).click();
  await page.getByRole("menuitem", { name: "Persegi" }).click();
  await dragOnPage(page, 0, [100, 200], [250, 300]);

  // Text box on page 1.
  await page.getByRole("button", { name: "Teks", exact: true }).click();
  const p1 = (await page.getByTestId("page").first().boundingBox())!;
  await page.mouse.click(p1.x + 100, p1.y + 400);
  const editor = page.getByTestId("text-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Halo Edith");
  await page.mouse.click(p1.x + 500, p1.y + 700); // blur → commit
  await expect(editor).toHaveCount(0);

  // Undo/redo sanity: undo the text, redo it back.
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh" }).click();
  const download = await downloadPromise;
  const file = path.join(test.info().outputDir, "out.pdf");
  await download.saveAs(file);

  const info = await pdfInfo(file);
  expect(info.pages.length).toBe(2);
  expect(info.pages[0].text).not.toContain("Page 0");
  expect(info.pages[0].text).toContain("Halo Edith");
  expect(info.pages[1].text).toContain("Page 1");
  expect(info.pages[1].rotation).toBe(90);
});

test("rejects a non-PDF upload with an Indonesian message", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("bukan pdf") });
  await expect(page.getByRole("alert")).toContainText("bukan PDF");
});
```

Run: `npm run e2e -w apps/web`
Expected: 2 passed. If a selector fails, fix the UI component to expose the documented label/test id (do not loosen the assertion on PDF contents).

- [ ] **Step 4: Docker**

`.dockerignore`:
```
**/node_modules
**/.next
apps/api/.venv
apps/api/.data
**/__pycache__
test-results
playwright-report
.git
```

`apps/api/Dockerfile` (build context = repo root):
```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev
COPY apps/api/edith ./edith
COPY packages/fonts /app/packages/fonts
ENV EDITH_DATA_DIR=/data EDITH_FONTS_DIR=/app/packages/fonts
VOLUME /data
EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "edith.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`apps/web/Dockerfile` (build context = repo root):
```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/ops/package.json packages/ops/
COPY packages/fonts/package.json packages/fonts/
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build -w apps/web

FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "apps/web"]
```

`docker-compose.yml`:
```yaml
services:
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    ports: ["8000:8000"]
    environment:
      EDITH_CORS_ORIGINS: '["http://localhost:3000"]'
    volumes: [edith-data:/data]
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args: { NEXT_PUBLIC_API_URL: "http://localhost:8000" }
    ports: ["3000:3000"]
    depends_on: [api]
volumes:
  edith-data:
```

Run: `docker compose up --build -d && curl -s localhost:8000/health && curl -s -o /dev/null -w "%{http_code}\n" localhost:3000 && docker compose down`
Expected: `{"ok":true}` then `200`.

- [ ] **Step 5: CI + README**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: astral-sh/setup-uv@v5
      - run: npm ci
      - run: cd apps/api && uv sync && uv run pytest -q
      - run: npm run check -w packages/ops
      - run: npm test -w apps/web
      - run: npx tsc --noEmit -p apps/web
      - run: npx playwright install --with-deps chromium && npm run e2e -w apps/web
```

`README.md`:
```md
# Edith

Editor PDF berbasis web: unggah PDF, edit (teks, bentuk, gambar, gambar bebas, whiteout, redaksi, atur halaman), lalu unduh.

## Struktur

- `apps/api` — FastAPI + PyMuPDF. Menyimpan unggahan selama 1 jam dan menerapkan ("bake") operasi edit saat ekspor.
- `apps/web` — Next.js. Merender halaman dengan pdf.js, mengelola edit di browser, dan menata teks sendiri agar sama persis dengan hasil ekspor.
- `packages/ops` — JSON Schema + tipe TypeScript untuk operasi edit (dihasilkan dari `apps/api/edith/ops.py`).
- `packages/fonts` — font bersama (Arimo, Tinos, Cousine; Apache 2.0).

## Menjalankan untuk pengembangan

Prasyarat: Node 22+, uv.

    npm install
    npm run dev:api      # http://localhost:8000
    npm run dev:web      # http://localhost:3000

## Tes

    npm run test:api
    npm test -w apps/web
    npm run e2e -w apps/web

Setelah mengubah `apps/api/edith/ops.py`:

    cd apps/api && uv run python -m scripts.export_schema && cd ../.. && npm run gen -w packages/ops

## Docker

    docker compose up --build

## Lisensi

PyMuPDF berlisensi AGPL-3.0. Menjalankan Edith sebagai layanan tertutup memerlukan lisensi komersial dari Artifex atau membuka kode backend.
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add Playwright E2E flow, Docker setup, CI and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
