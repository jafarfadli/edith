"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@/lib/strings";
import { POPOVER, PROP_LABEL, swatch } from "../ui/styles";
import { returnFocus, usePopupFocus } from "../ui/usePopupFocus";

const SWATCHES = ["#111111", "#ffffff", "#e11d48", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];

/** A colour chip; pressing it opens a small popover with swatches and the browser's colour picker. The popover renders
 *  in a portal (the properties bar scrolls horizontally and would clip it). Picking a swatch closes it. Keyboard: opened
 *  with Enter/Space, focus goes to the first swatch; arrows, Home and End move through the swatches and the custom
 *  colour; Escape closes (usePopupFocus). `textProps`: it belongs to the text properties, so pressing it keeps the
 *  rich-text session open and the editor focused (opened by mouse, focus stays in the editor). */
export function ColorField({ label, value, onChange, textProps = false }: {
  label: string; value: string; onChange: (v: string) => void; textProps?: boolean;
}) {
  const [at, setAt] = useState<{ top: number; left: number; keyboard: boolean } | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !chip.current?.contains(target)) setAt(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setAt(null); chip.current?.focus(); } };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("keydown", onKey, true); };
  }, [open]);

  // A text-props popover opened by mouse leaves focus in the rich editor; by keyboard (click detail 0) it takes it.
  const onPopKey = usePopupFocus({
    open, popup: pop, trigger: chip, items: "button, input", orientation: "both",
    focusOnOpen: !textProps || !!at?.keyboard, close: () => setAt(null),
  });

  function pick(c: string) {
    returnFocus(pop, chip);
    setAt(null);
    onChange(c);
  }

  function toggle(e: React.MouseEvent) {
    if (open) { setAt(null); return; }
    const r = chip.current!.getBoundingClientRect();
    // Under the floating bar that holds the chip (not over its lower edge), else under the chip.
    const bar = chip.current!.closest("[data-testid=properties-bar]")?.getBoundingClientRect();
    setAt({ top: (bar?.bottom ?? r.bottom) + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 216)), keyboard: e.detail === 0 });
  }

  return (
    <span className={PROP_LABEL}>
      {label}
      <button ref={chip} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}
        className="h-6 w-6 shrink-0 rounded-md ring-1 ring-inset ring-line-strong transition-shadow hover:ring-ink/40" style={{ background: value }} />
      {at && createPortal(
        <div ref={pop} role="dialog" aria-label={label} style={{ top: at.top, left: at.left }} data-text-props={textProps || undefined}
          onMouseDown={(e) => { if (textProps && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}
          onKeyDown={onPopKey}
          className={`fixed z-50 flex w-52 flex-col gap-2.5 p-2.5 ${POPOVER}`}>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={`${label} ${c}`} aria-pressed={value.toLowerCase() === c} onClick={() => pick(c)}
                className={swatch(value.toLowerCase() === c)} style={{ background: c }} />
            ))}
          </div>
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 text-xs text-muted hover:bg-hover hover:text-ink has-[:focus-visible]:bg-hover has-[:focus-visible]:text-ink">
            <input type="color" aria-label={`${label} ${t.editor.customColor}`} value={value} onChange={(e) => onChange(e.target.value)}
              className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0" />
            {t.editor.customColor}
            <span className="ml-auto font-mono uppercase text-faint">{value}</span>
          </label>
        </div>,
        document.body,
      )}
    </span>
  );
}
