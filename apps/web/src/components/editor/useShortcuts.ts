"use client";

import { useEffect } from "react";
import { toolForKey } from "@/lib/toolKeys";
import { editorStore } from "@/store/editor";
import { openFind } from "./find/findStore";
import { zMoveForKey } from "@/lib/zorder";
import { copySelection, duplicateSelection, pasteClipboard } from "./objects/clipboard";
import { moveSelection, openMenuForSelection } from "./objects/layering";
import { afterTextCommitted, textEditStore, textSessionBusy } from "./text/textEdit";

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
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
      // In a form field the document's undo, not the input's own (which would desync the controlled value).
      const formField = (e.target as HTMLElement | null)?.closest?.("[data-field]");
      const undo = undoKey(e);
      if (formField && undo) { e.preventDefault(); editorStore.getState()[undo](); return; }
      if (isTyping(e.target)) return;
      if (extra?.(e)) return;
      const s = editorStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().undo()); }
      else if ((mod && k === "z" && e.shiftKey) || (e.ctrlKey && k === "y")) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().redo()); }
      else if (mod && k === "c" && !e.shiftKey && !e.altKey) { if (copySelection()) e.preventDefault(); } // else: the browser's copy
      else if (mod && k === "v" && !e.shiftKey && !e.altKey) { if (pasteClipboard()) e.preventDefault(); }
      else if (mod && k === "d" && !e.shiftKey && !e.altKey) { e.preventDefault(); duplicateSelection(); } // not the bookmark dialog
      else if (zMoveForKey(e)) { e.preventDefault(); moveSelection(zMoveForKey(e)!); } // Cmd+[ is not the browser's Back here
      else if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && s.selection) { if (openMenuForSelection()) e.preventDefault(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) { e.preventDefault(); s.deleteObject(s.selection); }
      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); }
      else if (!e.repeat && !textSessionBusy() && toolForKey(e)) { e.preventDefault(); s.setTool(toolForKey(e)!); } // V, T, R …: see TOOL_KEYS
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [extra]);
}
