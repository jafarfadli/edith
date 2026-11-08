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
        <button aria-label={label} aria-pressed={pressed} aria-keyshortcuts={current.keys} onClick={() => choose(current)}
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
              <button key={keyOf(o)} role="menuitem" aria-keyshortcuts={o.keys} onClick={() => { setMemory(o); setAt(null); choose(o); }}
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
