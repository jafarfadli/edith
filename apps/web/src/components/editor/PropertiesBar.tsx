"use client";

import type { ContentOp } from "@edith/ops";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { Dash } from "@/lib/geometry";
import { hasOpacity, inkWidth, isMarkup, isTextOp, MARKUP_TOOLS, opacityOf, POLY_TOOLS } from "@/lib/objects";
import { t } from "@/lib/strings";
import { useChars } from "@/store/chars";
import { editorStore, useEditor, type MarkupTool, type ToolStyle } from "@/store/editor";
import type { LinkTarget } from "@/lib/links";
import { STAMP_COLORS } from "@/lib/stamps";
import { ColorField } from "./ColorField";
import { LinkTargetFields } from "./marks/LinkTargetFields";
import { linkStore } from "./marks/linkStore";
import { textEditStore } from "./text/textEdit";

export const textPropsSlot: { render?: () => React.ReactNode } = {};

type Kind = "shape" | "line" | "ink" | "redact" | "text" | "markup" | "symbol" | "note" | "link" | "stamp" | null;

function kindOf(op: ContentOp | undefined, tool: string): Kind {
  if (op) {
    if (op.type === "shape.add") return ["line", "arrow", "polyline"].includes((op as { kind: string }).kind) ? "line" : "shape";
    if (op.type === "ink.add") return "ink";
    if (op.type === "redact.add") return "redact";
    if (isTextOp(op)) return "text";
    if (isMarkup(op)) return "markup";
    if (op.type === "symbol.add") return "symbol";
    if (op.type === "annot.add") return "note";
    if (op.type === "link.add") return "link";
    if (op.type === "stamp.add") return "stamp";
    return null;
  }
  if (MARKUP_TOOLS.has(tool)) return "markup";
  if (tool === "check" || tool === "cross") return "symbol";
  if (tool === "note") return "note";
  if (tool === "rect" || tool === "ellipse" || tool === "polygon" || tool === "cloud") return "shape";
  if (tool === "line" || tool === "arrow" || tool === "polyline") return "line";
  if (tool === "ink") return "ink";
  if (tool === "redact") return "redact";
  if (tool === "text") return "text";
  return null;
}

const DRAG_SHAPES: ReadonlySet<string> = new Set(["rect", "ellipse", "line", "arrow"]);

