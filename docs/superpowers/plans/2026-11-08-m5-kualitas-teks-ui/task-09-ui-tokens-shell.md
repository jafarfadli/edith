# Task 9: Dark design system, line icons and the app shell (one top bar, floating properties bar)

> Part of the M5 plan — read `README.md` in this folder first (Global Constraints, Decisions, Owner decisions, **Design system**). Code below was run in a throwaway worktree; modified files are unified diffs against the state the previous task leaves, new files and full rewrites are complete.

**Goal:** Owner feedback 5 ("stylenya jelek banget dan ai slop"): the first of four redesign tasks. It introduces the design tokens (dark panels, neutral grey canvas, one electric-blue accent, Geist type, a dense type scale, elevation), lucide line icons with one size/stroke, a tooltip with shortcut key caps, and the new shell:

- **One 48 px top bar** instead of header + toolbar + empty second row: wordmark · file name · the tool groups (icon-only, 32 px, grouped by separators: history | select/text/erase | markup/draw/shape | image/signature/symbols | pages/crop) · Cari · Ratakan form · **Unduh** (the one filled accent button).
- **Split buttons** keep "last used" + a chevron menu, now rendered in a portal: the old absolutely positioned menu sat inside the toolbar's `overflow-x-auto` and was clipped (it opened invisibly; the E2E clicks still worked).
- **The properties bar floats** over the top of the canvas (no layout shift when it appears) and is **not rendered when empty** (Pilih with nothing selected).
- The zoom pill moves into the canvas area (centred on the pages, not the window).

Later tasks restyle the rest (Task 10), add hints and tool keys (Task 11) and the start page (Task 12). Until Task 12 the old token names `--bg`/`--surface` stay as aliases so not-yet-restyled components keep working.

**Files:**
- Modify: `apps/web/package.json`, `package-lock.json` (`lucide-react` 1.61.0, exact)
- Rewrite: `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx` (Inter → Geist + Geist Mono)
- Create: `apps/web/src/lib/keys.ts`, `apps/web/src/lib/keys.test.ts`
- Create: `apps/web/src/components/ui/icon.ts`, `apps/web/src/components/ui/Tooltip.tsx`, `apps/web/src/components/ui/IconButton.tsx`
- Rewrite: `apps/web/src/components/editor/Header.tsx`, `Toolbar.tsx`, `SplitButton.tsx`, `ZoomPill.tsx`
- Modify: `apps/web/src/components/editor/Editor.tsx`, `PropertiesBar.tsx`, `PageList.tsx`, `forms/FormLayer.tsx`

**Interfaces:**
- Consumes: Task 8's `Header` download logic (kept verbatim), `NoticeMsg`.
- Produces (used by Tasks 10–13):
  - Tailwind colours `base panel raised canvas hover line line-strong ink muted faint accent accent-hover accent-text accent-ink danger danger-text warn paper paper-ink`; text sizes `2xs xs sm(13px) base(15px)`; shadows `shadow-pop shadow-modal shadow-page`; fonts `font-sans` (Geist) / `font-mono` (Geist Mono).
  - `ICON` (`size 16, strokeWidth 1.75, aria-hidden`) and `ICON_SM` (14) in `components/ui/icon.ts` — spread into every lucide icon.
  - `<Tip label keys? side?>` and `<Kbd keys>` in `components/ui/Tooltip.tsx` (portal, 500 ms hover delay, instant on keyboard focus); `formatKeys(spec, mac)` / `isMac()` in `lib/keys.ts` (`"Mod+Shift+Z"` → `⌘ ⇧ Z` / `Ctrl Shift Z`).
  - `<IconButton label icon keys? pressed? disabled? onClick>` in `components/ui/IconButton.tsx`.
  - `SplitOption = { tool?, key?, label, icon: LucideIcon, run?, keys? }` (icon is now a component, not an emoji).
  - `<Header onNotice>{children}</Header>` renders the top bar with `children` (the `<Toolbar>`) in the middle.
  - `PropertiesBar` returns `null` when empty and carries `data-testid="properties-bar"`; it is absolutely positioned inside the canvas wrapper (`relative` div around `#page-scroller`).
- Every aria-label / data-testid used by the E2E tests is unchanged (icon-only buttons keep their names as `aria-label`).

- [ ] **Step 1: Dependency**

Run: `npm install -w apps/web --save-exact lucide-react@1.61.0`
Expected: `apps/web/package.json` gains `"lucide-react": "1.61.0"`.

```diff
diff --git a/apps/web/package.json b/apps/web/package.json
index 2e6483f..a29540a 100644
--- a/apps/web/package.json
+++ b/apps/web/package.json
@@ -28,6 +28,7 @@
     "@tiptap/react": "^3.32.3",
     "fontkit": "^2.0.4",
     "konva": "^10.9.1",
+    "lucide-react": "1.61.0",
     "next": "16.4.5",
     "pdfjs-dist": "^6.5.438",
     "react": "19.3.0",
```

