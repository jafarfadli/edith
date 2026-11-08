"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatKeys, isMac } from "@/lib/keys";

/** Hover shows the tip after this delay; keyboard focus shows it at once. */
const HOVER_DELAY_MS = 500;
const EDGE = 8;
const WIDE = 288;

/** Key caps of a shortcut (hidden from assistive tech: the control carries `aria-keyshortcuts`). Set in Geist,
 *  12 px medium: Geist Mono's narrow "O" (Elips) read as a zero at 11 px. */
export function Kbd({ keys }: { keys: string }) {
  const mac = isMac();
  return (
    <span aria-hidden className="flex gap-0.5">
      {formatKeys(keys, mac).map((k, i) => (
        <kbd key={i} className="min-w-[18px] rounded-sm bg-hover px-1 text-center font-sans text-xs font-medium leading-[18px] text-muted">{k}</kbd>
      ))}
    </span>
  );
}

/** A tooltip (label + shortcut keys) under or over its child. It renders in a portal with fixed positioning, so the
 *  scrolling toolbar cannot clip it; it hides on press, scroll, Escape and when the pointer or focus leaves. */
export function Tip({ label, keys, side = "bottom", wide = false, children }: {
  /** `wide`: a sentence rather than a name; it wraps at a fixed width. */
  label: string; keys?: string; side?: "bottom" | "top"; wide?: boolean; children: React.ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const half = wide ? WIDE / 2 : 60;
    const x = Math.min(Math.max(r.left + r.width / 2, EDGE + half), window.innerWidth - EDGE - half);
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
          // Keep the whole tip inside the window: `show` guessed its width, this corrects it with the real one.
          ref={(el) => {
            if (!el) return;
            const half = el.offsetWidth / 2;
            el.style.left = `${Math.min(Math.max(at.x, EDGE + half), window.innerWidth - EDGE - half)}px`;
          }}
          className={`pointer-events-none fixed z-[60] flex -translate-x-1/2 items-center gap-2 rounded-md bg-raised px-2 text-xs text-ink shadow-pop ${wide ? "whitespace-normal py-1.5" : "whitespace-nowrap py-1"} ${side === "top" ? "-translate-y-full" : ""}`}
          style={{ left: at.x, top: at.y, width: wide ? WIDE : undefined }}>
          {label}
          {keys && <Kbd keys={keys} />}
        </div>,
        document.body,
      )}
    </span>
  );
}
