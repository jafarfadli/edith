# Task 8: Download hardening — a message for every failure, retry, new-tab fallback

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files are complete.

**Goal:** Owner feedback 4 ("unduh belum bisa") could not be reproduced; the probable cause was a mis-mapped API port, which fails as a network error or an HTML 404/502 page. Every failure in the download path now says what happened in Indonesian, transient ones offer **Coba lagi**, and a download the browser blocks falls back to opening the PDF in a new tab:

| Failure | Detected by | Message (strings.ts) | Retry |
|---|---|---|---|
| fetch rejects (offline, DNS, CORS, reset) | `ApiError("network")` | `errors.network` | yes |
| no answer within 120 s | `AbortSignal.timeout` → `ApiError("timeout")` | `errors.timeout` | yes |
| API error with a code (`bake_failed`, `doc_expired`, `invalid_op`, `internal`, `invalid_request` …) | JSON `error.code` | `errorMessage(code)` (existing mapping + new codes) | only `internal` |
| HTTP error without JSON (proxy page) | `ApiError("generic", status)` | 5xx `download.server(status)`, 404 `errors.not_found`, other 4xx `download.refused(status)` | 5xx |
| 200 but not a PDF (login/proxy HTML) | `isPdfBlob` (`%PDF-` signature) | `errors.bad_response` | yes |
| `<a download>` unsupported or throws | `saveBlob` → `window.open` | — (opens the PDF in a tab) | — |
| popup blocked too | `saveBlob` = `"blocked"` | `download.blocked` + **Buka di tab baru** | — |

After a successful download an info notice "Mengunduh <file>" offers **Buka di tab baru** too: a download the browser drops silently (no event reaches the page) can still be saved from the tab; that button is a fresh user gesture, so the popup is not blocked. Notices gain one optional action button.