- [ ] **Step 2: Write the failing test (shortcut key caps)**

```ts
import { describe, expect, it } from "vitest";
import { formatKeys } from "@/lib/keys";

describe("formatKeys", () => {
  it("writes Mod as Ctrl off the Mac", () => {
    expect(formatKeys("Mod+Z", false)).toEqual(["Ctrl", "Z"]);
    expect(formatKeys("Mod+Shift+Z", false)).toEqual(["Ctrl", "Shift", "Z"]);
  });

  it("uses the Mac symbols on the Mac", () => {
    expect(formatKeys("Mod+Z", true)).toEqual(["⌘", "Z"]);
    expect(formatKeys("Mod+Shift+Z", true)).toEqual(["⌘", "⇧", "Z"]);
    expect(formatKeys("Alt+X", true)).toEqual(["⌥", "X"]);
  });

  it("single keys stay as they are", () => {
    expect(formatKeys("V", true)).toEqual(["V"]);
    expect(formatKeys("Esc", false)).toEqual(["Esc"]);
  });
});
```

Run: `npx vitest run src/lib/keys.test.ts` (from `apps/web`)
Expected: FAIL — `Failed to resolve import "@/lib/keys"`.

- [ ] **Step 3: Tokens and fonts**

```css
/* Hallmark · genre: modern-minimal (dark tool) · theme: custom "dark design app" · accent hue: 262 (electric blue)
 * paper band: dark · type: Geist (single sans family) + Geist Mono for numbers and shortcut keys
 */
@import "tailwindcss";

:root {
  color-scheme: dark;

  /* Surfaces: neutral greys with a trace of the accent hue; a higher surface is lighter. */
  --base: oklch(19% 0.005 260);          /* behind everything (landing page) */
  --panel: oklch(22.5% 0.006 260);       /* top bar, sidebar, context bar */
  --raised: oklch(27% 0.007 260);        /* menus, popovers, dialogs, tooltips */
  --canvas: oklch(32% 0.004 260);        /* the grey area the pages sit on */
  --hover: oklch(98% 0.003 260 / 0.07);  /* hover overlay on any surface */
  --line: oklch(31% 0.007 260);          /* hairlines between panels */
  --line-strong: oklch(40% 0.008 260);   /* control borders */

  /* Text. */
  --ink: oklch(95% 0.004 260);
  --muted: oklch(72% 0.01 260);
  --faint: oklch(57% 0.01 260);

  /* The one accent: fills (white text on it ≥ 4.5:1), text and icons on dark, selection on the white page. */
  --accent: oklch(57% 0.22 262);
  --accent-hover: oklch(62% 0.21 262);
  --accent-text: oklch(76% 0.13 258);
  --accent-ink: oklch(99% 0.003 260);

  /* Status. */
  --danger: oklch(65% 0.2 22);
  --danger-text: oklch(74% 0.15 22);
  --warn: oklch(80% 0.15 75);

  /* The PDF page and what the editor draws on it (always light). */
  --paper: oklch(100% 0 0);
  --paper-ink: oklch(20% 0.005 260);

  /* Legacy names (M1–M4 components); Task 10 moves every component to the names above and removes these. */
  --bg: var(--canvas);
  --surface: var(--panel);
}

@theme inline {
  --color-base: var(--base);
  --color-panel: var(--panel);
  --color-raised: var(--raised);
  --color-canvas: var(--canvas);
  --color-hover: var(--hover);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-faint: var(--faint);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-text: var(--accent-text);
  --color-accent-ink: var(--accent-ink);
  --color-danger: var(--danger);
  --color-danger-text: var(--danger-text);
  --color-warn: var(--warn);
  --color-paper: var(--paper);
  --color-paper-ink: var(--paper-ink);
  --color-bg: var(--bg);
  --color-surface: var(--surface);

  --font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;

  /* Type scale for a dense tool UI: 11 · 12 · 13 (base) · 15 · 20 · display. */
  --text-2xs: 0.6875rem;
  --text-2xs--line-height: 1rem;
  --text-xs: 0.75rem;
  --text-xs--line-height: 1rem;
  --text-sm: 0.8125rem;
  --text-sm--line-height: 1.25rem;
  --text-base: 0.9375rem;
  --text-base--line-height: 1.5rem;

  /* Elevation on dark: a hairline ring plus a soft, deep shadow. */
  --shadow-pop: 0 0 0 1px var(--line-strong), 0 8px 24px oklch(0% 0 0 / 0.45);
  --shadow-modal: 0 0 0 1px var(--line-strong), 0 24px 64px oklch(0% 0 0 / 0.6);
  --shadow-page: 0 1px 2px oklch(0% 0 0 / 0.35), 0 4px 16px oklch(0% 0 0 / 0.25);

  --ease-out: cubic-bezier(0.2, 0, 0, 1);
}

html, body { overflow-x: clip; }
body { background: var(--panel); color: var(--ink); }

/* One focus ring everywhere, shown instantly. */
:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 1px; }

/* Native controls on dark surfaces. */
select option { background: var(--raised); color: var(--ink); }
input[type="range"], input[type="checkbox"], input[type="radio"] { accent-color: var(--accent); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = { title: "Edith — Editor PDF", description: "Edit PDF langsung di browser" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="font-sans text-sm antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Icons, key caps, tooltip, icon button**

```ts
/** Keyboard shortcuts as shown in tooltips and menus: `Mod` is ⌘ on the Mac and Ctrl elsewhere. */
const MAC: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃" };
const OTHER: Record<string, string> = { Mod: "Ctrl" };

