"use client";

import type { ContentOp } from "@edith/ops";
import { useStore } from "zustand";
import { inkWidth } from "@/lib/objects";
import { t } from "@/lib/strings";
import { editorStore, useEditor, type ToolStyle } from "@/store/editor";
import { ColorField } from "./ColorField";
import { textEditStore } from "./text/textEdit";

export const textPropsSlot: { render?: () => React.ReactNode } = {};

type Kind = "shape" | "line" | "ink" | "redact" | "text" | null;

function kindOf(op: ContentOp | undefined, tool: string): Kind {
  if (op) {
    if (op.type === "shape.add") return (op as { kind: string }).kind === "line" || (op as { kind: string }).kind === "arrow" ? "line" : "shape";
    if (op.type === "ink.add") return "ink";
    if (op.type === "redact.add") return "redact";
    if (op.type === "text.add") return "text";
    return null;
  }
  if (tool === "rect" || tool === "ellipse") return "shape";
  if (tool === "line" || tool === "arrow") return "line";
  if (tool === "ink") return "ink";
  if (tool === "redact") return "redact";
  if (tool === "text") return "text";
  return null;
}

export function PropertiesBar() {
  const selection = useEditor((s) => s.selection);
  const op = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
  const tool = useEditor((s) => s.tool);
  const style = useEditor((s) => s.style);
  const editingText = useStore(textEditStore, (st) => !!st.editing);
  const kind = editingText ? "text" : kindOf(op, tool);
  const o = op as (ContentOp & Record<string, unknown>) | undefined;
  const s = editorStore.getState();

  const stroke = (o?.type === "ink.add" ? (o.color as string) : (o?.stroke as string | undefined)) ?? style.stroke;
  const rawWidth = (o?.width as number | undefined) ?? style.width;
  const width = kind === "ink" ? inkWidth(rawWidth) : rawWidth;
  const fill = o ? ((o.fill as string | null | undefined) ?? null) : style.fill;

  function set(patch: { stroke?: string; width?: number; fill?: string | null; redactFill?: "black" | "white" }) {
    if (o) {
      const p: Record<string, unknown> = {};
      if (patch.stroke !== undefined) p[o.type === "ink.add" ? "color" : "stroke"] = patch.stroke;
      if (patch.width !== undefined) p.width = o.type === "ink.add" ? inkWidth(patch.width) : patch.width;
      if (patch.fill !== undefined) p.fill = patch.fill;
      if (patch.redactFill !== undefined) p.fill = patch.redactFill;
      s.updateObject(o.id, p as Partial<ContentOp>);
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
      {kind === "text" && textPropsSlot.render?.()}
      <div className="flex-1" />
      {selection && (
        <button onClick={() => s.deleteObject(selection)} aria-label={t.editor.delete} className="rounded-md px-2 py-1 text-danger hover:bg-danger/10">
          🗑 {t.editor.delete}
        </button>
      )}
    </div>
  );
}
