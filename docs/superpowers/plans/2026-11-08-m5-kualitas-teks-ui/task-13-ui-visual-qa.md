# Task 13: Visual QA of the redesign (screenshot script, fixes, review against the before shots)

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions, **Design system**). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** A repeatable screenshot pass over every main UI state, run against a production build, compared with the "before" shots in `shots/` and with the design system. The pass done while writing this plan found one problem — at 1024 px the tool row was clipped at the Crop button — fixed here by narrowing the file-name field below `xl`. The script stays in the repo (`npm run ui-shots -w apps/web`) for later design changes; it exits non-zero on any page error.

States captured: start page (1440 and 375 px), editor with the owner's Korean form, the shape menu, a tool with hint + properties (Persegi), a tooltip with key cap, stamp picker, signature dialog, find & replace, Kelola Halaman, crop overlay, a selected object (mini-bar + properties + Anotasi panel), the page menu, the editor at 1024 px, editing an original paragraph (text properties), the download notice and a failed download with **Coba lagi**.

**Files:**
- Create: `apps/web/scripts/ui-shots.mjs`
- Modify: `apps/web/package.json` (`ui-shots` script), `.gitignore` (`apps/web/ui-shots/`)
- Modify: `apps/web/src/components/editor/Header.tsx` (file-name field `w-36 xl:w-52`)

**Interfaces:**
- Consumes: everything from Tasks 7–12 (names used by the script: `Bentuk pilihan`, `Persegi`, `Penanda`, `Gambar pilihan`/`Stamp`, `Tanda Tangan`, `Nama Anda`, `Cari teks`, `Tampilkan ganti`, `Kelola Halaman`, `manage-page`, `Batal`, `Crop`, `Centang`, `Pilih`, `Anotasi`, `annotation-item`, `thumb`/`Menu halaman`, `text-editor`, `Unduh`).
- Produces: `npm run ui-shots -w apps/web -- <baseUrl> <outDir> [pdf]` (defaults `http://localhost:3000`, `ui-shots/`, `e2e/fixtures/pages.pdf`).

- [ ] **Step 1: The screenshot script**

```js
// Screenshots of every main UI state, for the visual QA of a design change.
// Usage (from apps/web, servers running): node scripts/ui-shots.mjs <baseUrl> <outDir> [pdf]
//   pdf: the document to open in the editor (default: e2e/fixtures/pages.pdf).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const [base = "http://localhost:3000", outDir = "ui-shots", pdf = path.join(here, "..", "e2e", "fixtures", "pages.pdf")] = process.argv.slice(2);
const TEXT_PDF = path.join(here, "..", "e2e", "fixtures", "text.pdf");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];
async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function shot(page, name, clip) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), clip });
  console.log("saved", name);
}
async function upload(page, file) {
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(file);
  await page.getByTestId("page").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
}
const button = (page, name) => page.getByRole("button", { name, exact: true });

// Start page, wide and phone-sized.
let page = await open(1440, 900);
await page.goto(base);
await shot(page, "landing");
const phone = await open(375, 812);
await phone.goto(base);
await phone.screenshot({ path: path.join(outDir, "landing-375.png"), fullPage: true });

// The editor with the document, a tool with options (hint + properties), the shape menu, a tooltip.
await upload(page, pdf);
await shot(page, "editor");
await button(page, "Bentuk pilihan").click();
await shot(page, "shape-menu");
await page.getByRole("menuitem", { name: "Persegi", exact: true }).click();
await shot(page, "tool-rect");
await button(page, "Pilih").click();
await button(page, "Penanda").hover();
await page.waitForTimeout(900);
await shot(page, "tooltip", { x: 300, y: 0, width: 800, height: 140 });

// Dialogs: stamp picker, signature, Kelola Halaman; the find bar; the crop overlay.
await page.getByRole("button", { name: "Gambar pilihan" }).click();
await page.getByRole("menuitem", { name: "Stamp" }).click();
await shot(page, "stamp-picker");
await page.keyboard.press("Escape");
await button(page, "Tanda Tangan").click();
await page.getByRole("textbox", { name: "Nama Anda" }).fill("Budi Santoso");
await shot(page, "signature");
await page.keyboard.press("Escape");
await page.keyboard.press("ControlOrMeta+f");
await page.getByRole("textbox", { name: "Cari teks" }).fill("a");
await button(page, "Tampilkan ganti").click();
await shot(page, "find");
await page.keyboard.press("Escape");
await button(page, "Kelola Halaman").click();
await page.waitForTimeout(1000);
await page.getByTestId("manage-page").first().click();
await shot(page, "manage-pages");
await button(page, "Batal").click();
await button(page, "Crop").click();
await shot(page, "crop");
await page.keyboard.press("Escape");

// A selected object (mini-bar + properties), the Anotasi panel, the page menu.
await button(page, "Centang").click();
const box = await page.getByTestId("page").first().boundingBox();
await page.mouse.click(box.x + 300, box.y + 420);
await button(page, "Pilih").click();
await page.getByRole("tab", { name: /Anotasi/ }).click();
await page.getByTestId("annotation-item").first().click();
await shot(page, "selected");
await page.getByRole("tab", { name: "Halaman" }).click();
await page.getByTestId("thumb").first().getByRole("button", { name: "Menu halaman" }).click();
await shot(page, "page-menu", { x: 0, y: 0, width: 520, height: 420 });
await page.keyboard.press("Escape");

// Narrow window.
const narrow = await open(1024, 768);
await upload(narrow, pdf);
await shot(narrow, "editor-1024");

// Editing an original paragraph; a download (info notice) and a failing one (error notice with retry).
page = await open(1440, 900);
await upload(page, TEXT_PDF);
const p = await page.getByTestId("page").first().boundingBox();
const editor = page.getByTestId("text-editor");
for (let i = 0; i < 10 && !(await editor.isVisible()); i++) { await page.mouse.dblclick(p.x + 150, p.y + 110); await page.waitForTimeout(300); }
await shot(page, "text-editing");
await page.mouse.click(p.x + 500, p.y + 700);
const download = page.waitForEvent("download");
await button(page, "Unduh").click();
await download;
await shot(page, "download-notice");
await page.route("**/documents/*/export", (r) => r.fulfill({ status: 502, contentType: "text/html", body: "Bad Gateway" }));
await button(page, "Unduh").click();
await page.getByRole("alert").filter({ hasText: /502/ }).waitFor();
await shot(page, "download-error");

console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
await browser.close();
if (errors.length) process.exit(1);
```