**Files:**
- Create: `apps/web/src/lib/download.test.ts`, `apps/web/e2e/download.spec.ts`
- Modify: `apps/web/src/lib/download.ts` (replaces `downloadBlob`)
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts` (export timeout)
- Modify: `apps/web/src/lib/notices.ts` (`NoticeMsg.action`)
- Modify: `apps/web/src/lib/strings.ts` (new error codes, `t.download.*`)
- Modify: `apps/web/src/components/editor/Header.tsx`, `apps/web/src/components/editor/Notice.tsx`, `apps/web/src/components/editor/Editor.tsx`

**Interfaces:**
- Consumes: Task 7's E2E ports.
- Produces:
  - `saveBlob(blob, filename, env?: SaveEnv): "downloaded" | "opened" | "blocked"`, `openBlob(blob, env?): boolean`, `isPdfBlob(blob): Promise<boolean>`, `downloadError(e: unknown): { code, message, retry }` in `lib/download.ts`; `SaveEnv` lets tests pass a fake browser.
  - `EXPORT_TIMEOUT_MS = 120_000` and `ApiError("timeout", 0)` in `lib/api.ts`.
  - `NoticeMsg = { kind, text, action?: { label, run } }`; `<Notice action>` runs `action.run()` after closing itself.
  - Strings: `errors.timeout/internal/bad_response/not_found/invalid_request`, `download.started(name)/openTab/retry/blocked/server(status)/refused(status)`; `errors.network` now ends with "Periksa koneksi Anda."

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { downloadError, isPdfBlob, openBlob, saveBlob, type SaveEnv } from "@/lib/download";
import { t } from "@/lib/strings";

function env(opts: { click?: () => void; open?: Window | null; noDownloadAttr?: boolean } = {}) {
  const anchor = {
    href: "", download: "", click: vi.fn(opts.click ?? (() => {})), remove: vi.fn(),
  } as unknown as HTMLAnchorElement;
  if (opts.noDownloadAttr) delete (anchor as Partial<HTMLAnchorElement>).download;
  const opened = opts.open === undefined ? ({ opener: {} } as unknown as Window) : opts.open;
  const e: SaveEnv = {
    createAnchor: () => anchor,
    append: vi.fn(),
    createUrl: vi.fn(() => "blob:x"),
    revokeLater: vi.fn(),
    open: vi.fn(() => opened),
  };
  return { e, anchor };
}

const pdf = () => new Blob(["%PDF-1.7\n..."], { type: "application/pdf" });

describe("saveBlob", () => {
  it("downloads through an <a download> click", () => {
    const { e, anchor } = env();
    expect(saveBlob(pdf(), "a.pdf", e)).toBe("downloaded");
    expect(anchor.download).toBe("a.pdf");
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.remove).toHaveBeenCalled();
    expect(e.open).not.toHaveBeenCalled();
  });

  it("opens the PDF in a new tab when the click throws", () => {
    const { e } = env({ click: () => { throw new Error("blocked by sandbox"); } });
    expect(saveBlob(pdf(), "a.pdf", e)).toBe("opened");
    expect(e.open).toHaveBeenCalledWith("blob:x");
  });

  it("opens the PDF in a new tab when the browser has no download attribute", () => {
    const { e, anchor } = env({ noDownloadAttr: true });
    expect(saveBlob(pdf(), "a.pdf", e)).toBe("opened");
    expect(anchor.click).not.toHaveBeenCalled();
  });

  it("reports blocked when the new tab is blocked too", () => {
    const { e } = env({ click: () => { throw new Error("x"); }, open: null });
    expect(saveBlob(pdf(), "a.pdf", e)).toBe("blocked");
  });
});

describe("openBlob", () => {
  it("opens a blob URL and cuts the opener", () => {
    const { e } = env();
    const w = { opener: {} } as unknown as Window;
    (e.open as ReturnType<typeof vi.fn>).mockReturnValue(w);
    expect(openBlob(pdf(), e)).toBe(true);
    expect(w.opener).toBeNull();
    expect(e.revokeLater).toHaveBeenCalledWith("blob:x");
  });

  it("is false when the popup is blocked", () => {
    const { e } = env({ open: null });
    expect(openBlob(pdf(), e)).toBe(false);
  });
});

describe("isPdfBlob", () => {
  it("checks the %PDF- signature", async () => {
    expect(await isPdfBlob(pdf())).toBe(true);
    expect(await isPdfBlob(new Blob(["<html>502 Bad Gateway</html>"]))).toBe(false);
    expect(await isPdfBlob(new Blob([]))).toBe(false);
  });
});

describe("downloadError", () => {
  it("network failures say so and can be retried", () => {
    expect(downloadError(new ApiError("network", 0))).toEqual({ code: "network", message: t.errors.network, retry: true });
  });

  it("timeouts can be retried", () => {
    expect(downloadError(new ApiError("timeout", 0))).toMatchObject({ message: t.errors.timeout, retry: true });
  });

  it("known API codes keep their message; a failed object is not retried", () => {
    expect(downloadError(new ApiError("bake_failed", 500))).toMatchObject({ message: t.errors.bake_failed, retry: false });
    expect(downloadError(new ApiError("doc_expired", 410))).toMatchObject({ message: t.errors.doc_expired, retry: false });
    expect(downloadError(new ApiError("internal", 500))).toMatchObject({ message: t.errors.internal, retry: true });
  });

  it("a server error without an error body names the status", () => {
    expect(downloadError(new ApiError("generic", 502))).toMatchObject({ message: t.download.server(502), retry: true });
    expect(downloadError(new ApiError("not_found", 404))).toMatchObject({ message: t.errors.not_found, retry: false });
    expect(downloadError(new ApiError("generic", 403))).toMatchObject({ message: t.download.refused(403), retry: false });
  });

  it("a body that is not a PDF and anything unexpected", () => {
    expect(downloadError(new ApiError("bad_response", 200))).toMatchObject({ message: t.errors.bad_response, retry: true });
    expect(downloadError(new Error("boom"))).toMatchObject({ code: "generic", message: t.errors.generic, retry: true });
  });
});
```

