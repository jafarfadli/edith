"use client";

import { useEffect } from "react";
import { editorStore } from "@/store/editor";
import { openFind } from "./find/findStore";
import { linkStore } from "./marks/linkStore";
import { afterTextCommitted, textEditStore } from "./text/textEdit";

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
}

/** Ctrl/Cmd+F: opens Find, also from text fields and the rich editor. */
export function isFindKey(e: { metaKey: boolean; ctrlKey: boolean; key: string }): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f";
}

export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isFindKey(e)) { e.preventDefault(); openFind(); return; } // before the typing check
      if (isTyping(e.target)) return;
      if (extra?.(e)) return;
      const s = editorStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().undo()); }
      else if ((mod && k === "z" && e.shiftKey) || (e.ctrlKey && k === "y")) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().redo()); }
      else if (mod && k === "k" && !e.shiftKey && !e.altKey) { e.preventDefault(); s.setTool("link"); }
      else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) { e.preventDefault(); s.deleteObject(s.selection); }
      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); linkStore.getState().close(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [extra]);
}