export function PropertiesBar() {
  const selection = useEditor((s) => s.selection);
  const op = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
  const tool = useEditor((s) => s.tool);
  const style = useEditor((s) => s.style);
  const editingText = useStore(textEditStore, (st) => !!st.editing);
  const kind = editingText ? "text" : kindOf(op, tool);
  // The text tool on a page without text (a scan): say why there is nothing to edit.
  const scanned = useEditor((st) => {
    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
    return tool === "text" && !!entry && "doc" in entry.src && entry.src.doc === st.info?.docId && st.info?.pages[entry.src.index]?.hasText === false;
  });
  // The markup tools on a page without original text (or only rotated text): nothing to mark.
  const currentSrc = useEditor((st) => {
    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage);
    return entry && "doc" in entry.src && entry.src.doc === st.info?.docId ? entry.src.index : -1;
  });
  const currentLines = useChars((cs) => cs.pages[currentSrc]);
  const noText = MARKUP_TOOLS.has(tool) && Array.isArray(currentLines) && currentLines.length === 0;
  const noteField = useRef<HTMLTextAreaElement>(null);
  const focusNote = useStore(linkStore, (st) => st.focusNote);
  // Only a note just created takes focus; selecting an existing note must leave Delete/Backspace to the editor.
  useEffect(() => {
    if (!focusNote || focusNote !== selection || !noteField.current) return;
    // Past the pointerdown that created the note: its mousedown default action would blur the field again.
    const el = noteField.current;
    linkStore.getState().setFocusNote(null);
    requestAnimationFrame(() => setTimeout(() => el.focus(), 0)); // not cancelled: clearing the flag re-runs this effect
  }, [focusNote, selection]);
  const o = op as (ContentOp & Record<string, unknown>) | undefined;
  const s = editorStore.getState();

  /** Color of the selected object (its `color` field), or of what the tool makes next. */
  function setColor(v: string) {
    if (o) s.updateObject(o.id, { color: v } as Partial<ContentOp>, { coalesce: `props:${o.id}` });
    else if (MARKUP_TOOLS.has(tool)) s.setStyle({ markup: { ...style.markup, [tool]: v } });
    else if (kind === "symbol") s.setStyle({ symbolColor: v });
    else if (kind === "note") s.setStyle({ noteColor: v });
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

  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface px-3 text-sm" role="group" aria-label={t.editor.properties}>
      {(kind === "shape" || kind === "line" || kind === "ink") && (
        <>
          <ColorField label={t.editor.color} value={stroke} onChange={(v) => set({ stroke: v })} />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            {t.editor.strokeWidth}
            <input type="range" min={kind === "shape" ? 0 : 1} max={20} step={0.5} value={width} aria-label={t.editor.strokeWidth}
              onChange={(e) => set({ width: Number(e.target.value) })} className="w-24 accent-[var(--accent)]" />
            <span className="w-8 tabular-nums text-ink">{width}</span>
          </label>
        </>
      )}
      {(kind === "shape" || kind === "line") && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t.editor.dash}
          <select value={dash} aria-label={t.editor.dash} onChange={(e) => setDash(e.target.value as Dash)} className="rounded border border-line px-1 py-0.5 text-ink">
            <option value="solid">{t.editor.dashSolid}</option>
            <option value="dashed">{t.editor.dashDashed}</option>
            <option value="dotted">{t.editor.dashDotted}</option>
          </select>
        </label>
      )}
      {kind === "shape" && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={fill === null} onChange={(e) => set({ fill: e.target.checked ? null : "#ffffff" })} />
            {t.editor.noFill}
          </label>
          {fill !== null && <ColorField label={t.editor.fill} value={fill} onChange={(v) => set({ fill: v })} />}
        </div>
      )}
      {kind === "redact" && o && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t.editor.fill}
          <select value={o.fill as string} onChange={(e) => set({ redactFill: e.target.value as "black" | "white" })} className="rounded border border-line px-1 py-0.5 text-ink">
            <option value="black">{t.editor.black}</option>
            <option value="white">{t.editor.white}</option>
          </select>
        </label>
      )}
      {kind === "markup" && (
        <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.markup[tool as MarkupTool] ?? style.markup.highlight}
          onChange={(v) => setColor(v)} />
      )}
      {kind === "markup" && noText && <span className="text-xs text-muted">{t.annot.noText}</span>}
      {kind === "symbol" && <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.symbolColor} onChange={setColor} />}
      {kind === "note" && <ColorField label={t.editor.color} value={(o?.color as string | undefined) ?? style.noteColor} onChange={setColor} />}
      {kind === "note" && o && (
        <textarea key={o.id} aria-label={t.annot.noteContent} placeholder={t.annot.noteContent} ref={noteField} rows={1}
          value={(o.content as string | null | undefined) ?? ""}
          onChange={(e) => s.updateObject(o.id, { content: e.target.value } as Partial<ContentOp>, { coalesce: `note:${o.id}` })}
          className="h-8 w-80 resize-none rounded border border-line px-1.5 py-1 text-ink" />
      )}
      {kind === "link" && o && (
        <LinkTargetFields key={o.id} target={o.target as LinkTarget}
          onChange={(target) => { if (target) s.updateObject(o.id, { target } as Partial<ContentOp>, { coalesce: `link:${o.id}` }); }} />
      )}
      {kind === "stamp" && o && (
        <div role="radiogroup" aria-label={t.editor.color} className="flex items-center gap-1">
          {STAMP_COLORS.map((c) => (
            <button key={c} role="radio" aria-checked={o.color === c} aria-label={`${t.editor.color} ${c}`} onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full ring-1 ring-line ${o.color === c ? "outline outline-2 outline-accent" : ""}`} style={{ background: c }} />
          ))}
        </div>
      )}
      {kind === "text" && textPropsSlot.render?.()}
      {showOpacity && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t.editor.opacity}
          <input type="range" min={0.1} max={1} step={0.05} value={opacity} aria-label={t.editor.opacity}
            onChange={(e) => setOpacity(Number(e.target.value))} className="w-20 accent-[var(--accent)]" />
          <span className="w-9 tabular-nums text-ink">{Math.round(opacity * 100)}%</span>
        </label>
      )}
      {kind === "text" && scanned && <span className="text-xs text-muted">{t.text.scanned}</span>}
      <div className="flex-1" />
      {selection && (
        // Deleting a text.edit op brings the original paragraph back.
        <button onClick={() => s.deleteObject(selection)} aria-label={op?.type === "text.edit" ? t.text.revert : t.editor.delete} className="rounded-md px-2 py-1 text-danger hover:bg-danger/10">
          🗑 {op?.type === "text.edit" ? t.text.revert : t.editor.delete}
        </button>
      )}
    </div>
  );
}
