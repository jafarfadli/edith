"use client";

import { useRef, useState } from "react";
import type { ContentOp } from "@edith/ops";
import { ApiError, uploadAsset } from "@/lib/api";
import { putAsset } from "@/lib/library";
import { newId } from "@/lib/id";
import { fitImage } from "@/lib/image";
import { errorMessage, t } from "@/lib/strings";
import { toolKey } from "@/lib/toolKeys";
import { editorStore, useEditor, type Tool } from "@/store/editor";
import {
  ArrowIcon, CheckIcon, CloudIcon, CropIcon, CrossIcon, EllipseIcon, HighlightIcon, ImageAddIcon, LineIcon, OcrAreaIcon, PagesIcon,
  PencilIcon, PointerIcon, PolygonIcon, PolylineIcon, RectIcon, RedactIcon, SignatureIcon, StampIcon, StrikeIcon, TextIcon,
  UnderlineIcon, WhiteoutIcon,
} from "../brand/icons";
import { IconButton, type AnyIcon } from "../ui/IconButton";
import { SignatureModal } from "./marks/SignatureModal";
import { cropStore } from "./pages/cropStore";
import { ManagePagesModal } from "./pages/ManagePagesModal";
import { StampPicker } from "./marks/StampPicker";
import { currentPage, placeObject } from "./placement";
import { SplitButton } from "./SplitButton";

type NoticeFn = (n: { kind: "error" | "info"; text: string }) => void;

function ToolButton({ tool, label, caption, icon, active }: { tool: Tool; label: string; caption: string; icon: AnyIcon; active: Tool }) {
  return <IconButton label={label} caption={caption} icon={icon} keys={toolKey(tool)} pressed={active === tool} onClick={() => editorStore.getState().setTool(tool)} />;
}

/** Between groups of tools: a short rule across the rail (upright on wide screens, along the bottom bar on phones). */
const Sep = () => <span aria-hidden className="mx-1 h-8 w-px shrink-0 self-center bg-line sm:mx-0 sm:my-1 sm:h-px sm:w-9" />;

export function Toolbar({ onNotice }: { onNotice: NoticeFn }) {
  const tool = useEditor((s) => s.tool);
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
      void putAsset(st.info.editId, asset.asset_id, f).catch(() => undefined); // kept for when the server drops the document
      const rect = fitImage(asset.width, asset.height, at.size.width, at.size.height);
      placeObject({ id: newId(), type: "image.add", pageKey: at.entry.pageKey, rect, assetId: asset.asset_id } as ContentOp);
    } catch (e) {
      onNotice({ kind: "error", text: errorMessage(e instanceof ApiError ? e.code : "generic") });
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  const r = t.rail;
  return (
    // The rail: upright at the canvas's left on wide screens; on a phone the bar along the bottom, within thumb reach.
    <div className="order-last flex shrink-0 border-t border-line bg-panel sm:order-first sm:border-r sm:border-t-0" role="toolbar"
      aria-label={t.editor.tools} data-testid="tool-rail">
      {/* p-1.5: room for the focus ring, which the scroller would otherwise clip. */}
      <div className="flex min-w-0 items-start gap-0.5 overflow-x-auto p-1.5 [scrollbar-width:none] max-sm:pr-10 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-3rem),transparent)] sm:flex-col sm:items-center sm:overflow-y-auto sm:overflow-x-visible">
        <ToolButton tool="select" label={t.editor.select} caption={r.select} icon={PointerIcon} active={tool} />
        <ToolButton tool="text" label={t.editor.text} caption={r.text} icon={TextIcon} active={tool} />
        <ToolButton tool="ocr" label={t.ocr.areaTool} caption={r.ocr} icon={OcrAreaIcon} active={tool} />
        <SplitButton label={t.editor.erase} caption={r.erase} active={tool} onPick={pick} options={[
          { tool: "whiteout", label: t.editor.whiteout, icon: WhiteoutIcon, keys: toolKey("whiteout") },
          { tool: "redact", label: t.editor.redact, icon: RedactIcon },
        ]} />
        <Sep />
        <SplitButton label={t.annot.markup} caption={r.markup} active={tool} onPick={pick} options={[
          { tool: "highlight", label: t.annot.highlight, icon: HighlightIcon, keys: toolKey("highlight") },
          { tool: "underline", label: t.annot.underline, icon: UnderlineIcon },
          { tool: "strike", label: t.annot.strike, icon: StrikeIcon },
        ]} />
        <ToolButton tool="ink" label={t.editor.draw} caption={r.draw} icon={PencilIcon} active={tool} />
        <SplitButton label={t.editor.shape} caption={r.shape} active={tool} onPick={pick} options={[
          { tool: "rect", label: t.editor.rect, icon: RectIcon, keys: toolKey("rect") },
          { tool: "ellipse", label: t.editor.ellipse, icon: EllipseIcon, keys: toolKey("ellipse") },
          { tool: "line", label: t.editor.line, icon: LineIcon, keys: toolKey("line") },
          { tool: "arrow", label: t.editor.arrow, icon: ArrowIcon },
          { tool: "polygon", label: t.editor.polygon, icon: PolygonIcon },
          { tool: "polyline", label: t.editor.polyline, icon: PolylineIcon },
          { tool: "cloud", label: t.editor.cloud, icon: CloudIcon },
        ]} />
        <Sep />
        <SplitButton label={t.editor.image} caption={r.image} active={tool} options={[
          { key: "upload", label: t.annot.uploadImage, icon: ImageAddIcon, run: () => file.current?.click() },
          { key: "stamp", label: t.annot.stamp, icon: StampIcon, run: () => setStampOpen(true) },
        ]} />
        <IconButton label={t.annot.signature} caption={r.signature} icon={SignatureIcon} onClick={() => setSignatureOpen(true)} />
        <ToolButton tool="check" label={t.annot.check} caption={r.check} icon={CheckIcon} active={tool} />
        <ToolButton tool="cross" label={t.annot.cross} caption={r.cross} icon={CrossIcon} active={tool} />
        <Sep />
        <IconButton label={t.pages.manage} caption={r.pages} icon={PagesIcon} onClick={() => setPagesOpen(true)} />
        <IconButton label={t.crop.title} caption={r.crop} icon={CropIcon} onClick={() => { const at = currentPage(); if (at) cropStore.getState().open(at.entry.pageKey); }} />
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg" hidden data-testid="image-input" onChange={(e) => addImage(e.target.files?.[0])} />
      {stampOpen && <StampPicker onClose={() => setStampOpen(false)} />}
      {signatureOpen && <SignatureModal onClose={() => setSignatureOpen(false)} onNotice={onNotice} />}
      {pagesOpen && <ManagePagesModal onClose={() => setPagesOpen(false)} />}
    </div>
  );
}
