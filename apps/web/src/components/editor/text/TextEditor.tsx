"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { EditorContent, useEditor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import type { Editor } from "@tiptap/core";
import { toScreen, type PageGeom } from "@/lib/coords";
import { cssFamily, fontKey, fontStore } from "@/lib/fonts";
import { attrsOf, docToRuns, runsToDoc, type RunAttrs } from "@/lib/richtext";
import { boxFonts, boxLineHeight } from "@/lib/textbox";
import { isFindKey } from "../useShortcuts";
import { createRunMark } from "./runMark";
import { commitOpenSession, preloadSessionFonts, session, textEditStore, type Editing } from "./textEdit";

export function TextEditor({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const editing = useStore(textEditStore, (s) => s.editing);
  if (!editing || editing.pageKey !== pageKey) return null;
  // Keyed by the session: a new session mounts a fresh editor with that box's runs.
  return <RichArea key={editing.id} editing={editing} geom={geom} scale={scale} />;
}

/** Tells the properties bar the style at the selection. */
function publish(editor: Editor, fallback: RunAttrs) {
  const a = editor.getAttributes("run") as Partial<RunAttrs>;
  textEditStore.getState().setCurrent(a.font ? { ...fallback, ...a } as RunAttrs : fallback);
}

function RichArea({ editing, geom, scale }: { editing: Editing; geom: PageGeom; scale: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useStore(textEditStore, (s) => s.editing?.box ?? editing.box);
  // Style of text that has none yet (an empty box, pasted text); fixed for the session.
  const [fallback] = useState(() => attrsOf(editing.box.paragraphs[0][0]));
  const editingId = editing.id;
  // Fonts this session asked for (a failing original is not re-fetched on every keystroke).
  const [requested] = useState(() => new Set<string>());

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [Document, Paragraph, Text, UndoRedo, createRunMark(() => fallback)],
    content: runsToDoc(editing.box.paragraphs) as never,
    // pre-wrap, not Tiptap's break-spaces: a space at a wrap hangs past the edge, as in the layout
    // (lines are measured without their trailing spaces), so a line that just fits wraps the same way.
    editorProps: { attributes: { "data-testid": "text-editor", spellcheck: "false", style: "outline:none;white-space:pre-wrap" } },
    onUpdate: ({ editor }) => {
      const paragraphs = docToRuns(editor.getJSON(), fallback);
      session.paragraphs = paragraphs;
      preloadSessionFonts(paragraphs);
      // Text typed with a style picked at an empty caret (or pasted) may need a font not loaded yet.
      for (const f of boxFonts({ ...editing.box, paragraphs })) {
        const key = fontKey(f);
        if (requested.has(key) || fontStore.peek(f)) continue;
        requested.add(key);
        fontStore.load(f).catch(() => {});
      }
      // A text box's line spacing follows its largest size while typing/styling (as the commit does).
      const cur = textEditStore.getState().editing;
      if (cur?.kind === "text.add" && cur.id === editingId) {
        const lineHeight = boxLineHeight(paragraphs);
        if (lineHeight !== cur.box.lineHeight) textEditStore.getState().update({ ...cur.box, lineHeight });
      }
    },
    // Every transaction: selection moves, and style changes (also stored marks of an empty selection).
    onTransaction: ({ editor }) => publish(editor, fallback),
  });

  // useEditor may create the editor more than once (React StrictMode): track the live instance.
  useEffect(() => {
    if (!editor) return;
    session.editor = editor;
    editor.commands.focus("end");
    if (editor.isEmpty) editor.commands.updateRuns(() => fallback); // typed text gets the box style
    publish(editor, fallback);
    return () => { if (session.editor === editor) session.editor = null; };
  }, [editor, fallback]);

  useEffect(() => {
    boxFonts(editing.box).forEach((f) => { fontStore.load(f).catch(() => {}); });
    // A press outside the editor and the properties bar ends the session (before the press acts).
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && (wrap.current?.contains(t) || t.closest("[data-text-props]"))) return;
      void commitOpenSession();
    };
    document.addEventListener("pointerdown", onDown, true);
    const el = wrap.current;
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      // Unmounted while still editing (page scrolled out of range, page deleted): commit, don't lose the text.
      // Checked after a tick so StrictMode's dev-only effect replay (node stays mounted) doesn't commit.
      setTimeout(() => {
        if (el?.isConnected) return;
        if (textEditStore.getState().editing?.id === editingId) void commitOpenSession();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const [left, top] = toScreen([box.rect.x, box.rect.y], geom, scale);
  return (
    <div
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); void commitOpenSession(); }
        if (isFindKey(e)) return; // Ctrl/Cmd+F reaches the window shortcut (opens Find)
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute", left, top, zIndex: 10,
        // +1 pt: the browser measures unquantized advances, slightly wider than the layout's.
        width: (box.rect.w + 1) * scale, minHeight: box.lineHeight * scale,
        transform: `rotate(${geom.rotation}deg)`, transformOrigin: "top left",
        ["--edith-scale" as string]: scale,
        fontFamily: `"${cssFamily(fallback.font)}"`, fontSize: fallback.size * scale, color: fallback.color,
        lineHeight: `${box.lineHeight * scale}px`, textAlign: box.align ?? "left",
        fontKerning: "none", fontVariantLigatures: "none", letterSpacing: 0,
        whiteSpace: "pre-wrap", overflowWrap: "break-word",
        outline: "1px dashed #0f766e", background: editing.kind === "text.edit" ? "#ffffff" : "rgba(255,255,255,0.85)",
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
