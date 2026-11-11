import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, type LucideIcon } from "lucide-react";
import { createStore } from "zustand/vanilla";
import type { Rect } from "@edith/ops";
import { t } from "@/lib/strings";
import { zMoves, type ZMove } from "@/lib/zorder";
import { editorStore } from "@/store/editor";

/** The four stacking commands as the menus list them (front first); their keys: zKeys(mac)[move]. */
export const Z_COMMANDS: { move: ZMove; label: string; icon: LucideIcon }[] = [
  { move: "front", label: t.layers.front, icon: ArrowUpToLine },
  { move: "forward", label: t.layers.forward, icon: ArrowUp },
  { move: "backward", label: t.layers.backward, icon: ArrowDown },
  { move: "back", label: t.layers.back, icon: ArrowDownToLine },
];

/** The selected objects (the moves take a group). */
export function selectedIds(): string[] {
  const s = editorStore.getState();
  return s.selected.filter((id) => s.doc.objects[id]);
}

/** Moves the selection in the stacking order of its page; false when nothing changed. */
export function moveSelection(move: ZMove): boolean {
  const ids = selectedIds();
  return ids.length > 0 && editorStore.getState().reorderObjects(ids, move);
}

/** Which moves would change something for the objects `ids`. */
export function movesFor(ids: readonly string[]): Record<ZMove, boolean> {
  return zMoves(editorStore.getState().doc, ids);
}

/** The object context menu: where it opens (window coordinates), the object it acts on, and the objects under the
 *  pointer (topmost first) for "Pilih elemen di bawah". */
export interface ObjectMenu { x: number; y: number; target: string; stack: string[] }
/** The menu of the selected paragraph of original (or OCR) text, not edited yet: Edit teks, Hapus teks. */
export interface ParagraphMenu { x: number; y: number; paragraph: { pageKey: string; id: string } }

/** The menu of a picture of the page (any image the API lists, nothing over it to edit): Kenali teks (OCR) of its
 *  rect (unrotated page points) on source page `index` of `doc`. */
export interface PictureMenu { x: number; y: number; picture: { pageKey: string; doc: string; index: number; rect: Rect } }

export type ContextMenu = ObjectMenu | ParagraphMenu | PictureMenu;

export const contextMenuStore = createStore<{ menu: ContextMenu | null; open(m: ContextMenu): void; close(): void }>()((set) => ({
  menu: null,
  open: (menu) => set({ menu }),
  close: () => set({ menu: null }),
}));

/** Per page, a function opening the menu over one of its objects (keyboard: the ContextMenu key, Shift+F10). The
 *  page's Konva overlay registers it: only it knows where the object is on screen. */
export const menuOpeners = new Map<string, (id: string) => void>();

export function openMenuForSelection(): boolean {
  const s = editorStore.getState();
  const op = s.selection ? s.doc.objects[s.selection] : undefined;
  const opener = op && s.tool === "select" ? menuOpeners.get(op.pageKey) : undefined;
  if (!op || !opener) return false;
  opener(op.id);
  return true;
}
