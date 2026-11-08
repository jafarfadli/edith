"use client";

import { useRef, useState } from "react";
import type { ContentOp } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { newId } from "@/lib/id";
import { fitImage } from "@/lib/image";
import { errorMessage, t } from "@/lib/strings";
import { editorStore, useEditor, type Tool } from "@/store/editor";
import { SignatureModal } from "./marks/SignatureModal";
import { cropStore } from "./pages/cropStore";
import { ManagePagesModal } from "./pages/ManagePagesModal";
import { StampPicker } from "./marks/StampPicker";
import { currentPage, placeObject } from "./placement";
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
  const [stampOpen, setStampOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const s = editorStore.getState();
  const pick = (x: Tool) => s.setTool(x);

  async function addImage(f: File | undefined) {
    const st = editorStore.getState();
    const at = currentPage();
    if (!f || !st.info || !at) return;
    try {
      const asset = await uploadAsset(st.info.docId, f);
      const rect = fitImage(asset.width, asset.height, at.size.width, at.size.height);
      placeObject({ id: newId(), type: "image.add", pageKey: at.entry.pageKey, rect, assetId: asset.asset_id } as ContentOp);
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
      <SplitButton label={t.annot.markup} active={tool} onPick={pick} options={[
        { tool: "highlight", label: t.annot.highlight, icon: "🖍" },
        { tool: "underline", label: t.annot.underline, icon: "U̲" },
        { tool: "strike", label: t.annot.strike, icon: "S̶" },
      ]} />
      <ToolButton tool="ink" label={t.editor.draw} icon="✎" active={tool} />
      <SplitButton label={t.editor.image} active={tool} options={[
        { key: "upload", label: t.annot.uploadImage, icon: "🖼", run: () => file.current?.click() },
        { key: "stamp", label: t.annot.stamp, icon: "🏷", run: () => setStampOpen(true) },
      ]} />
      {stampOpen && <StampPicker onClose={() => setStampOpen(false)} />}
      <input ref={file} type="file" accept="image/png,image/jpeg" hidden data-testid="image-input" onChange={(e) => addImage(e.target.files?.[0])} />
      <SplitButton label={t.editor.shape} active={tool} onPick={pick} options={[
        { tool: "rect", label: t.editor.rect, icon: "□" },
        { tool: "ellipse", label: t.editor.ellipse, icon: "○" },
        { tool: "line", label: t.editor.line, icon: "╱" },
        { tool: "arrow", label: t.editor.arrow, icon: "→" },
      ]} />
      <ToolButton tool="check" label={t.annot.check} icon="✓" active={tool} />
      <ToolButton tool="cross" label={t.annot.cross} icon="✗" active={tool} />
      <button aria-label={t.annot.signature} title={t.annot.signature} onClick={() => setSignatureOpen(true)} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
        <span aria-hidden>✍</span><span className="hidden lg:inline">{t.annot.signature}</span>
      </button>
      {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onNotice={onNotice} />}
      <ToolButton tool="note" label={t.annot.note} icon="🗒" active={tool} />
      <ToolButton tool="link" label={t.annot.link} icon="🔗" active={tool} />
      <div className="flex-1" />
      <button aria-label={t.pages.manage} title={t.pages.manage} onClick={() => setPagesOpen(true)} className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
        <span aria-hidden>▦</span><span className="hidden lg:inline">{t.pages.manage}</span>
      </button>
      {pagesOpen && <ManagePagesModal onClose={() => setPagesOpen(false)} />}
      <button aria-label={t.crop.title} title={t.crop.title} onClick={() => { const at = currentPage(); if (at) cropStore.getState().open(at.entry.pageKey); }}
        className="flex h-9 items-center gap-1 rounded-md px-2 text-sm hover:bg-bg">
        <span aria-hidden>⛶</span><span className="hidden lg:inline">{t.crop.title}</span>
      </button>
    </div>
  );
}
