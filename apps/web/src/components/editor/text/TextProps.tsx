"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { TextAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { isTextOp } from "@/lib/objects";
import { prepareRuns } from "@/lib/paragraphs";
import { applyPatch, attrsOf, docToRuns, fontStyle, type RunAttrs } from "@/lib/richtext";
import { t } from "@/lib/strings";
import { boxFonts, relayout, withStyle, type BoxPatch } from "@/lib/textbox";
import { editorStore, useEditor, type ToolStyle } from "@/store/editor";
import { textStore, useText } from "@/store/text";
import { ColorField } from "../ColorField";
import { session, textEditStore } from "./textEdit";

/** Restyles the whole selected text op (no session open). Repeated changes within a second are one undo step. */
async function applyToSelected(patch: BoxPatch) {
  const s = editorStore.getState();
  const id = s.selection;
  if (!id || !isTextOp(s.doc.objects[id])) return;
  const fonts = textStore.getState().fonts;
  try {
    // Restyle the op as it is when the fonts are in (another change may have landed while they loaded).
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = editorStore.getState().doc.objects[id];
      if (!isTextOp(cur)) return; // deleted while fonts loaded
      const styled = withStyle(cur.box, patch, fonts);
      const paragraphs = await prepareRuns(styled.paragraphs, fonts);
      if (editorStore.getState().doc.objects[id] !== cur) continue;
      const box = relayout({ ...styled, paragraphs }, (f) => fontStore.get(f));
      editorStore.getState().updateObject(id, { box } as Partial<TextAdd>, { coalesce: `text-style:${id}` });
      return;
    }
  } catch (err) {
    console.warn("text style: font load failed", err);
  }
}

/** Restyles the rich editor's selection (or the style typed next). */
function applyToSession(patch: BoxPatch) {
  const e = textEditStore.getState().editing;
  if (!e) return;
  if (patch.align) textEditStore.getState().update({ ...e.box, align: patch.align });
  const runPatch: BoxPatch = { ...patch };
  delete runPatch.align;
  const editor = session.editor;
  if (!editor || !Object.keys(runPatch).length) return;
  const fonts = textStore.getState().fonts;
  // Typing in the size field or using the color picker keeps its focus; buttons never took it from the editor.
  const tag = document.activeElement?.tagName;
  const chain = tag === "INPUT" || tag === "SELECT" ? editor.chain() : editor.chain().focus();
  chain.updateRuns((a) => applyPatch(a, runPatch, fonts)).run();
  const runs = docToRuns(editor.getJSON(), attrsOf(e.box.paragraphs[0][0]));
  boxFonts({ ...e.box, paragraphs: runs }).forEach((f) => { fontStore.load(f).catch(() => {}); });
}

const ALIGNS = ["left", "center", "right", "justify"] as const;
const ALIGN_ICON = { left: "⇤", center: "↔", right: "⇥", justify: "☰" } as const;

function toolAttrs(s: ToolStyle): RunAttrs {
  return { font: { kind: "bundled", family: s.fontFamily, bold: s.bold, italic: s.italic }, size: s.fontSize, color: s.color, bgColor: null, underline: false, strike: false };
}

/** Size input that keeps what is being typed ("2" on the way to "20") and applies only valid sizes. */
function SizeField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input aria-label={t.editor.fontSize} type="number" min={4} max={200} step={0.5} value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && v >= 4 && v <= 200) onChange(v);
      }}
      onBlur={() => setDraft(null)}
      className="w-16 rounded border border-line px-1 py-1" />
  );
}

export function TextProps() {
  const style = useEditor((s) => s.style);
  const editing = useStore(textEditStore, (s) => s.editing);
  const current = useStore(textEditStore, (s) => s.current);
  const selected = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
  const fonts = useText((s) => s.fonts);
  const [families, setFamilies] = useState<string[]>(["Arimo", "Tinos", "Cousine"]);
  useEffect(() => { fontStore.families().then(setFamilies).catch(() => {}); }, []);

  const box = editing?.box ?? (isTextOp(selected) ? selected.box : null);
  const attrs: RunAttrs = (editing && current) ?? (box ? attrsOf(box.paragraphs[0][0]) : toolAttrs(style));
  const fs = fontStyle(attrs.font, fonts);
  const align = box?.align ?? style.align;

  function set(patch: BoxPatch) {
    const next: Partial<ToolStyle> = {};
    if (patch.family !== undefined) next.fontFamily = patch.family;
    if (patch.size !== undefined) next.fontSize = patch.size;
    if (patch.bold !== undefined) next.bold = patch.bold;
    if (patch.italic !== undefined) next.italic = patch.italic;
    if (patch.color !== undefined) next.color = patch.color;
    if (patch.align !== undefined) next.align = patch.align;
    editorStore.getState().setStyle(next);
    if (textEditStore.getState().editing) applyToSession(patch);
    else void applyToSelected(patch);
  }

  const toggle = (on: boolean) => `h-8 w-8 rounded-md ${on ? "bg-accent/10 text-accent" : "hover:bg-bg"}`;
  const alignLabel = { left: t.editor.alignLeft, center: t.editor.alignCenter, right: t.editor.alignRight, justify: t.text.alignJustify };
  const original = fs.original ? fonts[fs.original] : undefined;
  return (
    <div
      data-text-props
      className="flex items-center gap-2"
      // Keep focus in the rich editor for buttons (a select/input takes focus; the session stays open).
      onMouseDown={(e) => { const tag = (e.target as HTMLElement).tagName; if (tag !== "SELECT" && tag !== "INPUT") e.preventDefault(); }}
    >
      <select aria-label={t.editor.font} value={original ? `orig:${original.ref}` : fs.family}
        onChange={(e) => { if (!e.target.value.startsWith("orig:")) set({ family: e.target.value }); }}
        className="max-w-40 rounded border border-line px-1 py-1">
        {original && <option value={`orig:${original.ref}`}>{t.text.originalFont(original.name)}</option>}
        {families.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <SizeField value={attrs.size} onChange={(v) => set({ size: v })} />
      <button type="button" aria-label={t.editor.bold} aria-pressed={fs.bold} className={`${toggle(fs.bold)} font-bold`} onClick={() => set({ bold: !fs.bold })}>B</button>
      <button type="button" aria-label={t.editor.italic} aria-pressed={fs.italic} className={`${toggle(fs.italic)} italic`} onClick={() => set({ italic: !fs.italic })}>I</button>
      <button type="button" aria-label={t.text.underline} aria-pressed={attrs.underline} className={`${toggle(attrs.underline)} underline`} onClick={() => set({ underline: !attrs.underline })}>U</button>
      <button type="button" aria-label={t.text.strike} aria-pressed={attrs.strike} className={`${toggle(attrs.strike)} line-through`} onClick={() => set({ strike: !attrs.strike })}>S</button>
      <ColorField label={t.editor.color} value={attrs.color} onChange={(v) => set({ color: v })} />
      <ColorField label={t.text.background} value={attrs.bgColor ?? "#ffff00"} onChange={(v) => set({ bgColor: v })} />
      <button type="button" aria-label={t.text.noBackground} aria-pressed={attrs.bgColor === null} className={toggle(attrs.bgColor === null)}
        onClick={() => set({ bgColor: null })}>⌀</button>
      {ALIGNS.map((a) => (
        <button key={a} type="button" aria-label={alignLabel[a]} aria-pressed={align === a}
          className={toggle(align === a)} onClick={() => set({ align: a })}>{ALIGN_ICON[a]}</button>
      ))}
    </div>
  );
}
