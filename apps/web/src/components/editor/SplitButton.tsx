"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/strings";
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
    // Capture phase so opening another menu (which may stop propagation) still closes this one.
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);

  return (
    <div ref={ref} className="relative flex">
      <button aria-label={label} aria-pressed={pressed} title={`${label}: ${current.label}`} onClick={() => onPick(current.tool)}
        className={`flex h-9 items-center gap-1 rounded-l-md px-2 text-sm ${pressed ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>
        <span aria-hidden>{current.icon}</span><span className="hidden lg:inline">{current.label}</span>
      </button>
      <button aria-label={`${label} ${t.editor.options}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="h-9 rounded-r-md px-1 text-xs text-muted hover:bg-bg">▾</button>
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
