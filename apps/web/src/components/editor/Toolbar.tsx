"use client";

import {
  ArrowUpRight, Check, Circle, Cloud, Crop, Eraser, EyeOff, Highlighter, ImagePlus, LayoutGrid, MousePointer2, Pencil, Pentagon,
  Redo2, ScanText, Signature, Slash, Spline, Square, Stamp, Strikethrough, Type, Underline, Undo2, X, type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import type { ContentOp } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { newId } from "@/lib/id";
import { fitImage } from "@/lib/image";
import { errorMessage, t } from "@/lib/strings";
import { toolKey } from "@/lib/toolKeys";
import { editorStore, useEditor, type Tool } from "@/store/editor";
import { IconButton } from "../ui/IconButton";
import { SignatureModal } from "./marks/SignatureModal";
import { cropStore } from "./pages/cropStore";
import { ManagePagesModal } from "./pages/ManagePagesModal";
import { StampPicker } from "./marks/StampPicker";
import { currentPage, placeObject } from "./placement";
import { SplitButton } from "./SplitButton";
import { afterTextCommitted } from "./text/textEdit";

type NoticeFn = (n: { kind: "error" | "info"; text: string }) => void;

function ToolButton({ tool, label, icon, active }: { tool: Tool; label: string; icon: LucideIcon; active: Tool }) {
  return <IconButton label={label} icon={icon} keys={toolKey(tool)} pressed={active === tool} onClick={() => editorStore.getState().setTool(tool)} />;
}

const Sep = () => <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-line" />;

export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const file = useRef<HTMLInputElement>(null);
  const [stampOpen, setStampOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const pick = (x: Tool) => editorStore.getState().setTool(x);

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
    <div className="flex min-w-0 flex-1 items-center justify-center" role="toolbar" aria-label={t.editor.tools}>
      {/* p-1: room for the focus ring, which the horizontal scroller would otherwise clip. */}
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto p-1 [scrollbar-width:none]">
        <IconButton label={t.editor.undo} icon={Undo2} keys="Mod+Z" disabled={!canUndo} onClick={() => afterTextCommitted(() => editorStore.getState().undo())} />
        <IconButton label={t.editor.redo} icon={Redo2} keys="Mod+Shift+Z" disabled={!canRedo} onClick={() => afterTextCommitted(() => editorStore.getState().redo())} />
        <Sep />
        <ToolButton tool="select" label={t.editor.select} icon={MousePointer2} active={tool} />
        <ToolButton tool="text" label={t.editor.text} icon={Type} active={tool} />
        <ToolButton tool="ocr" label={t.ocr.areaTool} icon={ScanText} active={tool} />
        <SplitButton label={t.editor.erase} active={tool} onPick={pick} options={[
          { tool: "whiteout", label: t.editor.whiteout, icon: Eraser, keys: toolKey("whiteout") },
          { tool: "redact", label: t.editor.redact, icon: EyeOff },
        ]} />
        <Sep />
        <SplitButton label={t.annot.markup} active={tool} onPick={pick} options={[
          { tool: "highlight", label: t.annot.highlight, icon: Highlighter, keys: toolKey("highlight") },
          { tool: "underline", label: t.annot.underline, icon: Underline },
          { tool: "strike", label: t.annot.strike, icon: Strikethrough },
        ]} />
        <ToolButton tool="ink" label={t.editor.draw} icon={Pencil} active={tool} />
        <SplitButton label={t.editor.shape} active={tool} onPick={pick} options={[
          { tool: "rect", label: t.editor.rect, icon: Square, keys: toolKey("rect") },
          { tool: "ellipse", label: t.editor.ellipse, icon: Circle, keys: toolKey("ellipse") },
          { tool: "line", label: t.editor.line, icon: Slash, keys: toolKey("line") },
          { tool: "arrow", label: t.editor.arrow, icon: ArrowUpRight },
          { tool: "polygon", label: t.editor.polygon, icon: Pentagon },
          { tool: "polyline", label: t.editor.polyline, icon: Spline },
          { tool: "cloud", label: t.editor.cloud, icon: Cloud },
        ]} />
        <Sep />
        <SplitButton label={t.editor.image} active={tool} options={[
          { key: "upload", label: t.annot.uploadImage, icon: ImagePlus, run: () => file.current?.click() },
          { key: "stamp", label: t.annot.stamp, icon: Stamp, run: () => setStampOpen(true) },
        ]} />
        <IconButton label={t.annot.signature} icon={Signature} onClick={() => setSignatureOpen(true)} />
        <ToolButton tool="check" label={t.annot.check} icon={Check} active={tool} />
        <ToolButton tool="cross" label={t.annot.cross} icon={X} active={tool} />
        <Sep />
        <IconButton label={t.pages.manage} icon={LayoutGrid} onClick={() => setPagesOpen(true)} />
        <IconButton label={t.crop.title} icon={Crop} onClick={() => { const at = currentPage(); if (at) cropStore.getState().open(at.entry.pageKey); }} />
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg" hidden data-testid="image-input" onChange={(e) => addImage(e.target.files?.[0])} />
      {stampOpen && <StampPicker onClose={() => setStampOpen(false)} />}
      {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onNotice={onNotice} />}
      {pagesOpen && <ManagePagesModal onClose={() => setPagesOpen(false)} />}
    </div>
  );
}
