"use client";

import { Pipette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseHex } from "@/lib/colors";
import { t } from "@/lib/strings";

interface NativeEyeDropper { open(): Promise<{ sRGBHex: string }> }
declare global { interface Window { EyeDropper?: new () => NativeEyeDropper } }

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** The colour as the browser gave it: "#rrggbb", or "rgb(r, g, b)" in some versions. */
function toHex(c: string): string | null {
  const hex = parseHex(c.replace(/^#/, ""), false);
  if (hex) return hex;
  const m = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
  return m ? `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}` : null;
}

/** The colour shown at a point of the window, read from the canvases there (the pages pdf.js draws and the layers
 *  of drawn objects over them), the topmost one that is not see-through at that point. */
export function sampleAt(x: number, y: number): string | null {
  const canvases = [...document.querySelectorAll("canvas")].reverse(); // later in the document: drawn on top
  for (const c of canvases) {
    if (!c.width || !c.height) continue;
    const r = c.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue;
    const px = Math.min(c.width - 1, Math.floor(((x - r.left) * c.width) / r.width));
    const py = Math.min(c.height - 1, Math.floor(((y - r.top) * c.height) / r.height));
    try {
      const [red, green, blue, alpha] = c.getContext("2d")?.getImageData(px, py, 1, 1).data ?? [];
      if (alpha !== undefined && alpha > 127) return `#${hex2(red)}${hex2(green)}${hex2(blue)}`;
    } catch { /* a canvas that cannot be read: look under it */ }
  }
  return null;
}

/** The pipette next to the hex code: takes a colour from what is on screen. Where the browser has one (Chrome and
 *  Edge on a computer) its own eyedropper is used, which reads any pixel on the screen; elsewhere (Safari, Firefox,
 *  phones) the page is covered with a picking layer that reads the pages under the pointer or finger, with a loupe of
 *  the colour beside it, and takes it on release. Escape, or a press on nothing, cancels. `onSampling`: the popover
 *  steps out of the way while it picks. */
export function Eyedropper({ label, onPick, onSampling, textProps }: {
  label: string; onPick: (hex: string) => void; onSampling: (on: boolean) => void; textProps: boolean;
}) {
  const [layer, setLayer] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  async function start() {
    if (window.EyeDropper) {
      onSampling(true);
      try {
        const hex = toHex((await new window.EyeDropper().open()).sRGBHex);
        if (hex) onPick(hex);
      } catch { /* cancelled */ }
      onSampling(false);
      button.current?.focus({ preventScroll: true });
      return;
    }
    onSampling(true);
    setLayer(true);
  }

  function done(hex: string | null) {
    setLayer(false);
    onSampling(false);
    if (hex) onPick(hex);
    button.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button ref={button} type="button" aria-label={`${label} ${t.editor.eyedropper}`} title={t.editor.eyedropper} onClick={start}
        data-testid="eyedropper"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted ring-1 ring-inset ring-line transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
        <Pipette size={14} aria-hidden />
      </button>
      {layer && <PickLayer textProps={textProps} onDone={done} />}
    </>
  );
}

function PickLayer({ textProps, onDone }: { textProps: boolean; onDone: (hex: string | null) => void }) {
  const [at, setAt] = useState<{ x: number; y: number; colour: string | null; touch: boolean } | null>(null);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation(); // not the editor's Escape that deselects
      done.current(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const look = (e: React.PointerEvent) => setAt({ x: e.clientX, y: e.clientY, colour: sampleAt(e.clientX, e.clientY), touch: e.pointerType !== "mouse" });

  // Above a finger the loupe stays in sight; beside a mouse pointer it stays out of the way.
  const lx = at ? (at.touch ? at.x - 24 : at.x + 14) : 0;
  const ly = at ? (at.touch ? at.y - 80 : at.y + 14) : 0;
  return createPortal(
    <div data-eyedropper data-text-props={textProps || undefined} data-testid="eyedropper-layer" role="application" aria-label={t.editor.eyedropperHint}
      className="fixed inset-0 z-[60] cursor-crosshair touch-none"
      onMouseDown={(e) => e.preventDefault()} // a text session keeps its focus
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); look(e); }}
      onPointerMove={look}
      onPointerUp={(e) => onDone(sampleAt(e.clientX, e.clientY))}
      onPointerCancel={() => onDone(null)}
      onContextMenu={(e) => { e.preventDefault(); onDone(null); }}>
      <p className="pointer-events-none fixed left-1/2 top-4 -translate-x-1/2 rounded-full bg-ink px-3 py-1.5 text-xs text-base shadow-pop">
        {t.editor.eyedropperHint}
      </p>
      {at && (
        <span aria-hidden className="pointer-events-none fixed flex items-center gap-1.5 rounded-full bg-raised py-1 pl-1 pr-2.5 font-mono text-xs uppercase text-ink shadow-pop"
          style={{ left: lx, top: ly }}>
          <span className="h-6 w-6 rounded-full ring-1 ring-inset ring-line-strong"
            style={{ background: at.colour ?? "repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px" }} />
          {at.colour ?? "–"}
        </span>
      )}
    </div>,
    document.body,
  );
}
