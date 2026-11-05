# Task 17: Toolbar, properties bar, image tool, arrow-key nudge

**Files:**
- Create: `apps/web/src/lib/image.ts`, `apps/web/src/lib/image.test.ts`, `apps/web/src/components/editor/Toolbar.tsx`, `apps/web/src/components/editor/SplitButton.tsx`, `apps/web/src/components/editor/PropertiesBar.tsx`, `apps/web/src/components/editor/ColorField.tsx`
- Modify: `apps/web/src/components/editor/Editor.tsx` (toolbar slot, nudge shortcuts)

**Interfaces:**
- Consumes: store (Task 12), `uploadAsset`, `ApiError` (Task 13), `moveOp` (Task 16), `toPage`, `pageGeom` (Tasks 10, 12), `newId`, `t`, `errorMessage`.
- Produces:
  - `lib/image.ts`: `fitImage(pxW: number, pxH: number, pageW: number, pageH: number): { x: number; y: number; w: number; h: number }` — natural size = px × 0.75 pt, shrunk (never enlarged) to fit 50% of the page in both directions, centered.
  - `<Toolbar onNotice={(n) => void} />`: buttons with `aria-label` from `t.editor`: `undo`, `redo`, `select`, `text`, split `erase` (sub: `whiteout`, `redact`), `draw`, `image`, split `shape` (sub: `rect`, `ellipse`, `line`, `arrow`). Tool buttons set `aria-pressed`. Split buttons: main part activates the remembered sub-tool; the `▾` part (`aria-label="<label> pilihan"`) opens a `role="menu"` list.
  - `<PropertiesBar />` (row 2): shows controls for the selected object, or for the active tool when nothing is selected; writes to the object (`updateObject`) or to `style` (`setStyle`). Exposes `export const textPropsSlot: { render?: () => React.ReactNode }` that Task 18 fills for text.
  - Arrow keys move the selected object 1 pt (Shift: 10 pt) in **screen** direction (converted to page coords for rotated pages).

- [ ] **Step 1: Failing test for fitImage**

`apps/web/src/lib/image.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fitImage } from "@/lib/image";

describe("fitImage", () => {
  it("keeps small images at natural size, centered", () => {
    expect(fitImage(100, 40, 600, 800)).toEqual({ x: 262.5, y: 385, w: 75, h: 30 });
  });
  it("shrinks large images to half the page keeping aspect", () => {
    const r = fitImage(4000, 2000, 600, 800);
    expect(r.w).toBeCloseTo(300);
    expect(r.h).toBeCloseTo(150);
    expect(r.x).toBeCloseTo(150);
  });
});
```

Run: `npm test -w apps/web` → Expected: FAIL.

`apps/web/src/lib/image.ts`:
```ts
export function fitImage(pxW: number, pxH: number, pageW: number, pageH: number) {
  const natW = pxW * 0.75, natH = pxH * 0.75;
  const s = Math.min(1, (pageW * 0.5) / natW, (pageH * 0.5) / natH);
  const w = natW * s, h = natH * s;
  return { x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}
```

Run: `npm test -w apps/web` → Expected: PASS.

- [ ] **Step 2: SplitButton + ColorField**

`apps/web/src/components/editor/SplitButton.tsx`:
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Tool } from "@/store/editor";

export interface SplitOption { tool: Tool; label: string; icon: string }