/** The keys of a shortcut such as "Mod+Shift+Z", one entry per key cap. */
export function formatKeys(spec: string, mac: boolean): string[] {
  const names = mac ? MAC : OTHER;
  return spec.split("+").map((k) => names[k] ?? k);
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
```

```ts
/** Every icon in the app is a lucide line icon at one size and stroke (spread these props). */
export const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
export const ICON_SM = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;
```

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatKeys, isMac } from "@/lib/keys";

/** Hover shows the tip after this delay; keyboard focus shows it at once. */
const HOVER_DELAY_MS = 500;
const EDGE = 8;

export function Kbd({ keys }: { keys: string }) {
  const mac = isMac();
  return (
    <span className="flex gap-0.5">
      {formatKeys(keys, mac).map((k, i) => (
        <kbd key={i} className="min-w-4 rounded-sm bg-hover px-1 text-center font-mono text-2xs leading-4 text-muted">{k}</kbd>
      ))}
    </span>
  );
}

/** A tooltip (label + shortcut keys) under or over its child. It renders in a portal with fixed positioning, so the
 *  scrolling toolbar cannot clip it; it hides on press, scroll, Escape and when the pointer or focus leaves. */
export function Tip({ label, keys, side = "bottom", children }: {
  label: string; keys?: string; side?: "bottom" | "top"; children: React.ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(Math.max(r.left + r.width / 2, EDGE + 60), window.innerWidth - EDGE - 60);
    setAt({ x, y: side === "bottom" ? r.bottom + 6 : r.top - 6 });
  };
  const hide = () => { clearTimeout(timer.current); setAt(null); };

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("keydown", onKey); };
  }, [at]);

  return (
    <span
      ref={anchor}
      className="inline-flex"
      onPointerEnter={(e) => { if (e.pointerType === "mouse") { clearTimeout(timer.current); timer.current = setTimeout(show, HOVER_DELAY_MS); } }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => { if ((e.target as HTMLElement).matches(":focus-visible")) show(); }}
      onBlur={hide}
    >
      {children}
      {at && createPortal(
        <div role="tooltip"
          className={`pointer-events-none fixed z-[60] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-md bg-raised px-2 py-1 text-xs text-ink shadow-pop ${side === "top" ? "-translate-y-full" : ""}`}
          style={{ left: at.x, top: at.y }}>
          {label}
          {keys && <Kbd keys={keys} />}
        </div>,
        document.body,
      )}
    </span>
  );
}
```

```tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { ICON } from "./icon";
import { Tip } from "./Tooltip";

/** A square icon button with a tooltip; `pressed` marks the active tool. */
export function IconButton({ label, icon: Icon, keys, pressed, disabled, onClick }: {
  label: string; icon: LucideIcon; keys?: string; pressed?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <Tip label={label} keys={keys}>
      <button aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:text-faint/60 ${pressed ? "bg-accent/20 text-accent-text" : "text-muted hover:bg-hover hover:text-ink"}`}>
        <Icon {...ICON} />
      </button>
    </Tip>
  );
}
```

- [ ] **Step 5: Top bar, tool groups, split buttons, zoom pill**

```tsx
"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/lib/strings";
import type { Tool } from "@/store/editor";
import { ICON } from "../ui/icon";
import { Kbd, Tip } from "../ui/Tooltip";

/** A sub-tool (`tool`) or an action (`run`, e.g. "upload an image"); actions need a `key`. `keys`: its shortcut. */
export interface SplitOption { tool?: Tool; key?: string; label: string; icon: LucideIcon; run?: () => void; keys?: string }

const keyOf = (o: SplitOption) => o.tool ?? o.key ?? o.label;
const MENU_WIDTH = 208;