```diff
diff --git a/apps/web/package.json b/apps/web/package.json
index a29540a..814e761 100644
--- a/apps/web/package.json
+++ b/apps/web/package.json
@@ -12,7 +12,8 @@
     "predev": "npm run sync-fonts",
     "prebuild": "npm run sync-fonts",
     "pretest": "npm run sync-fonts",
-    "e2e": "playwright test"
+    "e2e": "playwright test",
+    "ui-shots": "node scripts/ui-shots.mjs"
   },
   "dependencies": {
     "@dnd-kit/core": "^6.3.1",
```

```diff
diff --git a/.gitignore b/.gitignore
index 0fe659a..a904384 100644
--- a/.gitignore
+++ b/.gitignore
@@ -9,6 +9,7 @@ __pycache__/
 apps/web/public/fonts/
 test-results/
 playwright-report/
+apps/web/ui-shots/
 .env*.local
 .DS_Store
 apps/web/public/pdf.worker.min.mjs
```

- [ ] **Step 2: Run it against a production build**

Start the API on a free port with CORS for the web port, build with that API URL, start the web, run the script with the owner's form (never copy it into the repo):

```bash
(cd apps/api && EDITH_CORS_ORIGINS='["http://localhost:19102"]' uv run uvicorn edith.main:app --port 19103 &)   # note the PID, stop it afterwards
NEXT_PUBLIC_API_URL=http://localhost:19103 npm run build -w apps/web
(cd apps/web && npx next start --port 19102 &)                                                            # note the PID
cd apps/web && npm run ui-shots -- http://localhost:19102 ui-shots "../../references/Visa Application Form (1).pdf"
```

Expected: 17 PNGs in `apps/web/ui-shots/`, `no page errors`.

- [ ] **Step 3: Review the shots against this checklist; fix what fails**

For each PNG: no emoji anywhere; no label wraps onto two lines; no empty bar; one accent only (blue on fills, selection and focus — never a second hue for decoration); icons all the same size/stroke; menus/popovers/dialogs share the raised surface + hairline ring + shadow; text on dark ≥ 4.5:1 (muted `#a1a5ab` on the panel is ~7:1, faint only for secondary text); the page stays white with dark text; the properties bar is absent with Pilih + nothing selected; at 1024 px every tool is reachable; at 375 px the start page has no horizontal scroll.

The pass for this plan failed one item (1024 px: the Crop button was cut off by the scrolling tool row) — fix:

```diff
diff --git a/apps/web/src/components/editor/Header.tsx b/apps/web/src/components/editor/Header.tsx
index b1af4a7..54cd91e 100644
--- a/apps/web/src/components/editor/Header.tsx
+++ b/apps/web/src/components/editor/Header.tsx
@@ -67,7 +67,7 @@ export function Header({ onNotice, children }: { onNotice: (n: NoticeMsg) => voi
         aria-label={t.editor.fileName}
         value={fileName}
         onChange={(e) => setName(e.target.value)}
-        className="h-8 w-52 min-w-0 shrink truncate rounded-md border border-transparent bg-transparent px-2 text-sm text-muted hover:border-line-strong focus:border-accent focus:text-ink focus:outline-none"
+        className="h-8 w-36 min-w-0 shrink truncate rounded-md xl:w-52 border border-transparent bg-transparent px-2 text-sm text-muted hover:border-line-strong focus:border-accent focus:text-ink focus:outline-none"
       />
       {children}
       <div className="flex shrink-0 items-center gap-1">
```

Re-run Step 2; compare with `shots/after-*.png` in this folder (taken with the same script).

- [ ] **Step 4: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run build -w apps/web`
Expected: web 314 passed, tsc/eslint clean, build OK.

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web`
Expected: 12 passed.

Stop the servers you started (by PID).

- [ ] **Step 5: Commit**

```bash
git checkout apps/web/tsconfig.json; rm -f apps/web/AGENTS.md
git add .gitignore apps/web/package.json apps/web/scripts/ui-shots.mjs apps/web/src/components/editor/Header.tsx
git commit -m "chore(web): visual QA script for every main UI state; narrower file name field below xl" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
