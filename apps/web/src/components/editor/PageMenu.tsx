"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/strings";
import { editorStore } from "@/store/editor";

export function PageMenu({ pageKey, index, count }: { pageKey: string; index: number; count: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const s = editorStore.getState();
  const items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[] = [
    { label: t.editor.rotateLeft, run: () => s.rotatePage(pageKey, -90) },
    { label: t.editor.rotateRight, run: () => s.rotatePage(pageKey, 90) },
    { label: t.editor.moveUp, run: () => s.movePage(pageKey, index - 1), disabled: index === 0 },
    { label: t.editor.moveDown, run: () => s.movePage(pageKey, index + 1), disabled: index === count - 1 },
    { label: t.editor.deletePage, run: () => s.deletePage(pageKey), disabled: count <= 1, danger: true },
  ];

  return (
    <div ref={ref} className="absolute right-1 top-1">
      <button
        aria-label={t.editor.pageMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="grid h-6 w-6 place-items-center rounded bg-white/90 text-muted shadow ring-1 ring-line hover:text-ink"
      >⋮</button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-lg bg-surface py-1 text-sm shadow-lg ring-1 ring-line">
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); it.run(); setOpen(false); }}
              className={`block w-full px-3 py-1.5 text-left hover:bg-bg disabled:opacity-40 ${it.danger ? "text-danger" : ""}`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