```diff
diff --git a/apps/web/src/lib/api.test.ts b/apps/web/src/lib/api.test.ts
index f780284..2d2d4c4 100644
--- a/apps/web/src/lib/api.test.ts
+++ b/apps/web/src/lib/api.test.ts
@@ -41,6 +41,16 @@ describe("api client", () => {
     await expect(getStructure("x")).rejects.toMatchObject({ code: "network", status: 0 });
   });
 
+  it("gives the export a time limit and maps it to a timeout error", async () => {
+    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
+      expect(init?.signal).toBeInstanceOf(AbortSignal);
+      throw new DOMException("The operation timed out.", "TimeoutError");
+    });
+    vi.stubGlobal("fetch", fn);
+    await expect(exportPdf("x", { ops: [], flatten_forms: false, filename: "a.pdf" })).rejects.toMatchObject({ code: "timeout", status: 0 });
+    expect(fn).toHaveBeenCalledOnce();
+  });
+
   it("returns blob for export", async () => {
     mockFetch(200, "%PDF-1.7", "application/pdf");
     const blob = await exportPdf("x", { ops: [], flatten_forms: false, filename: "a.pdf" });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/download.test.ts src/lib/api.test.ts` (from `apps/web`)
Expected: FAIL — `download.test.ts` cannot import `downloadError`/`saveBlob` (12 failed); the timeout test gets `network`.

- [ ] **Step 3: Implement**

```ts
import { ApiError } from "@/lib/api";
import { errorMessage, t } from "@/lib/strings";

/** What saveBlob/openBlob need from the browser (tests pass fakes). */
export interface SaveEnv {
  createAnchor(): HTMLAnchorElement;
  append(el: HTMLElement): void;
  createUrl(blob: Blob): string;
  revokeLater(url: string): void;
  open(url: string): Window | null;
}

/** A blob URL opened in a tab must outlive the tab's load; one used by an <a download> click only the click. */
const OPEN_REVOKE_MS = 60_000;
const CLICK_REVOKE_MS = 1_000;

function browserEnv(revokeMs: number): SaveEnv {
  return {
    createAnchor: () => document.createElement("a"),
    append: (el) => document.body.appendChild(el),
    createUrl: (blob) => URL.createObjectURL(blob),
    revokeLater: (url) => { setTimeout(() => URL.revokeObjectURL(url), revokeMs); },
    open: (url) => window.open(url, "_blank"), // not "noopener": with it window.open always returns null
  };
}

/** Opens `blob` in a new tab (the browser's PDF viewer, which can save it). False when the popup was blocked. */
export function openBlob(blob: Blob, env: SaveEnv = browserEnv(OPEN_REVOKE_MS)): boolean {
  const url = env.createUrl(blob);
  const w = env.open(url);
  env.revokeLater(url);
  if (!w) return false;
  w.opener = null;
  return true;
}

export type SaveResult = "downloaded" | "opened" | "blocked";

/** Saves `blob` as `filename` through an <a download> click; when the browser cannot (no download attribute, or the
 *  click throws, e.g. in a sandboxed frame) it opens the PDF in a new tab instead; "blocked" when that fails too. */
export function saveBlob(blob: Blob, filename: string, env?: SaveEnv): SaveResult {
  const click = env ?? browserEnv(CLICK_REVOKE_MS);
  const a = click.createAnchor();
  if ("download" in a) {
    const url = click.createUrl(blob);
    try {
      a.href = url;
      a.download = filename;
      click.append(a);
      a.click();
      return "downloaded";
    } catch {
      // fall through to the new tab
    } finally {
      a.remove();
      click.revokeLater(url);
    }
  }
  return openBlob(blob, env ?? browserEnv(OPEN_REVOKE_MS)) ? "opened" : "blocked";
}

/** True when `blob` starts with the PDF signature (a proxy can answer 200 with an HTML error page). */
export async function isPdfBlob(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

export interface DownloadFailure { code: string; message: string; retry: boolean }

/** Codes worth a "Coba lagi": the same request may well work a moment later. */
const RETRY = new Set(["network", "timeout", "internal", "bad_response", "generic"]);

/** The user-facing message for anything that went wrong while exporting, and whether a retry makes sense. */
export function downloadError(e: unknown): DownloadFailure {
  if (!(e instanceof ApiError)) return { code: "generic", message: t.errors.generic, retry: true };
  const { code, status } = e;
  if (code === "generic" || code === "http_error" || code === "not_found") {
    if (status >= 500) return { code, message: t.download.server(status), retry: true };
    if (status === 404) return { code: "not_found", message: t.errors.not_found, retry: false };
    if (status >= 400) return { code, message: t.download.refused(status), retry: false };
    return { code: "generic", message: t.errors.generic, retry: true };
  }
  return { code, message: errorMessage(code), retry: RETRY.has(code) };
}
```

