# Task 13: API client + upload page

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/components/UploadDropzone.tsx`, `apps/web/.env.example`
- Modify: `apps/web/src/app/page.tsx` (replace template), `apps/web/src/app/layout.tsx` (title, lang, font), `apps/web/src/app/globals.css` (theme tokens)

**Interfaces:**
- Consumes: `t`, `errorMessage` (Task 1), `StructurePage` (Task 12), `ExportRequest`, `RenderPageRequest` (Task 3).
- Produces:
```ts
export const API_URL: string;  // NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
export class ApiError extends Error { code: string; status: number; extra: Record<string, unknown> }
export interface UploadResult { doc_id: string; sha256: string; page_count: number }
export interface Structure { doc_id: string; sha256: string; page_count: number; pages: StructurePage[] }
export function uploadDocument(file: File | Blob, name?: string): Promise<UploadResult>;
export function getStructure(docId: string): Promise<Structure>;
export function fileUrl(docId: string): string;
export function uploadAsset(docId: string, file: Blob): Promise<{ asset_id: string; width: number; height: number }>;
export function assetUrl(docId: string, assetId: string): string;
export function exportPdf(docId: string, body: ExportRequest): Promise<Blob>;
export function renderPage(docId: string, body: RenderPageRequest): Promise<Blob>;
```
Upload page navigates to `/edit/{doc_id}?name=<encoded file name>`.

- [ ] **Step 1: Failing API client tests**

`apps/web/src/lib/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, exportPdf, getStructure, uploadDocument } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown, type = "application/json") {
  const fn = vi.fn(async () => new Response(type === "application/json" ? JSON.stringify(body) : (body as BodyInit), { status, headers: { "content-type": type } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api client", () => {
  it("uploads multipart", async () => {
    const fn = mockFetch(201, { doc_id: "x", sha256: "s", page_count: 1 });
    const res = await uploadDocument(new Blob(["%PDF"]), "a.pdf");
    expect(res.doc_id).toBe("x");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/documents");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("maps error bodies to ApiError", async () => {
    mockFetch(410, { error: { code: "doc_expired", message: "gone" } });
    await expect(getStructure("x")).rejects.toMatchObject({ code: "doc_expired", status: 410 });
  });

  it("keeps extra error fields", async () => {
    mockFetch(500, { error: { code: "bake_failed", message: "m", op_id: "o1" } });
    try {
      await exportPdf("x", { ops: [], flatten_forms: false, filename: "a.pdf" });
      throw new Error("should fail");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).extra.op_id).toBe("o1");
    }
  });

  it("maps network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fail"); }));
    await expect(getStructure("x")).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("returns blob for export", async () => {
    mockFetch(200, "%PDF-1.7", "application/pdf");
    const blob = await exportPdf("x", { ops: [], flatten_forms: false, filename: "a.pdf" });
    expect(await blob.text()).toBe("%PDF-1.7");
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL.

- [ ] **Step 2: api.ts**

`apps/web/src/lib/api.ts`:
```ts
import type { ExportRequest, RenderPageRequest } from "@edith/ops";
import type { StructurePage } from "@/store/editor";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public code: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}

export interface UploadResult { doc_id: string; sha256: string; page_count: number }
export interface Structure { doc_id: string; sha256: string; page_count: number; pages: StructurePage[] }

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError("network", 0);
  }
  if (!res.ok) {
    let err: Record<string, unknown> = {};
    try { err = ((await res.json()) as { error?: Record<string, unknown> }).error ?? {}; } catch { /* not JSON */ }
    throw new ApiError(String(err.code ?? "generic"), res.status, err);
  }
  return res;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function uploadDocument(file: File | Blob, name = "document.pdf"): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, name);
  return (await request("/documents", { method: "POST", body: form })).json();
}

export async function getStructure(docId: string): Promise<Structure> {
  return (await request(`/documents/${docId}/structure`)).json();
}

export function fileUrl(docId: string): string {
  return `${API_URL}/documents/${docId}/file`;
}

export async function uploadAsset(docId: string, file: Blob) {
  const form = new FormData();
  form.append("file", file, "asset");
  return (await request(`/documents/${docId}/assets`, { method: "POST", body: form })).json() as Promise<{ asset_id: string; width: number; height: number }>;
}

export function assetUrl(docId: string, assetId: string): string {
  return `${API_URL}/documents/${docId}/assets/${assetId}`;
}

export async function exportPdf(docId: string, body: ExportRequest): Promise<Blob> {
  return (await request(`/documents/${docId}/export`, json(body))).blob();
}

export async function renderPage(docId: string, body: RenderPageRequest): Promise<Blob> {
  return (await request(`/documents/${docId}/render-page`, json(body))).blob();
}
```

`apps/web/.env.example`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Run: `npm test -w apps/web` → Expected: PASS.

- [ ] **Step 3: Theme + layout**

Replace `apps/web/src/app/globals.css` with:
```css
@import "tailwindcss";

:root {
  --bg: #f6f7f9;
  --surface: #ffffff;
  --ink: #16181d;
  --muted: #5b6270;
  --line: #e3e6eb;
  --accent: #0f766e;
  --accent-ink: #ffffff;
  --danger: #c2410c;
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-danger: var(--danger);
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}

body { background: var(--bg); color: var(--ink); }
```

Replace `apps/web/src/app/layout.tsx` with:
```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = { title: "Edith — Editor PDF", description: "Edit PDF langsung di browser" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Dropzone + page**

`apps/web/src/components/UploadDropzone.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ApiError, uploadDocument } from "@/lib/api";
import { errorMessage, t } from "@/lib/strings";

const MAX_BYTES = 50 * 1024 * 1024;

export function UploadDropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) return setError(errorMessage("too_large"));
    setBusy(true);
    try {
      const res = await uploadDocument(file, file.name);
      router.push(`/edit/${res.doc_id}?name=${encodeURIComponent(file.name)}`);
    } catch (e) {
      setError(errorMessage(e instanceof ApiError ? e.code : "generic"));
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="dropzone"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files[0]); }}
      className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition ${over ? "border-accent bg-accent/5" : "border-line bg-surface"}`}
    >
      {busy ? (
        <p className="text-muted" role="status">{t.upload.processing}</p>
      ) : (
        <>
          <p className="text-lg font-medium">{t.upload.drop}</p>
          <p className="text-sm text-muted">{t.upload.or}</p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-ink hover:opacity-90"
          >
            {t.upload.choose}
          </button>
          <p className="text-xs text-muted">{t.upload.limit}</p>
        </>
      )}
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => handle(e.target.files?.[0])} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
```

Replace `apps/web/src/app/page.tsx` with:
```tsx
import { UploadDropzone } from "@/components/UploadDropzone";
import { t } from "@/lib/strings";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <p className="text-sm font-semibold tracking-wide text-accent">{t.appName}</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{t.upload.title}</h1>
        <p className="mt-2 text-muted">{t.tagline}</p>
      </div>
      <UploadDropzone />
    </main>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run build -w apps/web`
Expected: all succeed.

Manual: run API (`npm run dev:api`) and web (`npm run dev:web`), open http://localhost:3000, upload a PDF → browser navigates to `/edit/<id>?name=...` (404 page for now is expected).

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add API client and upload page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
