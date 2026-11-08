"use client";

import { EllipsisVertical } from "lucide-react";
import { t } from "@/lib/strings";
import { editorStore } from "@/store/editor";
import { ICON_SM } from "../ui/icon";
import { MenuButton } from "./MenuButton";
import { scrollToPage } from "./ZoomPill";

export function PageMenu({ pageKey, index, count }: { pageKey: string; index: number; count: number }) {
  const s = editorStore.getState();
  return (
    <div className="absolute right-2.5 top-2.5">
      <MenuButton label={t.editor.pageMenu} className="grid h-6 w-6 place-items-center rounded-md bg-raised text-muted opacity-0 shadow-pop transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/thumb:opacity-100 aria-expanded:opacity-100" items={[
        { label: t.editor.rotateLeft, run: () => s.rotatePage(pageKey, -90) },
        { label: t.editor.rotateRight, run: () => s.rotatePage(pageKey, 90) },
        { label: t.pages.duplicate, run: () => { const k = s.duplicatePage(pageKey); if (k) setTimeout(() => scrollToPage(k), 50); } },
        { label: t.editor.moveUp, run: () => s.movePage(pageKey, index - 1), disabled: index === 0 },
        { label: t.editor.moveDown, run: () => s.movePage(pageKey, index + 1), disabled: index === count - 1 },
        { label: t.editor.deletePage, run: () => s.deletePage(pageKey), disabled: count <= 1, danger: true },
      ]}><EllipsisVertical {...ICON_SM} /></MenuButton>
    </div>
  );
}
