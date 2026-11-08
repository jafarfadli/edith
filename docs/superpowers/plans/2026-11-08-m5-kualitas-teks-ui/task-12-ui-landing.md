# Task 12: Start page — the empty canvas with a page to drop the PDF on

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions, **Design system**). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files and full rewrites are complete.

**Goal:** The start page stops being a centred card with a green button. It is the editor's own empty canvas: the top bar with the wordmark, then on the left the headline, one honest sentence and four things Edith does (each with its line icon; no invented numbers or claims), and on the right a blank A4-shaped sheet — the drop target — with "Tarik & lepas PDF di sini", **Pilih file** and the size limit. Dragging a file over it tints it with the accent. One column on phones (checked at 375 px, no horizontal scroll). The fatal-error screen of the editor uses the same tokens. The legacy colour aliases `--bg`/`--surface` (kept since Task 9) are removed — nothing uses them any more.

**Files:**
- Rewrite: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/UploadDropzone.tsx`, `apps/web/src/components/editor/Editor.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/strings.ts` (`upload.lede`, `upload.points.*`)

**Interfaces:**
- Consumes: Task 9 tokens, Task 10 `BTN_PRIMARY`.
- Produces: `t.upload.lede`, `t.upload.points.{text, forms, sign, pages}`. `data-testid="dropzone"`, `data-testid="file-input"` and the `role="alert"` upload error are unchanged (the error now sits under the sheet, outside the drop target).

- [ ] **Step 1: Strings**

```diff
diff --git a/apps/web/src/lib/strings.ts b/apps/web/src/lib/strings.ts
index ef96097..f10e5f7 100644
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -8,6 +8,13 @@ export const t = {
     choose: "Pilih file",
     limit: "Maksimal 50 MB atau 500 halaman",
     processing: "Memproses dokumen…",
+    lede: "Ubah teks, isi formulir, tanda tangani, dan atur halaman PDF tanpa memasang aplikasi apa pun.",
+    points: {
+      text: "Edit teks asli langsung di halaman",
+      forms: "Isi formulir PDF",
+      sign: "Tanda tangan, stempel, dan penanda",
+      pages: "Putar, susun, impor, dan crop halaman",
+    },
   },
   editor: {
     download: "Unduh",
```

- [ ] **Step 2: The drop target as a page**

```diff
diff --git a/apps/web/src/components/UploadDropzone.tsx b/apps/web/src/components/UploadDropzone.tsx
index fc69c28..80abbe4 100644
--- a/apps/web/src/components/UploadDropzone.tsx
+++ b/apps/web/src/components/UploadDropzone.tsx
@@ -1,9 +1,11 @@
 "use client";
 
+import { FileUp, LoaderCircle } from "lucide-react";
 import { useRouter } from "next/navigation";
 import { useRef, useState } from "react";
 import { ApiError, uploadDocument } from "@/lib/api";
 import { errorMessage, t } from "@/lib/strings";
+import { BTN_PRIMARY } from "./ui/styles";
 
 const MAX_BYTES = 50 * 1024 * 1024;
 
@@ -40,30 +42,30 @@ export function UploadDropzone() {
   }
 
   return (
-    <div
-      data-testid="dropzone"
-      onDragOver={(e) => { e.preventDefault(); if (!busy && !inFlight.current) setOver(true); }}
-      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
-      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy && !inFlight.current) handle(e.dataTransfer.files[0]); }}
-      className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition ${over ? "border-accent bg-accent/5" : "border-line bg-surface"}`}
-    >
-      <p className="text-lg font-medium">{t.upload.drop}</p>
-      <p className="text-sm text-muted">{t.upload.or}</p>
-      <button
-        type="button"
-        disabled={busy}
-        onClick={() => input.current?.click()}
-        className="rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
+    <div className="flex w-full max-w-[22rem] flex-col items-center gap-4">
+      <div
+        data-testid="dropzone"
+        onDragOver={(e) => { e.preventDefault(); if (!busy && !inFlight.current) setOver(true); }}
+        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
+        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy && !inFlight.current) handle(e.dataTransfer.files[0]); }}
+        // A blank page waiting on the canvas: the drop target has the proportions of an A4 sheet.
+        className={`flex aspect-[210/297] w-full flex-col items-center justify-center gap-5 rounded-sm px-8 text-center shadow-page transition-colors ${over ? "bg-accent/10 outline-2 outline-offset-4 outline-accent outline-dashed" : "bg-paper outline-1 outline-offset-4 outline-line-strong outline-dashed"}`}
       >
-        {t.upload.choose}
-      </button>
-      {busy ? (
-        <p className="text-sm text-muted" role="status">{t.upload.processing}</p>
-      ) : (
-        <p className="text-xs text-muted">{t.upload.limit}</p>
-      )}
-      <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => handle(e.target.files?.[0])} />
-      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
+        <span aria-hidden className={`grid h-12 w-12 place-items-center rounded-full ${over ? "bg-accent text-accent-ink" : "bg-accent/10 text-accent"}`}>
+          <FileUp size={22} strokeWidth={1.75} />
+        </span>
+        <div className="flex flex-col gap-1">
+          <p className={`text-base font-medium ${over ? "text-ink" : "text-paper-ink"}`}>{t.upload.drop}</p>
+          <p className="text-xs text-faint">{t.upload.or}</p>
+        </div>
+        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={BTN_PRIMARY}>
+          {busy && <LoaderCircle size={16} strokeWidth={1.75} aria-hidden className="animate-spin" />}
+          {t.upload.choose}
+        </button>
+        {busy ? <p className="text-2xs text-faint" role="status">{t.upload.processing}</p> : <p className="text-2xs text-faint">{t.upload.limit}</p>}
+        <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => handle(e.target.files?.[0])} />
+      </div>
+      {error && <p role="alert" className="text-center text-sm text-danger-text">{error}</p>}
     </div>
   );
 }
```

