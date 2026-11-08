"use client";

import { useStore } from "zustand";
import { toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { isCopyable, visualBounds, type Align } from "@/lib/objects";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { MenuButton } from "../MenuButton";
import { textEditStore } from "../text/textEdit";
import { alignSelection, copySelection, duplicateSelection, hasClipboard, pasteClipboard } from "./clipboard";

const BAR_H = 34;
const ALIGNS: [Align, string][] = [
  ["left", t.objects.alignLeft], ["center", t.objects.alignCenter], ["right", t.objects.alignRight],
  ["top", t.objects.alignTop], ["middle", t.objects.alignMiddle], ["bottom", t.objects.alignBottom],
];

/** Floating bar over the selected object: Duplikat, Hapus and ⋯ (Salin, Tempel, Duplikat, Ratakan ke halaman). */
export function SelectionMiniBar({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const op = useEditor((s) => (s.selection && s.tool === "select" ? s.doc.objects[s.selection] : undefined));
  const editing = useStore(textEditStore, (s) => !!s.editing);
  if (!op || op.pageKey !== pageKey || editing) return null;

  const b = visualBounds(op);
  const corners = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => toScreen(p, geom, scale));
  const left = (Math.min(...corners.map((c) => c[0])) + Math.max(...corners.map((c) => c[0]))) / 2;
  const top = Math.min(...corners.map((c) => c[1]));
  const bottom = Math.max(...corners.map((c) => c[1]));
  const y = top - BAR_H - 8 >= 0 ? top - BAR_H - 8 : bottom + 8; // above the object, below it at the page top
  const copyable = isCopyable(op);
  const s = editorStore.getState();
  const btn = "grid h-7 min-w-7 place-items-center rounded px-1.5 hover:bg-bg";

  return (
    <div role="toolbar" aria-label={t.objects.bar} data-testid="mini-bar" onPointerDown={(e) => e.stopPropagation()}
      className="absolute flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-surface p-0.5 text-sm shadow-lg ring-1 ring-line"
      style={{ left, top: y, height: BAR_H, zIndex: 15 }}>
      {copyable && <button aria-label={t.objects.duplicate} title={t.objects.duplicate} className={btn} onClick={() => duplicateSelection()}>⧉</button>}
      <button aria-label={t.editor.delete} title={t.editor.delete} className={`${btn} text-danger`} onClick={() => s.deleteObject(op.id)}>🗑</button>
      {copyable && (
        <MenuButton label={t.objects.more} className={btn} items={[
          { label: t.objects.copy, run: () => { copySelection(); } },
          { label: t.objects.paste, run: () => { pasteClipboard(); }, disabled: !hasClipboard() },
          { label: t.objects.duplicate, run: () => { duplicateSelection(); } },
          ...ALIGNS.map(([a, label]) => ({ label, run: () => alignSelection(a) })),
        ]}>⋯</MenuButton>
      )}
    </div>
  );
}
