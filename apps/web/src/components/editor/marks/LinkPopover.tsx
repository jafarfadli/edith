"use client";

// Not mounted since M5: the Link tool is hidden (owner decision). Kept with LinkTargetFields and linkStore so the
// tool can come back; link.add objects from older drafts still render, export and can be deleted.

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { LinkAdd } from "@edith/ops";
import { toScreen, type PageGeom } from "@/lib/coords";
import { newId } from "@/lib/id";
import type { LinkTarget } from "@/lib/links";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { LinkTargetFields } from "./LinkTargetFields";
import { linkStore } from "./linkStore";

/** Asks for the target of the link area just drawn on this page; saving adds the link.add op. */
export function LinkPopover({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const pending = useStore(linkStore, (s) => s.pending);
  const tool = useEditor((s) => s.tool);
  // Choosing another tool abandons the area (it opens with Pilih active).
  useEffect(() => { if (pending && tool !== "select") linkStore.getState().close(); }, [pending, tool]);
  if (!pending || pending.pageKey !== pageKey) return null;
  return <PopoverBody key={`${pending.rect.x},${pending.rect.y},${pending.rect.w},${pending.rect.h}`} pageKey={pageKey} geom={geom} scale={scale} />;
}

function PopoverBody({ pageKey, geom, scale }: { pageKey: string; geom: PageGeom; scale: number }) {
  const pending = useStore(linkStore, (s) => s.pending);
  const [target, setTarget] = useState<LinkTarget | null>(null);
  if (!pending || pending.pageKey !== pageKey) return null;
  const { rect } = pending;
  const corners = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]]
    .map((p) => toScreen(p as [number, number], geom, scale));
  const left = Math.min(...corners.map((c) => c[0])), top = Math.max(...corners.map((c) => c[1])) + 6;

  function close() { setTarget(null); linkStore.getState().close(); }
  function save() {
    if (!target || !pending) return;
    const op: LinkAdd = { id: newId(), type: "link.add", pageKey: pending.pageKey, rect: pending.rect, target };
    const s = editorStore.getState();
    s.addObject(op);
    s.select(op.id);
    close();
  }

  return (
    <div role="dialog" aria-label={t.link.title} data-testid="link-popover"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation(); // typing here is not an editor shortcut
        if (e.key === "Escape") close();
        // Enter saves from the URL field / page select only: on a button or radio it keeps its own meaning.
        const el = e.target as HTMLElement;
        if (e.key === "Enter" && (el.tagName === "INPUT" || el.tagName === "SELECT")) { e.preventDefault(); save(); }
      }}
      className="absolute z-20 flex flex-col gap-2 rounded-lg bg-raised p-3 shadow-pop" style={{ left, top }}>
      <span className="text-sm font-medium">{t.link.title}</span>
      <LinkTargetFields target={target} onChange={setTarget} autoFocus />
      <div className="flex justify-end gap-2 text-sm">
        <button type="button" onClick={close} className="rounded-md px-3 py-1 hover:bg-hover">{t.link.cancel}</button>
        <button type="button" onClick={save} disabled={!target} className="rounded-md bg-accent px-3 py-1 text-accent-ink disabled:opacity-50">{t.link.save}</button>
      </div>
    </div>
  );
}
