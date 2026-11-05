"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/lib/strings";
import { editorStore } from "@/store/editor";

const MENU_WIDTH = 176; // w-44

/** The page menu renders in a portal with fixed positioning so the narrow, scrolling sidebar cannot clip it. */
export function PageMenu({ pageKey, index, count }: { pageKey: string; index: number; count: number }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    // Capture phase: other handlers (another page menu's button, dnd-kit) stop propagation.
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
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)) });
  }

  const s = editorStore.getState();
  const items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[] = [
    { label: t.editor.rotateLeft, run: () => s.rotatePage(pageKey, -90) },
    { label: t.editor.rotateRight, run: () => s.rotatePage(pageKey, 90) },
    { label: t.editor.moveUp, run: () => s.movePage(pageKey, index - 1), disabled: index === 0 },
    { label: t.editor.moveDown, run: () => s.movePage(pageKey, index + 1), disabled: index === count - 1 },
    { label: t.editor.deletePage, run: () => s.deletePage(pageKey), disabled: count <= 1, danger: true },
  ];

  return (
    <div className="absolute right-1 top-1">
      <button
        ref={button}
        aria-label={t.editor.pageMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="grid h-6 w-6 place-items-center rounded bg-white/90 text-muted shadow ring-1 ring-line hover:text-ink"
      >⋮</button>
      {at && createPortal(
        <div
          ref={menu}
          role="menu"
          style={{ top: at.top, left: at.left, width: MENU_WIDTH }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line"
        >
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              onClick={() => { it.run(); setAt(null); }}
              className={`block w-full px-3 py-1.5 text-left hover:bg-bg disabled:opacity-40 ${it.danger ? "text-danger" : ""}`}>
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