export function SplitButton({ label, options, active, onPick }: {
  label: string; options: SplitOption[]; active: Tool; onPick: (t: Tool) => void;
}) {
  const [memory, setMemory] = useState<SplitOption>(options[0]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.tool === active) ?? memory;
  const pressed = options.some((o) => o.tool === active);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative flex">
      <button aria-label={label} aria-pressed={pressed} title={`${label}: ${current.label}`} onClick={() => onPick(current.tool)}
        className={`flex h-9 items-center gap-1 rounded-l-md px-2 text-sm ${pressed ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>
        <span aria-hidden>{current.icon}</span><span className="hidden lg:inline">{current.label}</span>
      </button>
      <button aria-label={`${label} pilihan`} onClick={() => setOpen((o) => !o)} className="h-9 rounded-r-md px-1 text-xs text-muted hover:bg-bg">▾</button>
      {open && (
        <div role="menu" className="absolute left-0 top-10 z-30 w-40 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
          {options.map((o) => (
            <button key={o.tool} role="menuitem" onClick={() => { setMemory(o); setOpen(false); onPick(o.tool); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg">
              <span aria-hidden>{o.icon}</span>{o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

`apps/web/src/components/editor/ColorField.tsx`:
```tsx
"use client";

const SWATCHES = ["#111111", "#ffffff", "#e11d48", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-8 cursor-pointer rounded border border-line bg-transparent p-0.5" />
      <span className="hidden gap-0.5 xl:flex">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={`${label} ${c}`} onClick={() => onChange(c)}
            className={`h-4 w-4 rounded-full ring-1 ring-line ${value.toLowerCase() === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
        ))}
      </span>
    </label>
  );
}
```

- [ ] **Step 3: Toolbar**

`apps/web/src/components/editor/Toolbar.tsx`:
```tsx
"use client";

import { useRef } from "react";
import type { ContentOp } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { newId } from "@/lib/id";
import { fitImage } from "@/lib/image";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, pageGeom, useEditor, type Tool } from "@/store/editor";
import { SplitButton } from "./SplitButton";

type NoticeFn = (n: { kind: "error" | "info"; text: string }) => void;

function ToolButton({ tool, label, icon, active }: { tool: Tool; label: string; icon: string; active: Tool }) {
  const pressed = active === tool;
  return (
    <button aria-label={label} aria-pressed={pressed} title={label} onClick={() => editorStore.getState().setTool(tool)}
      className={`flex h-9 items-center gap-1 rounded-md px-2 text-sm ${pressed ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>
      <span aria-hidden>{icon}</span><span className="hidden lg:inline">{label}</span>
    </button>
  );
}

export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const file = useRef<HTMLInputElement>(null);
  const s = editorStore.getState();
  const pick = (x: Tool) => s.setTool(x);

  async function addImage(f: File | undefined) {
    const st = editorStore.getState();
    if (!f || !st.info) return;
    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage) ?? st.doc.pages[0];
    try {
      const asset = await uploadAsset(st.info.docId, f);
      const g = pageGeom(entry, st.info);
      const rect = fitImage(asset.width, asset.height, g.width, g.height);
      const op = { id: newId(), type: "image.add", pageKey: entry.pageKey, rect, assetId: asset.asset_id } as ContentOp;
      st.addObject(op);
      st.setTool("select");
      st.select(op.id);
    } catch (e) {
      onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-3" role="toolbar" aria-label="Alat">
      <button aria-label={t.editor.undo} title={t.editor.undo} disabled={!canUndo} onClick={() => s.undo()} className="h-9 rounded-md px-2 hover:bg-bg disabled:opacity-40">↶</button>
      <button aria-label={t.editor.redo} title={t.editor.redo} disabled={!canRedo} onClick={() => s.redo()} className="h-9 rounded-md px-2 hover:bg-bg disabled:opacity-40">↷</button>
      <span className="mx-2 h-6 w-px bg-line" />
      <ToolButton tool="select" label={t.editor.select} icon="↖" active={tool} />
      <ToolButton tool="text" label={t.editor.text} icon="T" active={tool} />
      <SplitButton label={t.editor.erase} active={tool} onPick={pick} options={[
        { tool: "whiteout", label: t.editor.whiteout, icon: "▭" },
        { tool: "redact", label: t.editor.redact, icon: "▮" },
      ]} />
      <ToolButton tool="ink" label={t.editor.draw} icon="✎" active={tool} />
      <button aria-label={t.editor.image} title={t.editor.image} onClick={() => file.current?.click()} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
        <span aria-hidden>🖼</span><span className="hidden lg:inline">{t.editor.image}</span>
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg" hidden data-testid="image-input" onChange={(e) => addImage(e.target.files?.[0])} />
      <SplitButton label={t.editor.shape} active={tool} onPick={pick} options={[
        { tool: "rect", label: t.editor.rect, icon: "□" },
        { tool: "ellipse", label: t.editor.ellipse, icon: "○" },
        { tool: "line", label: t.editor.line, icon: "╱" },
        { tool: "arrow", label: t.editor.arrow, icon: "→" },
      ]} />
    </div>
  );
}
```

- [ ] **Step 4: PropertiesBar**

`apps/web/src/components/editor/PropertiesBar.tsx`:
```tsx
"use client";

import type { ContentOp } from "@edith/ops";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { ColorField } from "./ColorField";

export const textPropsSlot: { render?: () => React.ReactNode } = {};

type Kind = "shape" | "line" | "ink" | "redact" | "text" | null;

function kindOf(op: ContentOp | undefined, tool: string): Kind {
  if (op) {
    if (op.type === "shape.add") return (op as { kind: string }).kind === "line" || (op as { kind: string }).kind === "arrow" ? "line" : "shape";
    if (op.type === "ink.add") return "ink";
    if (op.type === "redact.add") return "redact";
    if (op.type === "text.add") return "text";
    return null;
  }
  if (tool === "rect" || tool === "ellipse") return "shape";
  if (tool === "line" || tool === "arrow") return "line";
  if (tool === "ink") return "ink";
  if (tool === "redact") return "redact";
  if (tool === "text") return "text";
  return null;
}

export function PropertiesBar() {
  const selection = useEditor((s) => s.selection);
  const op = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
  const tool = useEditor((s) => s.tool);
  const style = useEditor((s) => s.style);
  const kind = kindOf(op, tool);
  const o = op as (ContentOp & Record<string, unknown>) | undefined;
  const s = editorStore.getState();

  const stroke = (o?.type === "ink.add" ? (o.color as string) : (o?.stroke as string | undefined)) ?? style.stroke;
  const width = (o?.width as number | undefined) ?? style.width;
  const fill = o ? ((o.fill as string | null | undefined) ?? null) : style.fill;

  function set(patch: { stroke?: string; width?: number; fill?: string | null; redactFill?: "black" | "white" }) {
    if (o) {
      const p: Record<string, unknown> = {};
      if (patch.stroke !== undefined) p[o.type === "ink.add" ? "color" : "stroke"] = patch.stroke;
      if (patch.width !== undefined) p.width = patch.width;
      if (patch.fill !== undefined) p.fill = patch.fill;
      if (patch.redactFill !== undefined) p.fill = patch.redactFill;
      s.updateObject(o.id, p as Partial<ContentOp>);
    } else {
      const { redactFill: _ignored, ...rest } = patch;
      s.setStyle(rest);
    }
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface px-3 text-sm" aria-label="Properti">
      {(kind === "shape" || kind === "line" || kind === "ink") && (
        <>
          <ColorField label={t.editor.color} value={stroke} onChange={(v) => set({ stroke: v })} />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            {t.editor.strokeWidth}
            <input type="range" min={kind === "shape" ? 0 : 1} max={20} step={0.5} value={width} aria-label={t.editor.strokeWidth}
              onChange={(e) => set({ width: Number(e.target.value) })} className="w-24 accent-[var(--accent)]" />
            <span className="w-8 tabular-nums text-ink">{width}</span>
          </label>
        </>
      )}
      {kind === "shape" && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={fill === null} onChange={(e) => set({ fill: e.target.checked ? null : "#ffffff" })} />
            {t.editor.noFill}
          </label>
          {fill !== null && <ColorField label={t.editor.fill} value={fill} onChange={(v) => set({ fill: v })} />}
        </div>
      )}
      {kind === "redact" && o && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t.editor.fill}
          <select value={o.fill as string} onChange={(e) => set({ redactFill: e.target.value as "black" | "white" })} className="rounded border border-line px-1 py-0.5 text-ink">
            <option value="black">Hitam</option>
            <option value="white">Putih</option>
          </select>
        </label>
      )}
      {kind === "text" && textPropsSlot.render?.()}
      <div className="flex-1" />
      {selection && (
        <button onClick={() => s.deleteObject(selection)} aria-label={t.editor.delete} className="rounded-md px-2 py-1 text-danger hover:bg-danger/10">
          🗑 {t.editor.delete}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire into Editor + nudge**

In `Editor.tsx`:
- Replace the toolbar placeholder `<div className="h-12 ..." data-slot="toolbar" />` with:
```tsx
<Toolbar onNotice={setNotice} />
<PropertiesBar />
```
- Imports: `Toolbar`, `PropertiesBar`, `moveOp` from `@/lib/objects`, `toPage` from `@/lib/coords`, `pageGeom` from `@/store/editor`, `useCallback`.
- Replace `useShortcuts();` with:
```tsx
const nudge = useCallback((e: KeyboardEvent) => {
  const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const d = dirs[e.key];
  const st = editorStore.getState();
  if (!d || !st.selection || !st.info) return false;
  const op = st.doc.objects[st.selection];
  const entry = st.doc.pages.find((p) => p.pageKey === op?.pageKey);
  if (!op || !entry) return false;
  e.preventDefault();
  const step = e.shiftKey ? 10 : 1;
  const g = pageGeom(entry, st.info);
  const [x0, y0] = toPage([0, 0], g, 1);
  const [x1, y1] = toPage([d[0] * step, d[1] * step], g, 1);
  st.updateObject(op.id, moveOp(op, x1 - x0, y1 - y0));
  return true;
}, []);
useShortcuts(nudge);
```

- [ ] **Step 6: Verify**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run build -w apps/web` → succeed.

Manual (API + web running), on a PDF with a page rotated 90°:
1. Hapus ▾ → Redaksi, drag over text → black translucent box; Unduh → text gone in downloaded PDF (cannot be selected/searched).
2. Bentuk ▾ → Panah, drag → arrow; change color + thickness in row 2 → arrow updates; Ctrl+Z reverts.
3. Gambar Bebas → draw two strokes → both stay, tool remains active.
4. Gambar → pick a PNG → appears centered on the current page, selected; resize via handles.
5. Select an object, press → and Shift+↓ → moves right/down on screen even on the rotated page.
6. Unduh → every object appears in the PDF at the same place as on screen.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): add toolbar, properties bar, image tool and keyboard nudge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