```diff
diff --git a/apps/web/src/lib/api.ts b/apps/web/src/lib/api.ts
index 3ca64f4..74fbd88 100644
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -45,8 +45,8 @@ async function request(path: string, init?: RequestInit): Promise<Response> {
   let res: Response;
   try {
     res = await fetch(`${API_URL}${path}`, init);
-  } catch {
-    throw new ApiError("network", 0);
+  } catch (e) {
+    throw new ApiError(e instanceof DOMException && e.name === "TimeoutError" ? "timeout" : "network", 0);
   }
   if (!res.ok) {
     let err: Record<string, unknown> = {};
@@ -94,8 +94,16 @@ export function assetUrl(docId: string, assetId: string): string {
   return `${API_URL}/documents/${docId}/assets/${assetId}`;
 }
 
+/** A bake of a large document takes seconds; past this the server or the connection is stuck. */
+export const EXPORT_TIMEOUT_MS = 120_000;
+
 export async function exportPdf(docId: string, body: ExportRequest): Promise<Blob> {
-  return (await request(`/documents/${docId}/export`, json(body))).blob();
+  const res = await request(`/documents/${docId}/export`, { ...json(body), signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS) });
+  try {
+    return await res.blob();
+  } catch (e) {
+    throw new ApiError(e instanceof DOMException && e.name === "TimeoutError" ? "timeout" : "network", 0);
+  }
 }
 
 export async function renderPage(docId: string, body: RenderPageRequest): Promise<Blob> {
```

```diff
diff --git a/apps/web/src/lib/notices.ts b/apps/web/src/lib/notices.ts
index 7ae72c6..04cbc0e 100644
--- a/apps/web/src/lib/notices.ts
+++ b/apps/web/src/lib/notices.ts
@@ -1,6 +1,7 @@
 import { createStore } from "zustand/vanilla";
 
-export interface NoticeMsg { kind: "error" | "info"; text: string }
+/** `action`: one button in the notice (e.g. "Coba lagi"); pressing it also closes the notice. */
+export interface NoticeMsg { kind: "error" | "info"; text: string; action?: { label: string; run: () => void } }
 
 /** Notices raised outside React (store actions such as a text commit); the editor shows the latest. */
 export const noticeStore = createStore<{ notice: NoticeMsg | null; show(n: NoticeMsg): void }>()((set) => ({
```

```diff
diff --git a/apps/web/src/lib/strings.ts b/apps/web/src/lib/strings.ts
index 658772c..f281929 100644
--- a/apps/web/src/lib/strings.ts
+++ b/apps/web/src/lib/strings.ts
@@ -183,7 +183,20 @@ export const t = {
     asset_not_found: "Gambar tidak ditemukan. Tambahkan ulang gambarnya.",
     invalid_op: "Ada perubahan yang tidak valid.",
     bake_failed: "Gagal menyimpan salah satu objek. Hapus objek yang disorot lalu coba lagi.",
-    network: "Tidak dapat terhubung ke server.",
+    network: "Tidak dapat terhubung ke server. Periksa koneksi Anda.",
+    timeout: "Server terlalu lama membuat PDF.",
+    internal: "Server mengalami kesalahan saat membuat PDF.",
+    bad_response: "Server tidak mengirim file PDF.",
+    not_found: "Server Edith tidak ditemukan di alamat ini (404).",
+    invalid_request: "Permintaan ke server tidak valid. Muat ulang halaman lalu coba lagi.",
+  },
+  download: {
+    started: (name: string) => `Mengunduh ${name}`,
+    openTab: "Buka di tab baru",
+    retry: "Coba lagi",
+    blocked: "Browser memblokir unduhan. Buka PDF di tab baru lalu simpan dari sana.",
+    server: (status: number) => `Server sedang bermasalah (${status}). Coba lagi sebentar lagi.`,
+    refused: (status: number) => `Server menolak permintaan (${status}).`,
   },
 } as const;
```

