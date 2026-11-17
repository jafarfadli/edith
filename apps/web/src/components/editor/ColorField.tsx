"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  hexToHsv, hsvToHex, MAX_SAVED_COLORS, parseHex, removeSavedColor, saveColor,
  savedColorsServerSnapshot, savedColorsSnapshot, subscribeSavedColors, type Hsv,
} from "@/lib/colors";
import { t } from "@/lib/strings";
import { POPOVER, PROP_LABEL, swatch } from "../ui/styles";
import { returnFocus, usePopupFocus } from "../ui/usePopupFocus";

const SWATCHES = ["#111111", "#ffffff", "#e11d48", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];
const POP_W = 224;

/** A colour chip; pressing it opens a popover with the default swatches, the colours saved in this browser (shared by
 *  every colour field; "+" saves the current one, a right click or Delete removes one), and a picker of its own: a
 *  saturation/brightness field, a hue bar and the hex code to type. The picker is drawn in the page rather than the
 *  browser's colour input, whose separate picker window could get stuck and ignore the next click. The popover renders
 *  in a portal (the properties bar scrolls horizontally and would clip it). Picking a swatch closes it; the picker and
 *  the hex code change the colour live and keep it open. Keyboard: opened with Enter/Space, focus goes to the first
 *  swatch; arrows, Home and End move between the items, the two sliders take their own arrows; Escape closes
 *  (usePopupFocus). `textProps`: it belongs to the text properties, so pressing it keeps the rich-text session open and
 *  the editor focused (opened by mouse, focus stays in the editor). */
