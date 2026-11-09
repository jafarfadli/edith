"use client";

import { Copy, Ellipsis, Layers, Trash2, Undo2 } from "lucide-react";
import { useStore } from "zustand";
import { toScreen, type PageGeom, type Pt } from "@/lib/coords";
import { isCopyable, isRotatable, ROTATE_HANDLE_OFFSET, visualBounds, type Align } from "@/lib/objects";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { ICON } from "../../ui/icon";
import { POPOVER } from "../../ui/styles";
import { useIsMac } from "../../ui/useIsMac";
import { MenuButton } from "../MenuButton";
import { deleteObjectOrText, isDeletedText, isTextEdit, textEditStore } from "../text/textEdit";
import { zKeys, zMoves } from "@/lib/zorder";
import { alignSelection, copySelection, duplicateSelection, hasClipboard, pasteClipboard } from "./clipboard";
import { Z_COMMANDS } from "./layering";

const BAR_H = 34;
/** Room for the longest command and its three key caps (Ctrl Shift [ / ⌘ ⌥ [). */
const LAYER_MENU_WIDTH = 264;
/** Room for the Transformer's rotation handle (its offset, half the 8 px anchor, a gap). */
const ROTATER_CLEARANCE = ROTATE_HANDLE_OFFSET + 4 + 8;
const ALIGNS: [Align, string][] = [
  ["left", t.objects.alignLeft], ["center", t.objects.alignCenter], ["right", t.objects.alignRight],
  ["top", t.objects.alignTop], ["middle", t.objects.alignMiddle], ["bottom", t.objects.alignBottom],
];

/** Floating bar over the selected object: Duplikat, Hapus and ⋯ (Salin, Tempel, Duplikat, Ratakan ke halaman). */
export function SelectionMiniBar({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const op = useEditor((s) => (s.selection && s.tool === "select" ? s.doc.objects[s.selection] : undefined));
  const doc = useEditor((s) => s.doc);
  const mac = useIsMac();
  const editing = useStore(textEditStore, (s) => !!s.editing);
  if (!op || op.pageKey !== pageKey || editing) return null;

  const b = visualBounds(op);
  const corners = ([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[]).map((p) => toScreen(p, geom, scale));
  const left = (Math.min(...corners.map((c) => c[0])) + Math.max(...corners.map((c) => c[0]))) / 2;
  const top = Math.min(...corners.map((c) => c[1]));
  const bottom = Math.max(...corners.map((c) => c[1]));
  // Above the object, below it at the page top; never over the rotation handle, which PageOverlay puts above the
  // box, or below it when the box is near the page top (rotateAnchorOffset).
  const rotatable = isRotatable(op);
  const handleAbove = rotatable && top >= ROTATE_HANDLE_OFFSET;
  const above = top - BAR_H - (handleAbove ? ROTATER_CLEARANCE : 8);
  const y = above >= 0 ? above : bottom + (rotatable && !handleAbove ? ROTATER_CLEARANCE : 8);
  const copyable = isCopyable(op);
  const textEdit = isTextEdit(op);
  const moves = zMoves(doc, [op.id]); // the layer menu only when the object has something to pass on its page
  const s = editorStore.getState();
  const btn = "grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink";

  return (
    <div role="toolbar" aria-label={t.objects.bar} data-testid="mini-bar" onPointerDown={(e) => e.stopPropagation()}
      className={`absolute flex -translate-x-1/2 items-center gap-0.5 p-0.5 ${POPOVER}`}
      style={{ left, top: y, height: BAR_H, zIndex: 15 }}>
      {copyable && <button aria-label={t.objects.duplicate} title={t.objects.duplicate} className={btn} onClick={() => duplicateSelection()}><Copy {...ICON} /></button>}
      {/* An edit of original text loses its text (once), as Delete does; removing the edit brings the original back. */}
      {!isDeletedText(op) && (
        <button aria-label={textEdit ? t.text.delete : t.editor.delete} title={textEdit ? t.text.delete : t.editor.delete}
          className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-danger/15 hover:text-danger-text"
          onClick={() => deleteObjectOrText(op.id)}><Trash2 {...ICON} /></button>
      )}
      {textEdit && <button aria-label={t.text.revert} title={t.text.revert} className={btn} onClick={() => s.deleteObject(op.id)}><Undo2 {...ICON} /></button>}
      {(moves.front || moves.back) && (
        <MenuButton label={t.layers.menu} className={btn} width={LAYER_MENU_WIDTH}
          items={Z_COMMANDS.map((c) => ({ label: c.label, icon: c.icon, keys: zKeys(mac)[c.move], disabled: !moves[c.move], run: () => { s.reorderObjects([op.id], c.move); } }))}>
          <Layers {...ICON} />
        </MenuButton>
      )}
      {copyable && (
        <MenuButton label={t.objects.more} className={btn} items={[
          { label: t.objects.copy, run: () => { copySelection(); } },
          { label: t.objects.paste, run: () => { pasteClipboard(); }, disabled: !hasClipboard() },
          { label: t.objects.duplicate, run: () => { duplicateSelection(); } },
          ...ALIGNS.map(([a, label]) => ({ label, run: () => alignSelection(a) })),
        ]}><Ellipsis {...ICON} /></MenuButton>
      )}
    </div>
  );
}
