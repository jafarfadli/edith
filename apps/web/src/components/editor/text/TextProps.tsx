"use client";

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Ban, Bold, Italic, Strikethrough, TriangleAlert, Underline } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { TextAdd } from "@edith/ops";
import { fontStore } from "@/lib/fonts";
import { entryText, pickerGroups, type PickerGroup } from "@/lib/fontPicker";
import { isTextOp } from "@/lib/objects";
import { hasUnsupportedChars, prepareRuns } from "@/lib/paragraphs";
import { applyPatch, attrsOf, docToRuns, fontStyle, type RunAttrs } from "@/lib/richtext";
import { t } from "@/lib/strings";
import { boxFonts, relayout, withStyle, type BoxPatch } from "@/lib/textbox";
import { editorStore, useEditor, type ToolStyle } from "@/store/editor";
import { textStore, useText } from "@/store/text";
import { ICON, ICON_SM } from "../../ui/icon";
import { FIELD, toggle } from "../../ui/styles";
import { ColorField } from "../ColorField";
import { useOverflow } from "./useOverflow";
import { session, textEditStore, updateTextOp } from "./textEdit";

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
      const styled = withStyle(cur.box, patch, fonts, (f) => fontStore.peek(f));
      const paragraphs = await prepareRuns(styled.paragraphs, fonts);
      if (editorStore.getState().doc.objects[id] !== cur) continue;
      const box = relayout({ ...styled, paragraphs }, (f) => fontStore.get(f));
      updateTextOp(id, { box } as Partial<TextAdd>, { coalesce: `text-style:${id}` }); // relayout drops kept lines: their marks go
      return;
    }
    console.warn("text style: the text changed while its fonts loaded; style not applied", patch);
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
  const fallback = attrsOf(e.box.paragraphs[0][0]);
  // The style at the caret before the change: with an empty selection the new font only lives in a
  // stored mark (no run uses it yet), so load it now — text typed next shows in it right away.
  const caret = applyPatch(textEditStore.getState().current ?? fallback, runPatch, fonts);
  // Bold/italic on original text: the embedded variant only for a piece it draws whole (no word in two fonts).
  chain.updateRuns((a, text) => applyPatch(a, runPatch, fonts, { text, peek: (f) => fontStore.peek(f) })).run();
  const runs = docToRuns(editor.getJSON(), fallback);
  [caret.font, ...boxFonts({ ...e.box, paragraphs: runs })].forEach((f) => { fontStore.load(f).catch(() => {}); });
}

const ALIGNS = ["left", "center", "right", "justify"] as const;
const ALIGN_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const;

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
      className={`${FIELD} w-16 pr-1 tabular-nums`} />
  );
}

/** Until the font manifest is fetched (or when it cannot be): the three families every document can use. */
const FALLBACK_GROUPS = pickerGroups({
  families: { Arimo: { category: "sans", display: "Arial" }, Tinos: { category: "serif", display: "Times New Roman" }, Cousine: { category: "mono", display: "Courier New" } },
  common: ["Tinos", "Arimo", "Cousine"],
});

export function TextProps() {
  const style = useEditor((s) => s.style);
  const editing = useStore(textEditStore, (s) => s.editing);
  const current = useStore(textEditStore, (s) => s.current);
  const selected = useEditor((s) => (s.selection ? s.doc.objects[s.selection] : undefined));
  const fonts = useText((s) => s.fonts);
  const [groups, setGroups] = useState<PickerGroup[]>(FALLBACK_GROUPS);
  useEffect(() => { fontStore.picker().then(setGroups).catch(() => {}); }, []);

  const box = editing?.box ?? (isTextOp(selected) ? selected.box : null);
  const overflow = useOverflow(!editing && isTextOp(selected) ? selected : undefined);
  // TextProps re-renders on every editor transaction (`current`), so the session's runs are fresh here.
  const shown = editing ? session.paragraphs ?? editing.box.paragraphs : box?.paragraphs;
  const unsupported = !!shown && hasUnsupportedChars(shown, fonts, (f) => fontStore.peek(f));
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

  const alignLabel = { left: t.editor.alignLeft, center: t.editor.alignCenter, right: t.editor.alignRight, justify: t.text.alignJustify };
  const original = fs.original ? fonts[fs.original] : undefined;
  return (
    <div
      data-text-props
      className="flex items-center gap-1.5"
      // Keep focus in the rich editor for buttons (a select/input takes focus; the session stays open).
      onMouseDown={(e) => { const tag = (e.target as HTMLElement).tagName; if (tag !== "SELECT" && tag !== "INPUT") e.preventDefault(); }}
    >
      <select aria-label={t.editor.font} value={original ? `orig:${original.ref}` : fs.family}
        onChange={(e) => { if (!e.target.value.startsWith("orig:")) set({ family: e.target.value }); }}
        className={`${FIELD} max-w-40 truncate pr-1`}>
        {original && <option value={`orig:${original.ref}`}>{t.text.originalFont(original.name)}</option>}
        {groups.map((g) => (
          <optgroup key={g.id} label={t.text.fontGroup[g.id]}>
            {g.entries.map((e) => <option key={e.family} value={e.family}>{entryText(e)}</option>)}
          </optgroup>
        ))}
      </select>
      <SizeField value={attrs.size} onChange={(v) => set({ size: v })} />
      <button type="button" aria-label={t.editor.bold} aria-pressed={fs.bold} className={toggle(fs.bold)} onClick={() => set({ bold: !fs.bold })}><Bold {...ICON} /></button>
      <button type="button" aria-label={t.editor.italic} aria-pressed={fs.italic} className={toggle(fs.italic)} onClick={() => set({ italic: !fs.italic })}><Italic {...ICON} /></button>
      <button type="button" aria-label={t.text.underline} aria-pressed={attrs.underline} className={toggle(attrs.underline)} onClick={() => set({ underline: !attrs.underline })}><Underline {...ICON} /></button>
      <button type="button" aria-label={t.text.strike} aria-pressed={attrs.strike} className={toggle(attrs.strike)} onClick={() => set({ strike: !attrs.strike })}><Strikethrough {...ICON} /></button>
      <ColorField textProps label={t.editor.color} value={attrs.color} onChange={(v) => set({ color: v })} />
      <ColorField textProps label={t.text.background} value={attrs.bgColor ?? "#ffff00"} onChange={(v) => set({ bgColor: v })} />
      <button type="button" aria-label={t.text.noBackground} aria-pressed={attrs.bgColor === null} className={toggle(attrs.bgColor === null)}
        onClick={() => set({ bgColor: null })}><Ban {...ICON} /></button>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
      {ALIGNS.map((a) => {
        const Icon = ALIGN_ICON[a];
        return (
          <button key={a} type="button" aria-label={alignLabel[a]} aria-pressed={align === a}
            className={toggle(align === a)} onClick={() => set({ align: a })}><Icon {...ICON} /></button>
        );
      })}
      {unsupported && <span role="status" className="flex items-center gap-1 text-xs text-danger-text"><TriangleAlert {...ICON_SM} />{t.text.unsupported}</span>}
      {overflow && <span role="status" className="flex items-center gap-1 text-xs text-warn"><TriangleAlert {...ICON_SM} />{t.text.overflow}</span>}
    </div>
  );
}