/** A tool group: the button runs the last used option, the chevron opens a menu of all of them. The menu renders in
 *  a portal (the toolbar scrolls horizontally and would clip it) and closes on an outside press, Escape, scroll or resize. */
export function SplitButton({ label, options, active, onPick }: {
  label: string; options: SplitOption[]; active: Tool; onPick?: (t: Tool) => void;
}) {
  const [memory, setMemory] = useState<SplitOption>(options[0]);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.tool !== undefined && o.tool === active) ?? memory;
  const pressed = options.some((o) => o.tool !== undefined && o.tool === active);
  const choose = (o: SplitOption) => { if (o.run) o.run(); else if (o.tool) onPick?.(o.tool); };
  const open = at !== null;
  const Icon = current.icon;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !menu.current?.contains(target)) setAt(null);
    };
    const dismiss = () => setAt(null);
    // Capture phase so opening another menu (which may stop propagation) still closes this one.
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function toggle() {
    if (open) { setAt(null); return; }
    const r = ref.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)) });
  }

  const tone = pressed ? "bg-accent/20 text-accent-text" : "text-muted hover:bg-hover hover:text-ink";
  return (
    <div ref={ref} className="flex shrink-0 items-center" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setAt(null); } }}>
      <Tip label={`${label}: ${current.label}`} keys={current.keys}>
        <button aria-label={label} aria-pressed={pressed} onClick={() => choose(current)}
          className={`grid h-8 w-8 place-items-center rounded-l-md transition-colors ${tone}`}>
          <Icon {...ICON} />
        </button>
      </Tip>
      <button aria-label={`${label} ${t.editor.options}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className={`grid h-8 w-4 place-items-center rounded-r-md transition-colors ${pressed ? tone : "text-faint hover:bg-hover hover:text-ink"} aria-expanded:bg-hover aria-expanded:text-ink`}>
        <ChevronDown size={12} strokeWidth={2} aria-hidden />
      </button>
      {at && createPortal(
        <div ref={menu} role="menu" aria-label={label} style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
          onKeyDown={(e) => { if (e.key === "Escape") setAt(null); }}
          className="fixed z-50 rounded-lg bg-raised p-1 text-sm shadow-pop">
          {options.map((o) => {
            const OptIcon = o.icon;
            const on = o.tool !== undefined && o.tool === active;
            return (
              <button key={keyOf(o)} role="menuitem" onClick={() => { setMemory(o); setAt(null); choose(o); }}
                className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-hover ${on ? "text-accent-text" : "text-ink"}`}>
                <OptIcon {...ICON} />
                <span className="flex-1">{o.label}</span>
                {o.keys && <Kbd keys={o.keys} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
```

```tsx
"use client";

import {
  ArrowUpRight, Check, Circle, Cloud, Crop, Eraser, EyeOff, Highlighter, ImagePlus, LayoutGrid, MousePointer2, Pencil, Pentagon,
  Redo2, Signature, Slash, Spline, Square, Stamp, Strikethrough, Type, Underline, Undo2, X, type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import type { ContentOp } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { newId } from "@/lib/id";
import { fitImage } from "@/lib/image";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, useEditor, type Tool } from "@/store/editor";
import { IconButton } from "../ui/IconButton";
import { SignatureModal } from "./marks/SignatureModal";
import { cropStore } from "./pages/cropStore";
import { ManagePagesModal } from "./pages/ManagePagesModal";
import { StampPicker } from "./marks/StampPicker";
import { currentPage, placeObject } from "./placement";
import { SplitButton } from "./SplitButton";
import { afterTextCommitted } from "./text/textEdit";

type NoticeFn = (n: { kind: "error" | "info"; text: string }) => void;

function ToolButton({ tool, label, icon, active }: { tool: Tool; label: string; icon: LucideIcon; active: Tool }) {
  return <IconButton label={label} icon={icon} pressed={active === tool} onClick={() => editorStore.getState().setTool(tool)} />;
}

const Sep = () => <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />;

export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const file = useRef<HTMLInputElement>(null);
  const [stampOpen, setStampOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const pick = (x: Tool) => editorStore.getState().setTool(x);

  async function addImage(f: File | undefined) {
    const st = editorStore.getState();
    const at = currentPage();
    if (!f || !st.info || !at) return;
    try {
      const asset = await uploadAsset(st.info.docId, f);
      const rect = fitImage(asset.width, asset.height, at.size.width, at.size.height);
      placeObject({ id: newId(), type: "image.add", pageKey: at.entry.pageKey, rect, assetId: asset.asset_id } as ContentOp);
    } catch (e) {
      onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center" role="toolbar" aria-label={t.editor.tools}>
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        <IconButton label={t.editor.undo} icon={Undo2} keys="Mod+Z" disabled={!canUndo} onClick={() => afterTextCommitted(() => editorStore.getState().undo())} />
        <IconButton label={t.editor.redo} icon={Redo2} keys="Mod+Shift+Z" disabled={!canRedo} onClick={() => afterTextCommitted(() => editorStore.getState().redo())} />
        <Sep />
        <ToolButton tool="select" label={t.editor.select} icon={MousePointer2} active={tool} />
        <ToolButton tool="text" label={t.editor.text} icon={Type} active={tool} />
        <SplitButton label={t.editor.erase} active={tool} onPick={pick} options={[
          { tool: "whiteout", label: t.editor.whiteout, icon: Eraser },
          { tool: "redact", label: t.editor.redact, icon: EyeOff },
        ]} />
        <Sep />
        <SplitButton label={t.annot.markup} active={tool} onPick={pick} options={[
          { tool: "highlight", label: t.annot.highlight, icon: Highlighter },
          { tool: "underline", label: t.annot.underline, icon: Underline },
          { tool: "strike", label: t.annot.strike, icon: Strikethrough },
        ]} />
        <ToolButton tool="ink" label={t.editor.draw} icon={Pencil} active={tool} />
        <SplitButton label={t.editor.shape} active={tool} onPick={pick} options={[
          { tool: "rect", label: t.editor.rect, icon: Square },
          { tool: "ellipse", label: t.editor.ellipse, icon: Circle },
          { tool: "line", label: t.editor.line, icon: Slash },
          { tool: "arrow", label: t.editor.arrow, icon: ArrowUpRight },
          { tool: "polygon", label: t.editor.polygon, icon: Pentagon },
          { tool: "polyline", label: t.editor.polyline, icon: Spline },
          { tool: "cloud", label: t.editor.cloud, icon: Cloud },
        ]} />
        <Sep />
        <SplitButton label={t.editor.image} active={tool} options={[
          { key: "upload", label: t.annot.uploadImage, icon: ImagePlus, run: () => file.current?.click() },
          { key: "stamp", label: t.annot.stamp, icon: Stamp, run: () => setStampOpen(true) },
        ]} />
        <IconButton label={t.annot.signature} icon={Signature} onClick={() => setSignatureOpen(true)} />
        <ToolButton tool="check" label={t.annot.check} icon={Check} active={tool} />
        <ToolButton tool="cross" label={t.annot.cross} icon={X} active={tool} />
        <Sep />
        <IconButton label={t.pages.manage} icon={LayoutGrid} onClick={() => setPagesOpen(true)} />
        <IconButton label={t.crop.title} icon={Crop} onClick={() => { const at = currentPage(); if (at) cropStore.getState().open(at.entry.pageKey); }} />
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg" hidden data-testid="image-input" onChange={(e) => addImage(e.target.files?.[0])} />
      {stampOpen && <StampPicker onClose={() => setStampOpen(false)} />}
      {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onNotice={onNotice} />}
      {pagesOpen && <ManagePagesModal onClose={() => setPagesOpen(false)} />}
    </div>
  );
}
```

```tsx
"use client";

import { Download, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Op } from "@edith/ops";
import { ApiError, exportPdf } from "@/lib/api";
import { compact, failedOpId } from "@/lib/compact";
import { downloadError, isPdfBlob, openBlob, saveBlob } from "@/lib/download";
import type { NoticeMsg } from "@/lib/notices";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { ICON } from "../ui/icon";
import { IconButton } from "../ui/IconButton";
import { openFind } from "./find/findStore";
import { whenTextCommitted } from "./text/textEdit";

/** The editor's one top bar: wordmark and file name, the tools (`children`), then Cari, Ratakan form and Unduh. */
export function Header({ onNotice, children }: { onNotice: (n: NoticeMsg) => void; children?: React.ReactNode }) {
  const info = useEditor((s) => s.info);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const hasForm = useEditor((s) => (s.info?.fields?.length ?? 0) > 0 || Object.values(s.info?.importFields ?? {}).some((f) => f.length > 0));
  const fileName = name ?? info?.fileName ?? "document.pdf";

  async function download() {
    if (!editorStore.getState().info) return;
    setBusy(true);
    let s = editorStore.getState();
    let sent: Op[] = [];
    try {
      await whenTextCommitted(); // a text box whose fonts were still loading must be in the document first
      s = editorStore.getState();
      if (!s.info) return;
      sent = compact(s.doc, s.info);
      const blob = await exportPdf(s.info.docId, { ops: sent, flatten_forms: hasForm && flatten, filename: fileName });
      if (!(await isPdfBlob(blob))) throw new ApiError("bad_response", 200);
      const name = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
      // A download the browser blocks silently still leaves the notice's "Buka di tab baru" (a fresh click: no popup block).
      const openTab = { label: t.download.openTab, run: () => { if (!openBlob(blob)) onNotice({ kind: "error", text: t.download.blocked }); } };
      if (saveBlob(blob, name) === "blocked") onNotice({ kind: "error", text: t.download.blocked, action: openTab });
      else onNotice({ kind: "info", text: t.download.started(name), action: openTab });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("generic", 0);
      if (err.code === "bake_failed" || err.code === "invalid_op") console.warn(`export ${err.code}:`, err.extra.message);
      else console.warn("export failed:", e);
      const failed = failedOpId(err.code, err.extra, sent);
      if (failed && s.doc.objects[failed]) {
        s.setTool("select");
        s.select(failed);
      }
      const { message, retry } = downloadError(err);
      onNotice({ kind: "error", text: message, action: retry ? { label: t.download.retry, run: () => void download() } : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <Link href="/" className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 font-semibold tracking-tight text-ink hover:bg-hover">
        <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
        {t.appName}
      </Link>
      <input
        aria-label={t.editor.fileName}
        value={fileName}
        onChange={(e) => setName(e.target.value)}
        className="h-8 w-52 min-w-0 shrink truncate rounded-md border border-transparent bg-transparent px-2 text-sm text-muted hover:border-line-strong focus:border-accent focus:text-ink focus:outline-none"
      />
      {children}
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label={t.find.open} icon={Search} keys="Mod+F" disabled={!info} onClick={openFind} />
        {hasForm && (
          <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-hover hover:text-ink" title={t.form.flattenHint}>
            <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
            {t.form.flatten}
          </label>
        )}
        <button
          onClick={download}
          disabled={busy || !info}
          className="ml-1 flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? <LoaderCircle {...ICON} className="animate-spin" /> : <Download {...ICON} />}
          {busy ? t.editor.downloading : t.editor.download}
        </button>
      </div>
    </header>
  );
}
```

```tsx
"use client";

import { ChevronLeft, ChevronRight, Hand, Minus, Plus } from "lucide-react";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { ICON } from "../ui/icon";

export function scrollToPage(pageKey: string) {
  // The page itself, not its thumbnail (which carries the same data-page-key and comes first in the DOM).
  document.querySelector(`[data-testid="page"][data-page-key="${pageKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Page and zoom controls floating at the bottom of the canvas. */
export function ZoomPill() {
  const zoom = useEditor((s) => s.zoom);
  const pages = useEditor((s) => s.doc.pages);
  const current = useEditor((s) => s.currentPage);
  const tool = useEditor((s) => s.tool);
  const idx = Math.max(0, pages.findIndex((p) => p.pageKey === current));
  const go = (d: number) => { const p = pages[idx + d]; if (p) scrollToPage(p.pageKey); };
  const s = editorStore.getState();
  const btn = "grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:text-faint/60";

  return (
    <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-panel p-1 text-xs text-ink shadow-pop">
      <button className={btn} onClick={() => go(-1)} disabled={idx === 0} aria-label={t.editor.prevPage}><ChevronLeft {...ICON} /></button>
      <span data-testid="page-indicator" className="min-w-12 text-center tabular-nums">{pages.length ? idx + 1 : 0}/{pages.length}</span>
      <button className={btn} onClick={() => go(1)} disabled={idx >= pages.length - 1} aria-label={t.editor.nextPage}><ChevronRight {...ICON} /></button>
      <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />
      <button className={btn} onClick={() => s.setZoom(Math.round((zoom - 0.1) * 10) / 10)} aria-label={t.editor.zoomOut}><Minus {...ICON} /></button>
      <span className="min-w-11 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button className={btn} onClick={() => s.setZoom(Math.round((zoom + 0.1) * 10) / 10)} aria-label={t.editor.zoomIn}><Plus {...ICON} /></button>
      <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />
      <button className={`${btn} ${tool === "pan" ? "bg-accent/20 text-accent-text" : ""}`} onClick={() => s.setTool(tool === "pan" ? "select" : "pan")}
        aria-label={t.editor.pan} aria-pressed={tool === "pan"}><Hand {...ICON} /></button>
    </div>
  );
}
```

- [ ] **Step 6: Shell layout, floating properties bar, form fields on the page**

`FormLayer` inputs sit on the white page: they now use `text-paper-ink` (with the dark tokens `text-ink` is near-white). `PageList` gets more top padding so the first page starts below the floating bar.

```diff
diff --git a/apps/web/src/components/editor/Editor.tsx b/apps/web/src/components/editor/Editor.tsx
index 14663b3..82d78a3 100644
--- a/apps/web/src/components/editor/Editor.tsx
+++ b/apps/web/src/components/editor/Editor.tsx
@@ -154,34 +154,35 @@ export function Editor({ docId, initialName }: { docId: string; initialName: str
   }
 
   return (
-    <div className="flex h-dvh flex-col">
-      <Header onNotice={setNotice} />
-      <Toolbar onNotice={setNotice} />
-      <PropertiesBar />
+    <div className="flex h-dvh flex-col bg-panel">
+      <Header onNotice={setNotice}><Toolbar onNotice={setNotice} /></Header>
       <div className="flex min-h-0 flex-1">
-        {pdf ? <Sidebar /> : <aside className="w-48 shrink-0 border-r border-line bg-surface" />}
-        <main
-          className="relative min-w-0 flex-1 overflow-auto bg-bg"
-          id="page-scroller"
-          style={{ cursor: tool === "pan" ? "grab" : undefined }}
-          onPointerDown={(e) => {
-            if (tool !== "pan") return;
-            const el = e.currentTarget;
-            drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
-          }}
-          onPointerMove={(e) => {
-            if (!drag.current || e.buttons !== 1) return;
-            const el = e.currentTarget;
-            el.scrollLeft = drag.current.l - (e.clientX - drag.current.x);
-            el.scrollTop = drag.current.t - (e.clientY - drag.current.y);
-          }}
-          onPointerUp={() => { drag.current = null; }}
-        >
-          {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><SelectionMiniBar {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
-        </main>
+        {pdf ? <Sidebar /> : <aside className="w-48 shrink-0 border-r border-line bg-panel" />}
+        <div className="relative min-w-0 flex-1">
+          <PropertiesBar />
+          <main
+            className="absolute inset-0 overflow-auto bg-canvas"
+            id="page-scroller"
+            style={{ cursor: tool === "pan" ? "grab" : undefined }}
+            onPointerDown={(e) => {
+              if (tool !== "pan") return;
+              const el = e.currentTarget;
+              drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
+            }}
+            onPointerMove={(e) => {
+              if (!drag.current || e.buttons !== 1) return;
+              const el = e.currentTarget;
+              el.scrollLeft = drag.current.l - (e.clientX - drag.current.x);
+              el.scrollTop = drag.current.t - (e.clientY - drag.current.y);
+            }}
+            onPointerUp={() => { drag.current = null; }}
+          >
+            {info && pdf ? <PageList overlay={(a) => <><PageOverlay {...a} /><FormLayer {...a} /><TextEditor {...a} /><SelectionMiniBar {...a} /><CropOverlay {...a} /></>} /> : <p className="p-8 text-muted" role="status">{t.upload.processing}</p>}
+          </main>
+          <ZoomPill />
+        </div>
       </div>
       <FindBar />
-      <ZoomPill />
       {notice && <Notice kind={notice.kind} action={notice.action} onClose={() => setNotice(null)}>{notice.text}</Notice>}
     </div>
   );
```

```diff
diff --git a/apps/web/src/components/editor/PropertiesBar.tsx b/apps/web/src/components/editor/PropertiesBar.tsx
index 5fac883..07d0149 100644
--- a/apps/web/src/components/editor/PropertiesBar.tsx
+++ b/apps/web/src/components/editor/PropertiesBar.tsx
@@ -1,6 +1,7 @@
 "use client";
 
 import type { ContentOp } from "@edith/ops";
+import { Trash2, Undo2 } from "lucide-react";
 import { useStore } from "zustand";
 import type { Dash } from "@/lib/geometry";
 import { hasOpacity, inkWidth, isMarkup, isTextOp, MARKUP_TOOLS, opacityOf, POLY_TOOLS } from "@/lib/objects";
@@ -9,6 +10,7 @@ import { useChars } from "@/store/chars";
 import { editorStore, sourcePage, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
 import { srcKey } from "@/lib/sources";
 import { STAMP_COLORS } from "@/lib/stamps";
+import { ICON } from "../ui/icon";
 import { ColorField } from "./ColorField";
 import { textEditStore } from "./text/textEdit";
 
@@ -107,8 +109,14 @@ export function PropertiesBar() {
     }
   }
 
+  // Hidden when it would be empty (Pilih with nothing selected, Whiteout, a tool without options).
+  const empty = !selection && !showOpacity && !scanned && !noText
+    && (kind === null || (kind === "redact" && !o) || (kind === "stamp" && !o) || (kind === "text" && !editingText && !textPropsSlot.render));
+  if (empty) return null;
+
   return (
-    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface px-3 text-sm" role="group" aria-label={t.editor.properties}>
+    <div role="group" aria-label={t.editor.properties} data-testid="properties-bar"
+      className="absolute left-1/2 top-3 z-30 flex h-10 max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-4 overflow-x-auto whitespace-nowrap rounded-lg bg-panel px-3 text-sm shadow-pop [scrollbar-width:none]">
       {(kind === "shape" || kind === "line" || kind === "ink") && (
         <>
           <ColorField label={t.editor.color} value={stroke} onChange={(v) => set({ stroke: v })} />
@@ -172,12 +180,16 @@ export function PropertiesBar() {
         </label>
       )}
       {kind === "text" && scanned && <span className="text-xs text-muted">{t.text.scanned}</span>}
-      <div className="flex-1" />
       {selection && (
         // Deleting a text.edit op brings the original paragraph back.
-        <button onClick={() => s.deleteObject(selection)} aria-label={op?.type === "text.edit" ? t.text.revert : t.editor.delete} className="rounded-md px-2 py-1 text-danger hover:bg-danger/10">
-          🗑 {op?.type === "text.edit" ? t.text.revert : t.editor.delete}
-        </button>
+        <>
+          <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
+          <button onClick={() => s.deleteObject(selection)} aria-label={op?.type === "text.edit" ? t.text.revert : t.editor.delete}
+            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-danger-text hover:bg-danger/15">
+            {op?.type === "text.edit" ? <Undo2 {...ICON} /> : <Trash2 {...ICON} />}
+            {op?.type === "text.edit" ? t.text.revert : t.editor.delete}
+          </button>
+        </>
       )}
     </div>
   );
```

```diff
diff --git a/apps/web/src/components/editor/PageList.tsx b/apps/web/src/components/editor/PageList.tsx
index 2f1ad92..dee761e 100644
--- a/apps/web/src/components/editor/PageList.tsx
+++ b/apps/web/src/components/editor/PageList.tsx
@@ -28,7 +28,7 @@ export function PageList({ overlay }: { overlay?: OverlayRender }) {
   }, []);
 
   return (
-    <div className="flex flex-col items-center gap-6 px-6 py-8">
+    <div className="flex flex-col items-center gap-6 px-6 pb-24 pt-16">
       {pages.map((entry) => (
         <PageView key={entry.pageKey} entry={entry} geom={pageGeom(entry.pageKey === cropping ? { ...entry, crop: null } : entry, info)} scale={zoom} overlay={overlay} onVisible={onVisible} />
       ))}
```

```diff
diff --git a/apps/web/src/components/editor/forms/FormLayer.tsx b/apps/web/src/components/editor/forms/FormLayer.tsx
index 68b74ef..7d19c41 100644
--- a/apps/web/src/components/editor/forms/FormLayer.tsx
+++ b/apps/web/src/components/editor/forms/FormLayer.tsx
@@ -37,7 +37,7 @@ export function FormLayer({ pageKey, geom, scale }: { pageKey: string; geom: Pag
           pointerEvents: tool === "select" ? "auto" : "none",
           fontSize: fieldFontSize(f) * scale, background: FIELD_BG, boxSizing: "border-box",
         };
-        const common = { "aria-label": f.name, "data-field": f.name, style, className: "border border-accent/40 px-1 text-ink outline-none focus:border-accent" };
+        const common = { "aria-label": f.name, "data-field": f.name, style, className: "border border-accent/40 px-1 text-paper-ink outline-none focus:border-accent" };
         switch (f.type) {
           case "text":
             return f.multiline
```

- [ ] **Step 7: Run the suites and look at it**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web && npm run lint -w apps/web`
Expected: web 309 passed (+3 keys), tsc/eslint clean.

Run: `E2E_WEB_PORT=19101 E2E_API_PORT=19100 npm run e2e -w apps/web`
Expected: 10 passed (no test changes: names and test ids are unchanged).

Open the editor (`npm run dev -w apps/web -- --port 19101` with the API on 19100) and check: one top bar, no wrapping labels, tool menus open below their chevron (not clipped), the properties bar floats over the canvas and disappears with Pilih + nothing selected.

- [ ] **Step 8: Commit**

```bash
git checkout apps/web/tsconfig.json; rm -f apps/web/AGENTS.md
git add apps/web/package.json package-lock.json apps/web/src/app/globals.css apps/web/src/app/layout.tsx \
  apps/web/src/lib/keys.ts apps/web/src/lib/keys.test.ts apps/web/src/components/ui \
  apps/web/src/components/editor/Header.tsx apps/web/src/components/editor/Toolbar.tsx apps/web/src/components/editor/SplitButton.tsx \
  apps/web/src/components/editor/ZoomPill.tsx apps/web/src/components/editor/Editor.tsx apps/web/src/components/editor/PropertiesBar.tsx \
  apps/web/src/components/editor/PageList.tsx apps/web/src/components/editor/forms/FormLayer.tsx
git commit -m "feat(web): dark design tokens, line icons and one top bar with tooltips; floating properties bar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
