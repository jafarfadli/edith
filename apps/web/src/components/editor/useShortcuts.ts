"use client";

import { useEffect } from "react";
import { toolForKey } from "@/lib/toolKeys";
import { editorStore } from "@/store/editor";
import { viewStore } from "@/store/view";
import { openFind } from "./find/findStore";
import { isMac } from "@/lib/keys";
import { zMoveForKey } from "@/lib/zorder";
import { arrangeForKey, isCutKey, isSelectAllKey, nudgeForKey, tabForKey } from "@/lib/selectionKeys";
import { alignSelection, copySelection, cutSelection, distributeSelection, duplicateSelection, pasteClipboard } from "./objects/clipboard";
import { cycleObjects, deleteObjects, nudgeSelectedParagraph, nudgeSelection, selectAll } from "./objects/group";
import { moveSelection, openMenuForSelection } from "./objects/layering";
import { afterTextCommitted, deleteSelectedParagraph, textEditStore, textSessionBusy } from "./text/textEdit";

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
}

/** Whether a key press is meant for the canvas: nothing focused, or focus inside the page area (not a button, a menu). */
function focusOnCanvas(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !el || el === document.body || !!el.closest?.("#page-scroller");
}

/** Undo/redo keys: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. */
export function undoKey(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; key: string }): "undo" | "redo" | null {
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === "z") return e.shiftKey ? "redo" : "undo";
  if (e.ctrlKey && k === "y") return "redo";
  return null;
}

/** Ctrl/Cmd+F: opens Find, also from text fields and the rich editor. */
export function isFindKey(e: { metaKey: boolean; ctrlKey: boolean; key: string }): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f";
}

export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isFindKey(e)) { e.preventDefault(); openFind(); return; } // before the typing check
      // Space held: a drag pans the canvas (whatever the tool). Not from a button or field (Space is theirs), not
      // while typing in a text box or composing.
      if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing && !isTyping(e.target) && focusOnCanvas(e.target) && !textSessionBusy()) {
        e.preventDefault();
        viewStore.getState().setSpace(true);
        return;
      }
      // In a form field the document's undo, not the input's own (which would desync the controlled value).
      const formField = (e.target as HTMLElement | null)?.closest?.("[data-field]");
      const undo = undoKey(e);
      if (formField && undo) { e.preventDefault(); editorStore.getState()[undo](); return; }
      if (isTyping(e.target)) return;
      if (extra?.(e)) return;
      const s = editorStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const arrow = nudgeForKey(e);
      const nudge = s.selected.length ? arrow : null;
      const arrange = s.selected.length ? arrangeForKey(e) : null;
      // Tab walks the objects only while one is selected and focus is on the canvas, not on a button or field: it must
      // stay the way through the toolbar for the keyboard.
      const tab = s.selected.length && focusOnCanvas(e.target) ? tabForKey(e) : null;
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().undo()); }
      else if ((mod && k === "z" && e.shiftKey) || (e.ctrlKey && k === "y")) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().redo()); }
      else if (mod && k === "c" && !e.shiftKey && !e.altKey) { if (copySelection()) e.preventDefault(); } // else: the browser's copy
      else if (mod && k === "v" && !e.shiftKey && !e.altKey) { if (pasteClipboard()) e.preventDefault(); }
      else if (mod && k === "d" && !e.shiftKey && !e.altKey) { e.preventDefault(); duplicateSelection(); } // not the bookmark dialog
      else if (isCutKey(e)) { if (cutSelection()) e.preventDefault(); }
      else if (isSelectAllKey(e)) { e.preventDefault(); selectAll(); } // not the page's own text selection
      else if (nudge) { e.preventDefault(); nudgeSelection(nudge[0], nudge[1]); } // held: one undo step
      // An original paragraph, selected but not yet an object, is moved the same way (it becomes its text.edit op).
      else if (arrow && !s.selected.length && focusOnCanvas(e.target) && nudgeSelectedParagraph(arrow[0], arrow[1])) e.preventDefault();
      else if (arrange) { e.preventDefault(); if ("align" in arrange) alignSelection(arrange.align); else distributeSelection(arrange.distribute); }
      else if (tab) { e.preventDefault(); cycleObjects(tab); }
      // Only with an object selected: otherwise Ctrl/Cmd+[ ] stay the browser's Back/Forward.
      else if (s.selection && zMoveForKey(e, isMac())) { e.preventDefault(); moveSelection(zMoveForKey(e, isMac())!); }
      else if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && s.selection) { if (openMenuForSelection()) e.preventDefault(); }
      // An edit of original text loses its text rather than its op (which would bring the original back).
      else if ((e.key === "Delete" || e.key === "Backspace") && s.selected.length) { e.preventDefault(); deleteObjects(s.selected); }
      else if ((e.key === "Delete" || e.key === "Backspace") && deleteSelectedParagraph()) e.preventDefault();
      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); }
      else if (!e.repeat && !textSessionBusy() && toolForKey(e)) { e.preventDefault(); s.setTool(toolForKey(e)!); } // V, T, R …: see TOOL_KEYS
    }
    const spaceUp = (e: KeyboardEvent) => { if (e.code === "Space") viewStore.getState().setSpace(false); };
    const spaceOff = () => viewStore.getState().setSpace(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", spaceUp);
    window.addEventListener("blur", spaceOff);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", spaceUp);
      window.removeEventListener("blur", spaceOff);
    };
  }, [extra]);
}
