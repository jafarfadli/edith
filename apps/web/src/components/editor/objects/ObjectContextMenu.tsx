"use client";

import { ClipboardCopy, Copy, Trash2, Type, Undo2, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import type { ContentOp } from "@edith/ops";
import { ariaKeys } from "@/lib/keys";
import { isCopyable } from "@/lib/objects";
import { objectLabel } from "@/lib/objectLabels";
import { t } from "@/lib/strings";
import { zKeys, zMoves, zStage } from "@/lib/zorder";
import { editorStore, useEditor } from "@/store/editor";
import { ICON } from "../../ui/icon";
import { MENU_ITEM, POPOVER } from "../../ui/styles";
import { Kbd } from "../../ui/Tooltip";
import { useIsMac } from "../../ui/useIsMac";
import { usePopupFocus } from "../../ui/usePopupFocus";
import { OBJECT_ICONS } from "../objectIcons";
import { copySelection, duplicateSelection } from "./clipboard";
import { contextMenuStore, Z_COMMANDS, type ObjectMenu, type ParagraphMenu } from "./layering";
import { deleteObjectOrText, deleteSelectedParagraph, editSelectedParagraph, isDeletedText, isTextEdit, textEditStore } from "../text/textEdit";

/** Distance (px) the menu keeps from the window's edges. */
const EDGE = 8;
const close = () => contextMenuStore.getState().close();

/** `at` moved so that `[at, at + size]` lies within `[EDGE, span − EDGE]` (at EDGE when it cannot fit). */
function clampTo(at: number, size: number, span: number): number {
  return Math.max(EDGE, Math.min(at, span - EDGE - size));
}

/** The colour an object shows most (fill, else stroke or ink), for the chip next to it in "Pilih elemen di bawah". */
function colourOf(op: ContentOp): string | null {
  switch (op.type) {
    case "shape.add": return op.fill ?? op.stroke;
    case "ink.add": case "symbol.add": case "annot.add": return op.color;
    case "whiteout.add": return "#ffffff";
    case "redact.add": return op.fill === "white" ? "#ffffff" : "#000000";
    default: return null;
  }
}

/** The right-click menu of an object on the page (PageOverlay opens it through contextMenuStore). */
export function ObjectContextMenu() {
  const menu = useStore(contextMenuStore, (s) => s.menu);
  // A new menu (another right-click) is a new instance: position, focus and "focus before" start over.
  const target = menu && ("paragraph" in menu ? `${menu.paragraph.pageKey}/${menu.paragraph.id}` : menu.target);
  return menu ? <Menu key={`${target}:${menu.x}:${menu.y}`} menu={menu} /> : null;
}

function Menu({ menu }: { menu: ObjectMenu | ParagraphMenu }) {
  const ref = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const mac = useIsMac();
  const paragraph = "paragraph" in menu ? menu.paragraph : null;
  const op = paragraph ? undefined : doc.objects[(menu as ObjectMenu).target];
  // A paragraph's menu lasts while it stays selected and not edited.
  const paragraphOn = useStore(textEditStore, (s) => !!paragraph && s.paragraph?.pageKey === paragraph.pageKey
    && s.paragraph.id === paragraph.id && !s.editing);

  // Where focus was (to give it back on Escape); read before usePopupFocus moves it into the menu.
  useLayoutEffect(() => {
    const a = document.activeElement;
    before.current = a instanceof HTMLElement && a !== document.body ? a : null;
  }, []);

  // At the pointer, flipped to its left/top when the menu would run past the right/bottom edge of the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const flipX = menu.x + w > window.innerWidth - EDGE ? menu.x - w : menu.x;
    const flipY = menu.y + h > window.innerHeight - EDGE ? Math.min(menu.y - h, window.innerHeight - EDGE - h) : menu.y;
    // Then inside the window whatever the anchor (the keyboard opens it over an object that may be scrolled away).
    setPos({ left: clampTo(flipX, w, window.innerWidth), top: clampTo(flipY, h, window.innerHeight) });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const outside = (e: Event) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener("pointerdown", outside, true); // capture: Konva and dnd-kit stop propagation
    window.addEventListener("scroll", outside, true); // the canvas moved under it; not the menu's own list scrolling
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const gone = paragraph ? !paragraphOn : !op;
  useEffect(() => { if (gone) close(); }, [gone]); // deleted, undone or edited meanwhile
  useEffect(() => { if (tool !== "select") close(); }, [tool]); // a tool key pressed while focus was elsewhere

  const onKey = usePopupFocus({ open: true, popup: ref, trigger: before, items: "[role^=menuitem]:not(:disabled)", orientation: "vertical", close });
  if (gone) return null;

  /** Closes, gives focus back (keyboard use), then runs the command. */
  const pick = (run: () => void) => () => {
    if (ref.current?.contains(document.activeElement)) before.current?.focus();
    close();
    run();
  };
  const item = (key: string, label: string, Icon: LucideIcon, run: () => void, opts: { keys?: string; disabled?: boolean; danger?: boolean } = {}) => (
    <button key={key} role="menuitem" disabled={opts.disabled} aria-keyshortcuts={opts.keys && ariaKeys(opts.keys, mac)} onClick={pick(run)}
      className={`${MENU_ITEM} ${opts.danger ? "text-danger-text" : "text-ink"}`}>
      <Icon {...ICON} className={opts.danger ? undefined : "text-muted"} />
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {opts.keys && <Kbd keys={opts.keys} />}
    </button>
  );
  const shell = (label: string, testId: string, children: React.ReactNode) => createPortal(
    <div ref={ref} role="menu" aria-label={label} data-testid={testId}
      // Every key stays in the menu: arrows, Enter, Escape, Tab are its own (usePopupFocus); letters must not switch
      // the editor's tool, Delete not delete the object, behind it.
      onKeyDown={(e) => { onKey(e); e.stopPropagation(); }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      // Placed before the first paint (layout effect), so it never shows at the unflipped spot; not hidden meanwhile:
      // usePopupFocus focuses the first item right after that first render.
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, maxHeight: `calc(100dvh - ${2 * EDGE}px)` }}
      className={`fixed z-50 flex w-max min-w-60 max-w-80 flex-col overflow-y-auto p-1 ${POPOVER}`}>
      {children}
    </div>,
    document.body,
  );

  // Original (or OCR) text not edited yet: what can be done to it.
  if (!op) {
    return shell(t.text.menu, "text-menu", <>
      {item("edit", t.text.edit, Type, editSelectedParagraph)}
      {item("delete", t.text.delete, Trash2, () => { deleteSelectedParagraph(); }, { keys: "Delete", danger: true })}
    </>);
  }

  // An edit of original text: Delete takes its text (once); bringing the original back is said as such.
  const textEdit = isTextEdit(op);
  const moves = zMoves(doc, [op.id]);
  const copyable = isCopyable(op);
  const stage = zStage(op);
  const pageHasMarkup = doc.order.some((id) => { const o = doc.objects[id]; return !!o && o.pageKey === op.pageKey && zStage(o) === "annot"; });
  const note = stage === "redact" ? t.layers.redactBelow : stage === "link" ? t.layers.linkAbove
    : stage === "annot" || pageHasMarkup ? t.layers.markupAbove : null;
  const s = editorStore.getState();
  const stack = (menu as ObjectMenu).stack;

  return shell(t.layers.contextMenu, "object-menu", <>
      {Z_COMMANDS.map((c) => item(c.move, c.label, c.icon, () => s.reorderObjects([op.id], c.move), { keys: zKeys(mac)[c.move], disabled: !moves[c.move] }))}
      <div role="separator" className="mx-1 my-1 h-px bg-line" />
      {copyable && item("duplicate", t.objects.duplicate, Copy, () => { s.select(op.id); duplicateSelection(); }, { keys: "Mod+D" })}
      {copyable && item("copy", t.objects.copy, ClipboardCopy, () => { s.select(op.id); copySelection(); }, { keys: "Mod+C" })}
      {textEdit && item("revert", t.text.revert, Undo2, () => s.deleteObject(op.id))}
      {textEdit
        ? item("delete", t.text.delete, Trash2, () => deleteObjectOrText(op.id), { keys: "Delete", danger: true, disabled: isDeletedText(op) })
        : item("delete", t.editor.delete, Trash2, () => s.deleteObject(op.id), { keys: "Delete", danger: true })}
      {stack.length > 1 && (
        <div role="group" aria-label={t.layers.pickBelow} className="flex flex-col">
          <div role="separator" className="mx-1 my-1 h-px bg-line" />
          <div aria-hidden className="flex h-7 items-center gap-2 px-2 text-2xs font-medium text-faint">
            <span className="flex-1 uppercase tracking-wider">{t.layers.pickBelow}</span>
            <Kbd keys={t.layers.altClick} />
          </div>
          {stack.map((id) => {
            const o = doc.objects[id];
            if (!o) return null;
            const { icon, label, detail } = objectLabel(o);
            const Icon = OBJECT_ICONS[icon];
            const on = id === selection;
            const colour = colourOf(o);
            return (
              <button key={id} role="menuitemradio" aria-checked={on} data-op-id={id} onClick={pick(() => s.select(id))}
                className={`${MENU_ITEM} ${on ? "text-accent-text" : "text-ink"}`}>
                <Icon {...ICON} className={on ? undefined : "text-muted"} />
                <span className="shrink-0">{label}</span>
                {detail && <span className="min-w-0 flex-1 truncate text-faint">{detail}</span>}
                {/* Two objects of one kind (Persegi, Persegi) tell apart by their colour. */}
                {colour && <span aria-hidden className="ml-auto h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset ring-line-strong" style={{ background: colour }} />}
              </button>
            );
          })}
        </div>
      )}
      {note && <p className="max-w-60 px-2 pb-1.5 pt-2 text-2xs leading-snug text-faint">{note}</p>}
  </>);
}
