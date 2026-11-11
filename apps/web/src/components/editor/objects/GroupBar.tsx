"use client";

import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, Copy, Trash2, type LucideIcon,
} from "lucide-react";
import { isMarkup, type Align } from "@/lib/objects";
import { t } from "@/lib/strings";
import { editorStore, useEditor } from "@/store/editor";
import { ICON } from "../../ui/icon";
import { IconButton } from "../../ui/IconButton";
import { BTN_DANGER } from "../../ui/styles";
import { Tip } from "../../ui/Tooltip";
import { alignSelection, distributeSelection, duplicateSelection } from "./clipboard";
import { deleteObjects } from "./group";

const ALIGNS: { a: Align; label: string; icon: LucideIcon; keys: string }[] = [
  { a: "left", label: t.objects.groupAlignLeft, icon: AlignStartVertical, keys: "Alt+A" },
  { a: "center", label: t.objects.groupAlignCenter, icon: AlignCenterVertical, keys: "Alt+H" },
  { a: "right", label: t.objects.groupAlignRight, icon: AlignEndVertical, keys: "Alt+D" },
  { a: "top", label: t.objects.groupAlignTop, icon: AlignStartHorizontal, keys: "Alt+W" },
  { a: "middle", label: t.objects.groupAlignMiddle, icon: AlignCenterHorizontal, keys: "Alt+V" },
  { a: "bottom", label: t.objects.groupAlignBottom, icon: AlignEndHorizontal, keys: "Alt+S" },
];

const Sep = () => <span aria-hidden className="h-5 w-px shrink-0 bg-line" />;

/** The properties bar of a group (several objects selected): how many, align and distribute, duplicate and delete. */
export function GroupBar() {
  const ids = useEditor((s) => s.selected);
  const movable = useEditor((s) => s.selected.filter((id) => { const op = s.doc.objects[id]; return !!op && !isMarkup(op); }).length);
  return (
    <>
      <span data-testid="group-count" className="shrink-0 text-xs text-muted">{t.objects.selected(ids.length)}</span>
      <Sep />
      <div role="group" aria-label={t.objects.group} className="flex items-center gap-0.5">
        {ALIGNS.map((x) => <IconButton key={x.a} label={x.label} icon={x.icon} keys={x.keys} disabled={movable < 2} onClick={() => alignSelection(x.a)} />)}
        <IconButton label={movable < 3 ? `${t.objects.distributeX} (${t.objects.distributeNeedsThree})` : t.objects.distributeX} icon={AlignHorizontalDistributeCenter}
          keys="Alt+Shift+H" disabled={movable < 3} onClick={() => distributeSelection("x")} />
        <IconButton label={movable < 3 ? `${t.objects.distributeY} (${t.objects.distributeNeedsThree})` : t.objects.distributeY} icon={AlignVerticalDistributeCenter}
          keys="Alt+Shift+V" disabled={movable < 3} onClick={() => distributeSelection("y")} />
      </div>
      <Sep />
      <IconButton label={t.objects.duplicate} icon={Copy} keys="Mod+D" onClick={() => duplicateSelection()} />
      <Tip label={t.editor.delete} keys="Delete">
        <button onClick={() => deleteObjects(editorStore.getState().selected)} aria-keyshortcuts="Delete" className={BTN_DANGER}>
          <Trash2 {...ICON} />{t.editor.delete}
        </button>
      </Tip>
    </>
  );
}