export function ColorField({ label, value, onChange, textProps = false }: {
  label: string; value: string; onChange: (v: string) => void; textProps?: boolean;
}) {
  const [at, setAt] = useState<{ top: number; left: number; keyboard: boolean } | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const open = at !== null;
  const saved = useSyncExternalStore(subscribeSavedColors, savedColorsSnapshot, savedColorsServerSnapshot);
  const current = value.toLowerCase();

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
    open, popup: pop, trigger: chip, items: "button, input, [role=slider]", orientation: "both",
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
    setAt({ top: (bar?.bottom ?? r.bottom) + 6, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - POP_W - 8)), keyboard: e.detail === 0 });
  }

  return (
    <span className={PROP_LABEL}>
      {label}
      <button ref={chip} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}
        className="h-6 w-6 shrink-0 rounded-md ring-1 ring-inset ring-line-strong transition-shadow hover:ring-ink/40" style={{ background: value }} />
      {at && createPortal(
        <div ref={pop} role="dialog" aria-label={label} style={{ top: at.top, left: at.left, width: POP_W }} data-text-props={textProps || undefined}
          onMouseDown={(e) => { if (textProps && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}
          onKeyDown={onPopKey}
          className={`fixed z-50 flex flex-col gap-2.5 p-2.5 ${POPOVER}`}>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={`${label} ${c}`} aria-pressed={current === c} onClick={() => pick(c)}
                className={swatch(current === c)} style={{ background: c }} />
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-[0.12em] text-faint">{t.editor.savedColors}</span>
            <div className="flex gap-1.5">
              <button type="button" aria-label={t.editor.saveColor} title={t.editor.saveColor} onClick={() => saveColor(value)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-muted transition-colors hover:border-ink/50 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                <Plus size={12} strokeWidth={2.5} aria-hidden />
              </button>
              {saved.map((c) => (
                <button key={c} type="button" aria-label={`${label} ${c}`} aria-pressed={current === c} title={`${c} · ${t.editor.savedColorHint}`}
                  aria-keyshortcuts="Delete" onClick={() => pick(c)}
                  onContextMenu={(e) => { e.preventDefault(); removeSavedColor(c); }}
                  onKeyDown={(e) => {
                    if (e.key !== "Delete" && e.key !== "Backspace") return;
                    e.preventDefault();
                    e.stopPropagation(); // not the editor's delete of the selected object
                    // Focus stays in the row: on the colour that moves into this place, else the one before it.
                    const row = e.currentTarget.parentElement!;
                    const i = [...row.querySelectorAll("button")].indexOf(e.currentTarget);
                    removeSavedColor(c);
                    requestAnimationFrame(() => {
                      const left = row.querySelectorAll("button");
                      left[Math.min(i, left.length - 1)]?.focus();
                    });
                  }}
                  className={swatch(current === c)} style={{ background: c }} />
              ))}
              {Array.from({ length: Math.max(0, MAX_SAVED_COLORS - saved.length) }, (_, i) => (
                <span key={i} aria-hidden className="h-5 w-5 shrink-0 rounded-full border border-dashed border-line" />
              ))}
            </div>
          </div>

          <Picker label={label} value={value} onChange={onChange} />
        </div>,
        document.body,
      )}
    </span>
  );
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** The in-page picker: a saturation (across) by brightness (up) field, a hue bar under it, and the hex code. It keeps
 *  its own hue, so a grey or black picked in the field does not lose the hue the bar was on. */
function Picker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [draft, setDraft] = useState(() => (parseHex(value) ?? "#000000").slice(1));

  function emit(next: Hsv) {
    setHsv(next);
    const hex = hsvToHex(next);
    setDraft(hex.slice(1));
    if (hex !== value.toLowerCase()) onChange(hex);
  }

  function fromPointer(e: React.PointerEvent<HTMLElement>, apply: (x: number, y: number) => void) {
    const r = e.currentTarget.getBoundingClientRect();
    apply(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  }
  const drag = (apply: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      fromPointer(e, apply);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e, apply);
    },
  });

  /** Arrow keys on a slider: `step` per press, five times that with Shift. */
  function keys(e: React.KeyboardEvent, onKey: (dx: number, dy: number) => boolean) {
    const n = e.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, n], ArrowDown: [0, -n] }[e.key];
    if (!d || !onKey(d[0], d[1])) return;
    e.preventDefault();
    e.stopPropagation(); // not the popover's move between items
  }

  function typed(text: string) {
    setDraft(text);
    const hex = parseHex(text, false);
    if (!hex) return;
    setHsv(hexToHsv(hex));
    if (hex !== value.toLowerCase()) onChange(hex);
  }
  function settle() {
    const hex = parseHex(draft);
    if (hex) typed(hex);
    setDraft((hex ?? parseHex(value) ?? "#000000").slice(1));
  }

  const hue = `hsl(${hsv.h} 100% 50%)`;
  const pct = (n: number) => Math.round(n * 100);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2.5">
      <span className="text-2xs font-medium uppercase tracking-[0.12em] text-faint">{t.editor.customColor}</span>
      <div role="slider" tabIndex={0} aria-label={`${label} ${t.editor.shade}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(hsv.s)}
        aria-valuetext={t.editor.shadeValue(pct(hsv.s), pct(hsv.v))}
        {...drag((x, y) => emit({ ...hsv, s: x, v: 1 - y }))}
        onKeyDown={(e) => keys(e, (dx, dy) => { emit({ ...hsv, s: clamp(hsv.s + dx * 0.02), v: clamp(hsv.v + dy * 0.02) }); return true; })}
        className="relative h-28 cursor-crosshair touch-none rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})` }}>
        <span aria-hidden className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <div role="slider" tabIndex={0} aria-label={`${label} ${t.editor.hue}`} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)}
        {...drag((x) => emit({ ...hsv, h: x * 359.9 }))}
        onKeyDown={(e) => keys(e, (dx) => { if (!dx) return false; emit({ ...hsv, h: Math.min(359.9, Math.max(0, hsv.h + dx * 3)) }); return true; })}
        className="relative h-3 cursor-pointer touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}>
        <span aria-hidden className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: hue }} />
      </div>
      <label className="flex h-8 items-center gap-1 rounded-md bg-base/60 px-2 font-mono text-xs ring-1 ring-inset ring-line focus-within:ring-ink/50">
        <span aria-hidden className="mr-1 h-4 w-4 shrink-0 rounded ring-1 ring-inset ring-line-strong" style={{ background: value }} />
        <span aria-hidden className="text-faint">#</span>
        <input type="text" aria-label={`${label} ${t.editor.hex}`} value={draft} maxLength={7} spellCheck={false} autoComplete="off"
          onChange={(e) => typed(e.target.value.replace(/^#/, ""))}
          onBlur={settle}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); settle(); return; }
            // The caret moves inside the code; Up/Down still go to the other items.
            if (["ArrowLeft", "ArrowRight", "Home", "End", "Backspace", "Delete"].includes(e.key)) e.stopPropagation();
          }}
          className="min-w-0 flex-1 bg-transparent uppercase text-ink outline-none" />
      </label>
    </div>
  );
}
