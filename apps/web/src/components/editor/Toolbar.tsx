"use client";

import { useRef } from "react";
import type { ContentOp } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { newId } from "@/lib/id";
import { fitImage } from "@/lib/image";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, pageGeom, useEditor, type Tool } from "@/store/editor";
import { SplitButton } from "./SplitButton";
import { afterTextCommitted } from "./text/textEdit";

type NoticeFn = (n: { kind: "error" | "info"; text: string }) => void;

function ToolButton({ tool, label, icon, active }: { tool: Tool; label: string; icon: string; active: Tool }) {
  const pressed = active === tool;
  return (
    <button aria-label={label} aria-pressed={pressed} title={label} onClick={() => editorStore.getState().setTool(tool)}
      className={`flex h-9 items-center gap-1 rounded-md px-2 text-sm ${pressed ? "bg-accent/10 text-accent" : "hover:bg-bg"}`}>
      <span aria-hidden>{icon}</span><span className="hidden lg:inline">{label}</span>
    </button>
  );
}

export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const file = useRef<HTMLInputElement>(null);
  const s = editorStore.getState();
  const pick = (x: Tool) => s.setTool(x);

  async function addImage(f: File | undefined) {
    const st = editorStore.getState();
    if (!f || !st.info) return;
    const entry = st.doc.pages.find((p) => p.pageKey === st.currentPage) ?? st.doc.pages[0];
    try {
      const asset = await uploadAsset(st.info.docId, f);
      const g = pageGeom(entry, st.info);
      const rect = fitImage(asset.width, asset.height, g.width, g.height);
      const op = { id: newId(), type: "image.add", pageKey: entry.pageKey, rect, assetId: asset.asset_id } as ContentOp;
      st.addObject(op);
      st.setTool("select");
      st.select(op.id);
    } catch (e) {
      onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-3" role="toolbar" aria-label={t.editor.tools}>
      <button aria-label={t.editor.undo} title={t.editor.undo} disabled={!canUndo} onClick={() => afterTextCommitted(() => editorStore.getState().undo())} className="h-9 rounded-md px-2 hover:bg-bg disabled:opacity-40">↶</button>
      <button aria-label={t.editor.redo} title={t.editor.redo} disabled={!canRedo} onClick={() => afterTextCommitted(() => editorStore.getState().redo())} className="h-9 rounded-md px-2 hover:bg-bg disabled:opacity-40">↷</button>
      <span className="mx-2 h-6 w-px bg-line" />
      <ToolButton tool="select" label={t.editor.select} icon="↖" active={tool} />
      <ToolButton tool="text" label={t.editor.text} icon="T" active={tool} />
      <SplitButton label={t.editor.erase} active={tool} onPick={pick} options={[
        { tool: "whiteout", label: t.editor.whiteout, icon: "▭" },
        { tool: "redact", label: t.editor.redact, icon: "▮" },
      ]} />
      <ToolButton tool="ink" label={t.editor.draw} icon="✎" active={tool} />
      <button aria-label={t.editor.image} title={t.editor.image} onClick={() => file.current?.click()} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
        <span aria-hidden>🖼</span><span className="hidden lg:inline">{t.editor.image}</span>
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg" hidden data-testid="image-input" onChange={(e) => addImage(e.target.files?.[0])} />
      <SplitButton label={t.editor.shape} active={tool} onPick={pick} options={[
        { tool: "rect", label: t.editor.rect, icon: "□" },
        { tool: "ellipse", label: t.editor.ellipse, icon: "○" },
        { tool: "line", label: t.editor.line, icon: "╱" },
        { tool: "arrow", label: t.editor.arrow, icon: "→" },
      ]} />
    </div>
  );
}