```diff
diff --git a/apps/web/src/components/editor/Notice.tsx b/apps/web/src/components/editor/Notice.tsx
index 716061d..3ff8d8d 100644
--- a/apps/web/src/components/editor/Notice.tsx
+++ b/apps/web/src/components/editor/Notice.tsx
@@ -1,12 +1,20 @@
 "use client";
 
+import type { NoticeMsg } from "@/lib/notices";
 import { t } from "@/lib/strings";
 
-export function Notice({ kind, children, onClose }: { kind: "error" | "info"; children: React.ReactNode; onClose?: () => void }) {
+export function Notice({ kind, children, action, onClose }: {
+  kind: "error" | "info"; children: React.ReactNode; action?: NoticeMsg["action"]; onClose?: () => void;
+}) {
   return (
     <div role={kind === "error" ? "alert" : "status"}
       className={`fixed bottom-20 left-1/2 z-50 max-w-[calc(100vw-2rem)] flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg ${kind === "error" ? "bg-danger text-white" : "bg-ink text-white"}`}>
       <span>{children}</span>
+      {action && (
+        <button onClick={() => { onClose?.(); action.run(); }} className="shrink-0 rounded-md px-2 py-0.5 font-medium underline underline-offset-2 hover:bg-white/15">
+          {action.label}
+        </button>
+      )}
       {onClose && <button onClick={onClose} aria-label={t.editor.close} className="opacity-80 hover:opacity-100">✕</button>}
     </div>
   );
```

```diff
diff --git a/apps/web/src/components/editor/Editor.tsx b/apps/web/src/components/editor/Editor.tsx
index aa46592..14663b3 100644
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -8,7 +8,7 @@ import { ApiError, fileUrl, getStructure } from "@/lib/api";
 import { toPage } from "@/lib/coords";
 import { fontStore } from "@/lib/fonts";
 import { loadDraft, saveDraft } from "@/lib/draft";
-import { noticeStore } from "@/lib/notices";
+import { noticeStore, type NoticeMsg } from "@/lib/notices";
 import { isTextOp, moveOp } from "@/lib/objects";
 import { destroyPdf, loadPdf } from "@/lib/pdf";
 import { resolveImports, restoreDraft } from "@/lib/restore";
@@ -44,7 +44,7 @@ const INFO_NOTICE_MS = 5000;
 export function Editor({ docId, initialName }: { docId: string; initialName: string }) {
   const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
   const [fatal, setFatal] = useState<string | null>(null);
-  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
+  const [notice, setNotice] = useState<NoticeMsg | null>(null);
   const info = useEditor((s) => s.info);
   const tool = useEditor((s) => s.tool);
   const initialDoc = useRef<EditorDoc | null>(null);
@@ -182,7 +182,7 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
       </div>
       <FindBar />
       <ZoomPill />
-      {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Notice>}
+      {notice && <Notice kind={notice.kind} action={notice.action} onClose={() => setNotice(null)}>{notice.text}</Notice>}
     </div>
   );
 }
```

```diff
diff --git a/apps/web/src/components/editor/Header.tsx b/apps/web/src/components/editor/Header.tsx
index cc51bf2..ebb48af 100644
--- a/apps/web/src/components/editor/Header.tsx
+++ b/apps/web/src/components/editor/Header.tsx
@@ -4,13 +4,14 @@ import { useState } from "react";
 import type { Op } from "@edith/ops";
 import { ApiError, exportPdf } from "@/lib/api";
 import { compact, failedOpId } from "@/lib/compact";
-import { downloadBlob } from "@/lib/download";
-import { errorMessage, t } from "@/lib/strings";
+import { downloadError, isPdfBlob, openBlob, saveBlob } from "@/lib/download";
+import type { NoticeMsg } from "@/lib/notices";
+import { t } from "@/lib/strings";
 import { editorStore, useEditor } from "@/store/editor";
 import { openFind } from "./find/findStore";
 import { whenTextCommitted } from "./text/textEdit";
 
-export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; text: string }) => void }) {
+export function Header({ onNotice }: { onNotice: (n: NoticeMsg) => void }) {
   const info = useEditor((s) => s.info);
   const [name, setName] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
@@ -29,16 +30,23 @@ export function Header({ onNotice }: { onNotice: (n: { kind: "error" | "info"; t
       if (!s.info) return;
       sent = compact(s.doc, s.info);
       const blob = await exportPdf(s.info.docId, { ops: sent, flatten_forms: hasForm && flatten, filename: fileName });
-      downloadBlob(blob, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`);
+      if (!(await isPdfBlob(blob))) throw new ApiError("bad_response", 200);
+      const name = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
+      // A download the browser blocks silently still leaves the notice's "Buka di tab baru" (a fresh click: no popup block).
+      const openTab = { label: t.download.openTab, run: () => { if (!openBlob(blob)) onNotice({ kind: "error", text: t.download.blocked }); } };
+      if (saveBlob(blob, name) === "blocked") onNotice({ kind: "error", text: t.download.blocked, action: openTab });
+      else onNotice({ kind: "info", text: t.download.started(name), action: openTab });
     } catch (e) {
       const err = e instanceof ApiError ? e : new ApiError("generic", 0);
       if (err.code === "bake_failed" || err.code === "invalid_op") console.warn(`export ${err.code}:`, err.extra.message);
+      else console.warn("export failed:", e);
       const failed = failedOpId(err.code, err.extra, sent);
       if (failed && s.doc.objects[failed]) {
         s.setTool("select");
         s.select(failed);
       }
-      onNotice({ kind: "error", text: errorMessage(err.code) });
+      const { message, retry } = downloadError(err);
+      onNotice({ kind: "error", text: message, action: retry ? { label: t.download.retry, run: () => void download() } : undefined });
     } finally {
       setBusy(false);
     }
