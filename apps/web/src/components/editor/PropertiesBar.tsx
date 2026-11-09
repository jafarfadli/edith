"use client";

import type { ContentOp } from "@edith/ops";
import { Info, Trash2, Undo2 } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { Dash } from "@/lib/geometry";
import { hasOpacity, inkWidth, isMarkup, isTextOp, MARKUP_TOOLS, opacityOf, POLY_TOOLS } from "@/lib/objects";
import { t } from "@/lib/strings";
import { useChars } from "@/store/chars";
import { editorStore, sourcePage, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
import { srcKey } from "@/lib/sources";
import { toolHint } from "@/lib/toolKeys";
import { STAMP_COLORS } from "@/lib/stamps";
import { ICON, ICON_SM } from "../ui/icon";
import { BTN_DANGER, FIELD, PROP_LABEL, swatch } from "../ui/styles";
import { Tip } from "../ui/Tooltip";
import { ColorField } from "./ColorField";
import { textEditStore } from "./text/textEdit";

// Filled by the text tool once its (lazily loaded) module is installed. The bar can already be open by then (the text
// tool's hint keeps it visible), so installing it re-renders the bar.
let slotRender: (() => React.ReactNode) | undefined;
const slotListeners = new Set<() => void>();
export const textPropsSlot = {
  get render() { return slotRender; },
  set render(r: (() => React.ReactNode) | undefined) { slotRender = r; slotListeners.forEach((l) => l()); },
};
const subscribeSlot = (l: () => void) => { slotListeners.add(l); return () => { slotListeners.delete(l); }; };
const getSlot = () => slotRender;

// Sticky notes and links (annot.add note, link.add) have no tool since M5: one restored from an older draft can
// still be selected, moved and deleted, but has no properties here.
type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | "symbol" | "stamp" | null;

function kindOf(op: ContentOp | undefined, tool: string): Kind {
  if (op) {
    if (op.type === "shape.add") return ["line", "arrow", "polyline"].includes((op as { kind: string }).kind) ? "line" : "shape";
    if (op.type === "ink.add") return "ink";
    if (op.type === "redact.add") return "redact";
    if (isTextOp(op)) return "text";
    if (isMarkup(op)) return "markup";
    if (op.type === "symbol.add") return "symbol";
    if (op.type === "stamp.add") return "stamp";
    return null;
  }
  if (MARKUP_TOOLS.has(tool)) return "markup";
  if (tool === "check" || tool === "cross") return "symbol";
  if (tool === "rect" || tool === "ellipse" || tool === "polygon" || tool === "cloud") return "shape";
  if (tool === "line" || tool === "arrow" || tool === "polyline") return "line";
  if (tool === "ink") return "ink";
  if (tool === "redact") return "redact";
  if (tool === "text") return "text";
  return null;
}

const DRAG_SHAPES: ReadonlySet<string> = new Set(["rect", "ellipse", "line", "arrow"]);
/** Room the bar loses inside the canvas: its `max-w-[calc(100%-1.5rem)]` margins and its `px-3` padding. */
const BAR_INSET = 24 + 24;
/** Hints longer than this (characters) wrap onto two lines; shorter ones stay on one line. */
const LONG_HINT = 64;

type HintFold = { key: string | null; fold: boolean; width: number };

/** Whether the tool hint folds to its icon (the sentence then shows in a tooltip): only when the bar, sentence included,
 *  would not fit in the canvas, so no option ever hides behind a horizontal scroll. `observe` goes on the bar's inner
 *  row (sized to its content); a ResizeObserver on it and on the canvas re-measures whenever either changes. */
function useHintFold(hint: string | null): [boolean, (row: HTMLDivElement | null) => (() => void) | undefined] {
  const [state, setState] = useState<HintFold>({ key: null, fold: false, width: 0 });
  const observe = useCallback((row: HTMLDivElement | null) => {
    const canvas = row?.parentElement?.parentElement;
    if (!row || !canvas) return;
    const measure = () => {
      const text = row.querySelector<HTMLElement>("[data-hint-text]");
      const key = text?.textContent ?? null;
      const room = canvas.clientWidth - BAR_INSET;
      setState((st) => {
        if (!key || !text) return st.fold ? { key: null, fold: false, width: 0 } : st;
        if (!(st.key === key && st.fold)) {
          if (row.offsetWidth <= room) return st.key === key && !st.fold ? st : { key, fold: false, width: 0 };
          return { key, fold: true, width: text.offsetWidth };
        }
        // Folded: unfold once the sentence fits again (its width was taken when it folded).
        return row.offsetWidth + st.width <= room ? { key, fold: false, width: 0 } : st;
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);
  return [hint !== null && state.key === hint && state.fold, observe];
}

export function PropertiesBar() {
  const renderTextProps = useSyncExternalStore(subscribeSlot, getSlot, getSlot);
  const selection = useEditor((s) => s.selection);
  const op = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
  const reverts = op?.type === "text.edit" || op?.type === "text.ocr_edit";
  const tool = useEditor((s) => s.tool);
  const style = useEditor((s) => s.style);
  const editingText = useStore(textEditStore, (st) => !!st.editing);
  const kind = editingText ? "text" : kindOf(op, tool);
  // The text tool on a page without text (a scan): say why there is nothing to edit.
  const scanned = useEditor((st) => {
    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
    return tool === "text" && !!entry && !!st.info && sourcePage(entry, st.info)?.hasText === false;
  });
  // The markup tools on a page without original text (or only rotated text): nothing to mark.
  const currentSrc = useEditor((st) => {
    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
    return entry && "doc" in entry.src ? srcKey(entry.src.doc, entry.src.index) : "";
  });
  const currentLines = useChars((cs) => cs.pages[currentSrc]);
  const noText = MARKUP_TOOLS.has(tool) && Array.isArray(currentLines) && currentLines.length === 0;
  const o = op as (ContentOp & Record<string, unknown>) | undefined;
  const s = editorStore.getState();

  /** Color of the selected object (its `color` field), or of what the tool makes next. */
  function setColor(v: string) {
    if (o) s.updateObject(o.id, { color: v } as Partial<ContentOp>, { coalesce: `props:${o.id}` });
    else if (MARKUP_TOOLS.has(tool)) s.setStyle({ markup: { ...style.markup, [tool]: v } });
    else if (kind === "symbol") s.setStyle({ symbolColor: v });
  }

  const stroke = (o?.type === "ink.add" ? (o.color as string) : (o?.stroke as string | undefined)) ?? style.stroke;
  const rawWidth = (o?.width as number | undefined) ?? style.width;
  const width = kind === "ink" ? inkWidth(rawWidth) : rawWidth;
  const fill = o ? ((o.fill as string | null | undefined) ?? null) : style.fill;

  const dash = o ? ((o.dash as Dash | undefined) ?? "solid") : style.dash;
  // Opacity: of the selected drawn object, or of the next shape a shape tool makes.
  const showOpacity = o ? hasOpacity(o) : (kind === "shape" || kind === "line") && (DRAG_SHAPES.has(tool) || POLY_TOOLS.has(tool));
  const opacity = o ? opacityOf(o) : style.opacity;

  function setOpacity(v: number) {
    if (o) s.updateObject(o.id, { opacity: v } as Partial<ContentOp>, { coalesce: `opacity:${o.id}` }); // a slider drag is one undo step
    else s.setStyle({ opacity: v });
  }

  function setDash(v: Dash) {
    if (o) s.updateObject(o.id, { dash: v } as Partial<ContentOp>);
    else s.setStyle({ dash: v });
  }

  function set(patch: { stroke?: string; width?: number; fill?: string | null; redactFill?: "black" | "white" }) {
    if (o) {
      const p: Record<string, unknown> = {};
      if (patch.stroke !== undefined) p[o.type === "ink.add" ? "color" : "stroke"] = patch.stroke;
      if (patch.width !== undefined) p.width = o.type === "ink.add" ? inkWidth(patch.width) : patch.width;
      if (patch.fill !== undefined) p.fill = patch.fill;
      if (patch.redactFill !== undefined) p.fill = patch.redactFill;
      s.updateObject(o.id, p as Partial<ContentOp>, { coalesce: `props:${o.id}` }); // a slider drag is one undo step
    } else {
      const next: Partial<ToolStyle> = {};
      if (patch.stroke !== undefined) next.stroke = patch.stroke;
      if (patch.width !== undefined) next.width = patch.width;
      if (patch.fill !== undefined) next.fill = patch.fill;
      s.setStyle(next);
    }
  }

  // What the active tool does, while nothing is selected (with a selection the bar is about that object).
  const hint = !selection && !editingText ? toolHint(tool) : null;
  const [foldHint, observeRow] = useHintFold(hint);
  // Hidden when it would be empty (Pilih with nothing selected).
  const empty = !hint && !selection && !showOpacity && !scanned && !noText
    && (kind === null || (kind === "redact" && !o) || (kind === "stamp" && !o) || (kind === "text" && !editingText && !renderTextProps));
  if (empty) return null;

  return (
    <div role="group" aria-label={t.editor.properties} data-testid="properties-bar"
      className="absolute left-1/2 top-3 z-30 h-10 max-w-[calc(100%-1.5rem)] -translate-x-1/2 overflow-x-auto rounded-lg bg-panel px-3 text-sm shadow-pop [scrollbar-width:none]">
      <div ref={observeRow} className="flex h-full w-max items-center gap-4 whitespace-nowrap">
        {hint && (
          // A long sentence wraps onto two lines rather than widening the bar; folded, it lives in the icon's tooltip.
          <span data-testid="tool-hint" className="flex shrink-0 items-center gap-2 text-xs text-muted">
            {foldHint
              ? <Tip label={hint} wide><span className="grid h-6 w-6 place-items-center rounded-md text-accent-text hover:bg-hover"><Info {...ICON_SM} /></span></Tip>
              : <Info {...ICON_SM} className="shrink-0 text-accent-text" />}
            <span data-hint-text className={foldHint ? "sr-only" : hint.length > LONG_HINT ? "line-clamp-2 max-w-[18rem] whitespace-normal leading-4" : undefined}>{hint}</span>
          </span>
        )}
        {(kind === "shape" || kind === "line" || kind === "ink") && (
          <>
            <ColorField label={t.editor.color} value={stroke} onChange={(v) => set({ stroke: v })} />
            <label className={PROP_LABEL}>
              {t.editor.strokeWidth}
              <input type="range" min={kind === "shape" ? 0 : 1} max={20} step={0.5} value={width} aria-label={t.editor.strokeWidth}
                onChange={(e) => set({ width: Number(e.target.value) })} className="w-20" />
              <span className="w-7 tabular-nums text-ink">{width}</span>
            </label>
          </>
        )}
        {(kind === "shape" || kind === "line") && (
          <label className={PROP_LABEL}>
            {t.editor.dash}
            <select value={dash} aria-label={t.editor.dash} onChange={(e) => setDash(e.target.value as Dash)} className={`${FIELD} pr-1`}>
              <option value="solid">{t.editor.dashSolid}</option>
              <option value="dashed">{t.editor.dashDashed}</option>
              <option value="dotted">{t.editor.dashDotted}</option>
            </select>
          </label>
        )}
        {kind === "shape" && (
          <div className="flex items-center gap-2">
            <label className={PROP_LABEL}>
              <input type="checkbox" checked={fill === null} onChange={(e) => set({ fill: e.target.checked ? null : "#ffffff" })} />
              {t.editor.noFill}
            </label>
            {fill !== null && <ColorField label={t.editor.fill} value={fill} onChange={(v) => set({ fill: v })} />}
          </div>
        )}
        {kind === "redact" && o && (
          <label className={PROP_LABEL}>
            {t.editor.fill}
            <select value={o.fill as string} onChange={(e) => set({ redactFill: e.target.value as "black" | "white" })} className={`${FIELD} pr-1`}>
              <option value="black">{t.editor.black}</option>
              <option value="white">{t.editor.white}</option>
            </select>
          </label>
        )}
        {kind === "markup" && (
          <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.markup[tool as MarkupTool] ?? style.markup.highlight}
            onChange={(v) => setColor(v)} />
        )}
        {kind === "markup" && noText && <span className="text-xs text-warn">{t.annot.noText}</span>}
        {kind === "symbol" && <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.symbolColor} onChange={setColor} />}
        {kind === "stamp" && o && (
          <div role="radiogroup" aria-label={t.editor.color} className="flex items-center gap-1.5">
            {STAMP_COLORS.map((c) => (
              <button key={c} role="radio" aria-checked={o.color === c} aria-label={`${t.editor.color} ${c}`} onClick={() => setColor(c)}
                className={swatch(o.color === c)} style={{ background: c }} />
            ))}
          </div>
        )}
        {kind === "text" && renderTextProps?.()}
        {showOpacity && (
          <label className={PROP_LABEL}>
            {t.editor.opacity}
            <input type="range" min={0.1} max={1} step={0.05} value={opacity} aria-label={t.editor.opacity}
              onChange={(e) => setOpacity(Number(e.target.value))} className="w-20" />
            <span className="w-8 tabular-nums text-ink">{Math.round(opacity * 100)}%</span>
          </label>
        )}
        {kind === "text" && scanned && <span className="text-xs text-warn">{t.text.scanned}</span>}
        {selection && (
          // Deleting a text.edit op brings the original paragraph back; a text.ocr_edit op, the original picture of it.
          <>
            <span aria-hidden className="h-5 w-px shrink-0 bg-line" />
            <button onClick={() => s.deleteObject(selection)} aria-label={reverts ? t.text.revert : t.editor.delete}
              className={BTN_DANGER}>
              {reverts ? <Undo2 {...ICON} /> : <Trash2 {...ICON} />}
              {reverts ? t.text.revert : t.editor.delete}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