- [ ] **Step 3: The start page**

```tsx
import { FormInput, LayoutGrid, Signature, Type } from "lucide-react";
import { UploadDropzone } from "@/components/UploadDropzone";
import { t } from "@/lib/strings";

const POINTS = [
  { icon: Type, text: t.upload.points.text },
  { icon: FormInput, text: t.upload.points.forms },
  { icon: Signature, text: t.upload.points.sign },
  { icon: LayoutGrid, text: t.upload.points.pages },
];

/** The start page is the editor's empty canvas: the pitch on the left, a blank page to drop the PDF on at the right. */
export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center border-b border-line bg-panel px-4">
        <span className="flex items-center gap-2 font-semibold tracking-tight text-ink">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
          {t.appName}
        </span>
      </header>
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-12 px-4 py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-16 md:px-8">
        <section className="flex min-w-0 flex-col gap-6">
          <h1 className="text-4xl font-semibold tracking-tight text-ink [overflow-wrap:anywhere] sm:text-5xl">{t.upload.title}</h1>
          <p className="max-w-md text-base text-muted">{t.upload.lede}</p>
          <ul className="flex flex-col gap-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-ink">
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-panel text-accent-text ring-1 ring-inset ring-line">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </section>
        <div className="flex justify-center md:justify-end">
          <UploadDropzone />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Fatal-error screen; drop the legacy colour names**

```diff
diff --git a/apps/web/src/components/editor/Editor.tsx b/apps/web/src/components/editor/Editor.tsx
index d21fb7c..d13fc9b 100644
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -19,6 +19,7 @@ import { editorStore, pageGeom, useEditor, type EditorDoc } from "@/store/editor
 import { pdfStore } from "@/store/pdfs";
 import { charsStore } from "@/store/chars";
 import { textStore } from "@/store/text";
+import { BTN_PRIMARY } from "../ui/styles";
 import { FormLayer } from "./forms/FormLayer";
 import { Header } from "./Header";
 import { Notice } from "./Notice";
@@ -146,9 +147,9 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
 
   if (fatal) {
     return (
-      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
-        <p role="alert" className="max-w-md text-lg">{errorMessage(fatal)}</p>
-        <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-accent-ink">{t.upload.choose}</Link>
+      <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-canvas px-4 text-center">
+        <p role="alert" className="max-w-md text-base text-ink">{errorMessage(fatal)}</p>
+        <Link href="/" className={BTN_PRIMARY}>{t.upload.choose}</Link>
       </main>
     );
   }
```

```diff
diff --git a/apps/web/src/app/globals.css b/apps/web/src/app/globals.css
index 8ae1783..8960304 100644
--- a/apps/web/src/app/globals.css
+++ b/apps/web/src/app/globals.css
@@ -34,10 +34,6 @@
   /* The PDF page and what the editor draws on it (always light). */
   --paper: oklch(100% 0 0);
   --paper-ink: oklch(20% 0.005 260);
-
-  /* Legacy names (M1–M4 components); Task 10 moves every component to the names above and removes these. */
-  --bg: var(--canvas);
-  --surface: var(--panel);
 }
 
 @theme inline {
@@ -60,8 +56,6 @@
   --color-warn: var(--warn);
   --color-paper: var(--paper);
   --color-paper-ink: var(--paper-ink);
-  --color-bg: var(--bg);
-  --color-surface: var(--surface);
 
   --font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
   --font-mono: var(--font-geist-mono), ui-monospace, monospace;
```

- [ ] **Step 5: Run the suites and look at it**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 314 passed, tsc/eslint clean.

Run: `grep -rnE "bg-bg|bg-surface|text-surface|--bg\b|--surface\b" apps/web/src`
Expected: no output.

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web`
Expected: 12 passed (`editor.spec` "rejects a non-PDF upload" still finds the alert).

Open `/` at 1440 px and at 375 px (devtools): two columns / one column, no horizontal scroll, the sheet keeps its A4 proportions.

- [ ] **Step 6: Commit**

```bash
git checkout apps/web/tsconfig.json; rm -f apps/web/AGENTS.md
git add apps/web/src/app/page.tsx apps/web/src/app/globals.css apps/web/src/components/UploadDropzone.tsx \
  apps/web/src/components/editor/Editor.tsx apps/web/src/lib/strings.ts
git commit -m "feat(web): start page as an empty canvas with a page-shaped drop target; drop legacy colour names" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
