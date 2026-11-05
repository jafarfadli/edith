"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { toScreen, type PageGeom } from "@/lib/coords";
import { cssFamily, fontStore } from "@/lib/fonts";
import { boxFonts, plainText } from "@/lib/textbox";
import { commitEditing, textEditStore, type Editing } from "./textEdit";

export function TextEditor({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const editing = useStore(textEditStore, (s) => s.editing);
  if (!editing || editing.pageKey !== pageKey) return null;
  // Keyed by the edit session: a new session mounts a fresh textarea with that box's text.
  return <EditorArea key={editing.id} editing={editing} geom={geom} scale={scale} />;
}

function EditorArea({ editing, geom, scale }: { editing: Editing; geom: PageGeom; scale: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => plainText(editing.box));
  const textRef = useRef(text);
  const editingId = editing.id;

  useEffect(() => {
    boxFonts(editing.box).forEach((f) => { fontStore.load(f).catch(() => {}); });
    const timer = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    const el = ref.current;
    return () => {
      clearTimeout(timer);
      // Unmounted while still editing (page scrolled out of range, page deleted): commit, don't lose the text.
      // Checked after a tick so StrictMode's dev-only effect replay (node stays mounted) doesn't commit.
      setTimeout(() => {
        if (el?.isConnected) return;
        if (textEditStore.getState().editing?.id === editingId) void commitEditing(textRef.current);
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // Grow with the content (wrapped lines included).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  const { box } = editing;
  const run = box.paragraphs[0][0];
  const [left, top] = toScreen([box.rect.x, box.rect.y], geom, scale);

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      value={text}
      rows={1}
      onChange={(e) => { setText(e.target.value); textRef.current = e.target.value; }}
      onBlur={(e) => {
        if (document.activeElement === e.currentTarget) return; // window lost focus; keep editing
        void commitEditing(textRef.current);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); ref.current?.blur(); }
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
      style={{
        position: "absolute", left, top, zIndex: 10,
        width: box.rect.w * scale,
        minHeight: box.lineHeight * scale,
        transform: `rotate(${geom.rotation}deg)`, transformOrigin: "top left",
        fontFamily: `"${cssFamily(run.font)}"`, fontSize: run.size * scale,
        lineHeight: `${box.lineHeight * scale}px`, color: run.color, textAlign: box.align ?? "left",
        fontKerning: "none", fontVariantLigatures: "none", letterSpacing: 0,
        padding: 0, margin: 0, border: 0, outline: "1px dashed #0f766e", background: "rgba(255,255,255,0.85)",
        resize: "none", overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", boxSizing: "content-box",
      }}
    />
  );
}
