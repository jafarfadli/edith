"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { TextAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { t } from "@/lib/strings";
import { boxFonts, relayout, withStyle, type TextStyle } from "@/lib/textbox";
import { editorStore, useEditor, type ToolStyle } from "@/store/editor";
import { ColorField } from "../ColorField";
import { textEditStore } from "./textEdit";

async function applyToSelected(patch: Partial<TextStyle>) {
  const s = editorStore.getState();
  const op = s.selection ? (s.doc.objects[s.selection] as TextAdd | undefined) : undefined;
  if (!op || op.type !== "text.add") return;
  const styled = withStyle(op.box, patch);
  try {
    await Promise.all(boxFonts(styled).map((f) => fontStore.load(f)));
  } catch (err) {
    console.warn("text style: font load failed", err);
    return;
  }
  const cur = editorStore.getState().doc.objects[op.id];
  if (!cur) return;
  editorStore.getState().updateObject(op.id, { box: relayout(withStyle((cur as TextAdd).box, patch), (f) => fontStore.get(f)) } as Partial<TextAdd>);
}

const ALIGNS = ["left", "center", "right"] as const;
const ALIGN_ICON = { left: "⇤", center: "↔", right: "⇥" } as const;

export function TextProps() {
  const style = useEditor((s) => s.style);
  const editing = useStore(textEditStore, (s) => s.editing);
  const selected = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
  const [families, setFamilies] = useState<string[]>(["Arimo", "Tinos", "Cousine"]);
  useEffect(() => { fontStore.families().then(setFamilies).catch(() => {}); }, []);

  const box = editing?.box ?? (selected?.type === "text.add" ? (selected as TextAdd).box : null);
  const run = box?.paragraphs[0]?.[0];
  const cur: TextStyle = run && box
    ? { family: run.font.family, bold: run.font.bold ?? false, italic: run.font.italic ?? false, size: run.size, color: run.color, align: box.align ?? "left" }
    : { family: style.fontFamily, bold: style.bold, italic: style.italic, size: style.fontSize, color: style.color, align: style.align };

  function set(patch: Partial<TextStyle>) {
    const s = editorStore.getState();
    const next: Partial<ToolStyle> = {};
    if (patch.family !== undefined) next.fontFamily = patch.family;
    if (patch.size !== undefined) next.fontSize = patch.size;
    if (patch.bold !== undefined) next.bold = patch.bold;
    if (patch.italic !== undefined) next.italic = patch.italic;
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.align !== undefined) next.align = patch.align;
    s.setStyle(next);
    const e = textEditStore.getState().editing;
    if (e) {
      const styled = withStyle(e.box, patch);
      textEditStore.getState().update(styled);
      boxFonts(styled).forEach((f) => { fontStore.load(f).catch(() => {}); });
    } else {
      void applyToSelected(patch);
    }
  }

  const toggle = (on: boolean) => `h-8 w-8 rounded-md ${on ? "bg-accent/10 text-accent" : "hover:bg-bg"}`;
  const alignLabel = { left: t.editor.alignLeft, center: t.editor.alignCenter, right: t.editor.alignRight };
  return (
    <div
      className="flex items-center gap-2"
      // Keep focus in the text editor for buttons; focusing a select/input commits the box first (then edits the selected op).
      onMouseDown={(e) => { const tag = (e.target as HTMLElement).tagName; if (tag !== "SELECT" && tag !== "INPUT") e.preventDefault(); }}
    >
      <select aria-label={t.editor.font} value={cur.family} onChange={(e) => set({ family: e.target.value })} className="rounded border border-line px-1 py-1">
        {families.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <input aria-label={t.editor.fontSize} type="number" min={4} max={200} value={cur.size}
        onChange={(e) => { const v = Number(e.target.value); if (v >= 4 && v <= 200) set({ size: v }); }}
        className="w-16 rounded border border-line px-1 py-1" />
      <button type="button" aria-label={t.editor.bold} aria-pressed={cur.bold} className={`${toggle(cur.bold)} font-bold`} onClick={() => set({ bold: !cur.bold })}>B</button>
      <button type="button" aria-label={t.editor.italic} aria-pressed={cur.italic} className={`${toggle(cur.italic)} italic`} onClick={() => set({ italic: !cur.italic })}>I</button>
      <ColorField label={t.editor.color} value={cur.color} onChange={(v) => set({ color: v })} />
      {ALIGNS.map((a) => (
        <button key={a} type="button" aria-label={alignLabel[a]} aria-pressed={cur.align === a}
          className={toggle(cur.align === a)} onClick={() => set({ align: a })}>{ALIGN_ICON[a]}</button>
      ))}
    </div>
  );
}