```

- [ ] **Step 4: E2E for the failure classes and the retry**

```ts
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const SAMPLE = path.join(__dirname, "fixtures", "sample.pdf");
const EXPORT = "**/documents/*/export";

test("a failing download says why and can be retried", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.getByTestId("file-input").setInputFiles(SAMPLE);
  await expect(page.getByTestId("page").first()).toBeVisible();
  const unduh = page.getByRole("button", { name: "Unduh" });
  const alert = page.getByRole("alert").filter({ hasText: /./ }); // not Next.js's empty route announcer

  // A proxy error page instead of the API's JSON error.
  await page.route(EXPORT, (r) => r.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad Gateway</html>" }));
  await unduh.click();
  await expect(alert).toContainText("Server sedang bermasalah (502)");

  // The connection drops.
  await page.unroute(EXPORT);
  await page.route(EXPORT, (r) => r.abort("connectionreset"));
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  await expect(alert).toContainText("Tidak dapat terhubung ke server");

  // 200, but not a PDF (an HTML page from something in between).
  await page.unroute(EXPORT);
  await page.route(EXPORT, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html>login</html>" }));
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  await expect(alert).toContainText("Server tidak mengirim file PDF");

  // An API error with its code: no retry button (a re-upload is needed), the mapped message.
  await page.unroute(EXPORT);
  await page.route(EXPORT, (r) => r.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: { code: "doc_expired", message: "expired" } }) }));
  await unduh.click();
  await expect(alert).toContainText("Sesi dokumen sudah berakhir");
  await expect(alert.getByRole("button", { name: "Coba lagi" })).toHaveCount(0);

  // Back to the real server: Coba lagi from a transient error downloads the PDF and says so.
  await page.unroute(EXPORT);
  await page.route(EXPORT, (r) => r.abort("connectionreset"), { times: 1 });
  await unduh.click();
  await expect(alert).toContainText("Tidak dapat terhubung ke server");
  const pending = page.waitForEvent("download");
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  const file = path.join(test.info().outputDir, "retry.pdf");
  await (await pending).saveAs(file);
  expect(readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.getByRole("status").filter({ hasText: "Mengunduh" })).toBeVisible();
  await expect(page.getByRole("status").getByRole("button", { name: "Buka di tab baru" })).toBeVisible();
});
```

- [ ] **Step 5: Run the suites**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web && npm run build -w apps/web`
Expected: web 306 passed (+12 download, +1 api), tsc/eslint clean, build OK.

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web`
Expected: 10 passed.

- [ ] **Step 6: Commit**

```bash
git checkout apps/web/tsconfig.json; rm -f apps/web/AGENTS.md
git add apps/web/src/lib/download.ts apps/web/src/lib/download.test.ts apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts \
  apps/web/src/lib/notices.ts apps/web/src/lib/strings.ts apps/web/src/components/editor/Header.tsx \
  apps/web/src/components/editor/Notice.tsx apps/web/src/components/editor/Editor.tsx apps/web/e2e/download.spec.ts
git commit -m "feat(web): download errors with a message per failure, retry, and a new-tab fallback" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
