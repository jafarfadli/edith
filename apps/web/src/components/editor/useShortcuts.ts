"use client";

import { useEffect } from "react";
import { editorStore } from "@/store/editor";
import { afterTextCommitted, textEditStore } from "./text/textEdit";

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
}

export function useShortcuts(extra?: (e: KeyboardEvent) => boolean) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      if (extra?.(e)) return;
      const s = editorStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().undo()); }
      else if ((mod && k === "z" && e.shiftKey) || (e.ctrlKey && k === "y")) { e.preventDefault(); afterTextCommitted(() => editorStore.getState().redo()); }
      else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) { e.preventDefault(); s.deleteObject(s.selection); }
      else if (e.key === "Escape") { s.select(null); s.setTool("select"); textEditStore.getState().selectParagraph(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [extra]);
}
