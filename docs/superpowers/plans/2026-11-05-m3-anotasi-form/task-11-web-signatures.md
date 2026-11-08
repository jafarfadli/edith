# Task 11: Signature modal (draw, type, upload) and the browser signature library

**Tanda Tangan** opens a modal with tabs Gambar (draw with the pointer, 3 colors), Ketik (name in one of the 4 bundled script fonts, 3 colors) and Unggah (PNG/JPEG, scaled to ≤ 900 × 300 px). Every kind becomes a transparent PNG rendered in the browser (typed text is drawn on a canvas with the same `FontFace` the editor loads, cropped to its ink), uploaded as an asset of the open document and placed 160 pt wide (≤ 80 pt tall) in the middle of the page in view as `signature.add`. With "Simpan tanda tangan" ticked (default) it is also saved in `localStorage["edith:signatures"]` (max 5, newest first, duplicates collapsed; a PNG over 400 000 data-URL characters is used but not saved, with a notice). Saved signatures are listed at the top of the modal ("Pakai tanda tangan", ✕ to remove).

**Files:**
- Modify: `apps/web/src/components/editor/Toolbar.tsx`
- Create: `apps/web/src/components/editor/marks/SignatureModal.tsx`
- Create: `apps/web/src/components/editor/marks/signatureCanvas.ts`
- Create: `apps/web/src/lib/signatures.test.ts`
- Create: `apps/web/src/lib/signatures.ts`

**Interfaces:**
- Consumes: Task 10 `currentPage`, `placeObject`; M1 `uploadAsset`; M2 `fontStore.load`, `cssFamily`; Task 6 strings.
- Produces:
  - `lib/signatures.ts`: `SavedSignature {id, dataUrl, width, height}`, `SIGNATURE_KEY`, `MAX_SIGNATURES = 5`, `MAX_DATA_URL = 400000`, `SIGNATURE_FONTS` (Dancing Script, Caveat, Great Vibes, Sacramento), `SIGNATURE_COLORS` (`#111111 #1d4ed8 #b91c1c`), `SIGNATURE_W = 160`, `SIGNATURE_MAX_H = 80`, `loadSignatures(kv?)`, `saveSignature(sig, kv?) -> {saved, list}`, `removeSignature(id, kv?)`, `signatureRect(w, h, page)`, `dataUrlToBlob(dataUrl)` (`kv` = any `getItem`/`setItem` store, default `localStorage`).
  - `components/editor/marks/signatureCanvas.ts`: `SignatureImage`, `scriptFont(family)`, `renderTyped(text, family, color)`, `cropDrawing(canvas)`, `loadUpload(file)`.
  - `marks/SignatureModal.tsx`: `SignatureModal({onClose, onNotice})` (dialog "Tanda tangan"; textbox "Nama Anda"; radios named by font family; button "Tambahkan"; library buttons "Pakai tanda tangan").

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/signatures.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dataUrlToBlob, loadSignatures, MAX_DATA_URL, MAX_SIGNATURES, removeSignature, saveSignature, SIGNATURE_KEY, signatureRect, type SavedSignature } from "@/lib/signatures";

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } } as Storage & { data: Map<string, string> };
}
const sig = (id: string, dataUrl = `data:image/png;base64,${id}`): SavedSignature => ({ id, dataUrl, width: 300, height: 100 });

describe("signature library", () => {
  it("keeps the newest first, at most MAX_SIGNATURES, without duplicates", () => {
    const kv = memory();
    for (let i = 0; i < MAX_SIGNATURES + 2; i++) expect(saveSignature(sig(`s${i}`), kv).saved).toBe(true);
    saveSignature(sig("again", "data:image/png;base64,s6"), kv); // same image as s6
    const list = loadSignatures(kv);
    expect(list.map((s) => s.id)).toEqual(["again", "s5", "s4", "s3", "s2"]);
    expect(removeSignature("s4", kv).map((s) => s.id)).toEqual(["again", "s5", "s3", "s2"]);
  });

  it("does not save a signature that is too big, or when storage refuses", () => {
    const kv = memory();
    expect(saveSignature(sig("big", `data:image/png;base64,${"A".repeat(MAX_DATA_URL)}`), kv)).toEqual({ saved: false, list: [] });
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(saveSignature(sig("a"), full).saved).toBe(false);
    expect(saveSignature(sig("a"), null).saved).toBe(false);
  });

  it("ignores broken storage content", () => {
    const kv = memory();
    kv.data.set(SIGNATURE_KEY, "not json");
    expect(loadSignatures(kv)).toEqual([]);
    kv.data.set(SIGNATURE_KEY, JSON.stringify([sig("ok"), { id: "x", dataUrl: "javascript:1", width: 1, height: 1 }, null]));
    expect(loadSignatures(kv).map((s) => s.id)).toEqual(["ok"]);
  });
});

