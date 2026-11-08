"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MENU_ITEM, POPOVER } from "../ui/styles";

export interface MenuItem { label: string; run: () => void; disabled?: boolean; danger?: boolean }

const MENU_WIDTH = 192;
const ITEM_HEIGHT = 32; // h-8

/** A button that opens a menu. The menu renders in a portal with fixed positioning so a narrow, scrolling
 *  parent (the sidebar) cannot clip it; it closes on an outside press, Escape, scroll or resize. */
export function MenuButton({ label, items, children, className }: { label: string; items: MenuItem[]; children: React.ReactNode; className?: string }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    // Capture phase: other handlers (another menu's button, dnd-kit) stop propagation.
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setAt(null);
    };
    const dismiss = () => setAt(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAt(null); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true); // the anchor moved
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (open) { setAt(null); return; }
    const r = button.current!.getBoundingClientRect();
    // Open upwards when the menu would run past the bottom of the window (an anchor near the bottom edge).
    const height = items.length * ITEM_HEIGHT + 8;
    const below = r.bottom + 4 + height <= window.innerHeight - 8;
    setAt({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)) });
  }

  return (
    <>
      <button
        ref={button}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={className}
      >{children}</button>
      {at && createPortal(
        <div
          ref={menu}
          role="menu"
          style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={`fixed z-50 p-1 ${POPOVER}`}
        >
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              onClick={() => { setAt(null); it.run(); }}
              className={`${MENU_ITEM} ${it.danger ? "text-danger-text" : "text-ink"}`}>
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