describe("signatureRect", () => {
  const page = { width: 595, height: 842 };
  it("is 160 pt wide for a wide signature, centred", () => {
    expect(signatureRect(600, 200, page)).toEqual({ x: (595 - 160) / 2, y: (842 - 160 / 3) / 2, w: 160, h: 160 / 3 });
  });
  it("is at most 80 pt tall", () => {
    const r = signatureRect(200, 200, page);
    expect([r.w, r.h]).toEqual([80, 80]);
  });
});

describe("dataUrlToBlob", () => {
  it("decodes base64 with its type", async () => {
    const b = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(b.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await b.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd apps/web && npx vitest run src/lib/signatures.test.ts`
Expected: `Cannot find module '@/lib/signatures'`.

- [ ] **Step 3: Implement**

Modify `apps/web/src/components/editor/Toolbar.tsx` (unified diff; the `-`/`+` lines are exact, apply by hand or with `git apply`):
```diff
--- a/apps/web/src/components/editor/Toolbar.tsx
+++ b/apps/web/src/components/editor/Toolbar.tsx
@@ -7,6 +7,7 @@ import { newId } from "@/lib/id";
 import { fitImage } from "@/lib/image";
 import { errorMessage, t } from "@/lib/strings";
 import { editorStore, useEditor, type Tool } from "@/store/editor";
+import { SignatureModal } from "./marks/SignatureModal";
 import { StampPicker } from "./marks/StampPicker";
 import { currentPage, placeObject } from "./placement";
 import { SplitButton } from "./SplitButton";
@@ -30,6 +31,7 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
   const canRedo = useEditor((s) => s.future.length > 0);
   const file = useRef<HTMLInputElement>(null);
   const [stampOpen, setStampOpen] = useState(false);
+  const [signatureOpen, setSignatureOpen] = useState(false);
   const s = editorStore.getState();
   const pick = (x: Tool) => s.setTool(x);
 
@@ -79,6 +81,10 @@ export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
       ]} />
       <ToolButton tool="check" label={t.annot.check} icon="✓" active={tool} />
       <ToolButton tool="cross" label={t.annot.cross} icon="✗" active={tool} />
+      <button aria-label={t.annot.signature} title={t.annot.signature} onClick={() => setSignatureOpen(true)} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
+        <span aria-hidden>✍</span><span className="hidden lg:inline">{t.annot.signature}</span>
+      </button>
+      {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onNotice={onNotice} />}
       <ToolButton tool="note" label={t.annot.note} icon="🗒" active={tool} />
       <ToolButton tool="link" label={t.annot.link} icon="🔗" active={tool} />
     </div>
```

Create `apps/web/src/components/editor/marks/SignatureModal.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { SignatureAdd } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { cssFamily, fontStore } from "@/lib/fonts";
import { newId } from "@/lib/id";
import {
  dataUrlToBlob, loadSignatures, removeSignature, saveSignature, SIGNATURE_COLORS, SIGNATURE_FONTS, signatureRect, type SavedSignature,
} from "@/lib/signatures";
import { errorMessage, t } from "@/lib/strings";
import { editorStore } from "@/store/editor";
import { currentPage, placeObject } from "../placement";
import { cropDrawing, loadUpload, renderTyped, scriptFont, type SignatureImage } from "./signatureCanvas";

type NoticeFn = (n: { kind: "error" | "info"; text: string }) => void;
type Tab = "draw" | "type" | "upload";
const PAD_W = 480, PAD_H = 160;

/** Uploads `img` as an asset of the open document and places it on the page in view, selected. */
async function placeSignature(img: SignatureImage): Promise<void> {
  const st = editorStore.getState();
  const at = currentPage();
  if (!st.info || !at) return;
  const asset = await uploadAsset(st.info.docId, dataUrlToBlob(img.dataUrl));
  const op: SignatureAdd = { id: newId(), type: "signature.add", pageKey: at.entry.pageKey, rect: signatureRect(img.width, img.height, at.geom), assetId: asset.asset_id };
  placeObject(op);
}

function Colors({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label={t.editor.color} className="flex gap-1">
      {SIGNATURE_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={t.signature.colors[c]} onClick={() => onChange(c)}
          className={`h-6 w-6 rounded-full ring-1 ring-line ${value === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
      ))}
    </div>
  );
}

function DrawPad({ color, canvasRef }: { color: string; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const last = useRef<[number, number] | null>(null);
  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) * PAD_W) / r.width, ((e.clientY - r.top) * PAD_H) / r.height];
  };
  return (
    <canvas ref={canvasRef} width={PAD_W} height={PAD_H} data-testid="signature-pad"
      className="w-full touch-none rounded-md bg-white ring-1 ring-line" style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); }}
      onPointerMove={(e) => {
        if (!last.current) return;
        const c = e.currentTarget.getContext("2d")!;
        const p = at(e);
        c.strokeStyle = color; c.lineWidth = 3; c.lineCap = "round"; c.lineJoin = "round";
        c.beginPath(); c.moveTo(...last.current); c.lineTo(...p); c.stroke();
        last.current = p;
      }}
      onPointerUp={() => { last.current = null; }} />
  );
}

/** Tanda tangan: draw, type (4 script fonts, 3 colors) or upload; optionally keep it in this browser's library. */
export function SignatureModal({ onClose, onNotice }: { onClose: () => void; onNotice: NoticeFn }) {
  const [tab, setTab] = useState<Tab>("type");
  const [color, setColor] = useState<string>(SIGNATURE_COLORS[0]);
  const [name, setName] = useState("");
  const [family, setFamily] = useState<string>(SIGNATURE_FONTS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedSignature[]>(() => loadSignatures());
  const pad = useRef<HTMLCanvasElement>(null);

  useEffect(() => { SIGNATURE_FONTS.forEach((f) => { fontStore.load(scriptFont(f)).catch(() => {}); }); }, []);

  async function run(make: () => Promise<SignatureImage | null>, keep: boolean) {
    setBusy(true);
    try {
      const img = await make();
      if (!img) return;
      if (keep && !saveSignature({ id: newId(), ...img }).saved) onNotice({ kind: "info", text: t.signature.tooBig });
      await placeSignature(img);
      onClose();
    } catch (e) {
      onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
    } finally {
      setBusy(false);
    }
  }

  function make(): Promise<SignatureImage | null> {
    if (tab === "type") return name.trim() ? renderTyped(name.trim(), family, color) : Promise.resolve(null);
    if (tab === "draw") return Promise.resolve(pad.current ? cropDrawing(pad.current) : null);
    return file ? loadUpload(file) : Promise.resolve(null);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-20" onPointerDown={onClose}>
      <div role="dialog" aria-label={t.signature.title} data-testid="signature-modal" onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}
        className="flex w-[34rem] flex-col gap-3 rounded-xl bg-surface p-4 text-sm shadow-xl ring-1 ring-line">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t.signature.title}</span>
          <div className="flex-1" />
          <button aria-label={t.editor.close} onClick={onClose} className="rounded-md px-2 py-1 hover:bg-bg">✕</button>
        </div>
        {saved.length > 0 && (
          <section aria-label={t.signature.saved} className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t.signature.saved}</span>
            <div className="flex flex-wrap gap-2">
              {saved.map((sig) => (
                <div key={sig.id} className="relative">
                  <button aria-label={t.signature.use} disabled={busy} onClick={() => run(async () => sig, false)}
                    className="h-14 w-36 rounded-md bg-white p-1 ring-1 ring-line hover:ring-accent">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from localStorage */}
                    <img src={sig.dataUrl} alt="" className="h-full w-full object-contain" />
                  </button>
                  <button aria-label={t.signature.remove} onClick={() => setSaved(removeSignature(sig.id))}
                    className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-surface text-xs ring-1 ring-line hover:text-danger">✕</button>
                </div>
              ))}
            </div>
          </section>
        )}
        <div role="tablist" className="flex self-start rounded-md ring-1 ring-line">
          {(["draw", "type", "upload"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-1 ${tab === k ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>{t.signature[k]}</button>
          ))}
        </div>
        {tab === "draw" && (
          <div className="flex flex-col gap-2">
            <DrawPad color={color} canvasRef={pad} />
            <div className="flex items-center gap-2">
              <Colors value={color} onChange={setColor} />
              <div className="flex-1" />
              <button type="button" onClick={() => pad.current?.getContext("2d")!.clearRect(0, 0, PAD_W, PAD_H)} className="rounded-md px-2 py-1 hover:bg-bg">{t.signature.clear}</button>
            </div>
          </div>
        )}
        {tab === "type" && (
          <div className="flex flex-col gap-2">
            <input aria-label={t.signature.name} placeholder={t.signature.name} value={name} autoFocus onChange={(e) => setName(e.target.value)}
              className="rounded border border-line px-2 py-1.5" />
            <div role="radiogroup" aria-label={t.signature.font} className="grid grid-cols-2 gap-2">
              {SIGNATURE_FONTS.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={family === f} aria-label={f} onClick={() => setFamily(f)}
                  className={`truncate rounded-md px-2 py-2 text-2xl ring-1 ${family === f ? "ring-accent" : "ring-line"}`}
                  style={{ fontFamily: `"${cssFamily(scriptFont(f))}"`, color }}>
                  {name.trim() || f}
                </button>
              ))}
            </div>
            <Colors value={color} onChange={setColor} />
          </div>
        )}
        {tab === "upload" && (
          <input type="file" accept="image/png,image/jpeg" aria-label={t.signature.upload} data-testid="signature-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        )}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />{t.signature.save}</label>
          <div className="flex-1" />
          <button onClick={() => run(make, save)} disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-accent-ink disabled:opacity-50">{t.signature.add}</button>
        </div>
      </div>
    </div>
  );
}
```

Create `apps/web/src/components/editor/marks/signatureCanvas.ts`:
```ts
"use client";

import type { BundledFont } from "@edith/ops";
import { cssFamily, fontStore } from "@/lib/fonts";

/** A rendered signature image (transparent PNG). */
export interface SignatureImage { dataUrl: string; width: number; height: number }

const TYPED_PX = 96;   // typed signatures are rendered at this font size (px), then scaled down on the page
const PAD = 8;
const MAX_UPLOAD = { w: 900, h: 300 };

export function scriptFont(family: string): BundledFont {
  return { kind: "bundled", family, bold: false, italic: false };
}

/** A typed name in a bundled script font, cropped to its ink (swashes included). */
export async function renderTyped(text: string, family: string, color: string): Promise<SignatureImage> {
  const font = scriptFont(family);
  await fontStore.load(font); // registers the FontFace the canvas draws with
  const css = `${TYPED_PX}px "${cssFamily(font)}"`;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = css;
  const m = probe.measureText(text);
  const left = Math.ceil(m.actualBoundingBoxLeft), right = Math.ceil(m.actualBoundingBoxRight);
  const ascent = Math.ceil(m.actualBoundingBoxAscent), descent = Math.ceil(m.actualBoundingBoxDescent);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, left + right + 2 * PAD);
  canvas.height = Math.max(1, ascent + descent + 2 * PAD);
  const c = canvas.getContext("2d")!;
  c.font = css;
  c.fillStyle = color;
  c.textBaseline = "alphabetic";
  c.fillText(text, PAD + left, PAD + ascent);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/** The drawn part of `canvas` (alpha > 0) plus a margin; null when nothing was drawn. */
export function cropDrawing(canvas: HTMLCanvasElement): SignatureImage | null {
  const c = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const px = c.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const sx = Math.max(0, x0 - PAD), sy = Math.max(0, y0 - PAD);
  const w = Math.min(width, x1 + PAD + 1) - sx, h = Math.min(height, y1 + PAD + 1) - sy;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")!.drawImage(canvas, sx, sy, w, h, 0, 0, w, h);
  return { dataUrl: out.toDataURL("image/png"), width: w, height: h };
}

/** An uploaded PNG/JPEG, scaled down to fit MAX_UPLOAD, as a PNG (keeps transparency). */
export async function loadUpload(file: File): Promise<SignatureImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_UPLOAD.w / bitmap.width, MAX_UPLOAD.h / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
```

Create `apps/web/src/lib/signatures.ts`:
```ts
import type { Rect } from "@edith/ops";

/** A signature kept in this browser's library (spec: pustaka tanda tangan per browser). */
export interface SavedSignature { id: string; dataUrl: string; width: number; height: number }
type KV = Pick<Storage, "getItem" | "setItem">;

export const SIGNATURE_KEY = "edith:signatures";
/** At most this many saved signatures (newest first; the oldest drops out). */
export const MAX_SIGNATURES = 5;
/** A signature PNG larger than this (data URL characters, ≈ 300 KB) is used but not saved. */
export const MAX_DATA_URL = 400_000;
export const SIGNATURE_FONTS = ["Dancing Script", "Caveat", "Great Vibes", "Sacramento"] as const;
export const SIGNATURE_COLORS = ["#111111", "#1d4ed8", "#b91c1c"] as const;
/** Width of a newly placed signature (pt); a tall one is limited to SIGNATURE_MAX_H instead. */
export const SIGNATURE_W = 160;
export const SIGNATURE_MAX_H = 80;

const store = (): KV | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

function valid(v: unknown): v is SavedSignature {
  const s = v as SavedSignature;
  return typeof s === "object" && s !== null && typeof s.id === "string" && typeof s.dataUrl === "string"
    && s.dataUrl.startsWith("data:image/") && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0;
}

export function loadSignatures(kv: KV | null = store()): SavedSignature[] {
  try {
    const raw = kv?.getItem(SIGNATURE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(valid).slice(0, MAX_SIGNATURES) : [];
  } catch {
    return [];
  }
}

function write(list: SavedSignature[], kv: KV | null): boolean {
  try { kv?.setItem(SIGNATURE_KEY, JSON.stringify(list)); return !!kv; } catch { return false; } // quota or blocked
}

/** Saves `sig` first in the library; `saved` is false when it is too big or storage refused it. */
export function saveSignature(sig: SavedSignature, kv: KV | null = store()): { saved: boolean; list: SavedSignature[] } {
  const current = loadSignatures(kv);
  if (sig.dataUrl.length > MAX_DATA_URL) return { saved: false, list: current };
  const list = [sig, ...current.filter((s) => s.id !== sig.id && s.dataUrl !== sig.dataUrl)].slice(0, MAX_SIGNATURES);
  return write(list, kv) ? { saved: true, list } : { saved: false, list: current };
}

export function removeSignature(id: string, kv: KV | null = store()): SavedSignature[] {
  const list = loadSignatures(kv).filter((s) => s.id !== id);
  write(list, kv);
  return list;
}

/** Where a new signature of `w` × `h` px goes: SIGNATURE_W wide (or SIGNATURE_MAX_H tall), centred on the page. */
export function signatureRect(w: number, h: number, page: { width: number; height: number }): Rect {
  const scale = Math.min(SIGNATURE_W / w, SIGNATURE_MAX_H / h, (page.width * 0.8) / w);
  const rw = w * scale, rh = h * scale;
  return { x: (page.width - rw) / 2, y: (page.height - rh) / 2, w: rw, h: rh };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",", 2);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? "application/octet-stream";
  const bin = atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run src/lib/signatures.test.ts`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Full check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: `Tests  201 passed (201)`; tsc prints nothing; eslint reports no problems. API untouched (`cd apps/api && uv run pytest -q` still `295 passed`).

- [ ] **Step 6: Try it in the browser**

Dev app: **Tanda Tangan → Ketik**, type a name, pick Great Vibes, blue, "Tambahkan" → the signature appears selected; open the modal again → it is listed under "Tanda tangan tersimpan"; "Pakai tanda tangan" places it again. **Gambar**: draw, "Tambahkan". **Unggah**: pick a PNG with transparency → no white box on the page. Reload the editor: the library is still there.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/marks/SignatureModal.tsx apps/web/src/components/editor/marks/signatureCanvas.ts apps/web/src/lib/signatures.test.ts apps/web/src/lib/signatures.ts
git commit -m "feat(web): signature modal with draw/type/upload and a per-browser library" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
